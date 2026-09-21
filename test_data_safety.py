import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from data_safety import DataIntegrityError, DataSafetyManager


class DataSafetyTests(unittest.TestCase):
    def make_db(self, root: Path, name='sample.db') -> Path:
        path = root / name
        con = sqlite3.connect(path)
        con.execute('CREATE TABLE important_data(id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
        con.executemany('INSERT INTO important_data(value) VALUES (?)', [('alpha',), ('beta',), ('gamma',)])
        con.commit()
        con.close()
        return path

    def test_backup_is_consistent_and_preserves_rows(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = self.make_db(root)
            manager = DataSafetyManager(db, 'test', '3.0.2')
            con = sqlite3.connect(db)
            result = manager.backup(reason='manual', source_connection=con, automatic=False)
            con.close()

            self.assertTrue(result['created'])
            backup = Path(result['path'])
            self.assertTrue(backup.is_file())
            self.assertEqual(manager.check_path(backup, full=True)['result'], 'ok')
            bcon = sqlite3.connect(backup)
            rows = bcon.execute('SELECT value FROM important_data ORDER BY id').fetchall()
            bcon.close()
            self.assertEqual(rows, [('alpha',), ('beta',), ('gamma',)])
            manifest = json.loads(backup.with_suffix('.db.json').read_text(encoding='utf-8'))
            self.assertEqual(manifest['integrity'], 'ok')
            self.assertEqual(manifest['app_version'], '3.0.2')
            self.assertFalse(manifest['automatic'])

    def test_corrupt_existing_database_is_blocked_without_modification(self):
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / 'broken.db'
            original = b'not-a-sqlite-database\x00keep-this-data'
            db.write_bytes(original)
            manager = DataSafetyManager(db, 'test', '3.0.2')
            with self.assertRaises(DataIntegrityError):
                manager.assert_existing_integrity()
            self.assertEqual(db.read_bytes(), original)


    def test_readonly_backup_includes_committed_wal_content(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / 'wal.db'
            writer = sqlite3.connect(db)
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute('PRAGMA wal_autocheckpoint=0')
            writer.execute('CREATE TABLE wal_data(value TEXT NOT NULL)')
            writer.execute('INSERT INTO wal_data(value) VALUES (?)', ('committed-in-wal',))
            writer.commit()
            manager = DataSafetyManager(db, 'test', '3.0.2')
            manager.assert_existing_integrity()
            result = manager.backup(reason='wal-test', automatic=False)
            backup_con = sqlite3.connect(result['path'])
            rows = backup_con.execute('SELECT value FROM wal_data').fetchall()
            backup_con.close()
            writer.close()
            self.assertEqual(rows, [('committed-in-wal',)])

    def test_version_backup_is_created_only_once(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = self.make_db(root)
            manager = DataSafetyManager(db, 'test', '3.0.2')
            con = sqlite3.connect(db)
            first = manager.ensure_version_backup(con)
            second = manager.ensure_version_backup(con)
            con.close()
            self.assertTrue(first['created'])
            self.assertFalse(second['created'])
            self.assertEqual(manager.status()['backup_count'], 1)

    def test_manual_backup_is_not_pruned_with_automatic_backups(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = self.make_db(root)
            manager = DataSafetyManager(db, 'test', '3.0.2', auto_retention=3)
            con = sqlite3.connect(db)
            manual = manager.backup(reason='manual', source_connection=con, automatic=False)
            for index in range(5):
                con.execute('INSERT INTO important_data(value) VALUES (?)', (f'auto-{index}',))
                con.commit()
                manager.backup(reason=f'auto-{index}', source_connection=con, automatic=True)
            con.close()
            status = manager.status()
            self.assertTrue(Path(manual['path']).exists())
            autos = [b for b in status['recent_backups'] if b.get('automatic')]
            self.assertLessEqual(len(autos), 3)
            self.assertTrue(any(not b.get('automatic') for b in status['recent_backups']))


class ExistingDatabaseCompatibilityTests(unittest.TestCase):
    def test_followup_existing_settings_are_preserved_and_snapshotted_before_upgrade(self):
        from engine import Store as FollowupStore
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / 'followup.db'
            con = sqlite3.connect(db)
            con.execute('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            con.execute("INSERT INTO settings(key,value) VALUES('buyer_filter','COMPRADOR EXISTENTE')")
            con.commit(); con.close()
            before = db.read_bytes()
            store = FollowupStore(db)
            try:
                self.assertEqual(store.settings()['buyer_filter'], 'COMPRADOR EXISTENTE')
                status = store.data_safety_status()
                self.assertGreaterEqual(status['backup_count'], 1)
                upgrade = next(b for b in status['recent_backups'] if b['reason'].startswith('pre-upgrade'))
                backup_con = sqlite3.connect(upgrade['path'])
                self.assertEqual(backup_con.execute("SELECT value FROM settings WHERE key='buyer_filter'").fetchone()[0], 'COMPRADOR EXISTENTE')
                backup_con.close()
                self.assertNotEqual(db.read_bytes(), before)  # schema grows, business value must survive
            finally:
                store.connection.close()

    def test_compras_existing_map_is_preserved_and_snapshotted_before_upgrade(self):
        from compras_engine import Store as ComprasStore
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / 'compras.sqlite3'
            con = sqlite3.connect(db)
            con.executescript('''
                CREATE TABLE items(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE maps(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE settings(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE messages(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            ''')
            payload = {'id': 'mapa-existente', 'name': 'Mapa já usado', 'items': [], 'archived': False, 'revision': 7}
            con.execute('INSERT INTO maps(id,data) VALUES (?,?)', ('mapa-existente', json.dumps(payload)))
            con.commit(); con.close()
            store = ComprasStore(root)
            restored = store.get_map('mapa-existente')
            self.assertEqual(restored['name'], 'Mapa já usado')
            self.assertEqual(restored['revision'], 7)
            status = store.data_safety_status()
            self.assertGreaterEqual(status['backup_count'], 1)
            upgrade = next(b for b in status['recent_backups'] if b['reason'].startswith('pre-upgrade'))
            backup_con = sqlite3.connect(upgrade['path'])
            raw = backup_con.execute("SELECT data FROM maps WHERE id='mapa-existente'").fetchone()[0]
            backup_con.close()
            self.assertEqual(json.loads(raw)['name'], 'Mapa já usado')

class DataSafetyHardeningTests(unittest.TestCase):
    def _db(self, root: Path, name='hardening.db') -> Path:
        path = root / name
        con = sqlite3.connect(path)
        con.execute('CREATE TABLE critical(id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
        con.executemany('INSERT INTO critical(value) VALUES (?)', [('one',), ('two',)])
        con.commit(); con.close()
        return path

    def test_pre_upgrade_backup_survives_automatic_pruning(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = self._db(root)
            manager = DataSafetyManager(db, 'test', '3.0.2', auto_retention=3)
            con = sqlite3.connect(db)
            pre = manager.ensure_version_backup(con)
            pre_path = Path(pre['path'])
            for index in range(7):
                con.execute('INSERT INTO critical(value) VALUES (?)', (f'auto-{index}',))
                con.commit()
                manager.backup(reason=f'pre-import-{index}', source_connection=con, automatic=True)
            con.close()
            self.assertTrue(pre_path.exists(), 'Backup pré-upgrade nunca deve ser podado por retenção automática.')
            manifest = json.loads(pre_path.with_suffix('.db.json').read_text(encoding='utf-8'))
            self.assertTrue(manifest.get('protected'))

    def test_pre_update_backup_survives_automatic_pruning(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = self._db(root)
            manager = DataSafetyManager(db, 'test', '3.0.2', auto_retention=3)
            con = sqlite3.connect(db)
            protected = manager.backup(reason='pre-update-3.0.2', source_connection=con, automatic=True)
            protected_path = Path(protected['path'])
            for index in range(7):
                con.execute('INSERT INTO critical(value) VALUES (?)', (f'import-{index}',))
                con.commit()
                manager.backup(reason=f'pre-import-{index}', source_connection=con, automatic=True)
            con.close()
            self.assertTrue(protected_path.exists(), 'Backup pré-update nunca deve ser podado por retenção automática.')

    def test_corrupted_version_backup_is_not_trusted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = self._db(root)
            manager = DataSafetyManager(db, 'test', '3.0.2')
            con = sqlite3.connect(db)
            first = manager.ensure_version_backup(con)
            first_path = Path(first['path'])
            first_path.write_bytes(b'corrupted-backup')
            second = manager.ensure_version_backup(con)
            con.close()
            self.assertTrue(second['created'], 'Um backup corrompido não pode impedir a criação de um novo snapshot seguro.')
            self.assertNotEqual(first['path'], second['path'])
            self.assertTrue(manager.check_path(second['path'], full=True)['ok'])

    def test_tampered_backup_hash_is_not_trusted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = self._db(root)
            manager = DataSafetyManager(db, 'test', '3.0.2')
            con = sqlite3.connect(db)
            first = manager.ensure_version_backup(con)
            manifest_path = Path(first['path']).with_suffix('.db.json')
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            manifest['sha256'] = '0' * 64
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            second = manager.ensure_version_backup(con)
            con.close()
            self.assertTrue(second['created'], 'Manifesto adulterado não pode ser aceito como backup válido.')

    def test_status_revalidates_latest_backup(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = self._db(root)
            manager = DataSafetyManager(db, 'test', '3.0.2')
            con = sqlite3.connect(db)
            result = manager.backup(reason='manual', source_connection=con, automatic=False)
            con.close()
            self.assertTrue(manager.status()['last_backup']['valid_now'])
            Path(result['path']).write_bytes(b'broken')
            self.assertFalse(manager.status()['last_backup']['valid_now'])

class ImportTransactionSafetyTests(unittest.TestCase):
    def test_followup_import_failure_rolls_back_existing_snapshot(self):
        from engine import Store as FollowupStore
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / 'followup.db'
            store = FollowupStore(db)
            try:
                with store.lock:
                    store.connection.execute(
                        "INSERT INTO orders(item_key,oc,description,supplier_key,supplier_name,imported_at) VALUES(?,?,?,?,?,?)",
                        ('old-item', 'OC-OLD', 'Registro existente', 'SUP-OLD', 'Fornecedor antigo', '2026-09-19T00:00:00')
                    )
                    store.connection.commit()
                    store.connection.execute(
                        "CREATE TRIGGER abort_new_orders BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'forced failure'); END"
                    )
                    store.connection.commit()

                new_row = {
                    'item_key': 'new-item', 'oc': 'OC-NEW', 'company': '', 'purchase_type': '', 'sci': '',
                    'quantity': 1.0, 'unit': 'UN', 'description': 'Novo', 'buyer': '', 'due_date': None,
                    'received_date': None, 'order_status': '', 'request_status': '', 'supplier_key': 'SUP-NEW',
                    'supplier_name': 'Fornecedor novo', 'supplier_doc': '', 'value_total': 1.0, 'company_id': '',
                    'source_item_id': '', 'process_id': '', 'article_code': '', 'buyer_id': '', 'order_date': None,
                    'order_status_code': None, 'order_bpm_status': '', 'order_bpm_status_code': None,
                    'supplier_id': '', 'value_unit': 1.0, 'received_qty': 0.0, 'remaining_qty': 1.0,
                    'urgent': 0, 'source_row_count': 1,
                }
                with self.assertRaises(sqlite3.DatabaseError):
                    store.replace_snapshot([new_row], [], 'nova.xlsx', 1, 0)

                rows = store.connection.execute('SELECT item_key,oc FROM orders ORDER BY item_key').fetchall()
                self.assertEqual([(r['item_key'], r['oc']) for r in rows], [('old-item', 'OC-OLD')])
            finally:
                store.connection.close()

    def test_compras_import_failure_rolls_back_existing_items(self):
        import compras_engine
        from compras_engine import Store as ComprasStore
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            store = ComprasStore(root)
            old_item = {'id': 'old-item', 'company': 'Hotel', 'sci': 'SCI-1', 'description': 'Existente'}
            store.put('items', old_item['id'], old_item)
            with store.db() as con:
                con.execute("CREATE TRIGGER abort_new_items BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'forced failure'); END")

            original_loader = compras_engine.load_items
            compras_engine.load_items = lambda _path: ([{'id': 'new-item', 'company': 'Hotel', 'sci': 'SCI-2'}], {'source_rows': 1})
            try:
                with self.assertRaises(sqlite3.DatabaseError):
                    store.import_file(root / 'fake.xlsx')
            finally:
                compras_engine.load_items = original_loader

            items = store.all('items')
            self.assertEqual(items, [old_item])


if __name__ == '__main__':
    unittest.main()

class SchemaDowngradeGuardTests(unittest.TestCase):
    def test_followup_newer_schema_is_blocked_before_write(self):
        from engine import Store as FollowupStore
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / 'followup.db'
            con = sqlite3.connect(db)
            con.execute('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            con.execute("INSERT INTO settings(key,value) VALUES('buyer_filter','DADO FUTURO')")
            con.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
            con.execute("INSERT INTO schema_migrations VALUES (999,'future','2099-01-01T00:00:00')")
            con.commit(); con.close()
            before = db.read_bytes()
            with self.assertRaises(DataIntegrityError):
                FollowupStore(db)
            self.assertEqual(db.read_bytes(), before)

    def test_compras_newer_schema_is_blocked_before_write(self):
        from compras_engine import Store as ComprasStore
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / 'compras.sqlite3'
            con = sqlite3.connect(db)
            con.executescript('''
                CREATE TABLE items(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE maps(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE settings(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE messages(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
            ''')
            con.execute("INSERT INTO settings(id,data) VALUES('ui','{\"id\":\"ui\"}')")
            con.execute("INSERT INTO schema_migrations VALUES (999,'future','2099-01-01T00:00:00')")
            con.commit(); con.close()
            before = db.read_bytes()
            with self.assertRaises(DataIntegrityError):
                ComprasStore(root)
            self.assertEqual(db.read_bytes(), before)
