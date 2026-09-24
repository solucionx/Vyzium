import tempfile
import unittest
from unittest.mock import patch
import compras_engine
import secure_sqlite


class RecoveryRegressions(unittest.TestCase):
    def test_purchase_send_lock_released_when_final_persistence_fails(self):
        for method, preview in [('send', 'preview'), ('send_negotiation', 'negotiation_preview')]:
            with self.subTest(method=method), tempfile.TemporaryDirectory() as directory:
                store = compras_engine.Store(directory)
                payload = {'supplier': {'phone': '5585999999999'}, 'fingerprint': 'fp',
                           'revision': 1, 'message': 'hello', 'targets': [], 'saving_target': '5'}
                writes = []
                original_put = store.put
                def fail_final(table, key, value):
                    writes.append(True)
                    if len(writes) == 2:
                        raise OSError('disk full')
                    return original_put(table, key, value)
                with patch.object(store, preview, return_value=payload), patch.object(store, 'put', side_effect=fail_final), patch.object(compras_engine, 'whatsapp_request', return_value={'status': 'sent'}):
                    with self.assertRaises(OSError):
                        getattr(store, method)({'map_id': 'm', 'supplier_id': 's', 'revision': 1, 'fingerprint': 'fp', 'message': 'hello'})
                self.assertFalse(store.send_lock.locked())
                # The pre-send record remains durable and blocks unsafe retries.
                self.assertEqual(store.all('messages')[0]['status'], 'sending')

    def test_rejected_sqlcipher_connection_is_closed(self):
        from unittest.mock import Mock
        connection = Mock()
        driver = Mock()
        driver.connect.return_value = connection
        with patch.object(secure_sqlite, 'cipher_sqlite', driver), patch.object(secure_sqlite, '_apply_key', side_effect=RuntimeError('wrong key')):
            with self.assertRaises(RuntimeError):
                secure_sqlite.connect('unused.db', key_hex='a'*64)
        connection.close.assert_called_once()
