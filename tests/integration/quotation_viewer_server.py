"""Read-only viewer fixture: real evaluator, isolated data, disabled WhatsApp."""
import copy
import json
import sys
import tempfile
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
import compras_engine as engine
import test_compras_items as fixtures


def no_whatsapp(*args, **kwargs):
    raise RuntimeError('WhatsApp sends are disabled in viewer tests.')


engine.whatsapp_request = no_whatsapp
with tempfile.TemporaryDirectory() as directory:
    store = engine.Store(directory)
    data = fixtures.MapItemsTest.seed(store)
    data.update(name='Manut · 0210', urgent=True, due_date='2026-10-15')
    data['suppliers'][1]['name'] = 'Fornecedor B <img src=x onerror=alert(1)>'
    data['awards']['c1'] = {'supplier_id': 's2', 'reason': 'Prazo de entrega', 'note': 'Entrega imediata <especial>'}
    data['quotes']['m1']['s2'] = {'price': '19', 'negotiated': '', 'delivery': '7 dias'}
    data['awards'].pop('m1')
    data['choices'].pop('m1')
    data['quotes']['m2'] = {}
    data['awards'].pop('m2')
    data['choices'].pop('m2')
    data['items'][1]['note'] = 'Nota <b>sem HTML</b> & texto'
    store.put('items', data['items'][1]['id'], data['items'][1])
    store.put('maps', data['id'], data)
    archived = copy.deepcopy(data)
    archived.update(id='archived-viewer', name='Mapa concluído', archived=True)
    store.put('maps', archived['id'], archived)
    large = copy.deepcopy(data)
    large.update(id='large-viewer', name='Manutenção · 60 itens / 10 fornecedores', archived=False, awards={}, choices={}, items=[], quotes={})
    large['suppliers'] = [{'id': f's{n}', 'name': f'Fornecedor {n} · materiais e manutenção', 'phone': ''} for n in range(10)]
    for n in range(60):
        item = {**data['items'][0], 'id': f'large-{n}', 'description': f'Peça de manutenção {n}', 'company': 'MAGNA PRAIA' if n % 2 else 'CARMEL CUMBUCO'}
        large['items'].append(item)
        store.put('items', item['id'], item)
        large['quotes'][item['id']] = {f's{x}': {'price': str(10 + x), 'negotiated': '', 'delivery': '3 dias'} for x in range(10)}
    store.put('maps', large['id'], large)
    server = ThreadingHTTPServer(('127.0.0.1', 0), engine.Handler)
    server.store = store
    print(json.dumps({'port': server.server_port, 'map_id': data['id'], 'archived_id': archived['id'], 'large_id': large['id']}), flush=True)
    server.serve_forever()
