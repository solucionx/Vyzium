import base64
import copy
from unittest.mock import patch
from test_compras_module import PurchasesTest, sample
import compras_engine as engine

IMAGE = {'mime': 'image/jpeg', 'data': base64.b64encode(b'\xff\xd8\xfftest\xff\xd9').decode()}

class ReferenceImagesTest(PurchasesTest):
    def attach(self):
        self.m['items'][0]['reference_image'] = copy.deepcopy(IMAGE)
        self.m = self.s.save_map(self.m)['map']

    def test_reference_persists_and_removes(self):
        self.attach()
        self.assertEqual(self.s.detail(self.m['id'])['map']['items'][0]['reference_image'], IMAGE)
        self.m['items'][0]['reference_image'] = None
        self.s.save_map(self.m)
        self.assertIsNone(self.s.detail(self.m['id'])['map']['items'][0]['reference_image'])

    def test_invalid_reference_rejected_without_changing_saved_map(self):
        self.attach()
        self.m['items'][0]['reference_image'] = {'mime': 'image/jpeg', 'data': 'bad'}
        with self.assertRaises(ValueError): self.s.save_map(self.m)
        self.assertEqual(self.s.detail(self.m['id'])['map']['items'][0]['reference_image'], IMAGE)

    def test_image_changes_fingerprint(self):
        before = self.s.preview(self.m['id'], 's1')
        self.attach()
        after = self.s.preview(self.m['id'], 's1')
        self.assertNotEqual(before['fingerprint'], after['fingerprint'])
        self.assertEqual(after['reference_count'], 1)

    def test_image_sent_automatically_and_duplicate_blocked(self):
        self.attach()
        p = self.s.preview(self.m['id'], 's1')
        with patch.object(engine, 'whatsapp_request', return_value={'status': 'sent'}) as send:
            self.s.send({'map_id':self.m['id'], 'supplier_id':'s1', **p})
            self.assertEqual(send.call_args.args[1]['images'][0]['data'], IMAGE['data'])
            with self.assertRaises(ValueError): self.s.send({'map_id':self.m['id'], 'supplier_id':'s1', **p})

    def test_removed_item_line_does_not_send_photo(self):
        self.attach()
        p = self.s.preview(self.m['id'], 's1')
        p['message'] = p['message'].replace('1. Lâmpada', '')
        with patch.object(engine, 'whatsapp_request', return_value={'status': 'sent'}) as send:
            self.s.send({'map_id':self.m['id'], 'supplier_id':'s1', **p})
            self.assertNotIn('images', send.call_args.args[1])

    def test_text_only_payload_unchanged(self):
        p = self.s.preview(self.m['id'], 's1')
        with patch.object(engine, 'whatsapp_request', return_value={'status':'sent'}) as send:
            self.s.send({'map_id':self.m['id'], 'supplier_id':'s1', **p})
            self.assertEqual(set(send.call_args.args[1]), {'phone','message'})


    def test_whatsapp_timeout_scales_for_ten_and_twenty_reference_photos(self):
        self.assertEqual(engine.whatsapp_timeout('/wait'), 135)
        self.assertEqual(engine.whatsapp_timeout('/send', {'phone':'1','message':'x'}), 90)
        self.assertEqual(engine.whatsapp_timeout('/send', {'images':[{}] * 10}), 590)
        self.assertEqual(engine.whatsapp_timeout('/send', {'images':[{}] * 20}), 1090)
        self.assertEqual(engine.whatsapp_timeout('/other'), 85)

    def test_partial_delivery_persists_and_remains_blocked_after_reopen(self):
        self.attach()
        p = self.s.preview(self.m['id'], 's1')
        delivery = {'text': 'sent', 'images_total': 1, 'images_sent': 0}
        response = {'status': 'uncertain', 'message_id': 'text-id', 'delivery': delivery,
                    'error': 'Texto enviado. Envio das imagens concluído: 0 de 1.'}
        with patch.object(engine, 'whatsapp_request', return_value=response):
            record = self.s.send({'map_id': self.m['id'], 'supplier_id': 's1', **p})
        self.assertEqual(record['delivery'], delivery)
        reopened = engine.Store(self.tmp.name)
        stored = next(r for r in reopened.all('messages') if r['id'] == record['id'])
        self.assertEqual(stored['delivery'], delivery)
        with patch.object(engine, 'whatsapp_request') as send:
            with self.assertRaises(ValueError):
                reopened.send({'map_id': self.m['id'], 'supplier_id': 's1', **p})
            send.assert_not_called()

    def test_successful_photo_delivery_keeps_history_progress(self):
        self.attach()
        p = self.s.preview(self.m['id'], 's1')
        delivery = {'text': 'sent', 'images_total': 1, 'images_sent': 1}
        with patch.object(engine, 'whatsapp_request', return_value={'status': 'sent', 'delivery': delivery}):
            record = self.s.send({'map_id': self.m['id'], 'supplier_id': 's1', **p})
        self.assertEqual(record['status'], 'sent')
        self.assertEqual(self.s.all('messages')[0]['delivery'], delivery)
