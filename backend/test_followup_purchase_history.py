"""Regression coverage for the two separate SCI sources and saved filters."""
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook
import engine
import compras_engine
from backup_sync import analyze, apply_merge
from secure_sqlite import cipher_available
from test_purchase_history import HEADERS, row, book


def import_orders(store, directory, rows, filename='BASE SCI OCs.xlsx'):
    path = Path(directory) / filename
    workbook = Workbook()
    workbook.active.append(HEADERS + ['DATAPREVISTAENTREGAOC'])
    for values in rows:
        workbook.active.append(list(values) + ['20/10/2026'])
    workbook.save(path)
    workbook.close()
    return engine.WorkbookImporter(store).import_file(str(path))


class FollowupPurchaseHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = self.open_store(self.root / 'followup.db')

    def open_store(self, path):
        store = engine.Store(path)
        self.addCleanup(store.connection.close)
        self.addCleanup(store.purchase_history.clear)
        return store

    def seed(self, rows=None, store=None):
        return import_orders(store or self.store, self.root, rows or [row()])

    def test_all_buyers_completed_and_cancelled_orders_ignore_operational_filters(self):
        self.seed([row(COMPRADOR='Levi'), row(IDORDEMDECOMPRA=201, COMPRADOR='Ana', NMSTATUSITEMDAORDEMDECOMPRA=2),
                   row(IDORDEMDECOMPRA=202, COMPRADOR='Carlos', NMSTATUSITEMDAORDEMDECOMPRA=3)])
        self.store.save_settings({'buyer_filter': 'Levi'})
        before = self.store.settings()
        data = self.store.purchase_history.query({'q': 'lampada', 'buyer': 'Levi', 'urgency': 'overdue', 'attendance_status': 'pending'})
        self.assertEqual(data['items'][0]['orders'], 3)
        detail = self.store.purchase_history.query({'id': data['items'][0]['id'], 'buyer': 'Levi'})
        self.assertEqual({o['lines'][0]['buyer'] for o in detail['orders']}, {'Levi', 'Ana', 'Carlos'})
        self.assertEqual(self.store.purchase_history.query({'q': 'lampada', 'status': 'valid'})['items'][0]['orders'], 2)
        self.assertEqual(before, self.store.settings())

    def test_maps_import_with_missing_or_misleading_oc_data_cannot_replace_history(self):
        self.seed()
        before = self.store.purchase_history.query({})
        maps = compras_engine.Store(self.root / 'compras')
        maps.put('settings', 'ui', {'id': 'ui', 'filters': {'buyer': 'Ninguém', 'company': 'Outro hotel'}})
        headers = ['Empresa', 'Comprador SCI', 'Número da SCI', 'Descrição do Artigo', 'Status da SCI',
                   'Quantidade', 'Unidade', 'ID OC', 'Status BPM SCI', 'Status do Item da OC']
        from workbook_formats import Book, Sheet
        values = ['Hotel Z', 'Ninguém', '42', 'Outro item', '2 - Em cotação', 5, 'UN', None, '3 - Aprovada', None]
        with patch.object(compras_engine, 'open_book', return_value=Book([Sheet([headers, values])])):
            maps.import_file('BASE MAPAS.xls')
        self.assertEqual(before, self.store.purchase_history.query({}))
        # Even a stale legacy purchase-history snapshot in compras is irrelevant.
        with patch.object(compras_engine, 'open_book', return_value=book([row(IDORDEMDECOMPRA=999, VALORUNITARIOITEMOC=999)])):
            maps.import_file('BASE MAPAS ERRADA.xlsx')
        self.assertEqual(before, self.store.purchase_history.query({}))
        self.assertEqual(before['source']['module'], 'followup')
        self.assertEqual(before['source']['filename'], 'BASE SCI OCs.xlsx')

    def test_existing_database_works_without_reimport_and_keeps_price_nf_and_all_receipts(self):
        self.seed([row(), row(), row(DATAENTRADAMERCADORIA='04/10/2026', ANNUMERODANOTAFISCAL='NF-002', QUANTIDADERECEBIDA=6)])
        reopened = self.open_store(self.store.path)
        data = reopened.purchase_history.query({'q': '0090'})
        detail = reopened.purchase_history.query({'id': data['items'][0]['id']})
        self.assertEqual(detail['total'], 1)
        line = detail['orders'][0]['lines'][0]
        self.assertEqual(line['order_price'], '12.5')
        self.assertEqual(line['unit'], 'UN')
        self.assertEqual([r['invoice'] for r in line['receipts']], ['NF-002', 'NF-001'])
        self.assertEqual([r['quantity'] for r in line['receipts']], ['6', '4'])
        self.assertTrue(all(r['price'] is None for r in line['receipts']))

    def test_read_only_queries_reuse_one_index_and_release_it_without_mutating_data(self):
        self.seed()
        before = list(self.store.connection.iterdump())
        history = self.store.purchase_history
        with patch.object(history, 'load', wraps=history.load) as loads:
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(history.query, [{}] * 4))
            self.assertTrue(all(r == results[0] for r in results))
            self.assertEqual(loads.call_count, 1)
            item = results[0]['items'][0]['id']
            detail = history.query({'id': item})
            detail['orders'][0]['lines'][0]['receipts'][0]['invoice'] = 'MUTATED'
            self.assertEqual(history.query({'id': item})['orders'][0]['lines'][0]['receipts'][0]['invoice'], 'NF-001')
            epoch = history.epoch
            history.expire(epoch - 1)
            self.assertIsNotNone(history.snapshot)
            history.expire(epoch)
            self.assertIsNone(history.snapshot)
            history.query({})
            self.assertEqual(loads.call_count, 2)
        self.assertEqual(before, list(self.store.connection.iterdump()))

    def test_successful_and_rejected_reimports_invalidate_only_committed_snapshot(self):
        self.seed()
        before = self.store.purchase_history.query({})
        with self.assertRaises(ValueError):
            import_orders(self.store, self.root, [])
        self.assertEqual(before, self.store.purchase_history.query({}))
        other = self.open_store(self.store.path)
        self.seed([row(IDORDEMDECOMPRA=900, VALORUNITARIOITEMOC=22)], other)
        current = self.store.purchase_history.query({})
        self.assertEqual(current['items'][0]['latest']['oc'], '900')
        self.assertEqual(current['items'][0]['latest']['order_price'], '22')

    def test_description_search_keeps_all_orders_and_units_do_not_mix(self):
        self.seed([row(), row(IDORDEMDECOMPRA=201, DATAOC='06/10/2026', DESCRICAOARTIGO='Luminária LED', VALORUNITARIOITEMOC=21),
                   row(IDORDEMDECOMPRA=202, UNIDADEMEDIDAOC='CX')])
        data = self.store.purchase_history.query({'q': 'lampada'})
        self.assertEqual(data['total'], 2)
        unit = next(i for i in data['items'] if i['unit'] == 'UN')
        self.assertEqual(unit['orders'], 2)
        self.assertEqual(unit['latest']['order_price'], '21')
        self.assertEqual(self.store.purchase_history.query({'id': unit['id'], 'q': 'lampada'})['total'], 2)

    def test_restored_backup_source_is_used_without_the_original_workbook(self):
        remote = self.open_store(self.root / 'remote.db')
        self.seed([row(IDORDEMDECOMPRA=900)], remote)
        out = self.root / 'restored.db'
        report = analyze('followup', self.store.path, remote.path, None, None)
        resolutions = {c['id']: 'remote' for c in report['conflicts']}
        apply_merge('followup', self.store.path, remote.path, out, None, None, resolutions)
        (self.root / 'BASE SCI OCs.xlsx').unlink()
        restored = self.open_store(out)
        result = restored.purchase_history.query({})
        self.assertEqual(result['items'][0]['latest']['oc'], '900')

    @unittest.skipUnless(cipher_available(), 'SQLCipher unavailable')
    def test_uses_followup_encryption_key_and_fails_closed_with_wrong_key(self):
        with patch.dict(os.environ, {'VYZIUM_DB_KEY_HEX': '44' * 32}):
            encrypted = self.open_store(self.root / 'encrypted.db')
        self.seed(store=encrypted)
        self.assertEqual(encrypted.purchase_history.query({})['items'][0]['latest']['oc'], '200')
        from followup_purchase_history import FollowupPurchaseHistory
        wrong = FollowupPurchaseHistory(encrypted.path, '55' * 32)
        with self.assertRaises(Exception):
            wrong.query({})

    def test_empty_followup_does_not_fall_back_to_quotation_history(self):
        data = self.store.purchase_history.query({})
        self.assertFalse(data['source']['available'])
        self.assertEqual(data['source']['module'], 'followup')
        self.assertEqual(data['total'], 0)


if __name__ == '__main__':
    unittest.main()
