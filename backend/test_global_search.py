import copy
import tempfile
import unittest
from pathlib import Path
import compras_engine
import engine
import test_compras_items as fixtures
from global_search import search_followup, search_compras, LIMIT_PER_KIND


class GlobalSearchTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.compras=compras_engine.Store(str(Path(self.tmp.name)/'compras'))
        self.map=fixtures.MapItemsTest.seed(self.compras)
        self.follow=engine.Store(Path(self.tmp.name)/'followup.db');self.addCleanup(self.follow.connection.close)
        with self.follow.lock:
            for key,supplier in [('one','Água & Luz'),('two','Outro fornecedor')]:
                self.follow.connection.execute('INSERT INTO orders(item_key,oc,supplier_key,supplier_name,company,sci,description,article_code,imported_at) VALUES (?,?,?,?,?,?,?,?,?)',
                    (key,'123',key,supplier,'Hotel Teste','SCI-900','Lâmpada LED','ART-77','2026-10-03'))
            self.follow.connection.commit()
        self.follow.save_supplier({'supplier_key':'one','display_name':'Água & Luz','phone':'5585999999999'})

    def test_search_accents_and_preserves_oc_supplier_identity(self):
        rows=search_followup(self.follow,'lampada')['results']
        self.assertEqual(len(rows),2)
        self.assertEqual({r['target']['supplier_key'] for r in rows},{'one','two'})
        self.assertEqual({r['target']['oc'] for r in rows},{'123'})
        self.assertEqual(len(search_followup(self.follow,'SCI-900')['results']),2)
        self.assertTrue(any(r['kind']=='supplier' for r in search_followup(self.follow,'agua')['results']))

    def test_literal_wildcards_are_not_sql_and_short_queries_are_empty(self):
        for q in ['','a',"' OR 1=1 --",'%_', '<script>']:
            self.assertEqual(search_followup(self.follow,q)['results'],[])
        with self.assertRaises(ValueError):search_followup(self.follow,'x'*101)

    def test_map_matches_supplier_sci_and_closed_history(self):
        data=self.compras.get_map(self.map['id'])
        for q in ['lampada','fornecedor a','SCI-INTERNA-c1']:
            result=search_compras(self.compras,q)
            self.assertTrue(any(r['kind']=='map' for r in result['results']))
        self.compras.complete_map(data['id'])
        rows=search_compras(self.compras,'Cotação por hotel')['results']
        self.assertIn('Concluído',rows[0]['subtitle'])

    def test_bounded_results_do_not_change_filters_or_map(self):
        self.compras.put('settings','ui',{'id':'ui','filters':{'buyer':'Outra pessoa'}})
        before=copy.deepcopy(self.compras.get_map(self.map['id']))
        for i in range(40):self.compras.put('items',f'extra{i}',{'id':f'extra{i}','description':'Lâmpada','sci':str(i)})
        result=search_compras(self.compras,'lampada')
        self.assertTrue(result['has_more'])
        self.assertEqual(len([r for r in result['results'] if r['kind']=='item']),LIMIT_PER_KIND)
        self.assertEqual(self.compras.get_map(self.map['id']),before)
        self.assertEqual(self.compras.settings()['filters'],{'buyer':'Outra pessoa'})


class MapPriorityAndCompletionTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=compras_engine.Store(self.tmp.name);self.map=fixtures.MapItemsTest.seed(self.store)

    def test_old_map_and_toggle_keep_quotes_and_deadline(self):
        data=copy.deepcopy(self.map);data.pop('urgent',None);self.store.put('maps',data['id'],data)
        self.assertFalse(self.store.map_summaries()[0]['urgent'])
        before=compras_engine.evaluate(data)
        for value in [True,False]:
            data['urgent']=value;data=self.store.save_map(data)['map']
            self.assertEqual(self.store.get_map(data['id'])['urgent'],value)
            self.assertEqual(compras_engine.evaluate(data),before)
            self.assertEqual(data['due_date'],self.map['due_date'])
        data['urgent']='false'
        with self.assertRaises(ValueError):self.store.save_map(data)
        self.assertFalse(self.store.get_map(data['id'])['urgent'])

    def test_urgent_active_first_completed_keep_their_order(self):
        data=copy.deepcopy(self.map);data['urgent']=True;data['created']='2020-01-01';self.store.put('maps',data['id'],data)
        normal=copy.deepcopy(data);normal.update(id='normal',urgent=False,created='2030-01-01',updated='2030-01-01');self.store.put('maps','normal',normal)
        self.assertEqual(self.store.map_summaries()[0]['id'],data['id'])
        self.store.complete_map(data['id']);self.assertFalse(self.store.map_summaries()[0]['archived'])
