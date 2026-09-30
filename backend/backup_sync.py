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
    source_choice: str = "remote"
    local_import_at: str | None = None
    remote_import_at: str | None = None

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
            "source_choice": self.source_choice,
            "local_import_at": self.local_import_at,
            "remote_import_at": self.remote_import_at,
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


def _record_fields_merge(module: str, table: str, key: Any, local: dict[str, Any], remote: dict[str, Any], base: dict[str, Any] | None, fields: tuple[str, ...], report: MergeReport, resolutions: dict[str, str] | None, apply: bool) -> tuple[dict[str, Any], bool, bool]:
    merged = dict(remote)
    local_stamp = str(local.get("updated_at") or "")
    remote_stamp = str(remote.get("updated_at") or "")
    dominant: str | None = None
    # Without a retained common base, record-level timestamps are the safest
    # available ordering signal for user-entered fields. They do not apply when
    # three-way merge data exists, because base comparison is more precise.
    if base is None and local_stamp and remote_stamp and local_stamp != remote_stamp:
        dominant = "local" if local_stamp > remote_stamp else "remote"

    for field in fields:
        lv, rv = local.get(field), remote.get(field)
        if dominant:
            # Empty is not an implicit deletion. Even the newer record cannot
            # erase a non-empty value without a future explicit tombstone.
            if _blank(lv) and not _blank(rv):
                value = rv
            elif _blank(rv) and not _blank(lv):
                value = lv
            else:
                value = lv if dominant == "local" else rv
        else:
            value, _ = _choose_value(
                module, table, key, field,
                lv, rv,
                base is not None, base.get(field) if base else None,
                report, resolutions, apply,
            )
        merged[field] = value

    # updated_at is metadata. Never let an older timestamp erase a newer one.
    candidates = [stamp for stamp in (local_stamp, remote_stamp) if stamp]
    if candidates:
        merged["updated_at"] = max(candidates)

    check_fields = list(fields)
    if "updated_at" in local or "updated_at" in remote:
        check_fields.append("updated_at")
    write_needed = any(not _same(merged.get(field), remote.get(field)) for field in check_fields)
    changed_from_local = any(not _same(merged.get(field), local.get(field)) for field in fields)
    return merged, write_needed, changed_from_local

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
            merged, write_needed, changed_from_local = _record_fields_merge(module, table, key, local, remote, base, fields, report, resolutions, apply)
            if changed_from_local:
                report.updates += 1
            else:
                report.preserved_local += 1
            if apply and write_needed:
                set_fields = [f for f in fields if f in columns]
                if "updated_at" in columns and "updated_at" not in set_fields:
                    set_fields.append("updated_at")
                assignments = ",".join(f"{f}=?" for f in set_fields)
                where = " AND ".join(f"{f}=?" for f in key_fields)
                out.execute(
                    f"UPDATE {table} SET {assignments} WHERE {where}",
                    tuple(merged.get(f) for f in set_fields) + tuple(key),
                )
            continue

        if local is None and remote is not None:
            # The candidate database starts as a byte-consistent copy of remote.
            # If the record existed in the common base, its absence locally may be
            # a deliberate deletion; never guess -- require an explicit choice.
            if base is not None:
                choice = _record_presence_conflict(module, table, key, local, remote, base, report, resolutions, apply)
                if choice == "local":
                    report.preserved_local += 1
                    if apply:
                        where = " AND ".join(f"{f}=?" for f in key_fields)
                        out.execute(f"DELETE FROM {table} WHERE {where}", tuple(key))
                    continue
            report.additions += 1
            continue

        if local is not None and remote is None:
            if base is not None:
                choice = _record_presence_conflict(module, table, key, local, remote, base, report, resolutions, apply)
                if choice == "remote":
                    report.updates += 1
                    continue
            # Local-only work must be copied into the remote-based candidate.
            report.preserved_local += 1
            if apply:
                vals = [local.get(c) for c in columns]
                out.execute(
                    f"INSERT OR REPLACE INTO {table}({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
                    vals,
                )


