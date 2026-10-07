"""Actual import, price provenance, deduplication, identity and persistence checks."""
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import compras_engine as engine
from purchase_history import HistoryBuilder, search, detail, numeric
from workbook_formats import Book, Sheet
from secure_sqlite import cipher_available


HEADERS = ['FKEMPRESA', 'EMPRESA', 'IDSCI', 'IDITEMDASCI', 'DESCRICAOARTIGO',
           'QUANTIDADESCI', 'UNIDADEDEMEDIDASCI', 'IDORDEMDECOMPRA',
           'NMSTATUSDOITEMDASCI', 'NMSTATUSBPMSCI', 'COMPRADOR', 'CODIGOARTIGO',
           'QUANTIDADEOC', 'UNIDADEMEDIDAOC', 'RAZAOSOCIALFORNECEDOR', 'DATAOC',
           'VALORUNITARIOITEMOC', 'VALORTOTALITEMOC', 'NMSTATUSITEMDAORDEMDECOMPRA',
           'DATAENTRADAMERCADORIA', 'QUANTIDADERECEBIDA', 'UNIDADEMEDIDARECEBIDA',
           'ANNUMERODANOTAFISCAL', 'VALORUNITARIOITEMENTRADA', 'VALORTOTALITEMENTRADA',
           'IDITEMDAENTRADA']


def row(**overrides):
    values = dict(zip(HEADERS, [1, 'MAGNA PRAIA', 501, 1, 'Lâmpada LED 9W', 10, 'UN', 200,
             2, 3, 'Teste', '0090', 10, 'UN', 'Fornecedor A', '01/10/2026',
             '12,50', '125,00', 1, '02/10/2026', 4, 'UN', 'NF-001', '13,75', '55,00', 'E1']))
    values.update(overrides)
    return [values.get(h) for h in HEADERS]


def book(rows):
    return Book([Sheet([HEADERS, *rows])])


def snapshot(rows):
    builder = HistoryBuilder(HEADERS)
    for values in rows:
        builder.add(values)
    return builder.finish()


class PurchaseHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = engine.Store(self.tmp.name)

    def import_rows(self, rows):
        with patch.object(engine, 'open_book', return_value=book(rows)):
            return self.store.import_file('BASE SCI.xlsx')

    def test_import_saves_orders_even_when_they_are_ineligible_for_quotation(self):
        pending = row(IDSCI=999, IDORDEMDECOMPRA=None, IDITEMDASCI=9, NMSTATUSDOITEMDASCI=0)
        result = self.import_rows([row(), pending])
        self.assertEqual(result['eligible'], 1)
        self.assertEqual(result['purchase_orders'], 1)
        self.assertEqual(self.store.catalog()['items'][0]['sci'], '999')
        data = self.store.purchase_history({})
        self.assertEqual(data['source']['filename'], 'BASE SCI.xlsx')
        self.assertTrue(data['source']['available'])
        self.assertEqual(data['items'][0]['article'], '0090')
        received = self.store.purchase_history({'id': data['items'][0]['id']})['orders'][0]['lines'][0]
        self.assertEqual(received['order_price'], '12.5')
        self.assertEqual(received['receipts'][0]['price'], '13.75')

    def test_partial_receipts_and_identical_export_rows_do_not_repeat_order_or_receipt(self):
        second = row(DATAENTRADAMERCADORIA='04/10/2026', QUANTIDADERECEBIDA=6,
                     ANNUMERODANOTAFISCAL='NF-002', VALORTOTALITEMENTRADA='82,50', IDITEMDAENTRADA='E2')
        data = snapshot([row(), row(), second, second])
        self.assertEqual(data['orders'], 1)
        self.assertEqual(len(data['lines']), 1)
        line = data['lines'][0]
        self.assertEqual(line['order_total'], '125')
        self.assertEqual([r['quantity'] for r in line['receipts']], ['6', '4'])
        self.assertEqual(sum(float(r['total']) for r in line['receipts']), 137.5)
        self.assertEqual(snapshot([row(), second]), snapshot([second, row()]))

    def test_missing_receipt_values_never_reuse_order_price_even_if_received(self):
        data = snapshot([row(VALORUNITARIOITEMENTRADA=None, VALORTOTALITEMENTRADA=None)])
        receipt = data['lines'][0]['receipts'][0]
        self.assertEqual(data['lines'][0]['order_price'], '12.5')
        self.assertIsNone(receipt['price'])
        self.assertEqual(receipt['price_source'], 'missing')
        self.assertIsNone(receipt['total'])

    def test_derivation_uses_only_matching_receipt_total_and_received_quantity(self):
        data = snapshot([row(VALORUNITARIOITEMENTRADA=None, VALORTOTALITEMENTRADA='55,00', QUANTIDADERECEBIDA=4,
                             UNIDADEMEDIDARECEBIDA='CX')])
        receipt = data['lines'][0]['receipts'][0]
        self.assertEqual(receipt['price'], '13.75')
        self.assertEqual(receipt['price_source'], 'total_div_quantity')
        self.assertEqual(receipt['unit'], 'CX')
        zero = snapshot([row(VALORUNITARIOITEMENTRADA=None, QUANTIDADERECEBIDA=0)])
        self.assertIsNone(zero['lines'][0]['receipts'][0]['price'])

    def test_zero_is_a_value_and_invalid_numbers_do_not_become_zero(self):
        for value in ['NaN', 'Infinity', '-1', '=1+1', True, None, '']:
            self.assertIsNone(numeric(value))
        self.assertEqual(numeric('R$ 1.234,567'), '1234.567')
        receipt = snapshot([row(VALORUNITARIOITEMENTRADA=0)])['lines'][0]['receipts'][0]
        self.assertEqual(receipt['price'], '0')

    def test_different_oc_units_and_different_article_codes_are_not_combined(self):
        data = snapshot([row(), row(IDORDEMDECOMPRA=201, UNIDADEMEDIDAOC='CX'),
                         row(IDORDEMDECOMPRA=202, CODIGOARTIGO='0091'),
                         row(IDORDEMDECOMPRA=203, CODIGOARTIGO=None),
                         row(IDORDEMDECOMPRA=204, CODIGOARTIGO=None, DESCRICAOARTIGO='Lampada LED 9w')])
        groups = search(data, {'q': 'lampada'})
        self.assertEqual(groups['total'], 4)
        no_code = next(i for i in groups['items'] if not i['article'])
        self.assertEqual(no_code['orders'], 2)
        self.assertEqual(search(data, {'q': '0090'})['total'], 2)

    def test_dates_sort_chronologically_with_explicit_missing_date_fallback(self):
        data = snapshot([row(IDORDEMDECOMPRA=100, DATAOC='01/02/2026'),
                         row(IDORDEMDECOMPRA=300, DATAOC=None, DATAENTRADAMERCADORIA='05/10/2026'),
                         row(IDORDEMDECOMPRA=400, DATAOC=None, DATAENTRADAMERCADORIA=None), row()])
        iid = data['lines'][0]['item_id']
        orders = detail(data, {'id': iid})['orders']
        self.assertEqual([o['oc'] for o in orders], ['300', '200', '100', '400'])
        self.assertEqual(orders[0]['date_basis'], 'receipt')
        self.assertEqual(orders[-1]['date_basis'], 'missing')

    def test_company_supplier_status_filters_and_cancelled_exclusion(self):
        data = snapshot([row(), row(IDORDEMDECOMPRA=201, NMSTATUSITEMDAORDEMDECOMPRA=3),
                         row(IDORDEMDECOMPRA=202, EMPRESA='CARMEL CUMBUCO', FKEMPRESA=2,
                             RAZAOSOCIALFORNECEDOR='Fornecedor B'),
                         row(IDORDEMDECOMPRA=203, DATAENTRADAMERCADORIA=None, QUANTIDADERECEBIDA=None,
                             ANNUMERODANOTAFISCAL=None)])
        iid = data['lines'][0]['item_id']
        self.assertEqual(detail(data, {'id': iid})['total'], 3)
        self.assertEqual(detail(data, {'id': iid, 'status': 'all'})['total'], 4)
        self.assertEqual(detail(data, {'id': iid, 'status': 'received'})['total'], 2)
        self.assertEqual(detail(data, {'id': iid, 'company': 'CARMEL CUMBUCO', 'supplier': 'Fornecedor B'})['total'], 1)
        with self.assertRaises(ValueError):
            search(data, {'status': 'invalid'})

    def test_order_lines_for_same_article_are_grouped_in_one_oc_and_description_search_keeps_all(self):
        data = snapshot([row(), row(IDSCI=502, IDITEMDASCI=2, DESCRICAOARTIGO='LED outra descrição')])
        self.assertEqual(search(data, {'q': 'lampada'})['items'][0]['orders'], 1)
        iid = data['lines'][0]['item_id']
        orders = detail(data, {'id': iid, 'q': 'lampada'})['orders']
        self.assertEqual(len(orders), 1)
        self.assertEqual(len(orders[0]['lines']), 2)

    def test_text_search_selects_identity_then_uses_latest_order_even_after_description_changes(self):
        data = snapshot([
            row(IDORDEMDECOMPRA=200, DATAOC='01/10/2026', DESCRICAOARTIGO='Lampada LED',
                VALORUNITARIOITEMOC='10,00', VALORTOTALITEMOC='100,00'),
            row(IDORDEMDECOMPRA=201, DATAOC='05/10/2026', DESCRICAOARTIGO='Luminaria LED',
                VALORUNITARIOITEMOC='25,00', VALORTOTALITEMOC='250,00')
        ])
        result = search(data, {'q': 'lampada'})
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['orders'], 2)
        self.assertEqual(result['items'][0]['latest']['oc'], '201')
        self.assertEqual(result['items'][0]['latest']['order_price'], '25')
        opened = detail(data, {'id': result['items'][0]['id'], 'q': 'lampada'})
        self.assertEqual(opened['total'], 2)
        self.assertEqual(opened['orders'][0]['oc'], '201')

    def test_native_sci_item_identity_survives_description_edits_and_export_reordering(self):
        first = row()
        changed = row(DESCRICAOARTIGO='LED 9W', IDITEMDAENTRADA='E2', ANNUMERODANOTAFISCAL='NF-002')
        data = snapshot([first, changed])
        self.assertEqual(len(data['lines']), 1)
        self.assertEqual(len(data['lines'][0]['receipts']), 2)
        self.assertEqual(data, snapshot([changed, first]))

    def test_conflicting_prices_are_unknown_and_receipts_remain_one_reference(self):
        data = snapshot([row(), row(VALORUNITARIOITEMOC=20, VALORUNITARIOITEMENTRADA=15)])
        line = data['lines'][0]
        self.assertIsNone(line['order_price'])
        self.assertEqual(line['price_source'], 'conflict')
        self.assertEqual(len(line['receipts']), 1)
        self.assertIsNone(line['receipts'][0]['price'])
        self.assertEqual(line['receipts'][0]['price_source'], 'conflict')
        with_missing = snapshot([row(), row(VALORUNITARIOITEMOC=None, VALORUNITARIOITEMENTRADA=None)])
        self.assertEqual(with_missing['lines'][0]['order_price'], '12.5')
        self.assertEqual(with_missing['lines'][0]['receipts'][0]['price'], '13.75')

    def test_receipt_unit_conflict_is_visible_and_price_per_unit_is_not_presented_as_certain(self):
        data = snapshot([row(), row(UNIDADEMEDIDARECEBIDA='CX')])
        receipt = data['lines'][0]['receipts'][0]
        self.assertIn('unit', receipt['conflicts'])
        self.assertFalse(receipt['unit'])
        self.assertIsNone(receipt['price'])
        self.assertEqual(receipt['price_source'], 'conflict')

    def test_supplier_name_falls_back_per_row_to_an_equivalent_supplier_column(self):
        headers = [*HEADERS, 'NOMEFORNECEDOR']
        values = row(RAZAOSOCIALFORNECEDOR=None) + ['Fornecedor alternativo']
        builder = HistoryBuilder(headers)
        builder.add(values)
        data = builder.finish()
        self.assertEqual(data['lines'][0]['supplier'], 'Fornecedor alternativo')

    def test_header_only_import_is_rejected_before_replacing_catalog_or_history(self):
        self.import_rows([row()])
        before = {table: self.store.all(table) for table in self.store.JSON_TABLES}
        with patch.object(engine, 'open_book', return_value=book([])):
            with self.assertRaisesRegex(ValueError, 'não possui linhas de dados válidas'):
                self.store.import_file('empty.xlsx')
        for table in before:
            self.assertEqual(self.store.all(table), before[table])

    def test_purchase_history_cache_reuses_snapshot_and_detects_external_reimport(self):
        self.import_rows([row()])
        first = self.store.purchase_history({'q': '0090'})
        cached = self.store._purchase_history_cache
        self.assertIsNotNone(cached)
        self.store.purchase_history({'q': 'lampada'})
        self.assertIs(self.store._purchase_history_cache, cached)

        other = engine.Store(self.tmp.name)
        with patch.object(engine, 'open_book', return_value=book([row(IDORDEMDECOMPRA=900)])):
            other.import_file('BASE SCI NOVA.xlsx')
        refreshed = self.store.purchase_history({'q': '0090'})
        self.assertEqual(refreshed['items'][0]['latest']['oc'], '900')
        self.assertIsNot(self.store._purchase_history_cache, cached)

    def test_reimport_replaces_snapshot_but_preserves_maps_messages_and_ui(self):
        self.import_rows([row()])
        self.store.put('maps', 'map', {'id': 'map', 'name': 'Saved', 'items': [], 'quotes': {}})
        self.store.put('messages', 'message', {'id': 'message', 'status': 'sent'})
        self.store.put('settings', 'ui', {'id': 'ui', 'filters': {'buyer': 'Teste'}})
        before = {t: self.store.all(t) for t in ('maps', 'messages')}
        self.import_rows([row(IDORDEMDECOMPRA=900)])
        self.assertEqual(self.store.purchase_history({})['items'][0]['latest']['oc'], '900')
        for table in before:
            self.assertEqual(self.store.all(table), before[table])
        self.assertEqual(self.store.settings()['filters']['buyer'], 'Teste')
        reopened = engine.Store(self.tmp.name)
        self.assertEqual(reopened.purchase_history({})['items'][0]['latest']['oc'], '900')

    def test_invalid_or_ambiguous_import_preserves_entire_previous_snapshot(self):
        self.import_rows([row()])
        before = {table: self.store.all(table) for table in self.store.JSON_TABLES}
        bad = Book([Sheet([HEADERS + ['VALOR UNITÁRIO ITEM OC'], row() + [99]])])
        with patch.object(engine, 'open_book', return_value=bad):
            with self.assertRaisesRegex(ValueError, 'ambíguo'):
                self.store.import_file('bad.xlsx')
        for table in before:
            self.assertEqual(self.store.all(table), before[table])

    def test_failure_saving_history_rolls_back_catalog_and_previous_purchase_snapshot(self):
        self.import_rows([row()])
        before = {table: self.store.all(table) for table in self.store.JSON_TABLES}
        with self.store.db() as con:
            con.execute("CREATE TRIGGER abort_history BEFORE INSERT ON settings WHEN NEW.id='purchase-history' BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
        with self.assertRaises(sqlite3.DatabaseError):
            self.import_rows([row(IDORDEMDECOMPRA=900), row(IDSCI=990, IDORDEMDECOMPRA=None)])
        for table in before:
            self.assertEqual(self.store.all(table), before[table])

    @unittest.skipUnless(cipher_available(), 'SQLCipher unavailable')
    def test_history_uses_the_existing_encrypted_database_and_survives_reopen(self):
        secret = '22' * 32  # Test-only key, never user credentials.
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {'VYZIUM_DB_KEY_HEX': secret}):
                store = engine.Store(directory)
            with patch.object(engine, 'open_book', return_value=book([row()])):
                store.import_file('BASE SCI.xlsx')
            self.assertTrue(store.data_safety_status()['encrypted'])
            raw = Path(store.path).read_bytes()
            self.assertNotIn(b'MAGNA PRAIA', raw)
            self.assertFalse(raw.startswith(b'SQLite format 3'))
            with patch.dict(os.environ, {'VYZIUM_DB_KEY_HEX': secret}):
                reopened = engine.Store(directory)
            self.assertEqual(reopened.purchase_history({'q': '0090'})['items'][0]['latest']['oc'], '200')

    def test_old_database_requests_reimport_and_read_only_queries_change_nothing(self):
        self.assertFalse(self.store.purchase_history({})['source']['available'])
        self.import_rows([row()])
        before = {table: self.store.all(table) for table in self.store.JSON_TABLES}
        data = self.store.purchase_history({'q': 'lâmpada'})
        self.store.purchase_history({'id': data['items'][0]['id']})
        for table in before:
            self.assertEqual(self.store.all(table), before[table])

    def test_pagination_is_bounded_without_losing_total_and_invalid_page_is_rejected(self):
        data = snapshot([row(IDORDEMDECOMPRA=n, DATAOC='01/10/2026') for n in range(1, 31)])
        iid = data['lines'][0]['item_id']
        self.assertEqual(len(detail(data, {'id': iid})['orders']), 10)
        self.assertEqual(detail(data, {'id': iid, 'page': 2})['total'], 30)
        for page in ['-1', 'nan', '1.2', '1000001']:
            with self.assertRaises(ValueError):
                search(data, {'page': page})

    def test_approval_report_without_price_columns_is_supported_as_unknown(self):
        headers = ['Empresa', 'Comprador SCI', 'Número da SCI', 'Descrição do Artigo', 'Status da SCI',
                   'Quantidade', 'Unidade', 'ID OC', 'Status BPM SCI', 'Status do Item da OC']
        values = ['Hotel A', 'Teste', '42', 'Item A', '2 - Em cotação', 5, 'UN', 123, '3 - Aprovada', '2 - Atendido']
        with patch.object(engine, 'open_book', return_value=Book([Sheet([headers, values])])):
            self.store.import_file('report.xls')
        data = self.store.purchase_history({})
        self.assertEqual(data['total'], 1)
        self.assertIsNone(data['items'][0]['latest']['order_price'])
        self.assertEqual(data['items'][0]['unit_basis'], 'sci')
        self.assertNotIn('receipt_price', data['source']['columns'])

    def test_real_binary_xls_and_xlsx_import_have_the_same_purchase_values(self):
        import xlwt
        from openpyxl import Workbook
        directory = Path(self.tmp.name)
        xlsx = Workbook()
        xlsx.active.append(HEADERS)
        xlsx.active.append(row())
        xlsx.save(directory / 'base.xlsx')
        xlsx.close()
        xls = xlwt.Workbook()
        sheet = xls.add_sheet('BASE SCI')
        for ri, values in enumerate([HEADERS, row()]):
            for ci, value in enumerate(values):
                if value is not None:
                    sheet.write(ri, ci, value)
        xls.save(str(directory / 'base.xls'))
        results = []
        for filename in ('base.xlsx', 'base.xls'):
            self.store.import_file(str(directory / filename))
            data = self.store.purchase_history({})
            results.append(self.store.purchase_history({'id': data['items'][0]['id']})['orders'])
        self.assertEqual(results[0], results[1])


if __name__ == '__main__':
    unittest.main()
