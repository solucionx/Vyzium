"""Isolated HTTP engine with synthetic contacts. Real WhatsApp bridge is forbidden."""
import json
import os
import sys
import tempfile
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
import engine

def forbidden(*args, **kwargs):
    raise AssertionError('Real WhatsApp must never be called by broadcast QA')
engine.whatsapp_request = forbidden
with tempfile.TemporaryDirectory() as directory:
    store = engine.Store(Path(directory) / 'followup.db')
    for row in [
        {'supplier_key': 'a', 'display_name': 'Água A', 'contact_name': 'Ana', 'phone': '85999998888'},
        {'supplier_key': 'b', 'display_name': 'Fornecedor sem telefone'},
        {'supplier_key': 'c', 'display_name': '<img src=x onerror=alert(1)>', 'phone': '85977776666'},
    ]:
        store.save_supplier(row)
    store.save_settings({'simulation': True})
    handler = type('BroadcastQA', (engine.ApiHandler,), {
        'store': store, 'importer': engine.WorkbookImporter(store),
        'service': engine.FollowUpService(store), 'token': os.environ['FOLLOWUP_API_TOKEN']})
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    print(json.dumps({'port': server.server_port}), flush=True)
    server.serve_forever()
