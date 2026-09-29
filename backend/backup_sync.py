from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from secure_sqlite import connect as secure_connect, key_from_env, row_factory


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value: Any) -> str:
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()[:20]


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _same(a: Any, b: Any) -> bool:
    return a == b


def _row_dict(row: Any) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def _connect(path: str | Path, key_hex: str | None, *, readonly: bool):
    con = secure_connect(path, key_hex=key_hex, readonly=readonly, timeout=30)
    con.row_factory = getattr(con, "row_factory", None) or None
    return con


def _fetch_rows(path: Path, table: str, key_fields: tuple[str, ...], key_hex: str | None) -> dict[tuple[Any, ...], dict[str, Any]]:
    if not path.exists():
        return {}
    con = secure_connect(path, key_hex=key_hex, readonly=True, timeout=30)
    try:
        con.row_factory = row_factory(key_hex)
        columns = [str(r[1]) for r in con.execute(f"PRAGMA table_info({table})").fetchall()]
        if not columns:
            return {}
        rows = {}
        for row in con.execute(f"SELECT * FROM {table}").fetchall():
            item = _row_dict(row)
            rows[tuple(item.get(k) for k in key_fields)] = item
        return rows
    finally:
        con.close()


def _fetch_json_rows(path: Path, table: str, key_hex: str | None) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    con = secure_connect(path, key_hex=key_hex, readonly=True, timeout=30)
    try:
        rows = {}
        for rid, raw in con.execute(f"SELECT id,data FROM {table}").fetchall():
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {"__raw__": str(raw)}
            rows[str(rid)] = parsed
        return rows
    finally:
        con.close()


def _conflict_id(module: str, table: str, record_key: Any, field: str, kind: str) -> str:
    return f"{module}:{table}:{_hash([record_key, field, kind])}"


@dataclass
class MergeReport:
    module: str
    additions: int = 0
    updates: int = 0
    preserved_local: int = 0
    equal: int = 0
    history_added: int = 0
    conflicts: list[dict[str, Any]] | None = None
    warnings: list[dict[str, Any]] | None = None

    def __post_init__(self):
        if self.conflicts is None:
            self.conflicts = []
        if self.warnings is None:
            self.warnings = []

    def as_dict(self) -> dict[str, Any]:
        return {
            "module": self.module,
            "additions": self.additions,
            "updates": self.updates,
            "preserved_local": self.preserved_local,
            "equal": self.equal,
            "history_added": self.history_added,
            "conflict_count": len(self.conflicts or []),
            "conflicts": self.conflicts or [],
            "warnings": self.warnings or [],
        }


def _choose_value(module: str, table: str, key: Any, field: str, local: Any, remote: Any, base_present: bool, base: Any, report: MergeReport, resolutions: dict[str, str] | None, apply: bool):
    if _same(local, remote):
        return local, False

    if base_present:
        if _same(local, base) and not _same(remote, base):
            return remote, True
        if _same(remote, base) and not _same(local, base):
            return local, False

    # Empty values never erase a non-empty value implicitly. Explicit deletion
    # will be represented by sync tombstones in later changes, not by omission.
    if _blank(local) and not _blank(remote):
        return remote, True
    if _blank(remote) and not _blank(local):
        return local, False

    cid = _conflict_id(module, table, key, field, "field")
    conflict = {
        "id": cid,
        "kind": "field",
        "table": table,
        "record_key": key,
        "field": field,
        "local": local,
        "remote": remote,
        "base": base if base_present else None,
    }
    report.conflicts.append(conflict)
    if not apply:
        return local, False
    choice = (resolutions or {}).get(cid)
    if choice == "remote":
        return remote, True
    if choice == "local":
        return local, False
    raise ValueError(f"Conflito sem resolução: {cid}")


def _record_fields_merge(module: str, table: str, key: Any, local: dict[str, Any], remote: dict[str, Any], base: dict[str, Any] | None, fields: tuple[str, ...], report: MergeReport, resolutions: dict[str, str] | None, apply: bool) -> tuple[dict[str, Any], bool]:
    merged = dict(local)
    changed = False
    for field in fields:
        value, did_change = _choose_value(
            module, table, key, field,
            local.get(field), remote.get(field),
            base is not None, base.get(field) if base else None,
            report, resolutions, apply,
        )
        merged[field] = value
        changed = changed or did_change

    # updated_at is metadata. Never let an older timestamp erase a newer one.
    if "updated_at" in local or "updated_at" in remote:
        candidates = [str(v) for v in (local.get("updated_at"), remote.get("updated_at")) if v]
        if candidates:
            merged["updated_at"] = max(candidates)
    return merged, changed


