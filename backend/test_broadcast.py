import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from engine import Store, FollowUpService


class BroadcastTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / 'test.db')
        self.service = FollowUpService(self.store)
        self.store.save_supplier({'supplier_key': 'a', 'display_name': 'Fornecedor A', 'phone': '85999998888'})
        self.store.save_supplier({'supplier_key': 'b', 'display_name': 'Sem telefone'})
        self.body = {'supplier_keys': ['a', 'b'], 'manual': [{'name': 'Repetido', 'phone': '+55 (85) 99999-8888'}, {'name': 'Manual', 'phone': '85988887777'}], 'message': 'Nova cotação', 'request_id': str(uuid.uuid4()), 'simulation': True}

    def tearDown(self):
        self.store.connection.close()
        self.tmp.cleanup()

    def test_preview_deduplicates_and_reports_missing_phone_without_orders(self):
        result = self.service.preview_broadcast(self.body)
        self.assertEqual(len(result['groups']), 2)
        self.assertEqual(len(result['skipped']), 2)
        self.assertTrue(all(not g['items'] for g in result['groups']))

    def test_invalid_requests_never_create_a_batch(self):
        for changes in ({'supplier_keys': [], 'manual': []}, {'message': ''}, {'supplier_keys': ['missing']}, {'manual': ['invalid']}, {'manual': [{}] * 501}):
            with self.assertRaises(ValueError):
                self.service.preview_broadcast({**self.body, **changes})
        with self.assertRaises(ValueError):
            self.service.start_broadcast({**self.body, 'simulation': False})
        self.assertIsNone(self.store.message_batch(self.body['request_id']))

    def create_batch(self):
        with patch.object(self.service, '_start_persistent_worker'):
            return self.service.start_broadcast(self.body)['job_id']

    def test_simulation_persists_history_and_duplicate_request_does_not_resend(self):
        job = self.create_batch()
        with patch('engine.whatsapp_request') as bridge:
            result = self.service._run_persistent_batch(job)
            bridge.assert_not_called()
        self.assertEqual(result['simulated'], 2)
        with patch.object(self.service, '_start_persistent_worker') as worker:
            self.service.start_broadcast(self.body)
            worker.assert_not_called()
        self.assertEqual(len(self.store.recent_history(20)), 2)
        self.assertEqual(len(self.store.suppliers()), 2)

    def test_real_send_keeps_manual_out_of_registry_and_does_not_replay_uncertain(self):
        self.store.save_settings({'simulation': False})
        self.body['simulation'] = False
        job = self.create_batch()
        with patch.object(self.service, '_wait_for_connection'), patch('engine.time.sleep'), patch('engine.whatsapp_request', side_effect=[{'status': 'sent', 'resolved_phone': '+5585999998888'}, TimeoutError()]):
            result = self.service._run_persistent_batch(job)
        self.assertEqual(result['sent'], 1)
        self.assertEqual(result['uncertain'], 1)
        with patch('engine.whatsapp_request') as bridge:
            self.service._run_persistent_batch(job)
            bridge.assert_not_called()
        self.assertEqual(len(self.store.suppliers()), 2)

    def test_concurrent_batch_is_blocked(self):
        self.create_batch()
        with self.assertRaises(ValueError):
            self.service.start_broadcast({**self.body, 'request_id': str(uuid.uuid4())})
