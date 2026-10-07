"""Read-only purchase references from the SCI snapshot, with receipt values kept separate.

Never substitute an order price for a receipt price. Missing/invalid/conflicting
amounts stay unknown. Group articles by code AND OC unit; without a code use the
exact normalized description and unit instead of fuzzy article identities.
"""
import hashlib
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from workbook_formats import normalize_header


def norm(value):
    return normalize_header(value)


def text(value):
    if value is None:
        return ''
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value).strip()


def compact(value):
    return norm(value).replace(' ', '')


FIELDS = {
    'oc': ('IDORDEMDECOMPRA', 'ID OC', 'OC', 'NUMERO DA OC'),
    'oc_item': ('IDITEMDAORDEMDECOMPRA', 'ID ITEM DA OC'),
    'company_id': ('FKEMPRESA',), 'company': ('EMPRESA', 'HOTEL'),
    'sci': ('IDSCI', 'NUMERO DA SCI', 'SCI'), 'sci_item': ('IDITEMDASCI',),
    'article': ('CODIGOARTIGO', 'CODIGO DO ARTIGO', 'CODIGO ARTIGO'),
    'description': ('DESCRICAOARTIGO', 'DESCRICAO DO ARTIGO'),
    'supplier_id': ('FKFORNECEDOR',),
    'supplier': ('RAZAOSOCIALFORNECEDOR', 'RAZAO SOCIAL FORNECEDOR', 'NOMEFORNECEDOR', 'FORNECEDOR'),
    'buyer': ('COMPRADOR', 'COMPRADOR SCI'),
    'order_date': ('DATAOC', 'DATA DA OC'),
    'order_status': ('NMSTATUSITEMDAORDEMDECOMPRA', 'STATUS DO ITEM DA OC', 'STATUSITEMDAORDEMDECOMPRA'),
    'quantity': ('QUANTIDADEOC', 'QUANTIDADE DA OC'),
    'unit': ('UNIDADEMEDIDAOC', 'UNIDADE DE MEDIDA OC', 'FATOR OC', 'UNIDADEDEMEDIDASCI', 'UNIDADE'),
    'order_price': ('VALORUNITARIOITEMOC', 'VALOR UNITARIO ITEM OC'),
    'order_total': ('VALORTOTALITEMOC', 'VALOR TOTAL ITEM OC'),
    'receipt_date': ('DATAENTRADAMERCADORIA', 'DATA ENTRADA MERCADORIA', 'DATA DA ENTRADA'),
    'receipt_quantity': ('QUANTIDADERECEBIDA', 'QUANTIDADE RECEBIDA'),
    'receipt_unit': ('UNIDADEMEDIDARECEBIDA', 'UNIDADE MEDIDA RECEBIDA'),
    'invoice': ('ANNUMERODANOTAFISCAL', 'NUMERO DA NOTA FISCAL', 'NOTA FISCAL'),
    # Only explicit receipt/entry fields are accepted, never the ambiguous
    # "valor unitario" or the OC fields above.
    'receipt_price': ('VALORUNITARIOITEMENTRADA', 'VALORUNITARIOENTRADA', 'VALORUNITARIORECEBIDO',
                      'VALORUNITARIOITEMRECEBIDO', 'VALOR UNITARIO DA ENTRADA'),
    'receipt_total': ('VALORTOTALITEMENTRADA', 'VALORTOTALENTRADA', 'VALORTOTALRECEBIDO',
                      'VALORTOTALITEMRECEBIDO', 'VALOR TOTAL DA ENTRADA'),
    'receipt_id': ('IDITEMDAENTRADA', 'IDITEMENTRADAMERCADORIA', 'IDENTRADAMERCADORIA'),
}


def numeric(value):
    raw = text(value).replace('R$', '').replace(' ', '')
    if not raw or raw.startswith('=') or isinstance(value, bool):
        return None
    if ',' in raw:
        raw = raw.replace('.', '').replace(',', '.')
    try:
        result = Decimal(raw)
        if not result.is_finite() or result < 0 or result > Decimal('1000000000000'):
            return None
        return format(result.normalize(), 'f')
    except InvalidOperation:
        return None


