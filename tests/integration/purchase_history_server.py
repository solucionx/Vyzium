"""Isolated real import/API fixture. All rows are synthetic; no supplier sends."""
import copy
import json
import sys
import tempfile
import os
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
import compras_engine as engine
import engine as followup
from test_followup_purchase_history import import_orders
import test_compras_items as maps
from test_purchase_history import HEADERS, book, row


def no_whatsapp(*args, **kwargs):
    raise RuntimeError('WhatsApp is disabled in purchase history tests.')


engine.whatsapp_request = no_whatsapp
followup.whatsapp_request = no_whatsapp
with tempfile.TemporaryDirectory() as directory:
    store = engine.Store(Path(directory) / 'compras')
    follow = followup.Store(Path(directory) / 'followup.db')
    data = maps.MapItemsTest.seed(store)
    large = [row(IDORDEMDECOMPRA=1000+n, IDSCI=5000+n,
                 CODIGOARTIGO=f'ART-{n//25:04d}', DESCRICAOARTIGO=f'Material de manutenção {n//25:04d}',
                 DATAOC='01/09/2026') for n in range(14000)]
    normal = [row(COMPRADOR='Levi'), row(COMPRADOR='Levi'), row(COMPRADOR='Levi', UNIDADEMEDIDARECEBIDA='CX'),\n              row(IDORDEMDECOMPRA=201, COMPRADOR='Ana', IDSCI=502, DATAOC='03/10/2026',
              VALORUNITARIOITEMOC='14,90', VALORTOTALITEMOC='149,00', DATAENTRADAMERCADORIA='04/10/2026',
              VALORUNITARIOITEMENTRADA=None, VALORTOTALITEMENTRADA='61,00', QUANTIDADERECEBIDA=4),
              row(IDORDEMDECOMPRA=202, COMPRADOR='Carlos', IDSCI=503, DATAOC='05/10/2026',
              EMPRESA='CARMEL CUMBUCO', FKEMPRESA=2, RAZAOSOCIALFORNECEDOR='Fornecedor B <img src=x onerror=alert(1)>',
              VALORUNITARIOITEMOC='15,00', VALORTOTALITEMOC='150,00', VALORUNITARIOITEMENTRADA=None,
              VALORTOTALITEMENTRADA=None, UNIDADEMEDIDARECEBIDA='CX'),
              row(IDORDEMDECOMPRA=203, IDSCI=504, DATAOC='06/10/2026', NMSTATUSITEMDAORDEMDECOMPRA=3),
              row(IDORDEMDECOMPRA=204, IDSCI=505, DATAOC='04/10/2026', UNIDADEMEDIDAOC='CX'),
              row(IDORDEMDECOMPRA=205, IDSCI=506, DATAOC=None, DATAENTRADAMERCADORIA='03/10/2026',
                  CODIGOARTIGO='SPECIAL', DESCRICAOARTIGO='Detergente <b>concentrado</b> & neutro', VALORUNITARIOITEMOC=0)]
    import_orders(follow, directory, [*large, *normal], 'BASE SCI OCs.xlsx')
    follow.save_settings({'buyer_filter': 'Comprador sem nenhum pedido'})
    # Different source and deliberately misleading legacy history in compras.
    with patch.object(engine, 'open_book', return_value=book([row(IDORDEMDECOMPRA=99999, VALORUNITARIOITEMOC=99999)])):
        store.import_file('BASE MAPAS.xlsx')
    store.put('settings', 'ui', {'id':'ui', 'filters': {'buyer':'Outro comprador', 'company':'Outro hotel', 'search':'Nada'}})
    # Keep eligible fixture items for existing map navigation/dirty protection.
    for item in data['items']:
        store.put('items', item['id'], item)
    server = ThreadingHTTPServer(('127.0.0.1', 0), engine.Handler)
    server.store = store
    handler = type('HistoryFollowupHandler', (followup.ApiHandler,), {
        'store': follow, 'service': followup.FollowUpService(follow),
        'importer': followup.WorkbookImporter(follow), 'token': os.environ['FOLLOWUP_API_TOKEN']})
    oc_server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=oc_server.serve_forever, daemon=True).start()
    print(json.dumps({'port': server.server_port, 'followup': oc_server.server_port, 'map_id': data['id']}), flush=True)
    server.serve_forever()