def _source_import_stamp(module: str, path: Path, key_hex: str | None) -> str:
    if not path.exists():
        return ""
    con = secure_connect(path, key_hex=key_hex, readonly=True, timeout=30)
    try:
        if module == "followup":
            row = con.execute("SELECT imported_at FROM import_batches ORDER BY id DESC LIMIT 1").fetchone()
            if row and row[0]:
                return str(row[0])
            row = con.execute("SELECT MAX(imported_at) FROM orders").fetchone()
            return str((row or [""])[0] or "")
        if module == "compras":
            row = con.execute("SELECT data FROM settings WHERE id='import'").fetchone()
            if not row:
                return ""
            try:
                return str(json.loads(row[0]).get("at") or "")
            except Exception:
                return ""
        return ""
    except Exception:
        return ""
    finally:
        con.close()


def _set_source_choice(report: MergeReport, module: str, local: Path, remote: Path, key_hex: str | None) -> str:
    local_at = _source_import_stamp(module, local, key_hex)
    remote_at = _source_import_stamp(module, remote, key_hex)
    report.local_import_at = local_at or None
    report.remote_import_at = remote_at or None
    report.source_choice = "local" if local_at and local_at > remote_at else "remote"
    return report.source_choice


def _copy_table_snapshot(source: Path, out, table: str, key_hex: str | None) -> None:
    source_con = secure_connect(source, key_hex=key_hex, readonly=True, timeout=30)
    try:
        source_con.row_factory = row_factory(key_hex)
        src_cols = [str(r[1]) for r in source_con.execute(f"PRAGMA table_info({table})").fetchall()]
        out_cols = [str(r[1]) for r in out.execute(f"PRAGMA table_info({table})").fetchall()]
        if not src_cols or src_cols != out_cols:
            raise ValueError(f"A estrutura da tabela {table} diverge entre os dois bancos; a restauração foi bloqueada antes de alterar a base ativa.")
        rows = [_row_dict(row) for row in source_con.execute(f"SELECT * FROM {table}").fetchall()]
        out.execute(f"DELETE FROM {table}")
        if rows:
            out.executemany(
                f"INSERT INTO {table}({','.join(src_cols)}) VALUES({','.join('?' for _ in src_cols)})",
                [tuple(row.get(c) for c in src_cols) for row in rows],
            )
    finally:
        source_con.close()


def _apply_newer_local_source_snapshot(module: str, local: Path, out, key_hex: str | None) -> None:
    if module == "followup":
        for table in ("orders", "receipts", "import_batches"):
            _copy_table_snapshot(local, out, table, key_hex)
        return
    if module == "compras":
        _copy_table_snapshot(local, out, "items", key_hex)
        source_con = secure_connect(local, key_hex=key_hex, readonly=True, timeout=30)
        try:
            row = source_con.execute("SELECT data FROM settings WHERE id='import'").fetchone()
            if row:
                out.execute("INSERT OR REPLACE INTO settings(id,data) VALUES('import',?)", (row[0],))
        finally:
            source_con.close()


def _table_rows(path: Path, table: str, key_hex: str | None) -> tuple[list[str], list[dict[str, Any]]]:
    if not path.exists():
        return [], []
    con = secure_connect(path, key_hex=key_hex, readonly=True, timeout=30)
    try:
        con.row_factory = row_factory(key_hex)
        columns = [str(r[1]) for r in con.execute(f"PRAGMA table_info({table})").fetchall()]
        if not columns:
            return [], []
        return columns, [_row_dict(row) for row in con.execute(f"SELECT * FROM {table}").fetchall()]
    finally:
        con.close()


