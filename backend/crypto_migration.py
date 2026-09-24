from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from secure_sqlite import connect as secure_connect, ensure_cipher_runtime


class MigrationError(RuntimeError):
    pass


def _report_stage(stage: str) -> None:
    # Human-readable marker consumed by the Electron launcher when a native
    # SQLCipher process terminates before Python can raise a normal exception.
    print(f"VYZIUM_SECURITY_STAGE:{stage}", file=sys.stderr, flush=True)


def _report_progress(
    message: str,
    *,
    module_name: str = '',
    current: int | None = None,
    total: int | None = None,
    stage: str = '',
) -> None:
    payload: dict[str, Any] = {
        'message': str(message),
        'module': str(module_name or ''),
        'stage': str(stage or ''),
    }
    if current is not None:
        payload['current'] = int(current)
    if total is not None:
        payload['total'] = int(total)
        payload['percent'] = 100 if total <= 0 else max(0, min(100, round((int(current or 0) / total) * 100)))
    print('VYZIUM_SECURITY_PROGRESS:' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')), file=sys.stderr, flush=True)


def _quote_ident(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def _copy_database_batched(src: Any, dst: Any, *, module_name: str = '') -> None:
    """Copy a normal SQLite database to an already-keyed SQLCipher connection.

    This deliberately avoids ATTACH/sqlcipher_export (which was crashing natively on
    Windows in this project) and also avoids executing one INSERT statement at a
    time through ``iterdump()``. Tables are created first, rows are transferred with
    parameterized ``executemany`` batches, then indexes/views/triggers are restored.
    The destination is temporary until all validations pass, so migration-speed
    pragmas do not weaken the active database or the retained legacy source.
    """
    tables = src.execute(
        """
        SELECT name, sql
        FROM sqlite_master
        WHERE type='table'
          AND name NOT LIKE 'sqlite_%'
          AND sql IS NOT NULL
        ORDER BY rowid
        """
    ).fetchall()

    # Vyzium databases use ordinary SQLite tables. A virtual table would create
    # shadow tables implicitly and needs a specialized migration path; fail clearly
    # rather than risking an incomplete encrypted copy.
    virtual = [str(name) for name, sql in tables if str(sql or '').lstrip().upper().startswith('CREATE VIRTUAL TABLE')]
    if virtual:
        raise MigrationError('A migração encontrou tabela virtual não suportada: ' + ', '.join(virtual[:8]))

    counts: dict[str, int] = {}
    total_rows = 0
    for name, _sql in tables:
        qname = _quote_ident(str(name))
        count = int(src.execute(f'SELECT COUNT(*) FROM {qname}').fetchone()[0])
        counts[str(name)] = count
        total_rows += count

    # These settings apply only to the disposable temporary encrypted destination.
    # If the process stops, the source remains untouched and the temp file is never
    # activated. This removes the fsync-per-step cost that made the UI look frozen.
    dst.execute('PRAGMA foreign_keys=OFF')
    try:
        dst.execute('PRAGMA journal_mode=MEMORY')
    except Exception:
        pass
    dst.execute('PRAGMA synchronous=OFF')
    dst.execute('PRAGMA temp_store=MEMORY')
    dst.execute('PRAGMA cache_size=-32768')
    dst.execute('BEGIN IMMEDIATE')

    copied_rows = 0
    try:
        _report_progress('Criando estrutura do banco criptografado…', module_name=module_name, stage='schema')
        for _name, sql in tables:
            dst.execute(str(sql))

        for table_name, _sql in tables:
            table_name = str(table_name)
            qname = _quote_ident(table_name)
            # hidden=0 keeps ordinary columns and excludes generated/hidden columns.
            xinfo = src.execute(f'PRAGMA table_xinfo({qname})').fetchall()
            columns = [str(row[1]) for row in xinfo if len(row) < 7 or int(row[6] or 0) == 0]
            table_total = counts.get(table_name, 0)
            if table_total and not columns:
                raise MigrationError(f'Não foi possível identificar as colunas da tabela {table_name}.')

            if not columns:
                continue
            qcols = ','.join(_quote_ident(column) for column in columns)
            placeholders = ','.join('?' for _ in columns)
            select_sql = f'SELECT {qcols} FROM {qname}'
            insert_sql = f'INSERT INTO {qname} ({qcols}) VALUES ({placeholders})'
            cursor = src.execute(select_sql)
            table_copied = 0
            while True:
                batch = cursor.fetchmany(1000)
                if not batch:
                    break
                dst.executemany(insert_sql, batch)
                size = len(batch)
                table_copied += size
                copied_rows += size
                overall_percent = 100 if total_rows <= 0 else round((copied_rows / total_rows) * 100)
                _report_progress(
                    f'Copiando dados — {table_name}: {table_copied}/{table_total} ({overall_percent}%)',
                    module_name=module_name,
                    current=copied_rows,
                    total=total_rows,
                    stage='data',
                )

        # Preserve AUTOINCREMENT high-water marks exactly, including values above
        # the current MAX(id) after deleted records.
        has_sequence = src.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
        ).fetchone()
        if has_sequence:
            seq_rows = src.execute('SELECT name, seq FROM sqlite_sequence').fetchall()
            try:
                dst.execute('DELETE FROM sqlite_sequence')
                if seq_rows:
                    dst.executemany('INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)', seq_rows)
            except Exception as exc:
                raise MigrationError('Não foi possível preservar sqlite_sequence.') from exc

        _report_progress('Restaurando índices e visualizações…', module_name=module_name, stage='schema-objects')
        for object_type in ('index', 'view', 'trigger'):
            rows = src.execute(
                """
                SELECT name, sql
                FROM sqlite_master
                WHERE type=?
                  AND name NOT LIKE 'sqlite_%'
                  AND sql IS NOT NULL
                ORDER BY rowid
                """,
                (object_type,),
            ).fetchall()
            for _name, sql in rows:
                dst.execute(str(sql))

        dst.commit()
    except Exception:
        try:
            dst.rollback()
        except Exception:
            pass
        raise
    finally:
        # Return durable defaults before the temporary file is validated/activated.
        try:
            dst.execute('PRAGMA synchronous=FULL')
        except Exception:
            pass
        try:
            dst.execute('PRAGMA journal_mode=DELETE')
        except Exception:
            pass



def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def _plain_integrity(path: Path, *, full: bool = True) -> None:
    uri = path.resolve().as_uri() + '?mode=ro'
    con = sqlite3.connect(uri, uri=True, timeout=15)
    try:
        pragma = 'integrity_check' if full else 'quick_check'
        rows = [str(r[0]) for r in con.execute(f'PRAGMA {pragma}').fetchall()]
        if rows != ['ok']:
            raise MigrationError('Banco legado não passou na verificação: ' + '; '.join(rows[:12]))
    finally:
        con.close()


def _snapshot_plain(source: Path, target: Path) -> None:
    target.unlink(missing_ok=True)
    src = sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=15)
    dst = sqlite3.connect(target, timeout=15)
    try:
        src.backup(dst, pages=256, sleep=0.01)
        dst.commit()
    finally:
        dst.close()
        src.close()
    _plain_integrity(target, full=True)


