"""Two real loopback backends on temporary synthetic databases; no user data or messages."""
import json
import os
import sys
import tempfile
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
import compras_engine as compras
import engine
import test_compras_items as fixtures
from openpyxl import Workbook

def no_send(*args,**kwargs):
    raise RuntimeError('Real messages are disabled in integration tests.')
compras.whatsapp_request=no_send
engine.whatsapp_request=no_send
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory)
    store=compras.Store(str(root/'compras'));data=fixtures.MapItemsTest.seed(store)
    data['items'][0]['reference_image']={'mime':'image/jpeg','data':'/9j/2Q=='}
    store.put('maps',data['id'],data)
    extra={**data['items'][0],'id':'search-item','sci':'SCI-777','description':'Peça <especial> & teste','buyer':'Outro comprador'}
    extra.pop('reference_image',None);store.put('items',extra['id'],extra)
    store.put('settings','ui',{'id':'ui','filters':{'buyer':'Teste','search':'Cabo'}})
    for mid, name, delivery, reference_count, message_id in [
        ('partial-photo', 'Resultado parcial', {'text':'sent','images_total':2,'images_sent':1}, 2, 'synthetic-text-id'),
        ('legacy-photo', 'Resultado anterior', None, 1, 'synthetic-legacy-id'),
        ('unknown-text', 'Texto sem resultado', {'text':'uncertain','images_total':1,'images_sent':0}, 1, None),
    ]:
        store.put('messages', mid, {'id':mid,'map_id':data['id'],'kind':'quote','status':'uncertain',
            'supplier':{'name':name,'phone':'5500000000000'},'at':'2026-10-03T12:00:00',
            'message':'Mensagem sintética','fingerprint':mid,'error':'Erro simulado <teste>',
            'reference_count':reference_count,'message_id':message_id,'delivery':delivery})
    follow=engine.Store(root/'followup.db')
    book=Workbook();sheet=book.active
    sheet.append(['OC','EMPRESA','RAZAOSOCIALFORNECEDOR','DESCRICAOARTIGO','SCI','DATAPREVISTAENTREGAOC'])
    sheet.append(['123','Hotel Teste','Água & Luz','Lâmpada LED','900','2026-10-10'])
    book.save(root/'seed.xlsx');importer=engine.WorkbookImporter(follow);importer.import_file(str(root/'seed.xlsx'))
    supplier=follow.suppliers()[0]
    handler=type('TestFollowupHandler',(engine.ApiHandler,),{'store':follow,'importer':importer,'service':engine.FollowUpService(follow),'token':os.environ['FOLLOWUP_API_TOKEN']})
    a=ThreadingHTTPServer(('127.0.0.1',0),handler)
    b=ThreadingHTTPServer(('127.0.0.1',0),compras.Handler);b.store=store
    threading.Thread(target=a.serve_forever,daemon=True).start()
    print(json.dumps({'followup':a.server_port,'compras':b.server_port,'map_id':data['id'],'supplier_key':supplier['supplier_key']}),flush=True)
    b.serve_forever()