def _record_presence_conflict(module: str, table: str, key: Any, local: dict[str, Any] | None, remote: dict[str, Any] | None, base: dict[str, Any] | None, report: MergeReport, resolutions: dict[str, str] | None, apply: bool) -> str:
    cid = _conflict_id(module, table, key, "__row__", "possible_deletion")
    conflict = {
        "id": cid,
        "kind": "possible_deletion",
        "table": table,
        "record_key": key,
        "field": "__row__",
        "local": local,
        "remote": remote,
        "base": base,
    }
    report.conflicts.append(conflict)
    if not apply:
        return "local" if local is not None else "remote"
    choice = (resolutions or {}).get(cid)
    if choice in {"local", "remote"}:
        return choice
    raise ValueError(f"Conflito sem resolução: {cid}")


def _merge_keyed_table(
    out,
    module: str,
    table: str,
    key_fields: tuple[str, ...],
    fields: tuple[str, ...],
    local_rows: dict[tuple[Any, ...], dict[str, Any]],
    remote_rows: dict[tuple[Any, ...], dict[str, Any]],
    base_rows: dict[tuple[Any, ...], dict[str, Any]],
    report: MergeReport,
    resolutions: dict[str, str] | None,
    apply: bool,
):
    columns = None
    if apply:
        columns = [str(r[1]) for r in out.execute(f"PRAGMA table_info({table})").fetchall()]
    for key in sorted(set(local_rows) | set(remote_rows), key=lambda v: _json(v)):
        local = local_rows.get(key)
        remote = remote_rows.get(key)
        base = base_rows.get(key)

        if local is not None and remote is not None:
            if all(_same(local.get(f), remote.get(f)) for f in fields):
                report.equal += 1
                continue
            merged, changed = _record_fields_merge(module, table, key, local, remote, base, fields, report, resolutions, apply)
            if changed:
                report.updates += 1
                if apply:
                    set_fields = [f for f in fields if f in columns]
                    if "updated_at" in columns and "updated_at" not in set_fields:
                        set_fields.append("updated_at")
                    assignments = ",".join(f"{f}=?" for f in set_fields)
                    where = " AND ".join(f"{f}=?" for f in key_fields)
                    out.execute(
                        f"UPDATE {table} SET {assignments} WHERE {where}",
                        tuple(merged.get(f) for f in set_fields) + tuple(key),
                    )
            else:
                report.preserved_local += 1
            continue

        if local is None and remote is not None:
            if base is not None:
                choice = _record_presence_conflict(module, table, key, local, remote, base, report, resolutions, apply)
                if choice == "local":
                    report.preserved_local += 1
                    continue
            report.additions += 1
            if apply:
                vals = [remote.get(c) for c in columns]
                out.execute(
                    f"INSERT OR REPLACE INTO {table}({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
                    vals,
                )
            continue

        if local is not None and remote is None:
            if base is not None:
                choice = _record_presence_conflict(module, table, key, local, remote, base, report, resolutions, apply)
                if choice == "remote" and apply:
                    where = " AND ".join(f"{f}=?" for f in key_fields)
                    out.execute(f"DELETE FROM {table} WHERE {where}", tuple(key))
                    report.updates += 1
                    continue
            report.preserved_local += 1


def _merge_followup(local: Path, remote: Path, base: Path | None, out, key_hex: str | None, report: MergeReport, resolutions: dict[str, str] | None, apply: bool):
    specs = [
        ("order_controls", ("oc", "supplier_key"), ("control_status", "note", "sent_at")),
        ("suppliers", ("supplier_key",), ("display_name", "phone", "contact_name", "active")),
    ]
    for table, keys, fields in specs:
        l = _fetch_rows(local, table, keys, key_hex)
        r = _fetch_rows(remote, table, keys, key_hex)
        b = _fetch_rows(base, table, keys, key_hex) if base and base.exists() else {}
        _merge_keyed_table(out, "followup", table, keys, fields, l, r, b, report, resolutions, apply)

    # History is append-only semantically. IDs are machine-local and are never
    # used as identity during merge.
    semantic = ("oc", "supplier_key", "control_status", "note", "changed_at")
    lhist = _fetch_rows(local, "order_control_history", ("id",), key_hex)
    rhist = _fetch_rows(remote, "order_control_history", ("id",), key_hex)
    have = {tuple(row.get(f) for f in semantic) for row in lhist.values()}
    for row in rhist.values():
        signature = tuple(row.get(f) for f in semantic)
        if signature in have:
            continue
        have.add(signature)
        report.history_added += 1
        if apply:
            out.execute(
                "INSERT INTO order_control_history(oc,supplier_key,control_status,note,changed_at) VALUES(?,?,?,?,?)",
                signature,
            )