def iso(value):
    if isinstance(value, (date, datetime)):
        return value.strftime('%Y-%m-%d')
    for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(text(value)[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return ''


def key(parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()[:32]


def unit_price(price, total, quantity):
    if price is not None:
        return price, 'column'
    if total is not None and quantity is not None and Decimal(quantity) > 0:
        return format(Decimal(total) / Decimal(quantity), '.6f').rstrip('0').rstrip('.'), 'total_div_quantity'
    return None, 'missing'


class HistoryBuilder:
    def __init__(self, headers):
        self.mapping = {}
        self.alias_indexes = {}
        for field, aliases in FIELDS.items():
            indexes = [i for i, h in enumerate(headers) if compact(h) in {compact(a) for a in aliases}]
            self.alias_indexes[field] = []
            # A code and a textual status, or SCI/OC units, may coexist. Use
            # documented alias priority; duplicate spellings of one alias are ambiguous.
            for alias in aliases:
                matches = [i for i in indexes if compact(headers[i]) == compact(alias)]
                if len(matches) > 1:
                    raise ValueError('Cabeçalho ambíguo no histórico de compras: ' + text(headers[matches[0]]) + '. A base anterior foi preservada.')
                if matches:
                    self.alias_indexes[field].append(matches[0])
                    if field not in self.mapping:
                        self.mapping[field] = matches[0]
        self.columns = {f: text(headers[i]) for f, i in self.mapping.items()}
        self.lines = {}
        self.source_rows = 0

    def add(self, values):
        def get(field):
            i = self.mapping.get(field)
            return values[i] if i is not None and i < len(values) else None

        def first_value(field):
            # Some SCI exports contain more than one compatible supplier-name
            # column. Fall back only inside the same semantic field; never mix
            # order values with receipt values.
            for i in self.alias_indexes.get(field, ()):
                if i < len(values) and text(values[i]):
                    return values[i]
            return get(field)

        oc, description = text(get('oc')), text(get('description'))
        if oc in ('', '0', '0.0') or not description:
            return
        self.source_rows += 1
        article, unit, company = (text(get(f)) for f in ('article', 'unit', 'company'))
        supplier = text(first_value('supplier'))
        unit_basis = 'sci' if compact(self.columns.get('unit')) in ('UNIDADEDEMEDIDASCI', 'UNIDADE') else 'order'
        item_id = key(['code' if article else 'description', norm(article or description), norm(unit), unit_basis])
        order_id = key([text(get('company_id')) or norm(company), oc, text(get('supplier_id')) or norm(supplier)])
        # Native SCI/OC item IDs must not change when an export edits a label.
        source_id = text(get('oc_item')) or (['sci_item', text(get('sci')), text(get('sci_item'))]
                    if text(get('sci_item')) else ['fallback', text(get('sci')), norm(description), norm(article), norm(unit)])
        lid = key([order_id, source_id, item_id])
        status = text(get('order_status'))
        cancelled = bool(re.fullmatch(r'3(?:\.0+)?(?:\s*[-–—]\s*cancelado)?|cancelad[oa]', status, re.I))
        row = {'id': lid, 'item_id': item_id, 'order_id': order_id, 'oc': oc,
               'company': company, 'supplier': supplier, 'article': article,
               'description': description, 'unit': unit, 'unit_basis': unit_basis, 'sci': text(get('sci')),
               'buyer': text(get('buyer')), 'order_date': iso(get('order_date')),
               'status': status, 'cancelled': cancelled,
               **{f: numeric(get(f)) for f in ('quantity', 'order_price', 'order_total')}}
        line = self.lines.get(lid)
        if line is None:
            line = self.lines[lid] = {**row, 'conflicts': [], '_receipts': {}}
        else:
            line['cancelled'] = line['cancelled'] or cancelled
            for f in ('company', 'supplier', 'article', 'description', 'unit', 'sci', 'buyer'):
                candidates = [v for v in (line[f], row[f]) if v]
                line[f] = min(candidates, key=lambda v: (norm(v), v)) if candidates else ''
            for f in ('quantity', 'order_price', 'order_total', 'order_date', 'status'):
                if row[f] in (None, '') or f in line['conflicts']:
                    continue
                if line[f] in (None, ''):
                    line[f] = row[f]
                    continue
                if row[f] != line[f] and f not in line['conflicts']:
                    line['conflicts'].append(f)
                    line[f] = None if f in ('quantity', 'order_price', 'order_total') else ''
        receipt = {'date': iso(get('receipt_date')), 'invoice': text(get('invoice')),
                   'quantity': numeric(get('receipt_quantity')), 'unit': text(get('receipt_unit')),
                   'price': numeric(get('receipt_price')), 'total': numeric(get('receipt_total'))}
        if receipt['date'] or receipt['invoice'] or (receipt['quantity'] is not None and Decimal(receipt['quantity']) > 0):
            rid = key(['id', text(get('receipt_id'))]) if text(get('receipt_id')) else key([receipt[f] for f in ('date', 'invoice', 'quantity', 'unit')])
            existing = line['_receipts'].get(rid)
            if existing is None:
                line['_receipts'][rid] = {**receipt, 'id': rid, 'conflicts': []}
            else:
                for f, value in receipt.items():
                    if value in (None, '') or f in existing['conflicts']:
                        continue
                    if existing[f] in (None, ''):
                        existing[f] = value
                    elif existing[f] != value:
                        existing['conflicts'].append(f)
                        existing[f] = None if f in ('price', 'total', 'quantity') else ''

    def finish(self):
        lines = []
        for line in self.lines.values():
            line = dict(line)
            line['conflicts'] = sorted(line['conflicts'])
            line['receipts'] = sorted(line.pop('_receipts').values(), key=lambda r: (r['date'], r['invoice'], r['id']), reverse=True)
            for receipt in line['receipts']:
                receipt['conflicts'] = sorted(receipt['conflicts'])
                # A unit conflict makes any "price per unit" ambiguous even when
                # the numeric amount itself is repeated consistently.
                if set(receipt['conflicts']) & {'price', 'total', 'quantity', 'unit'}:
                    receipt['price'] = None
                    receipt['price_source'] = 'conflict'
                else:
                    receipt['price'], receipt['price_source'] = unit_price(receipt['price'], receipt['total'], receipt['quantity'])
            # Conflicting source fields cannot be repaired by a derived price.
            if not set(line['conflicts']) & {'order_price', 'order_total', 'quantity'}:
                line['order_price'], line['price_source'] = unit_price(line['order_price'], line['order_total'], line['quantity'])
            else:
                line['price_source'] = 'conflict' if 'order_price' in line['conflicts'] else ('column' if line['order_price'] is not None else 'missing')
            line['sort_date'] = line['order_date'] or max((r['date'] for r in line['receipts']), default='')
            line['date_basis'] = 'order' if line['order_date'] else ('receipt' if line['sort_date'] else 'missing')
            lines.append(line)
        lines.sort(key=lambda line: line['id'])
        return {'id': 'purchase-history', 'lines': lines, 'columns': self.columns,
                'source_rows': self.source_rows, 'orders': len({l['order_id'] for l in lines}),
                'items': len({l['item_id'] for l in lines})}


def filtered_lines(snapshot, query):
    status = query.get('status', 'valid')
    if status not in ('valid', 'received', 'all'):
        raise ValueError('Filtro de compras inválido.')
    tokens = norm(query.get('q', '')).split()
    return sorted((l for l in snapshot.get('lines', [])
                   if (status == 'all' or not l['cancelled'])
                   and (status != 'received' or l['receipts'])
                   and (not query.get('company') or l['company'] == query['company'])
                   and (not query.get('supplier') or l['supplier'] == query['supplier'])
                   and all(t in norm(l['article'] + ' ' + l['description']) for t in tokens)),
                  key=lambda l: (l['sort_date'], l['oc'].zfill(20), l['id']), reverse=True)


def page_number(query):
    try:
        page = int(query.get('page', 0))
        if 0 <= page <= 1000000:
            return page
    except (ValueError, TypeError):
        pass
    raise ValueError('Página de compras inválida.')


def search(snapshot, query):
    # Text search selects article identities. Once an identity matches, compute
    # its card over every line that still satisfies hotel/supplier/status
    # filters. The card and detail therefore agree on latest OC and count.
    base = filtered_lines(snapshot, {**query, 'q': ''})
    tokens = norm(query.get('q', '')).split()
    if tokens:
        matching_ids = {l['item_id'] for l in base
                        if all(t in norm(l['article'] + ' ' + l['description']) for t in tokens)}
        lines = (l for l in base if l['item_id'] in matching_ids)
    else:
        lines = iter(base)
    groups = {}
    for line in lines:
        g = groups.setdefault(line['item_id'], {'id': line['item_id'], 'article': line['article'],
              'description': line['description'], 'unit': line['unit'], 'unit_basis': line['unit_basis'], 'latest': {k: line[k] for k in
              ('oc', 'company', 'supplier', 'sort_date', 'date_basis', 'order_price', 'price_source', 'cancelled')}, '_orders': set()})
        g['_orders'].add(line['order_id'])
    items = [{**g, 'orders': len(g['_orders'])} for g in groups.values()]
    for g in items:
        del g['_orders']
    page, size = page_number(query), 20
    return {'items': items[page * size:(page + 1) * size], 'total': len(items), 'page': page, 'page_size': size,
            'companies': sorted({l['company'] for l in snapshot.get('lines', []) if l['company']}),
            'suppliers': sorted({l['supplier'] for l in snapshot.get('lines', []) if l['supplier']})}


def detail(snapshot, query):
    # Search terms choose article identities. They must not hide another
    # description of the SAME article from its order history.
    lines = [l for l in filtered_lines(snapshot, {**query, 'q': ''}) if l['item_id'] == query.get('id')]
    if not lines:
        raise ValueError('Item não encontrado com os filtros atuais.')
    orders = {}
    for line in lines:
        order = orders.setdefault(line['order_id'], {k: line[k] for k in
            ('order_id', 'oc', 'company', 'supplier', 'order_date', 'sort_date', 'date_basis')})
        order.setdefault('lines', []).append(line)
    values = list(orders.values())
    page, size = page_number(query), 10
    return {'item': {k: lines[0][k] for k in ('item_id', 'article', 'description', 'unit', 'unit_basis')},
            'orders': values[page * size:(page + 1) * size], 'total': len(values), 'page': page, 'page_size': size}
