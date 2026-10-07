"""Production-safety regression tests for the operational SCI import used by purchase history."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

import engine
from test_followup_purchase_history import import_orders
from test_purchase_history import row


class OperationalImportSafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = engine.Store(self.root / 'followup.db')
        self.addCleanup(self.store.purchase_history.clear)
        self.addCleanup(self.store.connection.close)

    def snapshot_tables(self):
        with self.store.lock:
            return {
                'orders': [dict(r) for r in self.store.connection.execute('SELECT * FROM orders ORDER BY item_key')],
                'receipts': [dict(r) for r in self.store.connection.execute('SELECT * FROM receipts ORDER BY receipt_key')],
                'batches': [dict(r) for r in self.store.connection.execute('SELECT * FROM import_batches ORDER BY id')],
            }

    def test_invalid_workbook_never_replaces_committed_orders_or_history(self):
        import_orders(self.store, self.root, [row()], 'BASE SCI OCs.xlsx')
        before_tables = self.snapshot_tables()
        before_history = self.store.purchase_history.query({})
        before_path = self.store.settings().get('last_workbook_path')

        invalid = self.root / 'INVALIDA.xlsx'
        wb = Workbook()
        wb.active.append(['COLUNA A', 'COLUNA B'])
        wb.active.append([1, 2])
        wb.save(invalid)
        wb.close()

        with self.assertRaisesRegex(ValueError, 'base anterior foi preservada'):
            engine.WorkbookImporter(self.store).import_file(str(invalid))

        self.assertEqual(self.snapshot_tables(), before_tables)
        self.assertEqual(self.store.purchase_history.query({}), before_history)
        self.assertEqual(self.store.settings().get('last_workbook_path'), before_path)

    def test_catastrophic_shrink_is_rejected_without_changing_history(self):
        original = [
            row(IDORDEMDECOMPRA=1000+n, IDSCI=5000+n, IDITEMDASCI=n+1, IDITEMDAENTRADA=f'E{n}')
            for n in range(120)
        ]
        import_orders(self.store, self.root, original, 'BASE SCI COMPLETA.xlsx')
        before_tables = self.snapshot_tables()
        before_history = self.store.purchase_history.query({})
        before_path = self.store.settings().get('last_workbook_path')

        truncated = [
            row(IDORDEMDECOMPRA=9000+n, IDSCI=9500+n, IDITEMDASCI=9000+n, IDITEMDAENTRADA=f'T{n}')
            for n in range(10)
        ]
        with self.assertRaisesRegex(ValueError, 'menos de 50%'):
            import_orders(self.store, self.root, truncated, 'BASE SCI TRUNCADA.xlsx')

        self.assertEqual(self.snapshot_tables(), before_tables)
        self.assertEqual(self.store.purchase_history.query({}), before_history)
        self.assertEqual(self.store.settings().get('last_workbook_path'), before_path)

    def test_database_failure_mid_replace_rolls_back_orders_receipts_and_batch(self):
        import_orders(self.store, self.root, [row()], 'BASE SCI ANTERIOR.xlsx')
        with self.store.lock:
            self.store.connection.execute(
                """CREATE TRIGGER qa_abort_receipt BEFORE INSERT ON receipts
                   BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END"""
            )
            self.store.connection.commit()

        before_tables = self.snapshot_tables()
        before_history = self.store.purchase_history.query({})
        before_path = self.store.settings().get('last_workbook_path')

        replacement = [
            row(IDORDEMDECOMPRA=900, IDSCI=990, IDITEMDASCI=9901,
                ANNUMERODANOTAFISCAL='NF-NOVA', IDITEMDAENTRADA='ENTRADA-NOVA')
        ]
        with self.assertRaises(sqlite3.DatabaseError):
            import_orders(self.store, self.root, replacement, 'BASE SCI NOVA.xlsx')

        self.assertEqual(self.snapshot_tables(), before_tables)
        self.assertEqual(self.store.purchase_history.query({}), before_history)
        self.assertEqual(self.store.settings().get('last_workbook_path'), before_path)

    def test_conflicting_duplicate_receipt_id_is_rejected_without_double_counting(self):
        import_orders(self.store, self.root, [row()], 'BASE SCI ANTERIOR.xlsx')
        before_tables = self.snapshot_tables()
        before_history = self.store.purchase_history.query({})
        conflicting = [
            row(IDORDEMDECOMPRA=800, IDSCI=880, IDITEMDASCI=8801, IDITEMDAENTRADA='ENT-1',
                QUANTIDADERECEBIDA=4, UNIDADEMEDIDARECEBIDA='UN'),
            row(IDORDEMDECOMPRA=800, IDSCI=880, IDITEMDASCI=8801, IDITEMDAENTRADA='ENT-1',
                QUANTIDADERECEBIDA=4, UNIDADEMEDIDARECEBIDA='CX'),
        ]
        with self.assertRaisesRegex(ValueError, 'Recebimento ambíguo'):
            import_orders(self.store, self.root, conflicting, 'BASE SCI CONFLITANTE.xlsx')
        self.assertEqual(self.snapshot_tables(), before_tables)
        self.assertEqual(self.store.purchase_history.query({}), before_history)

    def test_duplicate_receipt_id_with_same_data_is_deduplicated_once(self):
        duplicate = row(IDORDEMDECOMPRA=801, IDSCI=881, IDITEMDASCI=8811, IDITEMDAENTRADA='ENT-2',
                        QUANTIDADERECEBIDA=4, UNIDADEMEDIDARECEBIDA='UN')
        result = import_orders(self.store, self.root, [duplicate, duplicate], 'BASE SCI DUPLICADA.xlsx')
        self.assertEqual(result['receipts'], 1)
        self.assertEqual(self.store.order_rows()[0]['received_qty'], 4)
        self.assertEqual(len(self.store.receipt_rows([self.store.order_rows()[0]['item_key']])), 1)

    def test_committed_import_is_immediately_visible_to_read_only_purchase_history(self):
        import_orders(
            self.store, self.root,
            [
                row(IDORDEMDECOMPRA=301, IDSCI=7001, COMPRADOR='Ana'),
                row(IDORDEMDECOMPRA=302, IDSCI=7002, COMPRADOR='Carlos', DATAOC='06/10/2026'),
            ],
            'BASE SCI OCs.xlsx'
        )
        self.store.save_settings({'buyer_filter': 'Comprador inexistente'})
        data = self.store.purchase_history.query({'q': 'lampada'})
        self.assertEqual(data['source']['module'], 'followup')
        self.assertEqual(data['source']['filename'], 'BASE SCI OCs.xlsx')
        self.assertEqual(data['items'][0]['orders'], 2)
        detail = self.store.purchase_history.query({'id': data['items'][0]['id']})
        self.assertEqual({o['oc'] for o in detail['orders']}, {'301', '302'})
        self.assertEqual({o['lines'][0]['buyer'] for o in detail['orders']}, {'Ana', 'Carlos'})


if __name__ == '__main__':
    unittest.main()