def _insert_dict(out, table: str, row: dict[str, Any], *, omit: tuple[str, ...] = ()) -> int:
    columns = [c for c in row.keys() if c not in omit]
    out.execute(
        f"INSERT INTO {table}({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
        tuple(row.get(c) for c in columns),
    )
    return int(getattr(out.execute("SELECT last_insert_rowid()").fetchone(), "__getitem__", lambda _: 0)(0) or 0)


def _output_has_table(out, table: str) -> bool:
    try:
        return bool(out.execute(f"PRAGMA table_info({table})").fetchall())
    except Exception:
        return False


def _overlay_local_settings(local: Path, out, key_hex: str | None) -> None:
    columns, rows = _table_rows(local, "settings", key_hex)
    if not columns or not _output_has_table(out, "settings"):
        return
    for row in rows:
        if "key" in row and "value" in row:
            out.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (row["key"], row["value"]))


def _merge_followup_execution_history(local: Path, out, key_hex: str | None) -> None:
    # Follow-up/message tables are operational history, not source-of-truth
    # imports. Keep the remote HEAD and append locally-created runs that are absent.
    followup_columns, local_followups = _table_rows(local, "followups", key_hex)
    if not followup_columns or not _output_has_table(out, "followups"):
        return
    remote_followups = {
        (r[0], r[1], r[2], r[3]): r[4]
        for r in out.execute("SELECT batch_id,supplier_key,message,sent_at,id FROM followups").fetchall()
    }
    followup_id_map: dict[int, int] = {}
    local_item_columns, local_items = _table_rows(local, "followup_items", key_hex)
    if not _output_has_table(out, "followup_items"):
        local_items = []
    items_by_followup: dict[int, list[dict[str, Any]]] = {}
    for item in local_items:
        items_by_followup.setdefault(int(item.get("followup_id") or 0), []).append(item)
    for row in local_followups:
        old_id = int(row.get("id") or 0)
        signature = (row.get("batch_id"), row.get("supplier_key"), row.get("message"), row.get("sent_at"))
        if signature in remote_followups:
            followup_id_map[old_id] = int(remote_followups[signature])
            continue
        new_id = _insert_dict(out, "followups", row, omit=("id",))
        followup_id_map[old_id] = new_id
        remote_followups[signature] = new_id
        for item in items_by_followup.get(old_id, []):
            out.execute(
                "INSERT OR IGNORE INTO followup_items(followup_id,item_key,urgency) VALUES(?,?,?)",
                (new_id, item.get("item_key"), item.get("urgency")),
            )

    batch_columns, local_batches = _table_rows(local, "message_batches", key_hex)
    if not batch_columns or not _output_has_table(out, "message_batches"):
        local_batches = []
    for row in local_batches:
        existing = out.execute("SELECT finished_at,started_at,created_at FROM message_batches WHERE batch_id=?", (row.get("batch_id"),)).fetchone()
        if existing is None:
            _insert_dict(out, "message_batches", row)
            continue
        local_stamp = str(row.get("finished_at") or row.get("started_at") or row.get("created_at") or "")
        remote_stamp = str(existing[0] or existing[1] or existing[2] or "")
        if local_stamp > remote_stamp:
            columns = [c for c in row.keys() if c != "batch_id"]
            out.execute(
                f"UPDATE message_batches SET {','.join(c+'=?' for c in columns)} WHERE batch_id=?",
                tuple(row.get(c) for c in columns) + (row.get("batch_id"),),
            )

    queue_columns, local_queue = _table_rows(local, "message_queue", key_hex)
    queue_item_columns, local_queue_items = _table_rows(local, "message_queue_items", key_hex)
    if not queue_columns or not _output_has_table(out, "message_queue"):
        local_queue = []
    if not queue_item_columns or not _output_has_table(out, "message_queue_items"):
        local_queue_items = []
    items_by_queue: dict[int, list[dict[str, Any]]] = {}
    for item in local_queue_items:
        items_by_queue.setdefault(int(item.get("queue_id") or 0), []).append(item)
    for row in local_queue:
        old_qid = int(row.get("id") or 0)
        key = (row.get("batch_id"), row.get("supplier_key"))
        existing = out.execute(
            "SELECT id,finished_at,started_at,created_at FROM message_queue WHERE batch_id=? AND supplier_key=?",
            key,
        ).fetchone()
        if existing is None:
            copy = dict(row)
            copy["followup_id"] = followup_id_map.get(int(row.get("followup_id") or 0)) if row.get("followup_id") else None
            new_qid = _insert_dict(out, "message_queue", copy, omit=("id",))
            for item in items_by_queue.get(old_qid, []):
                out.execute(
                    "INSERT OR IGNORE INTO message_queue_items(queue_id,item_key,urgency) VALUES(?,?,?)",
                    (new_qid, item.get("item_key"), item.get("urgency")),
                )
            continue
        local_stamp = str(row.get("finished_at") or row.get("started_at") or row.get("created_at") or "")
        remote_stamp = str(existing[1] or existing[2] or existing[3] or "")
        if local_stamp > remote_stamp:
            columns = [c for c in row.keys() if c not in {"id", "batch_id", "supplier_key", "followup_id"}]
            out.execute(
                f"UPDATE message_queue SET {','.join(c+'=?' for c in columns)} WHERE id=?",
                tuple(row.get(c) for c in columns) + (int(existing[0]),),
            )


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

    # Candidate starts from remote. Append local history events that the remote
    # HEAD does not already contain; numeric IDs are intentionally ignored.
    semantic = ("oc", "supplier_key", "control_status", "note", "changed_at")
    lhist = _fetch_rows(local, "order_control_history", ("id",), key_hex)
    rhist = _fetch_rows(remote, "order_control_history", ("id",), key_hex)
    have = {tuple(row.get(f) for f in semantic) for row in rhist.values()}
    for row in lhist.values():
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

    if apply:
        _merge_followup_execution_history(local, out, key_hex)
        _overlay_local_settings(local, out, key_hex)


