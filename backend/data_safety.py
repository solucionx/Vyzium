from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from secure_sqlite import connect as db_connect, database_errors


class DataIntegrityError(RuntimeError):
    """Raised when an existing SQLite/SQLCipher database fails an integrity check."""


class DataSafetyManager:
    PROTECTED_REASON_PREFIXES = ("pre-upgrade-", "pre-update-", "pre-encryption-")

    """Conservative backup/integrity helper for plaintext SQLite and SQLCipher.

    A key is optional. Without a key the behavior is the same as Vyzium 3.0.4.
    With a key every connection, including backup destinations and integrity
    checks, uses SQLCipher so no decrypted backup is written to disk.
    """

    def __init__(
        self,
        db_path: str | Path,
        module_name: str,
        app_version: str,
        *,
        auto_retention: int = 10,
        key_hex: str | None = None,
    ):
        self.db_path = Path(db_path).expanduser().resolve()
        self.module_name = str(module_name)
        self.app_version = str(app_version)
        self.auto_retention = max(3, int(auto_retention))
        self.key_hex = str(key_hex or "").strip().lower() or None
        self.backup_dir = self.db_path.parent / "backups" / self.module_name
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    @property
    def has_existing_database(self) -> bool:
        try:
            return self.db_path.is_file() and self.db_path.stat().st_size > 0
        except OSError:
            return False

    def _connect_readonly(self, path: Path):
        return db_connect(path, key_hex=self.key_hex, readonly=True, timeout=10)

    def check_path(self, path: str | Path, *, full: bool = False) -> dict[str, Any]:
        target = Path(path).expanduser().resolve()
        if not target.is_file() or target.stat().st_size <= 0:
            return {"ok": False, "result": "arquivo ausente", "path": str(target)}
        pragma = "integrity_check" if full else "quick_check"
        try:
            con = self._connect_readonly(target)
            try:
                rows = [str(row[0]) for row in con.execute(f"PRAGMA {pragma}").fetchall()]
            finally:
                con.close()
        except database_errors() + (OSError, RuntimeError) as exc:
            return {"ok": False, "result": str(exc), "path": str(target)}
        ok = rows == ["ok"]
        return {"ok": ok, "result": "ok" if ok else "; ".join(rows[:12]), "path": str(target)}

    def existing_schema_version(self) -> int:
        if not self.has_existing_database:
            return 0
        con = self._connect_readonly(self.db_path)
        try:
            exists = con.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
            ).fetchone()
            if not exists:
                return 0
            row = con.execute("SELECT MAX(version) FROM schema_migrations").fetchone()
            return int((row or [0])[0] or 0)
        except database_errors() + (ValueError, TypeError) as exc:
            raise DataIntegrityError(
                f"Não foi possível identificar a versão estrutural do banco existente: {exc}"
            ) from exc
        finally:
            con.close()

    def assert_existing_integrity(self) -> None:
        if not self.has_existing_database:
            return
        result = self.check_path(self.db_path, full=False)
        if not result["ok"]:
            raise DataIntegrityError(
                "O banco de dados existente não passou na verificação de integridade. "
                "O Vyzium bloqueou qualquer alteração para preservar os dados. "
                f"Detalhe: {result['result']}"
            )

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _manifest_path(self, backup_path: Path) -> Path:
        return backup_path.with_suffix(backup_path.suffix + ".json")

    def _write_manifest(self, backup_path: Path, *, reason: str, automatic: bool) -> dict[str, Any]:
        protected = str(reason).lower().startswith(self.PROTECTED_REASON_PREFIXES)
        manifest = {
            "database": self.module_name,
            "source_name": self.db_path.name,
            "app_version": self.app_version,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "reason": reason,
            "automatic": bool(automatic),
            "protected": protected,
            "encrypted": bool(self.key_hex),
            "integrity": "ok",
            "sha256": self._sha256(backup_path),
            "size_bytes": backup_path.stat().st_size,
        }
        self._manifest_path(backup_path).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return manifest

    def _safe_reason(self, reason: str) -> str:
        cleaned = "".join(c if c.isalnum() or c in "-_" else "-" for c in str(reason).lower()).strip("-")
        return cleaned[:48] or "backup"

    def _prune_automatic(self) -> None:
        candidates: list[tuple[float, Path]] = []
        for manifest_path in self.backup_dir.glob("*.db.json"):
            try:
                data = json.loads(manifest_path.read_text(encoding="utf-8"))
                if not data.get("automatic"):
                    continue
                reason = str(data.get("reason", "")).lower()
                if data.get("protected") or reason.startswith(self.PROTECTED_REASON_PREFIXES):
                    continue
                db_path = Path(str(manifest_path)[:-5])
                if db_path.exists():
                    candidates.append((db_path.stat().st_mtime, db_path))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
        candidates.sort(reverse=True)
        for _, old in candidates[self.auto_retention:]:
            try:
                old.unlink(missing_ok=True)
                self._manifest_path(old).unlink(missing_ok=True)
            except OSError:
                pass

    def backup(
        self,
        *,
        reason: str,
        source_connection: Any | None = None,
        automatic: bool = True,
    ) -> dict[str, Any]:
        if not self.has_existing_database and source_connection is None:
            return {"created": False, "reason": "Banco ainda não existe."}

        safe_reason = self._safe_reason(reason)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        final_path = self.backup_dir / f"{self.db_path.stem}-{safe_reason}-{stamp}.db"
        temp_path = final_path.with_suffix(".tmp")
        temp_path.unlink(missing_ok=True)

        owned_source = None
        destination = None
        try:
            source = source_connection
            if source is None:
                owned_source = self._connect_readonly(self.db_path)
                source = owned_source
            destination = db_connect(temp_path, key_hex=self.key_hex, timeout=15)
            source.backup(destination, pages=256, sleep=0.01)
            destination.commit()
            destination.close()
            destination = None

            verified = self.check_path(temp_path, full=True)
            if not verified["ok"]:
                raise DataIntegrityError(f"O backup criado não passou na verificação: {verified['result']}")

            os.replace(temp_path, final_path)
            manifest = self._write_manifest(final_path, reason=safe_reason, automatic=automatic)
            if automatic:
                self._prune_automatic()
            return {
                "created": True,
                "path": str(final_path),
                "filename": final_path.name,
                "created_at": manifest["created_at"],
                "reason": safe_reason,
                "sha256": manifest["sha256"],
                "size_bytes": manifest["size_bytes"],
                "encrypted": bool(self.key_hex),
            }
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise
        finally:
            if destination is not None:
                destination.close()
            if owned_source is not None:
                owned_source.close()

    def _manifest_records(self) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for manifest_path in self.backup_dir.glob("*.db.json"):
            try:
                data = json.loads(manifest_path.read_text(encoding="utf-8"))
                db_path = Path(str(manifest_path)[:-5])
                if not db_path.is_file():
                    continue
                records.append({**data, "filename": db_path.name, "path": str(db_path), "exists": True})
            except (OSError, ValueError, json.JSONDecodeError):
                continue
        records.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return records

    def _record_is_valid(self, item: dict[str, Any], *, full: bool = True) -> bool:
        try:
            backup_path = Path(str(item.get("path", ""))).expanduser().resolve()
            if not backup_path.is_file() or backup_path.stat().st_size <= 0:
                return False
            if bool(item.get("encrypted")) != bool(self.key_hex):
                return False
            expected_size = item.get("size_bytes")
            if expected_size is not None and int(expected_size) != backup_path.stat().st_size:
                return False
            expected_hash = str(item.get("sha256", "")).strip().lower()
            if not expected_hash or self._sha256(backup_path).lower() != expected_hash:
                return False
            return bool(self.check_path(backup_path, full=full).get("ok"))
        except (OSError, ValueError, TypeError):
            return False

    def has_version_backup(self) -> bool:
        expected = self._safe_reason(f"pre-upgrade-{self.app_version}")
        for item in self._manifest_records():
            if str(item.get("reason", "")).lower() != expected:
                continue
            if item.get("integrity") != "ok":
                continue
            if self._record_is_valid(item, full=True):
                return True
        return False

    def ensure_version_backup(self, source_connection: Any | None = None) -> dict[str, Any]:
        if not self.has_existing_database:
            return {"created": False, "reason": "Banco novo."}
        if self.has_version_backup():
            return {"created": False, "reason": "Backup desta versão já existe."}
        return self.backup(
            reason=f"pre-upgrade-{self.app_version}",
            source_connection=source_connection,
            automatic=True,
        )

    def status(self) -> dict[str, Any]:
        integrity = (
            self.check_path(self.db_path, full=False)
            if self.has_existing_database
            else {"ok": True, "result": "novo", "path": str(self.db_path)}
        )
        records = self._manifest_records()
        last_backup = records[0] if records else None
        if last_backup is not None:
            last_backup = {**last_backup, "valid_now": self._record_is_valid(last_backup, full=True)}
        return {
            "database": self.module_name,
            "database_path": str(self.db_path),
            "backup_dir": str(self.backup_dir),
            "encrypted": bool(self.key_hex),
            "integrity": integrity,
            "backup_count": len(records),
            "last_backup": last_backup,
            "recent_backups": records[:10],
            "auto_retention": self.auto_retention,
        }
