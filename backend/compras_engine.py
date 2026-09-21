from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import hmac
import io
import json
import os
import re
import sqlite3
import sys
import threading
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from openpyxl import load_workbook
from workbook_formats import open_book, REPORT_REQUIRED, adapt_report, approval_deadline, normalize_header
from data_safety import DataIntegrityError, DataSafetyManager
from secure_sqlite import connect as secure_connect, key_from_env


APP_VERSION = os.environ.get('VYZIUM_APP_VERSION', '3.1.25')
DB_SCHEMA_VERSION = 1

def norm(value):
    return normalize_header(value)


def text(value):
    if value is None:
        return ''
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value).strip()


def number(value):
    if isinstance(value, bool):
        raise ValueError('Valor numérico inválido.')
    raw = str(value).strip().replace('R$', '').replace(' ', '')
    if ',' in raw:
        raw = raw.replace('.', '').replace(',', '.')
    try:
        result = Decimal(raw)
    except InvalidOperation:
        raise ValueError('Informe um número válido.')
    if not result.is_finite() or result < 0 or result > Decimal('1000000000000'):
        raise ValueError('Valor fora do intervalo permitido.')
    return result


def money(value):
    return value.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)


def iso(value):
    if isinstance(value, (date, datetime)):
        return value.strftime('%Y-%m-%d')
    for fmt in ('%d/%m/%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(str(value)[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return ''


def now():
    return datetime.now().isoformat(timespec='seconds')


def load_items(path):
    """Read the raw SCI export, never treating receipt rows as new demand."""
    book = open_book(path, load_workbook)
    groups = {}
    rows_seen = 0
    try:
        source = None
        headers = []
        report_format = False
        required = {'FKEMPRESA', 'EMPRESA', 'IDSCI', 'IDITEMDASCI', 'DESCRICAOARTIGO',
                    'QUANTIDADESCI', 'UNIDADEDEMEDIDASCI', 'IDORDEMDECOMPRA',
                    'NMSTATUSDOITEMDASCI', 'NMSTATUSBPMSCI', 'COMPRADOR'}
        recognized = required | REPORT_REQUIRED
        for sheet in book:
            sheet.reset_dimensions()  # SCI export declares A1:A1 despite containing all rows.
            best = None
            for row_index, values in enumerate(sheet.iter_rows(min_row=1, max_row=30, values_only=True), 1):
                candidate = [norm(v) for v in values]
                candidate_set = {h for h in candidate if h}
                candidate_report = REPORT_REQUIRED.issubset(candidate_set)
                candidate_raw = required.issubset(candidate_set)
                score = len(candidate_set & recognized) + (100 if candidate_report or candidate_raw else 0)
                if best is None or score > best[0]:
                    best = (score, row_index, candidate, candidate_report, candidate_raw)
            if not best or not (best[3] or best[4]):
                continue
            _, header_row, headers, report_format, _ = best
            duplicates = sorted({h for h in headers if h and headers.count(h) > 1 and h in recognized})
            if duplicates:
                raise ValueError('Cabeçalhos duplicados/ambíguos: ' + ', '.join(duplicates) + '. A base anterior foi preservada.')
            source = sheet.iter_rows(min_row=header_row + 1, values_only=True)
            break
        if source is None:
            raise ValueError('Cabeçalhos não reconhecidos nas primeiras 30 linhas. Use o relatório com Número da SCI, Comprador SCI, Status da SCI e Status BPM SCI, ou a BASE SCI original.')
        for row in source:
            if not any(v is not None for v in row):
                continue
            # Some exports repeat the header inside the data region (and custom
            # spreadsheet adapters may ignore min_row). Never count a header as
            # a purchase item.
            if [norm(v) for v in row] == headers:
                continue
            r = dict(zip(headers, row))
            if report_format:
                r = adapt_report(r, norm, text)
                if r is None:
                    continue
            rows_seen += 1
            key = '|'.join(text(r.get(k)) for k in ('FKEMPRESA', 'IDSCI', 'IDITEMDASCI'))
            if not text(r.get('IDITEMDASCI')) or not text(r.get('IDSCI')):
                raise ValueError(f'Linha {rows_seen + 1}: SCI ou identificação do item ausente.')
            groups.setdefault(key, []).append(r)
    finally:
        book.close()
    result = []
    deadline_conflicts = 0
    excluded = {'with_order': 0, 'closed_or_rejected': 0, 'other_status': 0, 'invalid_quantity': 0, 'conflict': 0}
    for key, rows in groups.items():
        if len(rows) > 1 and rows[0].get('REPORT_IDENTITY'):
            excluded['conflict'] += 1
            continue
        if any(text(r.get('IDORDEMDECOMPRA')) not in ('', '0', '0.0') for r in rows):
            excluded['with_order'] += 1
            continue
        if any(text(r.get('NMSTATUSDOITEMDASCI')) in ('4', '6') or text(r.get('NMSTATUSBPMSCI')) in ('2', '4') for r in rows):
            excluded['closed_or_rejected'] += 1
            continue
        r = rows[0]
        if any(text(x.get('NMSTATUSDOITEMDASCI')) not in ('0', '2') for x in rows):
            excluded['other_status'] += 1
            continue
        comparable = ('QUANTIDADESCI', 'UNIDADEDEMEDIDASCI', 'DESCRICAOARTIGO', 'COMPRADOR', 'NMSTATUSDOITEMDASCI', 'NMSTATUSBPMSCI')
        if any(any(text(x.get(f)) != text(r.get(f)) for f in comparable) for x in rows[1:]):
            excluded['conflict'] += 1
            continue
        try:
            qty = number(r.get('QUANTIDADESCI'))
            if qty <= 0:
                raise ValueError()
        except ValueError:
            excluded['invalid_quantity'] += 1
            continue
        approved_at, due, mismatch = approval_deadline(r, iso)
        deadline_conflicts += int(mismatch)
        result.append({'id': key, 'company': text(r.get('EMPRESA')), 'sci': text(r.get('IDSCI')),
                       'article': text(r.get('CODIGOARTIGO')), 'description': text(r.get('DESCRICAOARTIGO')),
                       'quantity': str(qty), 'unit': text(r.get('UNIDADEDEMEDIDASCI')),
                       'buyer': text(r.get('COMPRADOR')), 'group': text(r.get('DESCRICAOGRUPO')),
                       'needed': due, 'approved_at': approved_at, 'deadline_rule': 'approval_12_days',
                       'note': text(r.get('NOTE')), 'purchase_type': text(r.get('PURCHASE_TYPE')),
                       'issued': iso(r.get('DATAEMISSAOSCI')),
                       'urgent': norm(r.get('URGENTE')) in ('TRUE', '1', 'SIM', 'URGENTE'),
                       'status': 'pending' if text(r.get('NMSTATUSDOITEMDASCI')) == '0' else 'quoting',
                       'approval': 'approved' if text(r.get('NMSTATUSBPMSCI')) == '3' else 'waiting'})
    return result, {'rows': rows_seen, 'unique_items': len(groups), 'eligible': len(result), 'excluded': excluded,
                    'format': 'approval_report' if report_format else 'raw_sci', 'deadline_conflicts': deadline_conflicts,
                    'missing_deadline': sum(not i['needed'] for i in result)}


def evaluate(data):
    """Per-line discounts apply to that line total, never to the supplier basket."""
    lines = []
    totals = {s['id']: {'name': s['name'], 'won': 0, 'net': Decimal(0), 'saving': Decimal(0)} for s in data['suppliers']}
    for item in data['items']:
        quotes = []
        for supplier in data['suppliers']:
            q = data['quotes'].get(item['id'], {}).get(supplier['id'], {})
            if q.get('price') in (None, ''):
                continue
            price = number(q['price'])
            if price <= 0:
                raise ValueError('Preço precisa ser maior que zero; deixe vazio quando não houver cotação.')
            gross = money(price * number(item['quantity']))
            if 'negotiated' in q:
                final_price = price if q['negotiated'] in ('', None) else number(q['negotiated'])
                if final_price <= 0 or final_price > price:
                    raise ValueError('O preço negociado deve ser maior que zero e não pode superar o preço inicial.')
                net = money(final_price * number(item['quantity']))
                saving = gross - net
                percent = money((price - final_price) / price * 100)
            else:
                # Preserve old maps: their discount fields still mean percent or a line amount.
                discount = number(q.get('discount') or '0')
                kind = q.get('kind', 'percent')
                if kind not in ('percent', 'amount'):
                    raise ValueError('Tipo de desconto inválido.')
                if (kind == 'percent' and discount > 100) or (kind == 'amount' and discount > gross):
                    raise ValueError('Desconto não pode ultrapassar o valor do item.')
                saving = money(gross * discount / 100) if kind == 'percent' else money(discount)
                net = gross - saving
                final_price = net / number(item['quantity'])
                percent = money(saving / gross * 100) if gross else Decimal(0)
            quotes.append({'supplier_id': supplier['id'], 'supplier': supplier['name'], 'gross': str(gross),
                           'saving': str(saving), 'net': str(net), 'initial_price': str(price),
                           'final_price': str(final_price), 'discount_percent': str(percent)})
        best = min((Decimal(q['net']) for q in quotes), default=None)
        winners = [q for q in quotes if Decimal(q['net']) == best]
        selected = data.get('choices', {}).get(item['id'])
        chosen = next((q for q in winners if q['supplier_id'] == selected), None)
        if len(winners) == 1:
            chosen = winners[0]
        if chosen:
            total = totals[chosen['supplier_id']]
            total['won'] += 1
            total['net'] += Decimal(chosen['net'])
            total['saving'] += Decimal(chosen['saving'])
        lines.append({'id': item['id'], 'quotes': quotes, 'winners': winners, 'chosen': chosen,
                      'state': 'unquoted' if not winners else ('tie' if not chosen else 'winner')})
    return {'lines': lines, 'suppliers': [{**t, 'id': sid, 'net': str(t['net']), 'saving': str(t['saving'])} for sid, t in totals.items()],
            'net': str(sum((t['net'] for t in totals.values()), Decimal(0))),
            'saving': str(sum((t['saving'] for t in totals.values()), Decimal(0))),
            'unquoted': sum(x['state'] == 'unquoted' for x in lines), 'ties': sum(x['state'] == 'tie' for x in lines)}


def whatsapp_request(route, body=None):
    base = os.environ.get('FOLLOWUP_WHATSAPP_URL', '')
    if not re.fullmatch(r'http://127\.0\.0\.1:\d+', base):
        raise ValueError('Abra o aplicativo para conectar o WhatsApp.')
    req = Request(base + route, data=json.dumps(body or {}).encode(),
                  headers={'Content-Type': 'application/json', 'X-FollowUp-Token': os.environ.get('FOLLOWUP_API_TOKEN', '')})
    try:
        with urlopen(req, timeout=135 if route == '/wait' else 85) as response:
            return json.load(response)
    except HTTPError as exc:
        try:
            message = json.load(exc).get('error', 'Erro na conexão do WhatsApp.')
        except Exception:
            message = 'Erro na conexão do WhatsApp.'
        raise RuntimeError(message) from exc
    except (URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as exc:
        raise RuntimeError('Não foi possível falar com a ponte do WhatsApp. Verifique a conexão e tente novamente.') from exc


class Store:
    def __init__(self, directory):
        directory = Path(directory).expanduser().resolve()
        directory.mkdir(parents=True, exist_ok=True)
        self.path = str(directory / 'compras.sqlite3')
        self.db_key_hex = key_from_env()
        self.safety = DataSafetyManager(self.path, 'compras', APP_VERSION, auto_retention=10, key_hex=self.db_key_hex)
        had_existing_database = self.safety.has_existing_database
        self.safety.assert_existing_integrity()
        self.lock = threading.RLock()
        self.send_lock = threading.Lock()
        if had_existing_database:
            # Snapshot through a read-only source before journal/schema maintenance.
            self.safety.ensure_version_backup()
            existing_schema = self.safety.existing_schema_version()
            if existing_schema > DB_SCHEMA_VERSION:
                raise DataIntegrityError(
                    f"Este banco usa o schema {existing_schema}, mais novo que o suportado por esta versão ({DB_SCHEMA_VERSION}). "
                    "O Vyzium bloqueou a abertura para evitar que uma versão antiga altere dados mais novos."
                )
        with self.db() as con:
            con.executescript('''CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS maps(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS schema_migrations(
                version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
            );''')
            con.execute('INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)',
                        (DB_SCHEMA_VERSION, 'data_safety_v1', now()))
            for mid, raw in con.execute('SELECT id,data FROM messages').fetchall():
                msg = json.loads(raw)
                if msg['status'] == 'sending':
                    msg.update(status='uncertain', error='Aplicativo encerrado durante envio. Confira a conversa.')
                    con.execute('UPDATE messages SET data=? WHERE id=?', (json.dumps(msg), mid))

    @contextmanager
    def db(self):
        con = secure_connect(self.path, key_hex=self.db_key_hex, timeout=30)
        try:
            con.execute('PRAGMA busy_timeout=10000')
            con.execute('PRAGMA foreign_keys=ON')
            con.execute('PRAGMA journal_mode=WAL')
            con.execute('PRAGMA synchronous=FULL')
            with con:
                yield con
        finally:
            con.close()

    def data_safety_status(self):
        with self.lock, self.db() as con:
            result = self.safety.status()
            row = con.execute('SELECT MAX(version) FROM schema_migrations').fetchone()
            result['schema_version'] = int((row or [0])[0] or 0)
            result['app_version'] = APP_VERSION
            return result

    def create_backup(self, reason='manual', automatic=False):
        with self.lock, self.db() as con:
            return self.safety.backup(reason=reason, source_connection=con, automatic=automatic)

    JSON_TABLES = frozenset({'items', 'maps', 'settings', 'messages'})

    @classmethod
    def _safe_table(cls, table):
        name = str(table or '')
        if name not in cls.JSON_TABLES:
            raise ValueError('Tabela interna inválida.')
        return name

    def all(self, table):
        table = self._safe_table(table)
        with self.db() as con:
            return [json.loads(r[0]) for r in con.execute(f'SELECT data FROM {table}')]

    def put(self, table, key, data):
        table = self._safe_table(table)
        with self.db() as con:
            con.execute(f'INSERT OR REPLACE INTO {table}(id,data) VALUES (?,?)', (key, json.dumps(data, ensure_ascii=False)))

    def get_map(self, mid):
        with self.db() as con:
            row = con.execute('SELECT data FROM maps WHERE id=?', (mid,)).fetchone()
        if not row:
            raise ValueError('Mapa não encontrado.')
        return json.loads(row[0])

    def settings(self):
        values = self.all('settings')
        return next((v for v in values if v.get('id') == 'ui'), {'id': 'ui', 'filters': {}})

    def import_file(self, path):
        if Path(path).suffix.lower() not in ('.xls', '.xlsx', '.xlsm'):
            raise ValueError('Escolha um arquivo XLS, XLSX ou XLSM.')
        items, report = load_items(path)
        with self.lock, self.db() as con:
            self.safety.backup(reason='pre-import', source_connection=con, automatic=True)
            con.execute('DELETE FROM items')
            con.executemany('INSERT INTO items VALUES (?,?)', [(i['id'], json.dumps(i, ensure_ascii=False)) for i in items])
            report.update(id='import', at=now(), filename=Path(path).name)
            con.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('import', json.dumps(report)))
            check = [str(row[0]) for row in con.execute('PRAGMA quick_check').fetchall()]
            if check != ['ok']:
                raise DataIntegrityError('A nova importação não passou na verificação interna; alterações revertidas.')
        return report

    def catalog(self):
        items = self.all('items')
        assigned = {}
        for m in self.all('maps'):
            if m.get('archived'):
                continue
            for i in m['items']:
                assigned.setdefault(i['id'], []).append(m['name'])
        for i in items:
            i['maps'] = assigned.get(i['id'], [])
            if i.get('deadline_rule') != 'approval_12_days':
                i['needed'] = ''  # Old stored necessity dates must never masquerade as approval deadlines.
        return {'items': items, 'import': next((v for v in self.all('settings') if v.get('id') == 'import'), None)}

    def overview(self):
        catalog = self.catalog()
        items = catalog['items']
        today_value = date.today().isoformat()
        active_maps = [m for m in self.all('maps') if not m.get('archived')]
        scis = {(text(i.get('company')), text(i.get('sci'))) for i in items if text(i.get('sci'))}
        overdue = 0
        for item in items:
            needed = text(item.get('needed'))
            if needed and needed < today_value:
                overdue += 1
        return {
            'total_items': len(items),
            'total_scis': len(scis),
            'overdue_items': overdue,
            'mapped_items': sum(1 for i in items if i.get('maps')),
            'active_maps': len(active_maps),
            'last_import': catalog.get('import'),
        }

    def create_map(self, body):
        name = text(body.get('name'))[:160]
        ids = list(dict.fromkeys(body.get('ids', [])))
        if not name or not ids:
            raise ValueError('Informe um nome e selecione ao menos um item.')
        with self.lock:
            catalog = {i['id']: i for i in self.catalog()['items']}
            if any(i not in catalog for i in ids):
                raise ValueError('Um item deixou de estar disponível. Atualize a lista.')
            if any(catalog[i]['maps'] for i in ids):
                raise ValueError('Há item em outro mapa ativo. Arquive o mapa anterior antes de reutilizá-lo.')
            data = {'id': uuid.uuid4().hex, 'name': name, 'created': now(), 'revision': 1,
                    'items': [{**catalog[i], 'note': catalog[i].get('note', ''), 'purchase_type': catalog[i].get('purchase_type', '')} for i in ids],
                    'suppliers': [], 'quotes': {}, 'choices': {}, 'archived': False}
            self.put('maps', data['id'], data)
        return data

    def save_map(self, body):
        with self.lock:
            data = self.get_map(body.get('id'))
            if data['archived']:
                raise ValueError('Mapa arquivado: somente consulta e exportação estão disponíveis.')
            if body.get('revision') != data['revision']:
                raise ValueError('O mapa foi alterado em outra tela. Abra novamente antes de salvar.')
            # Only user-owned fields are editable; imported identity and quantities remain authoritative.
            data['name'] = text(body.get('name', data['name']))[:160]
            if not data['name']:
                raise ValueError('Nome do mapa obrigatório.')
            suppliers = []
            seen = set()
            names = set()
            for s in body.get('suppliers', []):
                sid, name = text(s.get('id')), text(s.get('name'))[:160]
                if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', sid) or not name or sid in seen or norm(name) in names:
                    raise ValueError('Fornecedores devem ter nomes e identificações únicos.')
                phone = re.sub(r'[^\d+]', '', text(s.get('phone')))
                if phone and not re.fullmatch(r'\+?[1-9]\d{7,14}', phone):
                    raise ValueError('Informe WhatsApp com país e DDD, por exemplo 5585999999999.')
                suppliers.append({'id': sid, 'name': name, 'phone': phone})
                seen.add(sid)
                names.add(norm(name))
            data['suppliers'] = suppliers
            notes = {i['id']: i for i in body.get('items', [])}
            for i in data['items']:
                if i['id'] in notes:
                    i['note'] = text(notes[i['id']].get('note'))[:2000]
                    i['purchase_type'] = text(notes[i['id']].get('purchase_type'))[:100]
            raw_quotes = body.get('quotes', {})
            data['quotes'] = {i['id']: {s['id']: raw_quotes.get(i['id'], {}).get(s['id'], {}) for s in suppliers} for i in data['items']}
            for quotes in data['quotes'].values():
                for sid, q in quotes.items():
                    normalized = {'price': '' if q.get('price') in ('', None) else str(number(q['price']))}
                    if 'negotiated' in q:
                        # Preço inicial vazio significa que este fornecedor não cotou este item.
                        # Qualquer valor negociado residual é descartado para não participar da comparação.
                        normalized['negotiated'] = '' if not normalized['price'] or q['negotiated'] in ('', None) else str(number(q['negotiated']))
                    else:
                        normalized.update(discount=str(number(q.get('discount') or 0)), kind=q.get('kind', 'percent'))
                    quotes[sid] = normalized
            data['choices'] = body.get('choices', {})
            evaluate(data)
            data['revision'] += 1
            data['updated'] = now()
            self.put('maps', data['id'], data)
        return self.detail(data['id'])

    def detail(self, mid):
        data = self.get_map(mid)
        current = {i['id']: i for i in self.all('items')}
        changes = []
        for item in data['items']:
            fresh = current.get(item['id'])
            if not fresh:
                changes.append(f"SCI {item['sci']} • {item['description']}: não consta mais na lista de itens elegíveis.")
            elif any(item[k] != fresh[k] for k in ('quantity', 'unit', 'description', 'company', 'buyer', 'approval')):
                changes.append(f"SCI {item['sci']} • {item['description']}: dados alterados na última importação.")
        return {'map': data, 'result': evaluate(data), 'changes': changes}

    def preview(self, mid, sid):
        detail = self.detail(mid)
        data = detail['map']
        if data['archived']:
            raise ValueError('Mapa arquivado. Crie um novo mapa para solicitar cotações.')
        if detail['changes']:
            raise ValueError('A base mudou para itens deste mapa. Arquive este mapa e crie outro com os dados atuais antes de enviar.')
        supplier = next((s for s in data['suppliers'] if s['id'] == sid), None)
        if not supplier:
            raise ValueError('Fornecedor não encontrado.')
        lines = [f"Olá, {supplier['name']}! Poderia cotar os itens abaixo?", f"Mapa: {data['name']}", '']
        for n, item in enumerate(data['items'], 1):
            lines += [f"{n}. {item['description']}", f"Hotel: {item['company']} | SCI: {item['sci']}",
                      f"Quantidade: {item['quantity']} {item['unit']}"]
            if item['note']:
                lines.append('Observação: ' + item['note'])
            lines.append('')
        lines.append('Por favor, informe preço unitário, disponibilidade, prazo de entrega, frete, condições de pagamento e eventual desconto. Obrigado!')
        message = '\n'.join(lines)
        if len(message) > 60000:
            raise ValueError('Mapa muito grande para uma mensagem. Divida os itens em mapas menores.')
        digest = hashlib.sha256((mid + '|' + supplier['phone'] + '|' + message).encode()).hexdigest()
        return {'supplier': supplier, 'message': message, 'fingerprint': digest, 'revision': data['revision']}

    def send(self, body):
        if not self.send_lock.acquire(blocking=False):
            raise ValueError('Já existe um envio em andamento.')
        record = None
        submitted = False
        try:
            with self.lock:
                p = self.preview(body['map_id'], body['supplier_id'])
                if p['fingerprint'] != body.get('fingerprint') or p['revision'] != body.get('revision'):
                    raise ValueError('Mensagem alterada. Atualize a prévia antes de enviar.')
                if not p['supplier']['phone']:
                    raise ValueError('Cadastre o WhatsApp deste fornecedor.')
                if any(m['fingerprint'] == p['fingerprint'] and m['status'] in ('sent', 'sending', 'uncertain') for m in self.all('messages')):
                    raise ValueError('Esta solicitação já foi enviada ou está incerta. Consulte o Histórico.')
                record = {'id': uuid.uuid4().hex, 'at': now(), 'map_id': body['map_id'], **p, 'status': 'sending'}
                self.put('messages', record['id'], record)
            whatsapp_request('/wait')
            submitted = True
            response = whatsapp_request('/send', {'phone': p['supplier']['phone'], 'message': p['message']})
            record.update(status=response.get('status', 'uncertain'), error=response.get('error', ''), message_id=response.get('message_id'))
            if record['status'] not in ('sent', 'failed', 'uncertain'):
                record['status'] = 'uncertain'
        except Exception as exc:
            if record is None:
                raise
            record.update(status='uncertain' if submitted else 'failed', error=str(exc))
        finally:
            if record:
                self.put('messages', record['id'], record)
            self.send_lock.release()
        return record

    def review(self, body):
        with self.lock:
            msg = next((m for m in self.all('messages') if m['id'] == body['id']), None)
            if not msg or msg['status'] != 'uncertain' or body.get('outcome') not in ('received', 'not_received'):
                raise ValueError('Revisão inválida.')
            msg.update(status='sent' if body['outcome'] == 'received' else 'reviewed_not_received', reviewed_at=now())
            self.put('messages', msg['id'], msg)
        return msg

    def export_csv(self, mid):
        data = self.detail(mid)
        m = data['map']
        rows = [['HOTEL', 'SCI', 'TIPO DE COMPRA', 'DESCRIÇÃO', 'QTD', 'UNIDADE', 'OBSERVAÇÃO'] +
                [f"{s['name']} — {label}" for s in m['suppliers'] for label in ('Preço unitário', 'Total bruto', 'Desconto R$', 'Total líquido')] +
                ['VENCEDOR', 'VALOR FINAL', 'ECONOMIA R$']]
        for i, result in zip(m['items'], data['result']['lines']):
            row = [i['company'], i['sci'], i['purchase_type'], i['description'], i['quantity'], i['unit'], i['note']]
            for s in m['suppliers']:
                q = next((q for q in result['quotes'] if q['supplier_id'] == s['id']), None)
                row += [str(m['quotes'][i['id']][s['id']]['price']).replace('.', ','), q['gross'].replace('.', ','), q['saving'].replace('.', ','), q['net'].replace('.', ',')] if q else ['', '', '', '']
            chosen = result['chosen']
            row += [chosen['supplier'], chosen['net'].replace('.', ','), chosen['saving'].replace('.', ',')] if chosen else [('EMPATE' if result['state'] == 'tie' else 'SEM COTAÇÃO'), '', '']
            rows.append(row)
        out = io.StringIO()
        writer = csv.writer(out, delimiter=';')
        for row in rows:
            writer.writerow(["'" + str(v) if str(v).lstrip().startswith(('=', '+', '-', '@')) else v for v in row])
        return {'filename': 'mapa-' + mid[:8] + '.csv', 'content': '\ufeff' + out.getvalue()}

    def export_xls(self, mid):
        from excel_export import build_xls
        detail = self.detail(mid)
        raw = build_xls(detail['map'], detail['result'])
        return {'filename': 'mapa-' + mid[:8] + '.xls', 'encoding': 'base64',
                'content': base64.b64encode(raw).decode('ascii')}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def run_request(self):
        token = os.environ.get('FOLLOWUP_API_TOKEN', '')
        if not token or not hmac.compare_digest(self.headers.get('X-FollowUp-Token', ''), token):
            return self.reply(401, {'error': 'Não autorizado.'})
        try:
            parsed = urlparse(self.path)
            query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            s = self.server.store
            if self.command == 'GET':
                if parsed.path == '/health':
                    return self.reply(200, {'ok': True})
                if parsed.path == '/overview':
                    return self.reply(200, s.overview())
                if parsed.path == '/items':
                    return self.reply(200, s.catalog())
                if parsed.path == '/maps':
                    return self.reply(200, [{'id': m['id'], 'name': m['name'], 'created': m['created'], 'count': len(m['items']), 'archived': m['archived']} for m in s.all('maps')][::-1])
                if parsed.path == '/map':
                    return self.reply(200, s.detail(query['id']))
                if parsed.path == '/settings':
                    return self.reply(200, s.settings())
                if parsed.path == '/data-safety':
                    return self.reply(200, s.data_safety_status())
                if parsed.path == '/preview':
                    return self.reply(200, s.preview(query['id'], query['supplier']))
                if parsed.path == '/history':
                    return self.reply(200, s.all('messages')[::-1])
                if parsed.path == '/export':
                    return self.reply(200, s.export_xls(query['id']))
            else:
                size = int(self.headers.get('Content-Length', '0'))
                if size > 5000000:
                    raise ValueError('Requisição muito grande.')
                body = json.loads(self.rfile.read(size) or '{}')
                if parsed.path == '/import':
                    return self.reply(200, s.import_file(body['path']))
                if parsed.path == '/maps/create':
                    return self.reply(200, s.create_map(body))
                if parsed.path == '/maps/save':
                    return self.reply(200, s.save_map(body))
                if parsed.path == '/maps/archive':
                    with s.lock:
                        m = s.get_map(body['id'])
                        m.update(archived=True, revision=m['revision'] + 1)
                        s.put('maps', m['id'], m)
                    return self.reply(200, {'ok': True})
                if parsed.path == '/settings':
                    if not isinstance(body, dict):
                        raise ValueError('Configuração inválida.')
                    body['id'] = 'ui'
                    s.put('settings', 'ui', body)
                    return self.reply(200, body)
                if parsed.path == '/data-safety/backup':
                    return self.reply(200, s.create_backup(
                        reason=body.get('reason', 'manual'), automatic=bool(body.get('automatic', False))
                    ))
                if parsed.path == '/send':
                    return self.reply(200, s.send(body))
                if parsed.path == '/review':
                    return self.reply(200, s.review(body))
            self.reply(404, {'error': 'Operação não encontrada.'})
        except Exception as exc:
            self.reply(400, {'error': str(exc)})

    do_GET = run_request
    do_POST = run_request


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['serve', 'summary'])
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    try:
        store = Store(os.environ.get('FOLLOWUP_DATA_DIR', str(Path.home() / '.vyzium-compras')))
    except DataIntegrityError as exc:
        print(f'VYZIUM_DATA_INTEGRITY: {exc}', file=sys.stderr, flush=True)
        raise SystemExit(3)
    if args.command == 'summary':
        print(json.dumps(store.overview(), ensure_ascii=False), flush=True)
    else:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
        server.store = store
        print(json.dumps({'event': 'ready', 'port': server.server_address[1]}), flush=True)
        server.serve_forever()
