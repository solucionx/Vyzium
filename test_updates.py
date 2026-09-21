import tempfile
import unittest
from pathlib import Path
from engine import Store, FollowUpService, ApiHandler

class UpdatePreparationTests(unittest.TestCase):
    def test_update_cannot_interrupt_send_and_blocks_new_sends(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'db.sqlite')
            service = FollowUpService(store)
            handler = object.__new__(ApiHandler)
            handler.path = '/prepare-update'
            handler.service = service
            handler._authorized = lambda: True
            handler._json = lambda code, body: (code, body)
            service.send_lock.acquire()
            self.assertEqual(handler.do_POST()[0], 409)
            service.send_lock.release()
            self.assertEqual(handler.do_POST()[0], 200)
            with self.assertRaises(ValueError):
                service.send(['supplier'])
            service.send_lock.release()
            store.connection.close()

    def test_preparation_requires_local_token(self):
        handler = object.__new__(ApiHandler)
        handler.path = '/prepare-update'
        handler._authorized = lambda: False
        handler._json = lambda code, body: (code, body)
        self.assertEqual(handler.do_POST()[0], 401)
