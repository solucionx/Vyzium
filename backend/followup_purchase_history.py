"""Read-only purchase history built from the operational OC database.

The quotation workbook is a different source. This reader never imports from
Compras, never applies saved operational filters and never writes to the
follow-up database. It reuses the audited 3.4.12 purchase-history model.
"""
from copy import deepcopy
import os
import threading

from purchase_history import HistoryBuilder, search, detail
from secure_sqlite import connect


class FollowupPurchaseHistory:
    CACHE_SECONDS = 60

    def __init__(self, path, key_hex=None):
        self.path = str(path)
        self.key_hex = key_hex
        self.lock = threading.RLock()
        self.snapshot = None
        self.stamp = None
        self.timer = None
        self.epoch = 0

    def source_stamp(self):
        result = []
        for path in (self.path, self.path + '-wal'):
            try:
                stat = os.stat(path)
                result.append((stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns))
            except FileNotFoundError:
                result.append(None)
        return tuple(result)

    def clear(self):
        with self.lock:
            self.epoch += 1
            if self.timer is not None:
                self.timer.cancel()
            self.timer = None
            self.snapshot = None
            self.stamp = None

    def expire(self, epoch):
        with self.lock:
            if epoch == self.epoch:
                self.clear()

    def load(self):
        # Separate read-only connection + transaction: a query sees one coherent
        # import even if the daily workbook commits while the index is built.
        con = connect(self.path, key_hex=self.key_hex, readonly=True)
        try:
            con.execute('BEGIN')
            batch = con.execute(
                'SELECT source_file,imported_at,source_rows FROM import_batches ORDER BY id DESC LIMIT 1'
            ).fetchone()
            headers = [
                'IDORDEMDECOMPRA', 'IDITEMDAORDEMDECOMPRA', 'FKEMPRESA', 'EMPRESA',
                'IDSCI', 'CODIGOARTIGO', 'DESCRICAOARTIGO', 'FKFORNECEDOR',
                'RAZAOSOCIALFORNECEDOR', 'COMPRADOR', 'DATAOC',
                'NMSTATUSITEMDAORDEMDECOMPRA', 'QUANTIDADEOC', 'UNIDADEMEDIDAOC',
                'VALORUNITARIOITEMOC', 'VALORTOTALITEMOC', 'DATAENTRADAMERCADORIA',
                'QUANTIDADERECEBIDA', 'UNIDADEMEDIDARECEBIDA', 'ANNUMERODANOTAFISCAL',
                'IDITEMDAENTRADA'
            ]
            builder = HistoryBuilder(headers)
            # Deliberately no buyer/status WHERE: this reference view must show
            # every OC retained by the operational import, including older,
            # completed and cancelled purchases from every buyer.
            for values in con.execute('''
                SELECT o.oc,o.item_key,o.company_id,o.company,o.sci,o.article_code,
                       o.description,o.supplier_key,o.supplier_name,o.buyer,o.order_date,
                       COALESCE(o.order_status_code,o.order_status),o.quantity,o.unit,
                       o.value_unit,o.value_total,r.receipt_date,r.quantity,r.unit,r.invoice,r.receipt_key
                FROM orders o LEFT JOIN receipts r ON r.item_key=o.item_key
                ORDER BY o.item_key,r.receipt_key
            '''):
                builder.add(values)
            snapshot = builder.finish()
            if batch:
                snapshot.update(filename=batch[0], at=batch[1], source_rows=batch[2])
            elif snapshot.get('lines'):
                snapshot.update(filename='Base de OCs do Acompanhamento')
            else:
                snapshot.pop('id', None)
            return snapshot
        finally:
            con.close()

    def query(self, query):
        # Only controls from this read-only screen are accepted. Buyer, urgency,
        # attendance and persisted filters from other views are intentionally ignored.
        query = {k: v for k, v in query.items()
                 if k in ('q', 'id', 'page', 'company', 'supplier', 'status')}
        query.setdefault('status', 'all')
        with self.lock:
            before = self.source_stamp()
            if self.snapshot is None or before != self.stamp:
                self.clear()
                snapshot = self.load()
                after = self.source_stamp()
                # If another process committed during the load, serve the coherent
                # transaction result once but do not cache it under a newer stamp.
                if before == after:
                    self.snapshot, self.stamp = snapshot, after
            else:
                snapshot = self.snapshot

            # detail() contains references to cached line dictionaries. Copy the
            # response so a caller can never mutate the in-memory source snapshot.
            result = deepcopy(detail(snapshot, query) if query.get('id') else search(snapshot, query))
            result['source'] = {
                'at': snapshot.get('at'),
                'filename': snapshot.get('filename'),
                'orders': snapshot.get('orders', 0),
                'items': snapshot.get('items', 0),
                'source_rows': snapshot.get('source_rows', 0),
                'columns': dict(snapshot.get('columns') or {}),
                'available': snapshot.get('id') == 'purchase-history',
                'module': 'followup',
            }

            if self.snapshot is not None:
                if self.timer is not None:
                    self.timer.cancel()
                self.epoch += 1
                self.timer = threading.Timer(self.CACHE_SECONDS, self.expire, args=(self.epoch,))
                self.timer.daemon = True
                self.timer.start()
            return result
