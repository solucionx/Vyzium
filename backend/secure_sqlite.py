from __future__ import annotations

import os
import re
import sqlite3 as plain_sqlite
from pathlib import Path
from typing import Any

try:
    from sqlcipher3 import dbapi2 as cipher_sqlite
except Exception:  # pragma: no cover - validated explicitly at runtime/build time
    cipher_sqlite = None

_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def key_from_env(*, consume: bool = True) -> str | None:
    """Read the per-module database key handed over by the Electron process.

    The key travels through the child process environment, which is the weakest
    link of the chain: on Windows another process running as the same user can
    read a live process environment block. Removing the variable as soon as it
    has been read shrinks that window to the first instants of startup, since
    the block the OS exposes is updated when the variable is unset.
    """
    value = str(os.environ.get("VYZIUM_DB_KEY_HEX", "")).strip()
    if not value:
        return None
    if not _HEX_RE.fullmatch(value):
        if consume:
            os.environ.pop("VYZIUM_DB_KEY_HEX", None)
        raise RuntimeError("A chave criptográfica local do Vyzium possui formato inválido.")
    if consume:
        os.environ.pop("VYZIUM_DB_KEY_HEX", None)
    return value.lower()


def cipher_available() -> bool:
    return cipher_sqlite is not None


def database_errors() -> tuple[type[BaseException], ...]:
    errors: list[type[BaseException]] = [plain_sqlite.DatabaseError]
    if cipher_sqlite is not None:
        errors.append(cipher_sqlite.DatabaseError)
    return tuple(errors)


def row_factory(key_hex: str | None = None):
    if key_hex:
        if cipher_sqlite is None:
            raise RuntimeError("O componente SQLCipher não está disponível nesta instalação do Vyzium.")
        return cipher_sqlite.Row
    return plain_sqlite.Row


def _memory_security_enabled() -> bool:
    # SQLCipher keeps this feature disabled by default. On Windows, enabling it can
    # repeatedly call VirtualLock() and produce LastError=1453 on constrained or
    # restricted processes. Keep the stable SQLCipher default unless explicitly
    # requested for a controlled environment. This does not change encryption at rest.
    value = str(os.environ.get("VYZIUM_CIPHER_MEMORY_SECURITY", "")).strip().lower()
    return value in {"1", "true", "yes", "on"}


def _apply_key(con: Any, key_hex: str) -> None:
    if not _HEX_RE.fullmatch(key_hex):
        raise RuntimeError("A chave criptográfica local possui formato inválido.")
    # Raw 256-bit key avoids deriving the database key from a user password.
    con.execute(f"PRAGMA key = \"x'{key_hex}'\"")
    con.execute(f"PRAGMA cipher_memory_security = {'ON' if _memory_security_enabled() else 'OFF'}")
    # Force an early read so an invalid key fails before any schema/write operation.
    con.execute("SELECT count(*) FROM sqlite_master").fetchone()


def connect(
    path: str | Path,
    *,
    key_hex: str | None = None,
    readonly: bool = False,
    timeout: float = 10,
    check_same_thread: bool = True,
):
    target = Path(path).expanduser().resolve()
    key_hex = key_hex or None
    if key_hex:
        if cipher_sqlite is None:
            raise RuntimeError(
                "O SQLCipher não foi incluído nesta instalação. Reinstale o Vyzium antes de abrir dados protegidos."
            )
        if readonly:
            uri = target.as_uri() + "?mode=ro"
            con = cipher_sqlite.connect(uri, uri=True, timeout=timeout, check_same_thread=check_same_thread)
        else:
            con = cipher_sqlite.connect(str(target), timeout=timeout, check_same_thread=check_same_thread)
        _apply_key(con, key_hex)
        return con

    if readonly:
        uri = target.as_uri() + "?mode=ro"
        return plain_sqlite.connect(uri, uri=True, timeout=timeout, check_same_thread=check_same_thread)
    return plain_sqlite.connect(str(target), timeout=timeout, check_same_thread=check_same_thread)


def ensure_cipher_runtime() -> dict[str, str | bool]:
    if cipher_sqlite is None:
        return {"available": False, "version": "", "cipher_version": ""}
    con = cipher_sqlite.connect(":memory:")
    try:
        version = str(con.execute("select sqlite_version()").fetchone()[0])
        cipher_version = str(con.execute("pragma cipher_version").fetchone()[0])
        return {"available": bool(cipher_version), "version": version, "cipher_version": cipher_version}
    finally:
        con.close()
