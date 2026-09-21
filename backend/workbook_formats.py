"""Adapters for the raw SCI export and the approval/deadline report."""
import hashlib
import re
import unicodedata
import zipfile
from datetime import datetime, timedelta


class Sheet:
    def __init__(self, rows):
        self.rows = rows

    def reset_dimensions(self):
        pass

    def iter_rows(self, min_row=1, max_row=None, values_only=True, **kwargs):
        start = max(0, int(min_row or 1) - 1)
        end = None if max_row is None else max(start, int(max_row))
        return iter(self.rows[start:end])


class Book:
    def __init__(self, sheets):
        self.sheets = sheets

    def __iter__(self):
        return iter(self.sheets)

    def close(self):
        pass


class ManagedBook:
    """Own an XLSX stream together with the openpyxl workbook using it."""
    def __init__(self, workbook, stream):
        self.workbook = workbook
        self.stream = stream

    def __iter__(self):
        return iter(self.workbook)

    def __getattr__(self, name):
        return getattr(self.workbook, name)

    def close(self):
        try:
            self.workbook.close()
        finally:
            self.stream.close()


def normalize_header(value):
    """Normalize spreadsheet headers consistently across both Vyzium modules."""
    text = '' if value is None else str(value)
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r'[^A-Za-z0-9]+', ' ', text.upper())
    return re.sub(r'\s+', ' ', text).strip()


def open_book(path, xlsx_loader):
    if zipfile.is_zipfile(path):
        # File objects also permit legitimate XLSX content with an incorrect .xls extension.
        # openpyxl/ZipFile does not own a caller-provided stream, so keep explicit
        # ownership and close both objects when the importer finishes.
        stream = open(path, 'rb')
        try:
            workbook = xlsx_loader(stream, read_only=True, data_only=True)
        except Exception:
            stream.close()
            raise
        return ManagedBook(workbook, stream)
    if str(path).lower().endswith('.xls'):
        try:
            import xlrd
        except ImportError as exc:
            raise ValueError('Instale as dependências atualizadas para abrir arquivos XLS.') from exc
        try:
            book = xlrd.open_workbook(path)
        except xlrd.XLRDError as exc:
            raise ValueError('Este arquivo não é um XLS binário válido. Abra no Excel e salve como XLS ou XLSX.') from exc
        sheets = []
        for s in book.sheets():
            rows = []
            for row in s.get_rows():
                rows.append(tuple(xlrd.xldate.xldate_as_datetime(c.value, book.datemode)
                                  if c.ctype == xlrd.XL_CELL_DATE else c.value for c in row))
            sheets.append(Sheet(rows))
        book.release_resources()
        return Book(sheets)
    return xlsx_loader(path, read_only=True, data_only=True)


REPORT_REQUIRED = {'EMPRESA', 'COMPRADOR SCI', 'NUMERO DA SCI', 'DESCRICAO DO ARTIGO',
                   'STATUS DA SCI', 'QUANTIDADE', 'UNIDADE', 'ID OC', 'STATUS BPM SCI'}
ALIASES = {
    'EMPRESA': 'EMPRESA', 'COMPRADOR SCI': 'COMPRADOR', 'NUMERO DA SCI': 'IDSCI',
    'DESCRICAO DO ARTIGO': 'DESCRICAOARTIGO', 'QUANTIDADE': 'QUANTIDADESCI',
    'UNIDADE': 'UNIDADEDEMEDIDASCI', 'ID OC': 'IDORDEMDECOMPRA',
    'DATA APROVACAO SCI': 'APPROVED_AT', 'PRAZO (12 DIAS)': 'DEADLINE_AT',
    'DATA DA EMISSAO': 'DATAEMISSAOSCI', 'CENTRO DE CUSTO': 'DESCRICAOGRUPO',
    'URGENCIA': 'URGENTE', 'OBS': 'NOTE', 'TIPO DE COMPRA': 'PURCHASE_TYPE',
}


def adapt_report(r, norm, text):
    if not text(r.get('NUMERO DA SCI')) and not text(r.get('DESCRICAO DO ARTIGO')):
        return None  # Footer containing applied report filters is not an item.
    if not text(r.get('NUMERO DA SCI')) or not text(r.get('EMPRESA')) or not text(r.get('DESCRICAO DO ARTIGO')):
        raise ValueError('Há uma linha de item sem hotel, número de SCI ou descrição.')
    out = {target: r.get(source) for source, target in ALIASES.items()}
    out['FKEMPRESA'] = norm(r['EMPRESA'])
    # This report has no native SCI item ID. Identity excludes mutable quantities, notes and dates.
    identity = [norm(r.get(k)) for k in ('EMPRESA', 'NUMERO DA SCI', 'DESCRICAO DO ARTIGO',
                'UNIDADE', 'CENTRO DE CUSTO', 'TIPO DE COMPRA', 'TIPO DE DESTINO')]
    out['IDITEMDASCI'] = 'report-' + hashlib.sha256('|'.join(identity).encode()).hexdigest()[:24]
    for source, target in [('STATUS DA SCI', 'NMSTATUSDOITEMDASCI'), ('STATUS BPM SCI', 'NMSTATUSBPMSCI')]:
        m = re.match(r'^(\d+)\b', text(r.get(source)))
        out[target] = m.group(1) if m else ''
    out['REPORT_IDENTITY'] = True
    return out


def approval_deadline(r, iso):
    approved = iso(r.get('APPROVED_AT') or r.get('DATA APROVACAO SCI') or r.get('DATAAPROVACAOSCI'))
    provided = iso(r.get('DEADLINE_AT') or r.get('PRAZO (12 DIAS)'))
    if approved:
        expected = (datetime.fromisoformat(approved).date() + timedelta(days=12)).isoformat()
        # The approval + 12 rule remains authoritative if an exported deadline disagrees.
        return approved, expected, bool(provided and provided != expected)
    return '', provided, False
