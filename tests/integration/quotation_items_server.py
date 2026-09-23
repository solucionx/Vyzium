"""Temporary, synthetic database for the real renderer/IPC/HTTP integration test."""
import json
import sys
import tempfile
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
import compras_engine as engine
import test_compras_items as fixtures
import test_compras_add_items as additions


def no_whatsapp(*args, **kwargs):
    raise RuntimeError('Real WhatsApp sends are disabled in this test fixture.')


engine.whatsapp_request = no_whatsapp
with tempfile.TemporaryDirectory() as directory:
    store = engine.Store(directory)
    data = fixtures.MapItemsTest.seed(store)
    other, archived = additions.seed_available(store)
    store.put('items', 'a2', additions.available_item('a2', buyer='Outro comprador'))
    store.put('items', 'special', {**additions.available_item('special', buyer='Outro comprador'),
                                 'description': 'Peça <especial> & "teste"'})
    for n in range(55):
        iid = f'page-{n:02}'
        store.put('items', iid, additions.available_item(iid, company='MAGNA PRAIA'))
    server = ThreadingHTTPServer(('127.0.0.1', 0), engine.Handler)
    server.store = store
    print(json.dumps({'port': server.server_port, 'map_id': data['id'],
                      'other_id': other['id'], 'archived_id': archived['id']}), flush=True)
    server.serve_forever()
