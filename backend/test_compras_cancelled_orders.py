import tempfile
import unittest
from unittest.mock import patch

import compras_engine as engine
from workbook_formats import Book, Sheet


class CancelledOrdersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = engine.Store(self.tmp.name)

    def book(self, status='3 - Cancelado', sci='0 - Pendente', bpm='3 - Aprovado', order='123'):
        headers = ['Empresa', 'Comprador SCI', 'Número da SCI', 'Descrição do Artigo',
                   'Status da SCI', 'Quantidade', 'Unidade', 'ID OC', 'Status BPM SCI',
                   'Status do Item da OC']
        row = ['Hotel A', 'Comprador A', '42', 'Item A', sci, 5, 'UN', order, bpm, status]
        return Book([Sheet([headers, row])])

    def load(self, **kwargs):
        with patch.object(engine, 'open_book', return_value=self.book(**kwargs)):
            return engine.load_items('sample.xlsx')

    def test_cancelled_order_item_returns_to_catalog(self):
        for status in ['3 - Cancelado', '3 - cancelado', 3, 3.0, ' 3 – CANCELADO ']:
            with self.subTest(status=status):
                items, report = self.load(status=status)
                self.assertEqual(len(items), 1)
                self.assertEqual(items[0]['quantity'], '5')
                self.assertEqual(report['excluded']['with_order'], 0)

    def test_active_unknown_and_missing_status_still_exclude_order(self):
        for status in [None, '', '0 - Pendente', '2 - Atendido', '13 - Cancelado', '3 - Outro']:
            with self.subTest(status=status):
                items, report = self.load(status=status)
                self.assertEqual(items, [])
                self.assertEqual(report['excluded']['with_order'], 1)

    def test_existing_sci_restrictions_are_preserved(self):
        for kwargs in [{'sci': '4 - Encerrada'}, {'sci': '6 - Cancelada'},
                       {'bpm': '2 - Recusado'}, {'bpm': '4 - Cancelado'}]:
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.load(**kwargs)[0], [])
        self.assertEqual(len(self.load(sci='2 - Em Cotação')[0]), 1)
        self.assertEqual(len(self.load(order='', status=None)[0]), 1)

    def test_reimport_repurchase_preserves_completed_map_and_identity(self):
        def imp(**kwargs):
            with patch.object(engine, 'open_book', return_value=self.book(**kwargs)):
                return self.store.import_file('sample.xlsx')
        imp(order='', status=None)
        item = self.store.catalog()['items'][0]
        old = self.store.create_map({'name': 'Original', 'ids': [item['id']]})
        self.store.complete_map(old['id'])
        historical = self.store.get_map(old['id'])
        imp(status='0 - Pendente')
        self.assertEqual(self.store.catalog()['items'], [])
        imp()
        restored = self.store.catalog()['items'][0]
        self.assertEqual(restored['id'], item['id'])
        new = self.store.create_map({'name': 'Recompra', 'ids': [item['id']]})
        self.assertNotEqual(new['id'], old['id'])
        self.assertEqual(self.store.get_map(old['id']), historical)
        imp()
        with self.assertRaises(ValueError):
            self.store.create_map({'name': 'Duplicado', 'ids': [item['id']]})

    def test_raw_sci_mixed_orders_remain_blocked(self):
        headers = ['FKEMPRESA', 'EMPRESA', 'IDSCI', 'IDITEMDASCI', 'DESCRICAOARTIGO',
                   'QUANTIDADESCI', 'UNIDADEDEMEDIDASCI', 'IDORDEMDECOMPRA',
                   'NMSTATUSDOITEMDASCI', 'NMSTATUSBPMSCI', 'COMPRADOR', 'NMSTATUSITEMDAORDEMDECOMPRA']
        row = [1, 'Hotel A', 42, 1, 'Item A', 5, 'UN', 123, 0, 3, 'Comprador A', 3]
        with patch.object(engine, 'open_book', return_value=Book([Sheet([headers, row])])):
            self.assertEqual(len(engine.load_items('sample.xlsx')[0]), 1)
        active = list(row)
        active[7], active[-1] = 456, 0
        with patch.object(engine, 'open_book', return_value=Book([Sheet([headers, row, active])])):
            items, report = engine.load_items('sample.xlsx')
            self.assertEqual(items, [])
            self.assertEqual(report['excluded']['with_order'], 1)


if __name__ == '__main__':
    unittest.main()