def _table_counts(con: Any) -> dict[str, int]:
    rows = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    out: dict[str, int] = {}
    for row in rows:
        name = str(row[0])
        quoted = '"' + name.replace('"', '""') + '"'
        out[name] = int(con.execute(f'SELECT COUNT(*) FROM {quoted}').fetchone()[0])
    return out


def _schema_signature(con: Any) -> list[tuple[str, str, str, str]]:
    rows = con.execute(
        """
        SELECT type, name, tbl_name, COALESCE(sql, '')
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
          AND type IN ('table', 'index', 'trigger', 'view')
        ORDER BY type, name
        """
    ).fetchall()
    return [tuple(str(value or '') for value in row) for row in rows]


def _export_snapshot(snapshot: Path, target_tmp: Path, key_hex: str, *, module_name: str) -> dict[str, Any]:
    _report_stage('verificar runtime SQLCipher')
    _report_progress('Verificando SQLCipher…', module_name=module_name, stage='runtime')
    runtime = ensure_cipher_runtime()
    if not runtime.get('available'):
        raise MigrationError('SQLCipher não está disponível nesta instalação.')

    _report_stage('abrir snapshot legado')
    _report_progress('Abrindo cópia consistente do banco antigo…', module_name=module_name, stage='open-snapshot')
    src = sqlite3.connect(snapshot.resolve().as_uri() + '?mode=ro', uri=True, timeout=15)
    target_tmp.unlink(missing_ok=True)
    _report_stage('criar banco SQLCipher temporário')
    _report_progress('Preparando banco criptografado temporário…', module_name=module_name, stage='open-target')
    dst = secure_connect(target_tmp, key_hex=key_hex, timeout=30)
    try:
        user_version = int(src.execute('PRAGMA user_version').fetchone()[0] or 0)
        application_id = int(src.execute('PRAGMA application_id').fetchone()[0] or 0)
        source_counts = _table_counts(src)
        source_schema = _schema_signature(src)

        # Deliberately do NOT use ATTACH/sqlcipher_export here. On Windows a native
        # SQLCipher crash during ATTACH surfaces only as 0xC00000FD and bypasses
        # Python exception handling. The batched copy stays in Python/SQL and
        # provides live progress without using ATTACH.
        _report_stage('copiar snapshot legado para SQLCipher em lotes')
        _copy_database_batched(src, dst, module_name=module_name)

        _report_stage('preservar metadados SQLite')
        dst.execute(f'PRAGMA user_version={user_version}')
        dst.execute(f'PRAGMA application_id={application_id}')
        dst.execute('PRAGMA foreign_keys=ON')
        dst.execute('PRAGMA synchronous=FULL')
        dst.commit()

        _report_stage('validar integrity_check do banco criptografado')
        _report_progress('Verificando integridade do banco criptografado…', module_name=module_name, stage='integrity')
        rows = [str(r[0]) for r in dst.execute('PRAGMA integrity_check').fetchall()]
        if rows != ['ok']:
            raise MigrationError('Banco criptografado não passou no integrity_check: ' + '; '.join(rows[:12]))
        target_counts = _table_counts(dst)
        if source_counts != target_counts:
            raise MigrationError(
                'A validação encontrou diferença de registros entre o banco legado e o banco criptografado.'
            )
        target_schema = _schema_signature(dst)
        if source_schema != target_schema:
            raise MigrationError(
                'A validação encontrou diferença estrutural entre o banco legado e o banco criptografado.'
            )
        return {
            'table_counts': source_counts,
            'schema_object_count': len(source_schema),
            'user_version': user_version,
            'application_id': application_id,
            'cipher_version': runtime.get('cipher_version', ''),
        }
    finally:
        dst.close()
        src.close()


