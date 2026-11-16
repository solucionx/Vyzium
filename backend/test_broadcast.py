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
        self.body['snapshot_hash'] = self.service.preview_broadcast(self.body)['snapshot_hash']
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

    def test_contact_changed_after_review_requires_another_review(self):
        self.body['snapshot_hash'] = self.service.preview_broadcast(self.body)['snapshot_hash']
        self.store.save_supplier({'supplier_key': 'a', 'phone': '85977776666'})
        with self.assertRaisesRegex(ValueError, 'mudaram'):
            self.service.start_broadcast(self.body)

    def test_reused_id_cannot_hide_different_payload(self):
        self.create_batch()
        with self.assertRaises(ValueError):
            self.service.start_broadcast({**self.body, 'message': 'Outro comunicado'})

    def test_inactive_and_malformed_numbers_are_reported(self):
        self.store.save_supplier({'supplier_key': 'a', 'active': False})
        result = self.service.preview_broadcast({**self.body, 'manual': [{'name': 'Invalid', 'phone': 'abc85999998888'}, {'phone': '85988887777'}]})
        self.assertEqual(len(result['groups']), 1)
        self.assertEqual(len(result['skipped']), 3)

    def test_unknown_id_never_returns_unrelated_batch(self):
        self.create_batch()
        self.assertFalse(self.service.broadcast_status(str(uuid.uuid4()))['exists'])
        self.assertTrue(self.service.broadcast_status()['exists'])

    def test_uncertain_message_blocks_new_batch_until_reviewed(self):
        self.store.save_settings({'simulation': False})
        self.body.update(simulation=False, supplier_keys=['a'], manual=[])
        job = self.create_batch()
        with patch.object(self.service, '_wait_for_connection'), patch('engine.whatsapp_request', side_effect=TimeoutError()):
            result = self.service._run_persistent_batch(job)
        self.body['request_id'] = str(uuid.uuid4())
        with self.assertRaisesRegex(ValueError, 'sem confirmação'):
            self.service.start_broadcast(self.body)
        self.store.review_followup(result['results'][0]['id'])
        with patch.object(self.service, '_start_persistent_worker'):
            self.service.start_broadcast(self.body)

    def test_restart_quarantines_inflight_and_resumes_only_queued(self):
        self.store.save_settings({'simulation': False})
        self.body['simulation'] = False
        job = self.create_batch()
        batch = self.store.message_batch(job)
        self.store.plan_message_batch(job, batch['request']['groups'])
        self.store.claim_next_queue_item(job)
        with patch.object(FollowUpService, '_start_persistent_worker'):
            resumed = FollowUpService(self.store)
        with patch.object(resumed, '_wait_for_connection'), patch('engine.time.sleep'), patch('engine.whatsapp_request', return_value={'status': 'sent'}) as bridge:
            result = resumed._run_persistent_batch(job)
            self.assertEqual(bridge.call_count, 1)
        self.assertEqual(result['uncertain'], 1)
        self.assertEqual(result['sent'], 1)

    def test_failed_broadcast_does_not_auto_resume(self):
        job = self.create_batch()
        with self.store.lock:
            self.store.connection.execute("UPDATE message_batches SET status='error' WHERE batch_id=?", (job,))
            self.store.connection.commit()
        with patch.object(FollowUpService, '_start_persistent_worker') as worker:
            FollowUpService(self.store)
            worker.assert_not_called()

    def test_limit_500_and_no_followup_item_side_effects(self):
        body = {**self.body, 'supplier_keys': [], 'manual': [{'phone': '+1415555%04d' % i} for i in range(500)]}
        preview = self.service.preview_broadcast(body)
        self.assertEqual(len(preview['groups']), 500)
        self.assertEqual(self.store.connection.execute('SELECT COUNT(*) FROM followup_items').fetchone()[0], 0)
        with self.assertRaises(ValueError):
            self.service.preview_broadcast({**body, 'manual': body['manual'] + [{'phone': '+14155559999'}]})
