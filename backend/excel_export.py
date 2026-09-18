"""Real BIFF8 XLS output, for the desktop application's export command."""
from io import BytesIO
from decimal import Decimal


def build_xls(data, result):
    import xlwt
    columns = 8 + len(data['suppliers']) * 6 + 3
    if columns > 256 or len(data['items']) + 2 > 65536:
        raise ValueError('O formato XLS aceita até 256 colunas e 65.536 linhas. Divida este mapa em mapas menores.')
    book = xlwt.Workbook(encoding='utf-8')
    header = xlwt.easyxf('font: bold on, colour white; pattern: pattern solid, fore_colour dark_blue; alignment: wrap on, vert centre;')
    plain = xlwt.easyxf('alignment: wrap on, vert top;')
    cash = xlwt.easyxf('alignment: vert top;', num_format_str='"R$" #,##0.00')
    percentage = xlwt.easyxf('alignment: vert top;', num_format_str='0.00%')
    winner = xlwt.easyxf('pattern: pattern solid, fore_colour light_green; alignment: wrap on, vert top;')
    sheet = book.add_sheet('Mapa de compra')
    sheet.set_panes_frozen(True)
    sheet.set_horz_split_pos(1)
    sheet.set_vert_split_pos(4)
    headings = ['HOTEL', 'SCI', 'COMPRADOR', 'DESCRIÇÃO DO ARTIGO', 'QUANTIDADE', 'UNIDADE', 'TIPO DE COMPRA', 'OBSERVAÇÃO']
    for s in data['suppliers']:
        headings += [f"{s['name']} — {label}" for label in ('Inicial unitário', 'Negociado unitário', 'Desconto %', 'Bruto R$', 'Economia R$', 'Final R$')]
    headings += ['VENCEDOR', 'VALOR FINAL R$', 'ECONOMIA R$']
    for c, value in enumerate(headings):
        sheet.write(0, c, value, header)
        sheet.col(c).width = 5500 if c in (0, 2) else 4300
    sheet.col(3).width = 12000
    sheet.col(7).width = 10000
    sheet.row(0).height_mismatch = True
    sheet.row(0).height = 850
    for row, (item, comparison) in enumerate(zip(data['items'], result['lines']), 1):
        values = [item['company'], item['sci'], item['buyer'], item['description'], float(Decimal(item['quantity'])),
                  item['unit'], item.get('purchase_type', ''), item.get('note', '')]
        for c, value in enumerate(values):
            sheet.write(row, c, value, plain)
        for idx, s in enumerate(data['suppliers']):
            quote = next((q for q in comparison['quotes'] if q['supplier_id'] == s['id']), None)
            if quote:
                values = [quote['initial_price'], quote['final_price'], str(Decimal(quote['discount_percent']) / 100),
                          quote['gross'], quote['saving'], quote['net']]
                for off, value in enumerate(values):
                    sheet.write(row, 8 + idx * 6 + off, float(Decimal(value)), percentage if off == 2 else cash)
        col = 8 + len(data['suppliers']) * 6
        chosen = comparison['chosen']
        sheet.write(row, col, chosen['supplier'] if chosen else ('EMPATE' if comparison['state'] == 'tie' else 'SEM COTAÇÃO'), winner if chosen else plain)
        if chosen:
            sheet.write(row, col + 1, float(Decimal(chosen['net'])), cash)
            sheet.write(row, col + 2, float(Decimal(chosen['saving'])), cash)
    summary = book.add_sheet('Resumo por fornecedor')
    rows = [['Mapa', data['name']], ['Fornecedor', 'Itens vencedores', 'Total líquido R$', 'Economia R$']]
    rows += [[s['name'], s['won'], float(Decimal(s['net'])), float(Decimal(s['saving']))] for s in result['suppliers']]
    rows += [['TOTAL DEFINIDO', sum(s['won'] for s in result['suppliers']), float(Decimal(result['net'])), float(Decimal(result['saving']))],
             ['Itens sem cotação', result['unquoted']], ['Empates não resolvidos', result['ties']],
             ['Critério', 'Menor preço negociado por item. Frete e condições de lote não incluídos.']]
    for row, values in enumerate(rows):
        for col, value in enumerate(values):
            summary.write(row, col, value, header if row == 1 else (cash if col >= 2 and isinstance(value, float) else plain))
    for col in range(4):
        summary.col(col).width = 9500 if col < 2 else 6500
    out = BytesIO()
    book.save(out)
    return out.getvalue()
