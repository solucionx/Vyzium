"""Read-only, bounded search summaries; never return image bytes or modify filters."""
import json
import unicodedata

LIMIT_PER_KIND = 15


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or ''))
                   if not unicodedata.combining(c)).casefold().strip()


def search_query(value):
    if not isinstance(value, str) or len(value) > 100:
        raise ValueError('A busca deve ter até 100 caracteres.')
    query = normalized(value)
    return query if len(query) >= 2 else ''


class Results:
    def __init__(self, query):
        self.query = query
        self.tokens = query.split()
        self.buckets = {}
        self.seen = set()
        self.more = False

    def add(self, kind, identity, title, subtitle, fields, target):
        if not self.query or not all(t in normalized(' '.join(str(f or '') for f in fields)) for t in self.tokens):
            return
        key = (kind, identity)
        if key in self.seen:
            return
        self.seen.add(key)
        primary = [normalized(f) for f in fields[:2]]
        rank = 0 if self.query in primary else 1 if any(f.startswith(self.query) for f in primary) else 2
        bucket = self.buckets.setdefault(kind, [])
        bucket.append((rank, normalized(title), str(identity), {'kind': kind, 'title': str(title), 'subtitle': str(subtitle), 'target': target}))
        bucket.sort(key=lambda r: r[:3])
        if len(bucket) > LIMIT_PER_KIND:
            bucket.pop()
            self.more = True

    def response(self):
        return {'results': [r[3] for bucket in self.buckets.values() for r in bucket], 'has_more': self.more}


def search_followup(store, value):
    result = Results(search_query(value))
    if not result.query:
        return result.response()
    with store.lock:
        rows = store.connection.execute('SELECT oc,supplier_key,supplier_name,company,sci,description,article_code FROM orders ORDER BY oc,supplier_key,item_key')
        for row in rows:
            oc, key, supplier, hotel, sci, description, article = tuple(row)
            result.add('order', (oc, key), f'OC {oc}', f'{hotel or ""} · {supplier or ""} · SCI {sci or "—"} · {description or ""}',
                       [oc, sci, supplier, hotel, description, article],
                       {'module': 'followup', 'kind': 'order', 'oc': str(oc), 'supplier_key': str(key or '')})
        for row in store.connection.execute('SELECT supplier_key,display_name,contact_name,phone FROM suppliers ORDER BY display_name,supplier_key'):
            key, name, contact, phone = tuple(row)
            result.add('supplier', key, name, f'{contact or ""} · {phone or "Sem telefone"}', [name, phone, contact],
                       {'module': 'followup', 'kind': 'supplier', 'supplier_key': str(key)})
    return result.response()


def search_compras(store, value):
    result = Results(search_query(value))
    if not result.query:
        return result.response()
    with store.db() as con:
        for rid, raw in con.execute('SELECT id,data FROM items ORDER BY id'):
            item = json.loads(raw)
            result.add('item', rid, item.get('description', ''), f"SCI {item.get('sci', '')} · {item.get('company', '')} · {item.get('quantity', '')} {item.get('unit', '')}",
                       [item.get('sci'), item.get('article'), item.get('description'), item.get('company')],
                       {'module': 'compras', 'kind': 'item', 'item_id': rid})
        # Stream maps one by one so images do not accumulate in a search index/cache.
        for mid, raw in con.execute('SELECT id,data FROM maps ORDER BY id'):
            data = json.loads(raw)
            fields = [data.get('name'), mid]
            fields += [s.get('name') for s in data.get('suppliers', [])]
            for item in data.get('items', []):
                fields += [item.get('sci'), item.get('article'), item.get('description'), item.get('company')]
            state = 'Concluído' if data.get('archived') else 'Em cotação'
            result.add('map', mid, data.get('name', ''), f"{state} · {len(data.get('items', []))} itens", fields,
                       {'module': 'compras', 'kind': 'map', 'map_id': mid})
    return result.response()
