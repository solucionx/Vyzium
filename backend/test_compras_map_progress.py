import tempfile
import unittest

import compras_engine as engine


class ActiveMapProgressTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = engine.Store(self.tmp.name)

    @staticmethod
    def item(item_id):
        return {
            'id': item_id,
            'company': 'HOTEL',
            'sci': '100',
            'article': item_id,
            'description': f'Item {item_id}',
            'quantity': '1',
            'unit': 'UN',
            'buyer': 'Comprador',
            'approval': 'approved',
        }

    def test_summary_uses_same_defined_rule_as_open_map(self):
        data = {
            'id': 'map-progress',
            'name': 'Mapa progresso',
            'created': '2026-10-02T10:00:00',
            'revision': 1,
            'items': [self.item('i1'), self.item('i2'), self.item('i3')],
            'suppliers': [
                {'id': 's1', 'name': 'Fornecedor 1', 'phone': ''},
                {'id': 's2', 'name': 'Fornecedor 2', 'phone': ''},
            ],
            'quotes': {
                'i1': {'s1': {'price': '10'}},
                'i3': {'s1': {'price': '20'}, 's2': {'price': '20'}},
            },
            'choices': {},
            'awards': {},
            'saving_target': '5',
            'archived': False,
        }
        self.store.put('maps', data['id'], data)

        summary = next(row for row in self.store.map_summaries() if row['id'] == data['id'])
        self.assertEqual(summary['count'], 3)
        self.assertEqual(summary['defined_count'], 1)
        self.assertEqual(summary['completion_percent'], 33)

        data['choices']['i3'] = 's1'
        self.store.put('maps', data['id'], data)
        summary = next(row for row in self.store.map_summaries() if row['id'] == data['id'])
        self.assertEqual(summary['defined_count'], 2)
        self.assertEqual(summary['completion_percent'], 67)

    def test_archived_summary_does_not_recalculate_active_progress(self):
        data = {
            'id': 'map-completed',
            'name': 'Concluído',
            'created': '2026-10-02T10:00:00',
            'revision': 1,
            'items': [self.item('i1')],
            'suppliers': [],
            'quotes': {},
            'choices': {},
            'awards': {},
            'saving_target': '5',
            'archived': True,
        }
        self.store.put('maps', data['id'], data)
        summary = next(row for row in self.store.map_summaries() if row['id'] == data['id'])
        self.assertEqual(summary['defined_count'], 0)
        self.assertEqual(summary['completion_percent'], 0)


if __name__ == '__main__':
    unittest.main()
