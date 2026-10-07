"""Read-only purchase history from the operational OC database.

The quotation workbook is a different source. Never read it here, and never
apply saved operational filters or buyer/message eligibility to this query.
Existing installations and restored backups already contain orders/receipts;
no second import, database migration or copy of that snapshot is required.
"""
import os
import threading

from purchase_history import HistoryBuilder, HistoryIndex, search, detail
from secure_sqlite import connect


class FollowupPurchaseHistory:
    def __init__(self, path, key_hex=None):
        self.path = str(path)
        self.key_hex = key_hex
        self.lock = threading.RLock()
        self.index = None
        self.stamp = None
        self.timer = None
        self.epoch = 0

    def source_stamp(self):
        result = []
        for path in (self.path, self.path + '-wal'):
            try:
                s = os.stat(path)
                # SQLite may chmod an existing WAL when a reader opens it,
                # changing ctime without changing its contents. mtime + inode
                # + size track writes/replacements without disabling caching.
                result.append((s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns))
            except FileNotFoundError:
                result.append(None)
        return tuple(result)

    def clear(self):
        with self.lock:
            self.epoch += 1
            if self.timer is not None:
                self.timer.cancel()
            self.timer = self.index = self.stamp = None

    def expire(self, epoch):
        with self.lock:
            if epoch == self.epoch:
                self.clear()

    def load(self):
        # A separate read-only connection and one transaction see a coherent
        # snapshot even if an import commits while this index is being built.
        con = connect(self.path, key_hex=self.key_hex, readonly=True)
        try:
            con.execute('BEGIN')
            batch = con.execute('SELECT source_file,imported_at,source_rows FROM import_batches ORDER BY id DESC LIMIT 1').fetchone()
            headers = ['IDORDEMDECOMPRA', 'IDITEMDAORDEMDECOMPRA', 'FKEMPRESA', 'EMPRESA',
                       'IDSCI', 'CODIGOARTIGO', 'DESCRICAOARTIGO', 'FKFORNECEDOR',
                       'RAZAOSOCIALFORNECEDOR', 'COMPRADOR', 'DATAOC',
                       'NMSTATUSITEMDAORDEMDECOMPRA', 'QUANTIDADEOC', 'UNIDADEMEDIDAOC',
                       'VALORUNITARIOITEMOC', 'VALORTOTALITEMOC', 'DATAENTRADAMERCADORIA',
                       'QUANTIDADERECEBIDA', 'UNIDADEMEDIDARECEBIDA', 'ANNUMERODANOTAFISCAL',
                       'IDITEMDAENTRADA']
            builder = HistoryBuilder(headers)
            # No WHERE clause: completed, older and other buyers' orders are
            # just as relevant as pending orders when looking up an article.
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
            elif not snapshot['lines']:
                snapshot.pop('id')
            else:
                snapshot.update(filename='Base de OCs do Acompanhamento')
            return HistoryIndex(snapshot)
        finally:
            con.close()

    def query(self, query):
        # Accept only this view's own controls. In particular buyer, urgency,
        # attendance and saved settings never participate in the query.
        query = {k: v for k, v in query.items() if k in ('q', 'id', 'page', 'company', 'supplier', 'status')}
        query.setdefault('status', 'all')
        with self.lock:
            stamp = self.source_stamp()
            if self.index is None or stamp != self.stamp:
                self.clear()
                index = self.load()
                after = self.source_stamp()
                if stamp == after:
                    self.index, self.stamp = index, after
            else:
                index = self.index
            result = detail(index, query) if query.get('id') else search(index, query)
            result['source'] = {**index.source, 'module': 'followup',
                                'columns': dict(index.source.get('columns') or {})}
            if self.index is not None:
                if self.timer is not None:
                    self.timer.cancel()
                self.epoch += 1
                self.timer = threading.Timer(60, self.expire, args=(self.epoch,))
                self.timer.daemon = True
                self.timer.start()
            return result
