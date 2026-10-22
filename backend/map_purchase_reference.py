"""Bounded, read-only map lookups over the same history snapshot and ordering."""
import json
from purchase_history import filtered_lines, norm

MAX_REFERENCES = 50


def parse_references(raw):
    if not isinstance(raw, str) or len(raw) > 24000:
        raise ValueError('Consulta de referências muito grande.')
    items = json.loads(raw)
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_REFERENCES:
        raise ValueError('Consulte entre 1 e 50 referências por lote.')
    for item in items:
        if not isinstance(item, dict) or set(item) - {'article', 'description', 'unit'}:
            raise ValueError('Referência inválida.')
        if any(not isinstance(v, str) or len(v) > 500 for v in item.values()):
            raise ValueError('Campo da referência inválido.')
    return items


class ReferenceIndex:
    def __init__(self, snapshot):
        self.items = {}
        self.codes = {}
        self.descriptions = {}
        # Exactly the history tab's default ordering, including receipt-date
        # fallback and cancelled lines. Sort once per source version, not per item.
        for line in filtered_lines(snapshot, {'status': 'all'}):
            if line['unit_basis'] != 'order':
                continue
            item_id = line['item_id']
            if item_id not in self.items:
                self.items[item_id] = {
                    **{k: line[k] for k in ('article', 'description', 'unit', 'unit_basis')},
                    'id': item_id,
                    'latest': {k: line[k] for k in ('oc', 'company', 'supplier', 'sort_date',
                               'date_basis', 'order_price', 'price_source', 'cancelled')},
                }
            unit = norm(line['unit'])
            if line['article']:
                self.codes.setdefault((norm(line['article']), unit), set()).add(item_id)
            # Include historic descriptions: the history tab resolves an article
            # from any matching line, then shows its latest OC, even after renaming.
            self.descriptions.setdefault((norm(line['description']), unit), set()).add(item_id)

    def lookup(self, item):
        article, description, unit = (norm(item.get(k, '')) for k in ('article', 'description', 'unit'))
        if not unit or not (article or description):
            return {'status': 'incomplete', 'item': None}
        ids = (self.codes if article else self.descriptions).get((article or description, unit), set())
        if len(ids) > 1:
            return {'status': 'ambiguous', 'item': None}
        if not ids:
            return {'status': 'missing', 'item': None}
        return {'status': 'found', 'item': self.items[next(iter(ids))]}
