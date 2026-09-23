"""Addition must preserve prior purchasing decisions and validate current availability."""
import base64
import copy
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import compras_engine as engine
import test_compras_items as fixtures
from secure_sqlite import cipher_available, connect


def available_item(iid, company='CARMEL TAÍBA', buyer='Teste'):
    return {'id': iid, 'company': company, 'sci': 'SCI-' + iid, 'article': 'ART-' + iid,
            'description': 'Peça ' + iid, 'quantity': '3', 'unit': 'UN', 'buyer': buyer,
            'approval': 'approved', 'status': 'pending', 'note': 'Observação da base',
            'purchase_type': 'Normal', 'group': 'Manutenção'}


def seed_available(store):
    for iid in ['a1', 'a2', 'locked', 'remaining', 'archived']:
        store.put('items', iid, available_item(iid))
    other = store.create_map({'name': 'Outro mapa ativo', 'ids': ['locked', 'remaining']})
    archived = store.create_map({'name': 'Mapa concluído', 'ids': ['archived']})
    store.complete_map(archived['id'])
    return other, archived


class AddMapItemsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = engine.Store(self.tmp.name)
        self.map = fixtures.MapItemsTest.seed(self.store)
        self.other, self.archived = seed_available(self.store)

    def add(self, ids=None, body=None):
        return self.store.save_map({**(self.map if body is None else body), 'add_item_ids': ['a1'] if ids is None else ids})

    def snapshot(self):
        return {table: self.store.all(table) for table in self.store.JSON_TABLES}

    def test_add_preserves_prior_quotes_choices_awards_and_unrelated_data(self):
        self.store.put('messages', 'history', {'id': 'history', 'status': 'sent', 'message': 'Solicitação anterior'})
        self.store.put('settings', 'ui', {'id': 'ui', 'filters': {'buyer': 'Teste'}})
        before = self.snapshot()
        original_result = engine.evaluate(self.map)
        detail = self.add(['a1', 'a2'])
        data = detail['map']
        self.assertEqual(data['id'], self.map['id'])
        self.assertEqual(data['created'], self.map['created'])
        self.assertEqual(data['revision'], self.map['revision'] + 1)
        for field in ['name', 'suppliers', 'saving_target', 'awards', 'choices', 'archived']:
            self.assertEqual(data[field], self.map[field])
        for item in self.map['items']:
            self.assertEqual(next(i for i in data['items'] if i['id'] == item['id']), item)
            self.assertEqual(data['quotes'][item['id']], self.map['quotes'][item['id']])
        self.assertEqual(len(data['items']), 6)
        self.assertEqual(detail['result']['unquoted'], 2)
        for field in ['net', 'saving', 'gross', 'suppliers']:
            self.assertEqual(detail['result'][field], original_result[field])
        for table in ['items', 'settings', 'messages']:
            self.assertEqual(self.store.all(table), before[table])
        self.assertEqual(self.store.get_map(self.other['id']), next(m for m in before['maps'] if m['id'] == self.other['id']))
        for iid in ['a1', 'a2']:
            line = next(l for l in detail['result']['lines'] if l['id'] == iid)
            self.assertEqual(line['quotes'], [])
            self.assertIsNone(line['chosen'])
            self.assertNotIn(iid, data['awards'])
        self.assertNotIn('add_item_ids', data)

    def test_inclusion_payload_may_omit_unchanged_editable_fields(self):
        detail = self.add(body={'id': self.map['id'], 'revision': self.map['revision']})
        for field in ['suppliers', 'name', 'awards', 'choices', 'saving_target']:
            self.assertEqual(detail['map'][field], self.map[field])
        for iid, quotes in self.map['quotes'].items():
            self.assertEqual(detail['map']['quotes'][iid], quotes)

    def test_new_items_are_authoritative_and_cannot_inherit_prices_or_decisions(self):
        body = copy.deepcopy(self.map)
        body['items'].append({**available_item('a1'), 'quantity': '999', 'company': 'HOTEL INCORRETO',
                              'note': 'Nota adulterada', 'purchase_type': 'Outro'})
        body['quotes']['a1'] = {'s1': {'price': '1', 'negotiated': '1'}}
        body['choices']['a1'] = 's1'
        body['awards']['a1'] = {'supplier_id': 's1', 'reason': 'Prazo de entrega'}
        data = self.add(body=body)['map']
        item = next(i for i in data['items'] if i['id'] == 'a1')
        for key, value in available_item('a1').items():
            self.assertEqual(item[key], value)
        self.assertTrue(all(q['price'] == '' for q in data['quotes']['a1'].values()))
        self.assertNotIn('a1', data['choices'])
        self.assertNotIn('a1', data['awards'])

    def test_pending_edits_and_legacy_discount_are_saved_with_addition(self):
        body = copy.deepcopy(self.map)
        body['name'] = 'Mapa editado'
        body['saving_target'] = '8'
        body['items'][0]['note'] = 'Observação editada'
        iid = body['items'][0]['id']
        body['quotes'][iid]['s1']['negotiated'] = '8'
        body['quotes'][iid]['s1']['delivery'] = '1 dia'
        data = self.add(body=body)['map']
        self.assertEqual(data['name'], 'Mapa editado')
        self.assertEqual(data['saving_target'], '8')
        self.assertEqual(data['quotes'][iid]['s1'], body['quotes'][iid]['s1'])
        self.assertEqual(data['quotes'][iid]['s2'], self.map['quotes'][iid]['s2'])
        self.assertEqual(next(i for i in data['items'] if i['id'] == iid)['note'], 'Observação editada')

    def test_add_before_suppliers_are_registered_and_quote_new_row_later(self):
        self.store.put('items', 'empty-map-item', available_item('empty-map-item'))
        data = self.store.create_map({'name': 'Sem fornecedores', 'ids': ['empty-map-item']})
        detail = self.add(body=data)
        self.assertEqual(detail['result']['unquoted'], 2)
        self.assertEqual(detail['map']['suppliers'], [])
        data = detail['map']
        data['suppliers'] = [{'id': 's1', 'name': 'Novo fornecedor', 'phone': ''}]
        data['quotes']['a1'] = {'s1': {'price': '10', 'negotiated': '8'}}
        detail = self.store.save_map(data)
        self.assertEqual(detail['result']['net'], '24.00')

    def test_invalid_selections_rejected_without_partial_save_or_backup(self):
        before = self.snapshot()
        for selection in [None, 'a1', 1, [None], [{}], [''], ['a1', 'a1'], ['unknown'], ['a1', 'unknown'], ['m1'], ['a1', 'locked']]:
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                self.store.save_map({**self.map, 'add_item_ids': selection})
            self.assertEqual(self.snapshot(), before)
        self.assertEqual(list(self.store.safety.backup_dir.glob('*pre-add-map-items*.db')), [])

    def test_add_and_remove_in_one_request_is_rejected(self):
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'operações separadas'):
            self.add(body={**self.map, 'remove_item_ids': ['m1']})
        self.assertEqual(self.snapshot(), before)

    def test_omitting_add_ids_never_appends_forged_rows(self):
        body = copy.deepcopy(self.map)
        body['items'].append(available_item('a1'))
        self.assertEqual(len(self.store.save_map(body)['map']['items']), 4)

    def test_reimport_between_selection_and_save_uses_current_source(self):
        fresh = available_item('a1')
        fresh.update(quantity='7', description='Descrição atualizada', note='Nota atualizada')
        self.store.put('items', 'a1', fresh)
        item = next(i for i in self.add()['map']['items'] if i['id'] == 'a1')
        for key, value in fresh.items():
            self.assertEqual(item[key], value)

    def test_item_removed_from_catalog_cannot_be_added(self):
        with self.store.db() as con:
            con.execute('DELETE FROM items WHERE id=?', ('a1',))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'disponível na base'):
            self.add(['a2', 'a1'])
        self.assertEqual(self.snapshot(), before)

    def test_move_removed_item_into_existing_map(self):
        with self.assertRaisesRegex(ValueError, 'outro mapa ativo'):
            self.add(['locked'])
        self.store.save_map({**self.other, 'remove_item_ids': ['locked']})
        detail = self.add(['locked'])
        self.assertIn('locked', [i['id'] for i in detail['map']['items']])
        self.assertEqual([i['id'] for i in self.store.get_map(self.other['id'])['items']], ['remaining'])
        assigned = next(i for i in self.store.catalog()['items'] if i['id'] == 'locked')['maps']
        self.assertEqual(assigned, [self.map['name']])

    def test_item_from_completed_map_can_be_added_without_changing_history(self):
        original = self.store.get_map(self.archived['id'])
        self.add(['archived'])
        self.assertEqual(self.store.get_map(self.archived['id']), original)

    def test_revision_completed_map_and_in_progress_send_block_addition(self):
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'outra tela'):
            self.add(body={**self.map, 'revision': self.map['revision'] - 1})
        with self.store.send_lock, self.assertRaisesRegex(ValueError, 'envio'):
            self.add()
        self.assertEqual(self.snapshot(), before)
        self.store.complete_map(self.map['id'])
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'concluído'):
            self.add()
        self.assertEqual(self.snapshot(), before)

    def test_two_simultaneous_maps_cannot_claim_the_same_item(self):
        barrier = threading.Barrier(2)
        def attempt(data):
            barrier.wait()
            try:
                return self.store.save_map({**data, 'add_item_ids': ['a1']})['map']['id']
            except ValueError:
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts = [pool.submit(attempt, data) for data in [self.map, self.other]]
            results = [f.result(timeout=10) for f in attempts]
        self.assertEqual(sum(r is not None for r in results), 1)
        self.assertEqual(sum(any(i['id'] == 'a1' for i in m['items']) for m in self.store.all('maps')), 1)

    def test_repeated_request_is_rejected_without_duplication(self):
        self.add()
        with self.assertRaisesRegex(ValueError, 'outra tela'):
            self.add()
        self.assertEqual(sum(i['id'] == 'a1' for i in self.store.get_map(self.map['id'])['items']), 1)

    def test_validation_backup_and_storage_failures_do_not_partially_add(self):
        original = self.snapshot()
        invalid = copy.deepcopy(self.map)
        invalid['quotes']['m1']['s1']['negotiated'] = '999'
        with self.assertRaises(ValueError):
            self.add(body=invalid)
        self.assertEqual(self.snapshot(), original)
        for target in ['backup', 'put']:
            owner = self.store.safety if target == 'backup' else self.store
            with self.subTest(target=target), patch.object(owner, target, side_effect=OSError('Falha simulada')):
                with self.assertRaises(OSError):
                    self.add()
            self.assertEqual(self.snapshot(), original)

    def test_backup_recovery_and_reopen_preserve_both_versions(self):
        original = self.store.get_map(self.map['id'])
        data = self.add()['map']
        backup = next(self.store.safety.backup_dir.glob('*pre-add-map-items*.db'))
        con = connect(backup, readonly=True)
        try:
            restored = json.loads(con.execute('SELECT data FROM maps WHERE id=?', (self.map['id'],)).fetchone()[0])
        finally:
            con.close()
        self.assertEqual(restored, original)
        reopened = engine.Store(self.tmp.name)
        self.assertEqual(reopened.detail(data['id'])['map'], data)

    def test_preview_export_and_next_save_include_the_added_item(self):
        previous = self.store.preview(self.map['id'], 's1')
        detail = self.add()
        preview = self.store.preview(self.map['id'], 's1')
        self.assertIn('Peça a1', preview['message'])
        self.assertEqual(preview['message'].count('CNPJ: 27.708.448/0001-10'), 1)
        self.assertNotEqual(preview['fingerprint'], previous['fingerprint'])
        body = {'map_id': self.map['id'], 'supplier_id': 's1', 'revision': previous['revision'], 'fingerprint': previous['fingerprint']}
        with patch('compras_engine.whatsapp_request') as bridge, self.assertRaisesRegex(ValueError, 'Atualize a prévia'):
            self.store.send(body)
        bridge.assert_not_called()
        import xlrd
        book = xlrd.open_workbook(file_contents=base64.b64decode(self.store.export_xls(self.map['id'])['content']))
        sheet = book.sheet_by_index(1)
        self.assertIn('Peça a1', sheet.col_values(3))
        data = detail['map']
        data['quotes']['a1']['s1'] = {'price': '5', 'negotiated': '4', 'delivery': '2 dias'}
        saved = self.store.save_map(data)
        line = next(l for l in saved['result']['lines'] if l['id'] == 'a1')
        self.assertEqual(line['chosen']['net'], '12.00')
        self.assertEqual(saved['map']['quotes']['m1'], self.map['quotes']['m1'])

    @unittest.skipUnless(cipher_available(), 'SQLCipher runtime not available')
    def test_encrypted_inclusion_and_backup_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            key = '7b' * 32
            with patch.dict('os.environ', {'VYZIUM_DB_KEY_HEX': key}):
                store = engine.Store(directory)
            data = fixtures.MapItemsTest.seed(store)
            store.put('items', 'a1', available_item('a1'))
            saved = store.save_map({**data, 'add_item_ids': ['a1']})
            backup = next(store.safety.backup_dir.glob('*pre-add-map-items*.db'))
            con = connect(backup, key_hex=key, readonly=True)
            try:
                previous = json.loads(con.execute('SELECT data FROM maps WHERE id=?', (data['id'],)).fetchone()[0])
            finally:
                con.close()
            self.assertEqual(len(previous['items']), 4)
            with patch.dict('os.environ', {'VYZIUM_DB_KEY_HEX': key}):
                reopened = engine.Store(directory)
            self.assertEqual(reopened.detail(data['id'])['map'], saved['map'])


if __name__ == '__main__':
    unittest.main()
