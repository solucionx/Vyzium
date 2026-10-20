import copy
import tempfile
import unittest
from unittest.mock import patch
import compras_engine as engine
from test_compras_module import sample

class QuotationDeliveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = engine.Store(self.tmp.name)
        item = sample()
        self.store.put('items', item['id'], item)
        self.data = self.store.create_map({'name':'Status', 'ids':[item['id']]})
        self.data['suppliers'] = [{'id':'s1','name':'A','phone':'5585999999999'},
                                  {'id':'s2','name':'B','phone':'5585888888888'}]
        self.data = self.store.save_map(self.data)['map']

    def summary(self):
        return self.store.map_summaries()[0]['quotation_delivery']

    def record(self, sid, status='sent', kind='quote', ident=None):
        preview = self.store.preview(self.data['id'], sid)
        record = dict(preview, id=ident or sid, map_id=self.data['id'], kind=kind, status=status)
        self.store.put('messages', record['id'], record)
        return record

    def test_pending_partial_and_complete_without_mutations(self):
        before = copy.deepcopy(self.store.get_map(self.data['id']))
        self.assertEqual(self.summary()['state'], 'pending')
        self.record('s1')
        self.assertEqual(self.summary()['state'], 'partial')
        self.assertEqual(self.summary()['sent'], 1)
        self.record('s2')
        self.assertEqual(self.summary()['state'], 'sent')
        self.assertEqual(self.summary()['sent'], 2)
        self.assertEqual(self.store.get_map(self.data['id']), before)

    def test_real_send_result_is_used(self):
        preview = self.store.preview(self.data['id'],'s1')
        with patch.object(engine,'whatsapp_request',return_value={'status':'sent','message_id':'test'}):
            self.store.send(dict(map_id=self.data['id'],supplier_id='s1',fingerprint=preview['fingerprint'],revision=preview['revision']))
        self.assertEqual(self.summary()['sent'],1)

    def test_uncertain_failure_and_in_progress_never_count_as_sent(self):
        for status in ['uncertain','failed','sending']:
            with self.subTest(status=status):
                self.record('s1',status)
                self.assertEqual(self.summary()['state'],status)
                self.assertEqual(self.summary()['sent'],0)

    def test_negotiation_and_other_maps_do_not_count(self):
        self.record('s1',kind='negotiation')
        record=self.record('s2');record['map_id']='another-map';self.store.put('messages','s2',record)
        self.assertEqual(self.summary()['state'],'pending')

    def test_quote_prices_do_not_invalidate_sends_but_item_changes_do(self):
        self.record('s1');self.record('s2')
        data=self.store.get_map(self.data['id'])
        data['quotes'][data['items'][0]['id']]['s1']['price']='10'
        data=self.store.save_map(data)['map']
        self.assertEqual(self.summary()['state'],'sent')
        data['items'][0]['note']='Nova especificação'
        self.store.put('maps',data['id'],data)
        self.assertEqual(self.summary()['state'],'pending')

    def test_legacy_records_and_reviewed_uncertain_result(self):
        record=self.record('s1');record.pop('kind');self.store.put('messages','s1',record)
        self.assertEqual(self.summary()['sent'],1)
        record.update(status='reviewed_not_received');self.store.put('messages','s1',record)
        self.assertEqual(self.summary()['state'],'pending')

    def test_no_suppliers_and_new_supplier(self):
        self.record('s1');self.record('s2')
        data=self.store.get_map(self.data['id'])
        data['suppliers'].append({'id':'s3','name':'C','phone':'5585777777777'})
        self.store.put('maps',data['id'],data)
        self.assertEqual(self.summary()['state'],'partial')
        self.assertEqual(self.summary()['total'],3)
        data['suppliers']=[];self.store.put('maps',data['id'],data)
        self.assertEqual(self.summary()['state'],'pending')
