"""Regression coverage for item removal, hotel order and quotation messages."""
import base64
import copy
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import compras_engine as engine
from secure_sqlite import cipher_available, connect


class MapItemsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = engine.Store(self.tmp.name)
        self.map = self.seed(self.store)

    @staticmethod
    def seed(store):
        rows = [('m1', 'MAGNA PRAIA', 'Cabo', '20'),
                ('c1', 'CARMEL CUMBUCO', 'Lâmpada', '10'),
                ('m2', 'MAGNA PRAIA', 'Tomada', '30'),
                ('c2', 'CARMEL CUMBUCO', 'Disjuntor', '40')]
        for iid, hotel, description, _ in rows:
            store.put('items', iid, {
                'id': iid, 'company': hotel, 'sci': 'SCI-INTERNA-' + iid,
                'article': iid, 'description': description, 'quantity': '2',
                'unit': 'UN', 'buyer': 'Teste', 'approval': 'approved',
                'status': 'pending', 'note': 'Nota ' + iid, 'purchase_type': 'Normal',
            })
        data = store.create_map({'name': 'Cotação por hotel', 'ids': [r[0] for r in rows]})
        data['suppliers'] = [{'id': 's1', 'name': 'Fornecedor A', 'phone': '5585999999999'},
                             {'id': 's2', 'name': 'Fornecedor B', 'phone': ''}]
        data['quotes'] = {iid: {
            's1': {'price': price, 'negotiated': str(int(price) - 1), 'delivery': '3 dias'},
            's2': {'price': str(int(price) + 5), 'discount': '10', 'kind': 'percent'},
        } for iid, _, _, price in rows}
        data['awards'] = {iid: {'supplier_id': 's1', 'reason': 'Prazo de entrega', 'note': 'Manter'}
                          for iid, _, _, _ in rows}
        data['choices'] = {iid: 's1' for iid, _, _, _ in rows}
        return store.save_map(data)['map']

    def remove(self, iid='c1', body=None):
        return self.store.save_map({**(body or self.map), 'remove_item_ids': [iid]})

    def test_existing_map_order_is_stable_and_results_follow_item_ids(self):
        stored = self.store.get_map(self.map['id'])
        self.assertEqual([i['id'] for i in stored['items']], ['m1', 'c1', 'm2', 'c2'])
        detail = self.store.detail(self.map['id'])
        self.assertEqual([i['id'] for i in detail['map']['items']], ['c1', 'c2', 'm1', 'm2'])
        self.assertEqual([i['id'] for i in detail['result']['lines']], ['c1', 'c2', 'm1', 'm2'])
        self.assertEqual([i['chosen']['net'] for i in detail['result']['lines']], ['18.00', '78.00', '38.00', '58.00'])
        self.assertEqual(self.store.get_map(self.map['id']), stored)  # Reading is not a migration.
        saved = self.store.save_map(detail['map'])
        self.assertEqual(saved['map']['quotes'], stored['quotes'])
        self.assertEqual(saved['map']['awards'], stored['awards'])
        self.assertEqual(saved['result'], detail['result'])

    def test_exports_keep_hotel_order_and_prices_together(self):
        rows = list(csv.reader(io.StringIO(self.store.export_csv(self.map['id'])['content']), delimiter=';'))
        self.assertEqual([r[3] for r in rows[1:]], ['Lâmpada', 'Disjuntor', 'Cabo', 'Tomada'])
        self.assertEqual([r[7] for r in rows[1:]], ['10', '40', '20', '30'])
        import xlrd
        book = xlrd.open_workbook(file_contents=base64.b64decode(self.store.export_xls(self.map['id'])['content']))
        # Detailed export retains the same row ordering as the map and numeric prices.
        sheet = book.sheet_by_index(1)
        self.assertEqual([sheet.cell_value(n, 3) for n in range(1, 5)], ['Lâmpada', 'Disjuntor', 'Cabo', 'Tomada'])

    def test_quote_message_groups_each_hotel_and_cnpj_once(self):
        message = self.store.preview(self.map['id'], 's1')['message']
        self.assertEqual(message.count('Hotel: '), 2)
        self.assertEqual(message.count('CNPJ: 19.253.187/0001-63'), 1)
        self.assertEqual(message.count('CNPJ: 02.333.096/0001-35'), 1)
        parts = ['Hotel: CARMEL CUMBUCO', '1. Lâmpada', '2. Disjuntor',
                 'Hotel: MAGNA PRAIA', '3. Cabo', '4. Tomada']
        positions = [message.index(part) for part in parts]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(message.count('Quantidade: 2 UN'), 4)
        for iid in ('m1', 'm2', 'c1', 'c2'):
            self.assertIn('Observação: Nota ' + iid, message)
        self.assertNotIn('SCI-INTERNA', message)
        self.assertNotIn('Fornecedor B', message)
        self.assertNotIn('19.00', message)

    def test_accents_and_case_do_not_split_the_same_hotel(self):
        data = self.store.get_map(self.map['id'])
        for n, item in enumerate(data['items']):
            item['company'] = 'CARMEL TAÍBA' if n % 2 else 'carmel taiba'
            self.store.put('items', item['id'], item)
        self.store.put('maps', data['id'], data)
        message = self.store.preview(data['id'], 's1')['message']
        self.assertEqual(message.count('Hotel: '), 1)
        self.assertEqual(message.count('CNPJ: 27.708.448/0001-10'), 1)

    def test_remove_cleans_only_its_quotes_and_keeps_other_data_and_pending_edits(self):
        original = copy.deepcopy(self.map)
        self.store.put('settings', 'ui', {'id': 'ui', 'filters': {'buyer': 'Teste'}})
        self.store.put('messages', 'sent', {'id': 'sent', 'map_id': self.map['id'], 'status': 'sent', 'message': 'Histórico original'})
        before = {table: self.store.all(table) for table in ('items', 'settings', 'messages')}
        self.map['name'] = 'Nome editado'
        self.map['quotes']['m1']['s1']['negotiated'] = '18'
        next(i for i in self.map['items'] if i['id'] == 'm1')['note'] = 'Nota editada'
        detail = self.remove()
        data = detail['map']
        self.assertEqual(data['id'], original['id'])
        self.assertEqual(data['revision'], original['revision'] + 1)
        self.assertEqual(data['name'], 'Nome editado')
        self.assertEqual(data['suppliers'], original['suppliers'])
        self.assertEqual([i['id'] for i in data['items']], ['c2', 'm1', 'm2'])
        for field in ('quotes', 'choices', 'awards'):
            self.assertNotIn('c1', data[field])
            self.assertEqual(data[field]['m2'], original[field]['m2'])
            self.assertEqual(data[field]['c2'], original[field]['c2'])
        self.assertEqual(data['quotes']['m1']['s1']['negotiated'], '18')
        self.assertEqual(next(i for i in data['items'] if i['id'] == 'm1')['note'], 'Nota editada')
        self.assertEqual(detail['result']['net'], '172.00')
        for table, content in before.items():
            self.assertEqual(self.store.all(table), content)
        catalog = {i['id']: i for i in self.store.catalog()['items']}
        self.assertEqual(catalog['c1']['maps'], [])
        self.assertTrue(catalog['m1']['maps'])
        reopened = engine.Store(self.tmp.name)
        self.assertEqual(reopened.detail(data['id'])['map'], data)
        self.assertEqual(reopened.create_map({'name': 'Reutilização', 'ids': ['c1']})['items'][0]['id'], 'c1')

    def test_backup_contains_saved_map_before_removal(self):
        original = self.store.get_map(self.map['id'])
        self.remove()
        backups = list(self.store.safety.backup_dir.glob('*pre-remove-map-items*.db'))
        self.assertEqual(len(backups), 1)
        con = connect(backups[0], readonly=True)
        try:
            restored = json.loads(con.execute('SELECT data FROM maps WHERE id=?', (self.map['id'],)).fetchone()[0])
        finally:
            con.close()
        self.assertEqual(restored, original)

    def test_invalid_remaining_price_or_backup_failure_keeps_saved_map_intact(self):
        original = self.store.get_map(self.map['id'])
        invalid = copy.deepcopy(self.map)
        invalid['quotes']['m1']['s1']['negotiated'] = '999'
        with self.assertRaises(ValueError):
            self.remove(body=invalid)
        self.assertEqual(self.store.get_map(self.map['id']), original)
        with patch.object(self.store.safety, 'backup', side_effect=OSError('Falha de backup')):
            with self.assertRaises(OSError):
                self.remove()
        self.assertEqual(self.store.get_map(self.map['id']), original)

    def test_omitted_items_do_not_mean_removal(self):
        body = {**self.map, 'items': [self.map['items'][0]]}
        self.assertEqual(len(self.store.save_map(body)['map']['items']), 4)

    def test_invalid_removal_and_last_item_are_rejected_without_changes(self):
        original = self.store.get_map(self.map['id'])
        for removed in ('c1', [None], ['unknown'], ['m1', 'm2', 'c1', 'c2']):
            with self.subTest(removed=removed), self.assertRaises(ValueError):
                self.store.save_map({**self.map, 'remove_item_ids': removed})
            self.assertEqual(self.store.get_map(self.map['id']), original)

    def test_stale_revision_completed_map_and_active_send_block_removal(self):
        self.map = self.store.save_map(self.map)['map']
        stale = {**self.map, 'revision': self.map['revision'] - 1}
        with self.assertRaisesRegex(ValueError, 'outra tela'):
            self.remove(body=stale)
        with self.store.send_lock, self.assertRaisesRegex(ValueError, 'envio'):
            self.remove()
        self.store.complete_map(self.map['id'])
        with self.assertRaisesRegex(ValueError, 'concluído'):
            self.remove()
        self.assertEqual(len(self.store.get_map(self.map['id'])['items']), 4)

    def test_removal_invalidates_preview_and_excludes_item_from_next_message(self):
        preview = self.store.preview(self.map['id'], 's1')
        self.remove()
        body = {'map_id': self.map['id'], 'supplier_id': 's1', 'revision': preview['revision'], 'fingerprint': preview['fingerprint']}
        with patch('compras_engine.whatsapp_request') as bridge, self.assertRaisesRegex(ValueError, 'Atualize a prévia'):
            self.store.send(body)
        bridge.assert_not_called()
        message = self.store.preview(self.map['id'], 's1')['message']
        self.assertNotIn('Lâmpada', message)
        self.assertIn('Disjuntor', message)

    @unittest.skipUnless(cipher_available(), 'SQLCipher runtime not available')
    def test_encrypted_map_and_backup_keep_the_existing_encryption(self):
        with tempfile.TemporaryDirectory() as directory:
            key = '5a' * 32
            with patch.dict('os.environ', {'VYZIUM_DB_KEY_HEX': key}):
                store = engine.Store(directory)
            data = self.seed(store)
            saved = store.save_map({**data, 'remove_item_ids': ['m1']})
            self.assertEqual(len(saved['map']['items']), 3)
            self.assertNotEqual(Path(store.path).read_bytes()[:16], b'SQLite format 3\x00')
            backup = next(store.safety.backup_dir.glob('*pre-remove-map-items*.db'))
            con = connect(backup, key_hex=key, readonly=True)
            try:
                previous = json.loads(con.execute('SELECT data FROM maps WHERE id=?', (data['id'],)).fetchone()[0])
            finally:
                con.close()
            self.assertEqual(len(previous['items']), 4)


if __name__ == '__main__':
    unittest.main()
