import json
import unittest
from unittest.mock import patch
from map_purchase_reference import ReferenceIndex, parse_references
from test_purchase_history import snapshot, row
from test_followup_purchase_history import FollowupPurchaseHistoryTests


class MatchingTests(unittest.TestCase):
    def test_screenshot_missing_map_code_matches_coded_history(self):
        data = snapshot([row(CODIGOARTIGO='0910430', DESCRICAOARTIGO='GAS REFRIGERANTE EOS R 404A', UNIDADEMEDIDAOC='UND', IDORDEMDECOMPRA=100998, DATAOC='16/09/2026', VALORUNITARIOITEMOC='763,44')])
        result = ReferenceIndex(data).lookup({'description': 'gas refrigerante eos r 404a', 'unit': 'UND'})
        self.assertEqual(result['status'], 'found')
        self.assertEqual(result['item']['latest']['order_price'], '763.44')
        self.assertEqual(result['item']['latest']['oc'], '100998')

    def test_multiple_codes_with_same_description_are_ambiguous(self):
        index = ReferenceIndex(snapshot([row(), row(CODIGOARTIGO='0091', IDORDEMDECOMPRA=201)]))
        self.assertEqual(index.lookup({'description':'Lâmpada LED 9W','unit':'UN'})['status'], 'ambiguous')
        self.assertEqual(index.lookup({'article':'0090','unit':'UN'})['status'], 'found')

    def test_no_fuzzy_match_no_unit_conversion_no_wrong_code_fallback(self):
        index = ReferenceIndex(snapshot([row()]))
        for item in [{'description':'Lâmpada LED','unit':'UN'}, {'article':'0090','unit':'CX'}, {'article':'0091','description':'Lâmpada LED 9W','unit':'UN'}]:
            self.assertEqual(index.lookup(item)['status'],'missing')
        self.assertEqual(index.lookup({'article':'0090'})['status'],'incomplete')

    def test_old_description_resolves_latest_order_just_like_history(self):
        from purchase_history import search
        data = snapshot([row(),row(IDORDEMDECOMPRA=201, DATAOC='06/10/2026', DESCRICAOARTIGO='Luminária LED', NMSTATUSITEMDAORDEMDECOMPRA=3)])
        actual = ReferenceIndex(data).lookup({'description':'Lâmpada LED 9W','unit':'UN'})['item']['latest']
        self.assertEqual(actual,search(data,{'q':'Lâmpada LED 9W','status':'all'})['items'][0]['latest'])
        self.assertTrue(actual['cancelled'])

    def test_bounds_rejected_before_loading_database(self):
        for raw in ['[]','{}',json.dumps([{}]*51),json.dumps([{'article':7}]),json.dumps([{'description':'x'*501}])]:
            with self.assertRaises(ValueError):parse_references(raw)


class CacheTests(FollowupPurchaseHistoryTests):
    def test_batch_reuses_index_readonly_and_invalidates_after_import(self):
        self.seed()
        history=self.store.purchase_history
        query={'references':json.dumps([{'description':'Lâmpada LED 9W','unit':'UN'}]*50)}
        before=list(self.store.connection.iterdump())
        with patch('followup_purchase_history.ReferenceIndex',wraps=ReferenceIndex) as builds, patch.object(history,'load',wraps=history.load) as loads:
            first=history.query(query)
            for _ in range(4):self.assertEqual(history.query(query),first)
            self.assertEqual(builds.call_count,1);self.assertEqual(loads.call_count,1)
            first['references'][0]['item']['latest']['order_price']='WRONG'
            self.assertEqual(history.query(query)['references'][0]['item']['latest']['order_price'],'12.5')
            self.assertEqual(before,list(self.store.connection.iterdump()))
            self.seed([row(VALORUNITARIOITEMOC=22)])
            self.assertEqual(history.query(query)['references'][0]['item']['latest']['order_price'],'22')
            self.assertEqual(builds.call_count,2)
            history.expire(history.epoch)
            self.assertIsNone(history.reference_index)
