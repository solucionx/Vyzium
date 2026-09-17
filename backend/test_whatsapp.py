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