def _merge_json_value(module: str, table: str, key: str, path: str, local: Any, remote: Any, base_present: bool, base: Any, report: MergeReport, resolutions: dict[str, str] | None, apply: bool):
    if _same(local, remote):
        return local, False
    if base_present:
        if _same(local, base):
            return remote, True
        if _same(remote, base):
            return local, False

    if isinstance(local, dict) and isinstance(remote, dict) and (not base_present or isinstance(base, dict)):
        result = dict(local)
        changed = False
        base_dict = base if isinstance(base, dict) else {}
        for k in sorted(set(local) | set(remote)):
            lv = local.get(k)
            rv = remote.get(k)
            bp = base_present and k in base_dict
            bv = base_dict.get(k)
            if k not in local:
                result[k] = rv
                changed = True
                continue
            if k not in remote:
                # Absence is not deletion without a tombstone.
                continue
            merged, did = _merge_json_value(module, table, key, f"{path}.{k}" if path else k, lv, rv, bp, bv, report, resolutions, apply)
            result[k] = merged
            changed = changed or did
        return result, changed

    # Lists of dictionaries with stable "id" are merged by id. Other lists are
    # treated as one field to avoid guessing order/deletion semantics.
    if isinstance(local, list) and isinstance(remote, list) and all(isinstance(x, dict) and "id" in x for x in local + remote):
        lmap = {str(x["id"]): x for x in local}
        rmap = {str(x["id"]): x for x in remote}
        bmap = {str(x["id"]): x for x in base} if base_present and isinstance(base, list) and all(isinstance(x, dict) and "id" in x for x in base) else {}
        order = [str(x["id"]) for x in local]
        result = list(local)
        result_map = {str(x["id"]): i for i, x in enumerate(result)}
        changed = False
        for rid in [*order, *[x for x in rmap if x not in lmap]]:
            if rid not in lmap:
                result.append(rmap[rid]); changed = True; continue
            if rid not in rmap:
                continue
            merged, did = _merge_json_value(module, table, key, f"{path}[{rid}]", lmap[rid], rmap[rid], rid in bmap, bmap.get(rid), report, resolutions, apply)
            if did:
                result[result_map[rid]] = merged; changed = True
        return result, changed

    if _blank(local) and not _blank(remote):
        return remote, True
    if _blank(remote) and not _blank(local):
        return local, False

    cid = _conflict_id(module, table, key, path or "data", "json_field")
    report.conflicts.append({
        "id": cid, "kind": "json_field", "table": table, "record_key": key,
        "field": path or "data", "local": local, "remote": remote,
        "base": base if base_present else None,
    })
    if not apply:
        return local, False
    choice = (resolutions or {}).get(cid)
    if choice == "remote":
        return remote, True
    if choice == "local":
        return local, False
    raise ValueError(f"Conflito sem resolução: {cid}")


def _merge_compras(local: Path, remote: Path, base: Path | None, out, key_hex: str | None, report: MergeReport, resolutions: dict[str, str] | None, apply: bool):
    lmaps = _fetch_json_rows(local, "maps", key_hex)
    rmaps = _fetch_json_rows(remote, "maps", key_hex)
    bmaps = _fetch_json_rows(base, "maps", key_hex) if base and base.exists() else {}

    # Potential duplicates with different IDs are never silently added.
    local_names = {}
    for mid, data in lmaps.items():
        name = str(data.get("name", "")).strip().casefold() if isinstance(data, dict) else ""
        if name:
            local_names.setdefault(name, []).append(mid)

    for mid in sorted(set(lmaps) | set(rmaps)):
        l = lmaps.get(mid); r = rmaps.get(mid); b = bmaps.get(mid)
        if l is None and r is not None:
            name = str(r.get("name", "")).strip().casefold() if isinstance(r, dict) else ""
            possible = [x for x in local_names.get(name, []) if x != mid]
            if possible:
                cid = _conflict_id("compras", "maps", mid, "__duplicate__", "potential_duplicate")
                report.conflicts.append({
                    "id": cid, "kind": "potential_duplicate", "table": "maps", "record_key": mid,
                    "field": "__duplicate__", "local": {"existing_ids": possible, "name": r.get("name")},
                    "remote": r, "base": None,
                })
                if apply:
                    choice = (resolutions or {}).get(cid)
                    if choice == "local":
                        report.preserved_local += 1
                        continue
                    if choice not in {"remote", "both"}:
                        raise ValueError(f"Conflito sem resolução: {cid}")
                else:
                    continue
            report.additions += 1
            if apply:
                out.execute("INSERT OR REPLACE INTO maps(id,data) VALUES(?,?)", (mid, json.dumps(r, ensure_ascii=False)))
            continue
        if l is not None and r is None:
            if b is not None:
                choice = _record_presence_conflict("compras", "maps", mid, l, r, b, report, resolutions, apply)
                if apply and choice == "remote":
                    out.execute("DELETE FROM maps WHERE id=?", (mid,))
                    report.updates += 1
                    continue
            report.preserved_local += 1
            continue
        if _same(l, r):
            report.equal += 1
            continue
        merged, changed = _merge_json_value("compras", "maps", mid, "", l, r, b is not None, b, report, resolutions, apply)
        if changed:
            report.updates += 1
            if apply:
                out.execute("UPDATE maps SET data=? WHERE id=?", (json.dumps(merged, ensure_ascii=False), mid))
        else:
            report.preserved_local += 1

    # Message history is unioned by ID. Conflicting copies are preserved locally
    # and reported as a warning; a restore must never re-send or downgrade a local
    # delivery state because another PC had an older message record.
    lmsg = _fetch_json_rows(local, "messages", key_hex)
    rmsg = _fetch_json_rows(remote, "messages", key_hex)
    for mid, r in rmsg.items():
        if mid not in lmsg:
            report.history_added += 1
            if apply:
                out.execute("INSERT INTO messages(id,data) VALUES(?,?)", (mid, json.dumps(r, ensure_ascii=False)))
        elif not _same(lmsg[mid], r):
            report.warnings.append({"kind": "message_history_divergence", "table": "messages", "record_key": mid, "action": "kept_local"})