def _assert_plain_sqlite_cannot_read(path: Path) -> None:
    con = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=15)
    try:
        try:
            con.execute('SELECT count(*) FROM sqlite_master').fetchone()
        except sqlite3.DatabaseError:
            return
        raise MigrationError('A base migrada ainda pôde ser aberta sem a chave; ativação bloqueada.')
    finally:
        con.close()


def validate_encrypted_database(
    path: str | Path,
    *,
    key_hex: str,
    module_name: str = 'database',
) -> dict[str, Any]:
    target = Path(path).expanduser().resolve()
    if not target.is_file() or target.stat().st_size <= 0:
        raise MigrationError(f'O banco criptografado de {module_name} não existe ou está vazio.')
    if len(key_hex) != 64 or any(c not in '0123456789abcdefABCDEF' for c in key_hex):
        raise MigrationError('Chave criptográfica inválida.')

    runtime = ensure_cipher_runtime()
    if not runtime.get('available'):
        raise MigrationError('SQLCipher não está disponível nesta instalação.')

    con = secure_connect(target, key_hex=key_hex, readonly=True, timeout=20)
    try:
        rows = [str(r[0]) for r in con.execute('PRAGMA integrity_check').fetchall()]
        if rows != ['ok']:
            raise MigrationError(
                f'O banco criptografado de {module_name} não passou no integrity_check: ' + '; '.join(rows[:12])
            )
        counts = _table_counts(con)
        schema = _schema_signature(con)
    finally:
        con.close()

    _assert_plain_sqlite_cannot_read(target)
    return {
        'ok': True,
        'module': module_name,
        'path': str(target),
        'table_counts': counts,
        'schema_object_count': len(schema),
        'cipher_version': runtime.get('cipher_version', ''),
    }


