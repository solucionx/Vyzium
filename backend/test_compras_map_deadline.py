import copy
import tempfile
import unittest
from unittest.mock import patch

import compras_engine as engine


def sample_item():
    return {
        'id': 'deadline|1',
        'company': 'CARMEL CUMBUCO',
        'sci': '9001',
        'article': 'A01',
        'description': 'Item prazo mapa',
        'quantity': '2',
        'unit': 'UN',
        'buyer': 'Comprador A',
        'group': 'Teste',
        'needed': '2026-10-20',
        'approved_at': '2026-10-08',
        'deadline_rule': 'approval_12_days',
        'issued': '2026-10-01',
        'urgent': False,
        'status': 'pending',
        'approval': 'approved',
    }


class PurchaseMapDeadlineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = engine.Store(self.tmp.name)
        item = sample_item()
        self.store.put('items', item['id'], item)

    def create(self, due_date=''):
        return self.store.create_map({
            'name': 'Mapa com prazo',
            'ids': [sample_item()['id']],
            'due_date': due_date,
        })

    def test_old_map_without_due_date_remains_compatible(self):
        created = self.create()
        legacy = copy.deepcopy(created)
        legacy.pop('due_date', None)
        self.store.put('maps', legacy['id'], legacy)

        detail = self.store.detail(legacy['id'])
        self.assertNotIn('due_date', detail['map'])

        saved = self.store.save_map(copy.deepcopy(detail['map']))['map']
        self.assertNotIn('due_date', saved)
        self.assertFalse(saved['archived'])

    def test_create_save_and_clear_optional_due_date(self):
        created = self.create('2026-10-10')
        self.assertEqual(created['due_date'], '2026-10-10')

        body = copy.deepcopy(created)
        body['due_date'] = '2026-10-12'
        saved = self.store.save_map(body)['map']
        self.assertEqual(saved['due_date'], '2026-10-12')

        body = copy.deepcopy(saved)
        body['due_date'] = ''
        cleared = self.store.save_map(body)['map']
        self.assertEqual(cleared['due_date'], '')

    def test_invalid_due_date_is_rejected_without_creating_map(self):
        with self.assertRaisesRegex(ValueError, 'Prazo do mapa inválido'):
            self.create('10/10/2026')
        self.assertEqual(self.store.all('maps'), [])

    def test_invalid_due_date_is_rejected_without_overwriting_existing_value(self):
        created = self.create('2026-10-10')
        body = copy.deepcopy(created)
        body['due_date'] = '2026-02-30'
        with self.assertRaisesRegex(ValueError, 'Prazo do mapa inválido'):
            self.store.save_map(body)
        self.assertEqual(self.store.get_map(created['id'])['due_date'], '2026-10-10')

    def test_deadline_states_do_not_change_sci_deadline(self):
        created = self.create('2026-10-10')
        self.assertEqual(engine.map_due_status(created, '2026-10-09'), 'future')
        self.assertEqual(engine.map_due_status(created, '2026-10-10'), 'today')
        self.assertEqual(engine.map_due_status(created, '2026-10-11'), 'overdue')

        stored_item = self.store.catalog()['items'][0]
        self.assertEqual(stored_item['needed'], '2026-10-20')
        self.assertEqual(stored_item['deadline_rule'], 'approval_12_days')

    def test_completed_map_never_reports_overdue(self):
        created = self.create('2026-09-01')
        completed = self.store.complete_map(created['id'])['map']
        self.assertEqual(engine.map_due_status(completed, '2026-10-01'), 'completed')
        summary = next(row for row in self.store.map_summaries() if row['id'] == created['id'])
        self.assertEqual(summary['due_status'], 'completed')

    def test_overview_exposes_deadline_alert_fields(self):
        created = self.create('2026-10-01')
        self.assertTrue(created['due_date'])
        with patch('compras_engine.map_due_status', return_value='today'):
            overview = self.store.overview()
        self.assertEqual(overview['due_today_maps'], 1)
        self.assertEqual(overview['overdue_maps'], 0)


if __name__ == '__main__':
    unittest.main()
