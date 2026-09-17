import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError
from engine import Store, FollowUpService, whatsapp_request


class WhatsAppBridgeConnectionTests(unittest.TestCase):
    """A ponte pode não estar de pé (processo do WhatsApp fechado, porta trocada,
    Chrome travado). Antes, apenas erros HTTP viravam mensagem amigável; uma falha
    de conexão (URLError/timeout) subia como texto técnico bruto até a interface."""

    @patch.dict(os.environ, {"FOLLOWUP_WHATSAPP_URL": "http://127.0.0.1:5001", "FOLLOWUP_API_TOKEN": "token"})
    @patch('engine.urlopen', side_effect=URLError('Connection refused'))
    def test_connection_failure_becomes_friendly_message(self, _urlopen):
        with self.assertRaises(RuntimeError) as ctx:
            whatsapp_request('/health')
        message = str(ctx.exception)
        self.assertNotIn('Connection refused', message)
        self.assertIn('WhatsApp', message)

    @patch.dict(os.environ, {"FOLLOWUP_WHATSAPP_URL": "http://127.0.0.1:5001", "FOLLOWUP_API_TOKEN": "token"})
    @patch('engine.urlopen', side_effect=TimeoutError('timed out'))
    def test_timeout_becomes_friendly_message(self, _urlopen):
        with self.assertRaises(RuntimeError) as ctx:
            whatsapp_request('/wait')
        self.assertNotIn('timed out', str(ctx.exception))


class WhatsAppFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'test.db')
        self.service = FollowUpService(self.store)
        self.group = dict(supplier_key='supplier', supplier_name='Test', phone='+5585999999999', urgency='overdue', message='Teste', items=[dict(item_key='item', urgency='overdue')])
        self.service.groups = lambda: [self.group] if self.service._can_send(self.group['items'][0], 72) else []

    def tearDown(self):
        self.store.connection.close()
        self.temp.cleanup()

    @patch('engine.whatsapp_request')
    def test_simulation_never_contacts_whatsapp(self, bridge):
        result = self.service.send(force_simulation=True)
        self.assertEqual(result['simulated'], 1)
        bridge.assert_not_called()

    @patch('engine.time.sleep')
    @patch('engine.whatsapp_request')
    def test_wait_then_send_and_cooldown(self, bridge, sleep):
        bridge.side_effect = [{'ready': True}, {'status': 'sent', 'message_id': 'test'}]
        self.assertEqual(self.service.send(force_simulation=False)['sent'], 1)
        self.assertEqual([call.args[0] for call in bridge.call_args_list], ['/wait', '/send'])
        self.assertEqual(self.service.send(force_simulation=False)['sent'], 0)
        self.assertEqual(bridge.call_count, 2)

    @patch('engine.whatsapp_request')
    def test_not_connected_never_sends(self, bridge):
        bridge.side_effect = RuntimeError('Conecte pelo QR')
        with self.assertRaisesRegex(RuntimeError, 'Conecte'):
            self.service.send(force_simulation=False)
        self.assertEqual(bridge.call_count, 1)
        self.assertFalse(self.service.send_lock.locked())
        self.assertEqual(self.store.recent_history(), [])

    @patch('engine.whatsapp_request')
    def test_uncertain_requires_manual_review(self, bridge):
        bridge.side_effect = [{'ready': True}, OSError('connection lost')]
        result = self.service.send(force_simulation=False)
        self.assertEqual(result['failed'], 1)
        self.assertEqual(result['results'][0]['status'], 'uncertain')
        self.assertFalse(self.service._can_send(dict(item_key='item',urgency='critical'), 1))
        self.assertEqual(self.service.send(force_simulation=False)['sent'], 0)
        self.store.review_followup(result['results'][0]['id'])
        self.assertTrue(self.service._can_send(self.group['items'][0], 72))

    @patch('engine.whatsapp_request')
    def test_recheck_eligibility_after_connection(self, bridge):
        def changed(route, body=None):
            self.service.groups = lambda: []
            return {'ready': True}
        bridge.side_effect = changed
        self.assertEqual(self.service.send(force_simulation=False)['sent'], 0)
        self.assertEqual(bridge.call_count, 1)


    @patch('engine.time.sleep')
    @patch('engine.whatsapp_request')
    def test_edited_message_is_the_one_sent_and_logged(self, bridge, sleep):
        bridge.side_effect = [{'ready': True}, {'status': 'sent', 'message_id': 'edited-test'}]
        result = self.service.send(
            supplier_keys=['supplier'],
            force_simulation=False,
            message_overrides={'supplier': 'Mensagem editada manualmente.'},
        )
        self.assertEqual(result['sent'], 1)
        self.assertEqual(bridge.call_args_list[1].args[1]['message'], 'Mensagem editada manualmente.')
        self.assertEqual(self.store.recent_history()[0]['message'], 'Mensagem editada manualmente.')

    def test_edited_message_cannot_be_empty(self):
        with self.assertRaisesRegex(ValueError, 'vazia'):
            self.service.send(force_simulation=True, message_overrides={'supplier': '   '})

    def test_empty_supplier_selection_is_rejected_instead_of_sending_all(self):
        with self.assertRaisesRegex(ValueError, 'Nenhum fornecedor selecionado'):
            self.service.send(supplier_keys=[], force_simulation=True)

    @patch('engine.time.sleep')
    @patch('engine.whatsapp_request')
    def test_proven_pre_send_failure_does_not_stop_next_supplier(self, bridge, sleep):
        groups = [
            dict(supplier_key='one', supplier_name='One', phone='+5585111111111', urgency='overdue', message='One', items=[dict(item_key='one-item', urgency='overdue')]),
            dict(supplier_key='two', supplier_name='Two', phone='+5585222222222', urgency='overdue', message='Two', items=[dict(item_key='two-item', urgency='overdue')]),
        ]
        self.service.groups = lambda: groups
        bridge.side_effect = [
            {'ready': True},
            {'status': 'failed', 'error': 'Número não registrado.'},
            {'status': 'sent', 'message_id': 'two-message'},
        ]
        result = self.service.send(force_simulation=False)
        self.assertEqual(result['processed'], 2)
        self.assertEqual(result['failed'], 1)
        self.assertEqual(result['sent'], 1)
        self.assertEqual([row['status'] for row in result['results']], ['failed', 'sent'])

    def test_parallel_batch_rejected(self):
        self.service.send_lock.acquire()
        try:
            with self.assertRaisesRegex(ValueError, 'lote'):
                self.service.send()
        finally:
            self.service.send_lock.release()

class WhatsAppBatchQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'test.db')
        self.service = FollowUpService(self.store)

    def tearDown(self):
        self.store.connection.close()
        self.temp.cleanup()

    @patch('engine.time.sleep')
    @patch('engine.whatsapp_request')
    def test_uncertain_supplier_does_not_stop_remaining_queue(self, bridge, _sleep):
        groups = [
            dict(supplier_key='one', supplier_name='One', phone='+5585111111111', urgency='overdue', message='One', items=[dict(item_key='one-item', urgency='overdue')]),
            dict(supplier_key='two', supplier_name='Two', phone='+5585222222222', urgency='overdue', message='Two', items=[dict(item_key='two-item', urgency='overdue')]),
        ]
        self.service.groups = lambda: groups
        bridge.side_effect = [
            {'ready': True},
            {'status': 'uncertain', 'error': 'Envio sem confirmação'},
            {'ready': True},
            {'status': 'sent', 'message_id': 'two-message'},
        ]
        result = self.service.send(force_simulation=False)
        self.assertEqual(result['processed'], 2)
        self.assertEqual(result['uncertain'], 1)
        self.assertEqual(result['sent'], 1)
        self.assertEqual([call.args[0] for call in bridge.call_args_list], ['/wait', '/send', '/wait', '/send'])

    @patch('engine.time.sleep')
    @patch('engine.whatsapp_request')
    def test_async_job_reports_progress_and_completes_whole_batch(self, bridge, _sleep):
        groups = [
            dict(supplier_key='one', supplier_name='One', phone='+5585111111111', urgency='overdue', message='One', items=[dict(item_key='one-item', urgency='overdue')]),
            dict(supplier_key='two', supplier_name='Two', phone='+5585222222222', urgency='overdue', message='Two', items=[dict(item_key='two-item', urgency='overdue')]),
        ]
        self.service.groups = lambda: groups
        bridge.side_effect = [
            {'ready': True},
            {'ready': True},
            {'status': 'sent', 'message_id': 'one-message', 'ack': 1},
            {'ready': True},
            {'status': 'sent', 'message_id': 'two-message', 'ack': 1},
        ]
        state = self.service.start_send(['one', 'two'], False, None)
        for _ in range(100):
            state = self.service.send_status(state['job_id'])
            if not state['active']:
                break
            import threading as _threading
            _threading.Event().wait(0.005)
        self.assertFalse(state['active'])
        self.assertEqual(state['phase'], 'done')
        self.assertEqual(state['processed'], 2)
        self.assertEqual(state['sent'], 2)
        self.assertEqual(state['result']['selected'], 2)

    @patch('engine.time.sleep')
    @patch('engine.whatsapp_request')
    def test_persistent_batch_keeps_queue_and_provider_confirmation(self, bridge, _sleep):
        groups = [
            dict(supplier_key='one', supplier_name='One', phone='+5585111111111', urgency='overdue', message='One', items=[dict(item_key='one-item', urgency='overdue')]),
            dict(supplier_key='two', supplier_name='Two', phone='+5585222222222', urgency='critical', message='Two', items=[dict(item_key='two-item', urgency='critical')]),
        ]
        self.service.groups = lambda: groups
        bridge.side_effect = [
            {'ready': True}, {'ready': True},
            {'status': 'sent', 'message_id': 'msg-one', 'ack': 2},
            {'ready': True},
            {'status': 'sent', 'message_id': 'msg-two', 'ack': 1},
        ]
        state = self.service.start_send(['one', 'two'], False, None)
        for _ in range(200):
            state = self.service.send_status(state['job_id'])
            if not state['active']:
                break
            import threading as _threading
            _threading.Event().wait(0.005)
        self.assertEqual(state['phase'], 'done')
        rows = self.store.queue_rows(state['job_id'])
        self.assertEqual([row['status'] for row in rows], ['sent', 'sent'])
        self.assertEqual(rows[0]['provider_message_id'], 'msg-one')
        self.assertEqual(rows[0]['ack'], 2)
        self.assertEqual(rows[1]['provider_message_id'], 'msg-two')

    @patch('engine.time.sleep')
    @patch('engine.whatsapp_request')
    def test_restart_quarantines_inflight_and_resumes_only_queued_messages(self, bridge, _sleep):
        batch_id = 'resume-test'
        groups = [
            dict(supplier_key='one', supplier_name='One', phone='+5585111111111', urgency='overdue', message='One', items=[dict(item_key='one-item', urgency='overdue')]),
            dict(supplier_key='two', supplier_name='Two', phone='+5585222222222', urgency='overdue', message='Two', items=[dict(item_key='two-item', urgency='overdue')]),
        ]
        self.store.create_message_batch(batch_id, False, {'supplier_keys':['one','two'], 'message_overrides':{}})
        self.store.plan_message_batch(batch_id, groups)
        first = self.store.claim_next_queue_item(batch_id)
        self.assertEqual(first['supplier_key'], 'one')
        # Simulate a process crash after the first item became in-flight.
        self.store.connection.close()
        resumed_store = Store(Path(self.temp.name) / 'test.db')
        bridge.side_effect = [
            {'ready': True},
            {'status': 'sent', 'message_id': 'second-only', 'ack': 1},
        ]
        resumed = FollowUpService(resumed_store)
        for _ in range(200):
            state = resumed.send_status(batch_id)
            if not state['active']:
                break
            import threading as _threading
            _threading.Event().wait(0.005)
        rows = resumed_store.queue_rows(batch_id)
        self.assertEqual(rows[0]['status'], 'uncertain')
        self.assertEqual(rows[1]['status'], 'sent')
        self.assertEqual(rows[1]['provider_message_id'], 'second-only')
        sends = [call for call in bridge.call_args_list if call.args and call.args[0] == '/send']
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0].args[1]['phone'], '+5585222222222')
        resumed_store.connection.close()
        # Prevent tearDown from closing the already-closed original connection twice.
        self.store = Store(Path(self.temp.name) / 'throwaway.db')