def migrate_plain_database(
    source_path: str | Path,
    target_path: str | Path,
    *,
    key_hex: str,
    module_name: str,
    app_version: str = os.environ.get('VYZIUM_APP_VERSION', '3.3.0'),
) -> dict[str, Any]:
    source = Path(source_path).expanduser().resolve()
    target = Path(target_path).expanduser().resolve()
    if not source.is_file() or source.stat().st_size <= 0:
        return {'migrated': False, 'source_exists': False, 'source': str(source), 'target': str(target)}
    if target.exists():
        raise MigrationError('O banco criptografado de destino já existe; o Vyzium não irá sobrescrevê-lo.')
    if len(key_hex) != 64 or any(c not in '0123456789abcdefABCDEF' for c in key_hex):
        raise MigrationError('Chave criptográfica inválida.')

    _report_stage('validar banco legado')
    _report_progress('Verificando banco original…', module_name=module_name, stage='legacy-check')
    _plain_integrity(source, full=False)
    target.parent.mkdir(parents=True, exist_ok=True)
    migration_dir = target.parent / 'backups' / 'migration'
    migration_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='vyzium-migration-', dir=str(target.parent)) as td:
        snapshot = Path(td) / 'legacy-snapshot.db'
        target_tmp = Path(td) / 'encrypted-target.db'
        _report_stage('criar snapshot legado consistente')
        _report_progress('Criando snapshot consistente sem alterar seus dados…', module_name=module_name, stage='snapshot')
        _snapshot_plain(source, snapshot)
        source_snapshot_hash = _sha256(snapshot)
        result = _export_snapshot(snapshot, target_tmp, key_hex, module_name=module_name)
        result['source_snapshot_sha256'] = source_snapshot_hash
        _report_stage('confirmar que SQLite comum não abre o destino')
        _report_progress('Confirmando que o novo banco exige a chave…', module_name=module_name, stage='encryption-check')
        _assert_plain_sqlite_cannot_read(target_tmp)

        _report_stage('ativar banco criptografado atomicamente')
        _report_progress('Ativando banco protegido…', module_name=module_name, stage='activate')
        # Final activation is atomic within the destination filesystem.
        os.replace(target_tmp, target)

    _report_progress('Finalizando verificação de segurança…', module_name=module_name, stage='finalize')
    encrypted_hash = _sha256(target)
    source_hash = _sha256(source)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    manifest_path = migration_dir / f'{module_name}-migration-{stamp}.json'
    manifest = {
        'module': module_name,
        'app_version': app_version,
        'created_at': datetime.now().isoformat(timespec='seconds'),
        'source_path': str(source),
        'source_sha256': source_hash,
        'source_retained_untouched': True,
        'target_path': str(target),
        'target_sha256': encrypted_hash,
        'target_encrypted': True,
        **result,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'migrated': True, 'source_exists': True, 'manifest': str(manifest_path), **manifest}