def _quick_check(path: Path, key_hex: str | None):
    con = secure_connect(path, key_hex=key_hex, readonly=True, timeout=30)
    try:
        rows = [str(r[0]) for r in con.execute("PRAGMA quick_check").fetchall()]
        if rows != ["ok"]:
            raise ValueError("Banco mesclado não passou no quick_check.")
    finally:
        con.close()


def _copy_database(source: Path, output: Path, key_hex: str | None):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    src = secure_connect(source, key_hex=key_hex, readonly=True, timeout=30)
    dst = secure_connect(output, key_hex=key_hex, readonly=False, timeout=30)
    try:
        src.backup(dst, pages=256, sleep=0.01)
        dst.commit()
    finally:
        dst.close(); src.close()
    _quick_check(output, key_hex)


def analyze(module: str, local: Path, remote: Path, base: Path | None, key_hex: str | None) -> dict[str, Any]:
    report = MergeReport(module)
    if module == "followup":
        _merge_followup(local, remote, base, None, key_hex, report, None, False)
    elif module == "compras":
        _merge_compras(local, remote, base, None, key_hex, report, None, False)
    else:
        raise ValueError("Módulo inválido.")
    return report.as_dict()


def apply_merge(module: str, local: Path, remote: Path, output: Path, base: Path | None, key_hex: str | None, resolutions: dict[str, str]) -> dict[str, Any]:
    _copy_database(local, output, key_hex)
    out = secure_connect(output, key_hex=key_hex, readonly=False, timeout=30)
    try:
        out.execute("PRAGMA foreign_keys=ON")
        out.execute("BEGIN IMMEDIATE")
        report = MergeReport(module)
        if module == "followup":
            _merge_followup(local, remote, base, out, key_hex, report, resolutions, True)
        elif module == "compras":
            _merge_compras(local, remote, base, out, key_hex, report, resolutions, True)
        else:
            raise ValueError("Módulo inválido.")
        unresolved = [c["id"] for c in report.conflicts if c["id"] not in resolutions]
        if unresolved:
            raise ValueError("Existem conflitos sem resolução.")
        out.commit()
    except Exception:
        out.rollback()
        raise
    finally:
        out.close()
    _quick_check(output, key_hex)
    result = report.as_dict()
    result["output"] = str(output)
    return result


def snapshot(source: Path, output: Path, key_hex: str | None) -> dict[str, Any]:
    _copy_database(source, output, key_hex)
    return {"ok": True, "path": str(output), "size_bytes": output.stat().st_size}


def main() -> None:
    parser = argparse.ArgumentParser(description="Vyzium safe backup merge")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("analyze", "apply"):
        p = sub.add_parser(name)
        p.add_argument("--module", required=True, choices=["followup", "compras"])
        p.add_argument("--local", required=True)
        p.add_argument("--remote", required=True)
        p.add_argument("--base")
        if name == "apply":
            p.add_argument("--output", required=True)
            p.add_argument("--resolutions", required=True)
    p = sub.add_parser("snapshot")
    p.add_argument("--source", required=True)
    p.add_argument("--output", required=True)
    args = parser.parse_args()

    key_hex = key_from_env(consume=True)
    if args.command == "analyze":
        result = analyze(args.module, Path(args.local), Path(args.remote), Path(args.base) if args.base else None, key_hex)
    elif args.command == "apply":
        resolutions = json.loads(Path(args.resolutions).read_text(encoding="utf-8"))
        result = apply_merge(args.module, Path(args.local), Path(args.remote), Path(args.output), Path(args.base) if args.base else None, key_hex, resolutions)
    else:
        result = snapshot(Path(args.source), Path(args.output), key_hex)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        raise SystemExit(2)
