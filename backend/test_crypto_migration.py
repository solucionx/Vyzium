import sqlite3
import tempfile
import unittest
from pathlib import Path

from crypto_migration import _copy_database_batched, _schema_signature, _table_counts, migrate_plain_database, validate_encrypted_database
from data_safety import DataSafetyManager
from secure_sqlite import cipher_available, connect as secure_connect


class BatchedCopyTests(unittest.TestCase):
    def test_batched_copy_preserves_rows_schema_and_sequence(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = sqlite3.connect(root / 'plain-source.db')
            target = sqlite3.connect(root / 'plain-target.db')
            try:
                source.executescript("""
                    CREATE TABLE critical(id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL);
                    CREATE TABLE notes(id TEXT PRIMARY KEY, body BLOB);
                    CREATE INDEX idx_critical_value ON critical(value);
                    CREATE VIEW critical_view AS SELECT id, value FROM critical;
                    CREATE TRIGGER critical_guard AFTER INSERT ON critical BEGIN SELECT NEW.id; END;
                """)
                source.executemany('INSERT INTO critical(value) VALUES(?)', [(f'linha-{i}',) for i in range(2500)])
                source.executemany('INSERT INTO notes(id, body) VALUES(?, ?)', [(str(i), bytes([i % 251])) for i in range(25)])
                source.execute('DELETE FROM critical WHERE id > 2490')
                source.execute("UPDATE sqlite_sequence SET seq=4000 WHERE name='critical'")
                source.commit()

                expected_counts = _table_counts(source)
                expected_schema = _schema_signature(source)
                _copy_database_batched(source, target, module_name='followup')

                self.assertEqual(_table_counts(target), expected_counts)
                self.assertEqual(_schema_signature(target), expected_schema)
                self.assertEqual(target.execute("SELECT seq FROM sqlite_sequence WHERE name='critical'").fetchone()[0], 4000)
                self.assertEqual(target.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            finally:
                target.close()
                source.close()


@unittest.skipUnless(cipher_available(), 'sqlcipher3 não está instalado neste ambiente')
class CryptoMigrationTests(unittest.TestCase):
    KEY = '11' * 32

    def _legacy(self, root: Path) -> Path:
        path = root / 'followup.db'
        con = sqlite3.connect(path)
        con.executescript('''
            CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
            INSERT INTO schema_migrations VALUES(1, 'legacy', '2026-09-19T00:00:00');
            CREATE TABLE critical(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
            CREATE INDEX idx_critical_value ON critical(value);
            CREATE VIEW critical_view AS SELECT id, value FROM critical;
            CREATE TRIGGER critical_guard AFTER INSERT ON critical BEGIN SELECT NEW.id; END;
        ''')
        con.executemany('INSERT INTO critical(value) VALUES(?)', [(f'linha-{i}',) for i in range(250)])
        con.commit(); con.close()
        return path

    def test_plain_database_is_migrated_without_touching_source(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = self._legacy(root)
            before = source.read_bytes()
            target = root / 'secure' / 'followup.db'
            result = migrate_plain_database(source, target, key_hex=self.KEY, module_name='followup')
            self.assertTrue(result['migrated'])
            self.assertGreaterEqual(result['schema_object_count'], 4)
            self.assertRegex(result['source_snapshot_sha256'], r'^[0-9a-f]{64}$')
            self.assertEqual(source.read_bytes(), before)

            with self.assertRaises(sqlite3.DatabaseError):
                plain = sqlite3.connect(target)
                try:
                    plain.execute('SELECT count(*) FROM critical').fetchone()
                finally:
                    plain.close()

            secure = secure_connect(target, key_hex=self.KEY)
            try:
                self.assertEqual(secure.execute('SELECT count(*) FROM critical').fetchone()[0], 250)
                self.assertEqual(secure.execute('SELECT count(*) FROM critical_view').fetchone()[0], 250)
                self.assertIsNotNone(secure.execute("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='critical_guard'").fetchone())
                self.assertEqual(secure.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            finally:
                secure.close()

    def test_wrong_key_cannot_open_migrated_database(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = self._legacy(root)
            target = root / 'secure' / 'followup.db'
            migrate_plain_database(source, target, key_hex=self.KEY, module_name='followup')
            with self.assertRaises(Exception):
                con = secure_connect(target, key_hex='22' * 32)
                con.close()

    def test_validated_database_requires_correct_key_and_integrity(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = self._legacy(root)
            target = root / 'secure' / 'followup.db'
            migrate_plain_database(source, target, key_hex=self.KEY, module_name='followup')
            result = validate_encrypted_database(target, key_hex=self.KEY, module_name='followup')
            self.assertTrue(result['ok'])
            self.assertEqual(result['table_counts']['critical'], 250)
            with self.assertRaises(Exception):
                validate_encrypted_database(target, key_hex='22' * 32, module_name='followup')

    def test_data_safety_backup_remains_encrypted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = self._legacy(root)
            target = root / 'secure' / 'followup.db'
            migrate_plain_database(source, target, key_hex=self.KEY, module_name='followup')
            manager = DataSafetyManager(target, 'followup', '3.1.0', key_hex=self.KEY)
            con = secure_connect(target, key_hex=self.KEY)
            try:
                result = manager.backup(reason='manual', source_connection=con, automatic=False)
            finally:
                con.close()
            self.assertTrue(result['encrypted'])
            self.assertTrue(manager.check_path(result['path'], full=True)['ok'])
            with self.assertRaises(sqlite3.DatabaseError):
                plain = sqlite3.connect(result['path'])
                try:
                    plain.execute('SELECT count(*) FROM sqlite_master').fetchone()
                finally:
                    plain.close()


if __name__ == '__main__':
    unittest.main()