def _merge_json_value(module: str, table: str, key: str, path: str, local: Any, remote: Any, base_present: bool, base: Any, report: MergeReport, resolutions: dict[str, str] | None, apply: bool):
    if _same(local, remote):
        return remote

    if base_present:
        if _same(local, base) and not _same(remote, base):
            return remote
        if _same(remote, base) and not _same(local, base):
            return local

    if isinstance(local, dict) and isinstance(remote, dict) and (not base_present or isinstance(base, dict)):
        # Candidate starts from remote; missing remote keys are supplemented by
        # local data, while remote-only keys remain unless a real tombstone/base
        # proves an intentional deletion.
        result = dict(remote)
        base_dict = base if isinstance(base, dict) else {}
        for k in sorted(set(local) | set(remote)):
            if k not in local:
                continue
            if k not in remote:
                result[k] = local[k]
                continue
            result[k] = _merge_json_value(
                module, table, key, f"{path}.{k}" if path else k,
                local[k], remote[k],
                base_present and k in base_dict, base_dict.get(k),
                report, resolutions, apply,
            )
        return result

    # Stable-id lists are merged as sets of records while retaining remote order,
    # then appending genuinely local-only entries.
    if isinstance(local, list) and isinstance(remote, list) and all(isinstance(x, dict) and "id" in x for x in local + remote):
        lmap = {str(x["id"]): x for x in local}
        rmap = {str(x["id"]): x for x in remote}
        bmap = {str(x["id"]): x for x in base} if base_present and isinstance(base, list) and all(isinstance(x, dict) and "id" in x for x in base) else {}
        result = []
        seen: set[str] = set()
        for item in remote:
            rid = str(item["id"])
            seen.add(rid)
            if rid in lmap:
                result.append(_merge_json_value(
                    module, table, key, f"{path}[{rid}]",
                    lmap[rid], item, rid in bmap, bmap.get(rid),
                    report, resolutions, apply,
                ))
            else:
                result.append(item)
        for item in local:
            rid = str(item["id"])
            if rid not in seen:
                result.append(item)
        return result

    if _blank(local) and not _blank(remote):
        return remote
    if _blank(remote) and not _blank(local):
        return local

    cid = _conflict_id(module, table, key, path or "data", "json_field")
    report.conflicts.append({
        "id": cid, "kind": "json_field", "table": table, "record_key": key,
        "field": path or "data", "local": local, "remote": remote,
        "base": base if base_present else None,
    })
    if not apply:
        return local
    choice = (resolutions or {}).get(cid)
    if choice == "remote":
        return remote
    if choice == "local":
        return local
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
                        out.execute("DELETE FROM maps WHERE id=?", (mid,))
                        report.preserved_local += 1
                        continue
                    if choice not in {"remote", "both"}:
                        raise ValueError(f"Conflito sem resolução: {cid}")
                else:
                    continue
            report.additions += 1
            continue
        if l is not None and r is None:
            if b is not None:
                choice = _record_presence_conflict("compras", "maps", mid, l, r, b, report, resolutions, apply)
                if choice == "remote":
                    report.updates += 1
                    continue
            report.preserved_local += 1
            if apply:
                out.execute("INSERT OR REPLACE INTO maps(id,data) VALUES(?,?)", (mid, json.dumps(l, ensure_ascii=False)))
            continue
        if _same(l, r):
            report.equal += 1
            continue
        merged = _merge_json_value("compras", "maps", mid, "", l, r, b is not None, b, report, resolutions, apply)
        changed_from_local = not _same(merged, l)
        write_needed = not _same(merged, r)
        if changed_from_local:
            report.updates += 1
        else:
            report.preserved_local += 1
        if apply and write_needed:
            out.execute("UPDATE maps SET data=? WHERE id=?", (json.dumps(merged, ensure_ascii=False), mid))

    # Candidate starts from remote. Append local-only message history. If the
    # same immutable message id differs, retain the local copy and report it.
    lmsg = _fetch_json_rows(local, "messages", key_hex)
    rmsg = _fetch_json_rows(remote, "messages", key_hex)
    for mid, l in lmsg.items():
        if mid not in rmsg:
            report.history_added += 1
            if apply:
                out.execute("INSERT INTO messages(id,data) VALUES(?,?)", (mid, json.dumps(l, ensure_ascii=False)))
        elif not _same(l, rmsg[mid]):
            report.warnings.append({"kind": "message_history_divergence", "table": "messages", "record_key": mid, "action": "kept_local"})
            if apply:
                out.execute("UPDATE messages SET data=? WHERE id=?", (json.dumps(l, ensure_ascii=False), mid))
    if apply:
        _overlay_local_settings(local, out, key_hex)


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
    _set_source_choice(report, module, local, remote, key_hex)
    if module == "followup":
        _merge_followup(local, remote, base, None, key_hex, report, None, False)
    elif module == "compras":
        _merge_compras(local, remote, base, None, key_hex, report, None, False)
    else:
        raise ValueError("Módulo inválido.")
    return report.as_dict()


def apply_merge(module: str, local: Path, remote: Path, output: Path, base: Path | None, key_hex: str | None, resolutions: dict[str, str]) -> dict[str, Any]:
    # Start from the remote HEAD, then replace only the imported source snapshot
    # if this PC proves it imported a newer daily base. User-entered operational
    # data is merged separately below.
    _copy_database(remote, output, key_hex)
    out = secure_connect(output, key_hex=key_hex, readonly=False, timeout=30)
    try:
        out.execute("PRAGMA foreign_keys=ON")
        out.execute("BEGIN IMMEDIATE")
        report = MergeReport(module)
        source_choice = _set_source_choice(report, module, local, remote, key_hex)
        if source_choice == "local":
            _apply_newer_local_source_snapshot(module, local, out, key_hex)
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
