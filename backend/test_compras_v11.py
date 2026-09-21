import base64
import copy
import io
import tempfile
import unittest
from pathlib import Path
from datetime import datetime
from compras_engine import Store, load_items, evaluate
from workbook_formats import approval_deadline
from compras_engine import iso
from test_compras_module import sample


HEADERS = ['Empresa', 'Comprador SCI', 'Número da SCI', 'Data Aprovação SCI', 'Prazo (12 Dias)',
           'Data de Vencimento', 'Descrição do Artigo', 'Status da SCI', 'Quantidade', 'Unidade',
           'ID OC', 'Status BPM SCI', 'Centro de Custo', 'OBS', 'Tipo de Compra']


def fixture(path, rows):
    import xlwt
    w=xlwt.Workbook();s=w.add_sheet('Export')
    for col,value in enumerate(HEADERS):s.write(0,col,value)
    for line,row in enumerate(rows,1):
        for col,value in enumerate(row):
            if value is not None:
                s.write(line,col,value,xlwt.easyxf(num_format_str='DD/MM/YYYY') if isinstance(value,datetime) else xlwt.Style.default_style)
    w.save(str(path))


def report_row(buyer='Comprador A', description='Artigo'):
    return ['Hotel A',buyer,'123',datetime(2026,9,1),datetime(2026,9,13),datetime(2000,1,1),description,'0 - Pendente',5,'UN',None,'3 - Integrado e Aprovado','Estoque','Observação original','Normal']


class V11(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'sample.xls'
        self.store=Store(self.tmp.name)

    def test_binary_xls_report_uses_approval_not_necessity(self):
        fixture(self.path,[report_row()]);items,report=load_items(self.path)
        self.assertEqual(items[0]['needed'],'2026-09-13');self.assertEqual(items[0]['buyer'],'Comprador A')
        self.assertEqual(items[0]['note'],'Observação original');self.assertEqual(report['format'],'approval_report')

    def test_buyers_are_dynamic_and_reordering_preserves_identity(self):
        rows=[report_row('A','Item A'),report_row('B','Item B')]
        fixture(self.path,rows);first,_=load_items(self.path)
        fixture(self.path,list(reversed(rows)));second,_=load_items(self.path)
        self.assertEqual({i['id'] for i in first},{i['id'] for i in second});self.assertEqual({i['buyer'] for i in first},{'A','B'})

    def test_duplicate_report_identity_is_not_silently_summed(self):
        fixture(self.path,[report_row(),report_row()]);items,report=load_items(self.path)
        self.assertEqual(items,[]);self.assertEqual(report['excluded']['conflict'],1)

    def test_deadline_missing_or_conflicting(self):
        self.assertEqual(approval_deadline({'APPROVED_AT':'2026-09-01','DEADLINE_AT':'2026-09-20'},iso),('2026-09-01','2026-09-13',True))
        self.assertEqual(approval_deadline({'DATANECESSIDADESCI':'2020-01-01'},iso),('','',False))

    def make_map(self):
        self.store.put('items',sample()['id'],sample())
        m=self.store.create_map({'name':'Negociação','ids':[sample()['id']]})
        m['suppliers']=[{'id':'s1','name':'Fornecedor A','phone':''}]
        m['quotes']={sample()['id']:{'s1':{'price':'19','negotiated':'15'}}}
        return self.store.save_map(m)

    def test_negotiated_unit_price_calculates_percentage_and_total(self):
        d=self.make_map();q=d['result']['lines'][0]['chosen']
        self.assertEqual(q['discount_percent'],'21.05');self.assertEqual(q['net'],'150.00');self.assertEqual(q['saving'],'40.00')

    def test_invalid_and_blank_negotiated_values(self):
        m=self.make_map()['map'];q=m['quotes'][sample()['id']]['s1'];q['negotiated']=''
        self.assertEqual(evaluate(m)['net'],'190.00')
        for invalid in ['20','0','-1','NaN']:
            q['negotiated']=invalid
            with self.assertRaises(ValueError):evaluate(m)

    def test_blank_initial_means_supplier_did_not_quote_item(self):
        m=self.make_map()['map'];q=m['quotes'][sample()['id']]['s1']
        q['price']='';q['negotiated']='15'
        saved=self.store.save_map(m)
        stored=saved['map']['quotes'][sample()['id']]['s1']
        self.assertEqual(stored,{'price':'','negotiated':''})
        self.assertEqual(saved['result']['unquoted'],1)
        self.assertEqual(saved['result']['net'],'0')

    def test_real_xls_export_roundtrips_numbers_and_percent(self):
        import xlrd
        m=self.make_map()['map'];payload=self.store.export_xls(m['id']);raw=base64.b64decode(payload['content'])
        self.assertEqual(raw[:8],bytes.fromhex('D0CF11E0A1B11AE1'))
        book=xlrd.open_workbook(file_contents=raw);sheet=book.sheet_by_name('Detalhado')
        self.assertEqual(sheet.cell_value(1,8),19);self.assertEqual(sheet.cell_value(1,9),15)
        self.assertAlmostEqual(sheet.cell_value(1,10),.2105);self.assertEqual(sheet.cell_value(1,13),150)
        self.assertEqual(sheet.cell_value(1,14),'Fornecedor A')
        printable=book.sheet_by_name('Mapa para impressão')
        self.assertEqual(printable.cell_value(5,0),sample()['company']);self.assertEqual(printable.cell_value(5,5),19)
        self.assertEqual(printable.cell_value(1,0),'Valor inicial')
        self.assertEqual(printable.cell_value(1,2),'Valor negociado')
        self.assertEqual(printable.cell_value(1,4),'Economia')
        self.assertEqual(printable.cell_value(1,6),'Itens sem cotação')
        self.assertEqual(printable.cell_value(4,5),'Fornecedor A\nInicial')
        self.assertEqual(printable.cell_value(4,6),'Fornecedor A\nNegociado')
        self.assertEqual(book.sheet_by_name('Resumo por fornecedor').cell_value(3,2),150)

    def test_new_maps_keep_report_notes_and_type(self):
        fixture(self.path,[report_row()]);self.store.import_file(self.path);i=self.store.catalog()['items'][0]
        m=self.store.create_map({'name':'Teste','ids':[i['id']]})
        self.assertEqual(m['items'][0]['note'],'Observação original');self.assertEqual(m['items'][0]['purchase_type'],'Normal')


if __name__=='__main__':unittest.main()
