"""BIFF8 XLS export for Vyzium purchase maps.

The workbook keeps a detailed data sheet for auditing and adds a compact,
print-oriented first sheet so a map can be printed cleanly without changing
any purchasing calculation.
"""
from io import BytesIO
from decimal import Decimal


def _call(obj, method, *args):
    """Call optional xlwt worksheet helpers without tying the export to one xlwt build."""
    fn = getattr(obj, method, None)
    if callable(fn):
        fn(*args)


def _page_setup(sheet, *, fit_width=1, repeat_row=None):
    _call(sheet, 'set_landscape', True)
    _call(sheet, 'set_paper_size_code', 9)  # A4
    _call(sheet, 'set_fit_width_to_pages', fit_width)
    _call(sheet, 'set_fit_height_to_pages', 0)
    _call(sheet, 'set_left_margin', 0.25)
    _call(sheet, 'set_right_margin', 0.25)
    _call(sheet, 'set_top_margin', 0.45)
    _call(sheet, 'set_bottom_margin', 0.45)
    _call(sheet, 'set_print_centered_horz', True)
    _call(sheet, 'set_show_grid', False)
    if repeat_row is not None:
        _call(sheet, 'set_rows_to_repeat', repeat_row, repeat_row)
    _call(sheet, 'set_footer_str', '&C&P de &N')


def _styles(xlwt):
    border = 'borders: left thin, right thin, top thin, bottom thin;'
    return {
        'title': xlwt.easyxf(
            'font: bold on, colour white, height 280; '
            'pattern: pattern solid, fore_colour dark_blue; '
            'alignment: horiz left, vert centre;'
        ),
        'subtitle': xlwt.easyxf(
            'font: bold on, colour dark_blue; '
            'pattern: pattern solid, fore_colour ice_blue; '
            'alignment: horiz left, vert centre; ' + border
        ),
        'header': xlwt.easyxf(
            'font: bold on, colour white; '
            'pattern: pattern solid, fore_colour dark_blue; '
            'alignment: wrap on, horiz center, vert centre; ' + border
        ),
        'plain': xlwt.easyxf('alignment: wrap on, vert top; ' + border),
        'plain_alt': xlwt.easyxf(
            'pattern: pattern solid, fore_colour ice_blue; '
            'alignment: wrap on, vert top; ' + border
        ),
        'center': xlwt.easyxf('alignment: wrap on, horiz center, vert top; ' + border),
        'center_alt': xlwt.easyxf(
            'pattern: pattern solid, fore_colour ice_blue; '
            'alignment: wrap on, horiz center, vert top; ' + border
        ),
        'cash': xlwt.easyxf('alignment: horiz right, vert top; ' + border, num_format_str='"R$" #,##0.00'),
        'cash_alt': xlwt.easyxf(
            'pattern: pattern solid, fore_colour ice_blue; '
            'alignment: horiz right, vert top; ' + border,
            num_format_str='"R$" #,##0.00'
        ),
        'percent': xlwt.easyxf('alignment: horiz right, vert top; ' + border, num_format_str='0.00%'),
        'percent_alt': xlwt.easyxf(
            'pattern: pattern solid, fore_colour ice_blue; '
            'alignment: horiz right, vert top; ' + border,
            num_format_str='0.00%'
        ),
        'winner': xlwt.easyxf(
            'font: bold on, colour dark_green; '
            'pattern: pattern solid, fore_colour light_green; '
            'alignment: wrap on, vert top; ' + border
        ),
        'winner_cash': xlwt.easyxf(
            'font: bold on, colour dark_green; '
            'pattern: pattern solid, fore_colour light_green; '
            'alignment: horiz right, vert top; ' + border,
            num_format_str='"R$" #,##0.00'
        ),
        'winner_percent': xlwt.easyxf(
            'font: bold on, colour dark_green; '
            'pattern: pattern solid, fore_colour light_green; '
            'alignment: horiz right, vert top; ' + border,
            num_format_str='0.00%'
        ),
        'metric_label': xlwt.easyxf(
            'font: bold on, colour dark_blue; '
            'pattern: pattern solid, fore_colour ice_blue; '
            'alignment: horiz center, vert centre; ' + border
        ),
        'metric_cash': xlwt.easyxf(
            'font: bold on, height 240; '
            'alignment: horiz center, vert centre; ' + border,
            num_format_str='"R$" #,##0.00'
        ),
        'metric_value': xlwt.easyxf(
            'font: bold on, height 240; '
            'alignment: horiz center, vert centre; ' + border
        ),
    }


def _build_print_sheet(book, xlwt, data, result, st):
    """Compact first sheet intended for screen review and printing."""
    supplier_count = len(data['suppliers'])
    columns = 5 + supplier_count * 3 + 3
    sheet = book.add_sheet('Mapa para impressão')
    _page_setup(sheet, fit_width=1 if supplier_count <= 3 else 2, repeat_row=4)
    _call(sheet, 'set_header_str', f"&LVyzium · Mapa de compra&R{data['name']}")

    last_col = columns - 1
    sheet.write_merge(0, 0, 0, last_col, f"MAPA DE COMPRA · {data['name']}", st['title'])
    sheet.row(0).height_mismatch = True
    sheet.row(0).height = 520

    gross = Decimal(result['net']) + Decimal(result['saving'])
    metrics = [
        ('Valor inicial', gross, True),
        ('Valor negociado', Decimal(result['net']), True),
        ('Economia', Decimal(result['saving']), True),
        ('Itens sem cotação', result['unquoted'], False),
    ]
    # Four compact metric blocks spread across the available width.
    block = max(1, columns // 4)
    for idx, (label, value, cash) in enumerate(metrics):
        c0 = idx * block
        c1 = last_col if idx == 3 else min(last_col, c0 + block - 1)
        sheet.write_merge(1, 1, c0, c1, label, st['metric_label'])
        sheet.write_merge(2, 2, c0, c1, float(value) if cash else value, st['metric_cash'] if cash else st['metric_value'])
    sheet.write_merge(3, 3, 0, last_col,
                      'Preços unitários por fornecedor · valor inicial → valor negociado → desconto automático',
                      st['subtitle'])

    headings = ['HOTEL', 'SCI', 'ITEM / ESPECIFICAÇÃO', 'QTD.', 'UN.']
    for supplier in data['suppliers']:
        headings += [f"{supplier['name']}\nInicial", f"{supplier['name']}\nNegociado", f"{supplier['name']}\nDesc. %"]
    headings += ['VENCEDOR', 'VALOR FINAL', 'ECONOMIA']
    for col, value in enumerate(headings):
        sheet.write(4, col, value, st['header'])
    sheet.row(4).height_mismatch = True
    sheet.row(4).height = 760

    widths = [4200, 2600, 10500, 2200, 1800]
    for col, width in enumerate(widths):
        sheet.col(col).width = width
    for idx in range(supplier_count):
        base = 5 + idx * 3
        sheet.col(base).width = 3600
        sheet.col(base + 1).width = 3600
        sheet.col(base + 2).width = 2700
    end = 5 + supplier_count * 3
    sheet.col(end).width = 5200
    sheet.col(end + 1).width = 3600
    sheet.col(end + 2).width = 3400

    sheet.set_panes_frozen(True)
    sheet.set_horz_split_pos(5)
    sheet.set_vert_split_pos(3)

    for row, (item, comparison) in enumerate(zip(data['items'], result['lines']), 5):
        alt = row % 2 == 0
        plain = st['plain_alt'] if alt else st['plain']
        center = st['center_alt'] if alt else st['center']
        cash = st['cash_alt'] if alt else st['cash']
        percent = st['percent_alt'] if alt else st['percent']
        sheet.write(row, 0, item['company'], plain)
        sheet.write(row, 1, item['sci'], center)
        description = item['description']
        if item.get('purchase_type'):
            description += f"\nTipo: {item['purchase_type']}"
        if item.get('note'):
            description += f"\nObs.: {item['note']}"
        sheet.write(row, 2, description, plain)
        sheet.write(row, 3, float(Decimal(item['quantity'])), center)
        sheet.write(row, 4, item['unit'], center)

        chosen = comparison['chosen']
        for idx, supplier in enumerate(data['suppliers']):
            base = 5 + idx * 3
            quote = next((q for q in comparison['quotes'] if q['supplier_id'] == supplier['id']), None)
            if not quote:
                for off in range(3):
                    sheet.write(row, base + off, '', center)
                continue
            is_winner = bool(chosen and chosen['supplier_id'] == supplier['id'])
            if is_winner:
                sheet.write(row, base, float(Decimal(quote['initial_price'])), st['winner_cash'])
                sheet.write(row, base + 1, float(Decimal(quote['final_price'])), st['winner_cash'])
                sheet.write(row, base + 2, float(Decimal(quote['discount_percent']) / 100), st['winner_percent'])
            else:
                sheet.write(row, base, float(Decimal(quote['initial_price'])), cash)
                sheet.write(row, base + 1, float(Decimal(quote['final_price'])), cash)
                sheet.write(row, base + 2, float(Decimal(quote['discount_percent']) / 100), percent)

        result_col = 5 + supplier_count * 3
        state = chosen['supplier'] if chosen else ('EMPATE' if comparison['state'] == 'tie' else 'SEM COTAÇÃO')
        sheet.write(row, result_col, state, st['winner'] if chosen else plain)
        if chosen:
            sheet.write(row, result_col + 1, float(Decimal(chosen['net'])), st['winner_cash'])
            sheet.write(row, result_col + 2, float(Decimal(chosen['saving'])), st['winner_cash'])
        else:
            sheet.write(row, result_col + 1, '', cash)
            sheet.write(row, result_col + 2, '', cash)
        sheet.row(row).height_mismatch = True
        sheet.row(row).height = 640 if (item.get('note') or item.get('purchase_type')) else 420
    return sheet


def _build_detail_sheet(book, xlwt, data, result, st):
    sheet = book.add_sheet('Detalhado')
    _page_setup(sheet, fit_width=1 if len(data['suppliers']) <= 2 else 2, repeat_row=0)
    _call(sheet, 'set_header_str', f"&LVyzium · Detalhamento&R{data['name']}")
    sheet.set_panes_frozen(True)
    sheet.set_horz_split_pos(1)
    sheet.set_vert_split_pos(4)
    headings = ['HOTEL', 'SCI', 'COMPRADOR', 'DESCRIÇÃO DO ARTIGO', 'QUANTIDADE', 'UNIDADE', 'TIPO DE COMPRA', 'OBSERVAÇÃO']
    for supplier in data['suppliers']:
        headings += [f"{supplier['name']} — {label}" for label in ('Inicial unitário', 'Negociado unitário', 'Desconto %', 'Bruto R$', 'Economia R$', 'Final R$')]
    headings += ['VENCEDOR', 'VALOR FINAL R$', 'ECONOMIA R$']
    for col, value in enumerate(headings):
        sheet.write(0, col, value, st['header'])
        sheet.col(col).width = 5500 if col in (0, 2) else 4300
    sheet.col(3).width = 12000
    sheet.col(7).width = 10000
    sheet.row(0).height_mismatch = True
    sheet.row(0).height = 850

    for row, (item, comparison) in enumerate(zip(data['items'], result['lines']), 1):
        alt = row % 2 == 0
        plain = st['plain_alt'] if alt else st['plain']
        cash = st['cash_alt'] if alt else st['cash']
        percentage = st['percent_alt'] if alt else st['percent']
        values = [item['company'], item['sci'], item['buyer'], item['description'], float(Decimal(item['quantity'])),
                  item['unit'], item.get('purchase_type', ''), item.get('note', '')]
        for col, value in enumerate(values):
            sheet.write(row, col, value, plain)
        for idx, supplier in enumerate(data['suppliers']):
            quote = next((q for q in comparison['quotes'] if q['supplier_id'] == supplier['id']), None)
            if quote:
                values = [quote['initial_price'], quote['final_price'], str(Decimal(quote['discount_percent']) / 100),
                          quote['gross'], quote['saving'], quote['net']]
                for off, value in enumerate(values):
                    sheet.write(row, 8 + idx * 6 + off, float(Decimal(value)), percentage if off == 2 else cash)
        col = 8 + len(data['suppliers']) * 6
        chosen = comparison['chosen']
        sheet.write(row, col, chosen['supplier'] if chosen else ('EMPATE' if comparison['state'] == 'tie' else 'SEM COTAÇÃO'), st['winner'] if chosen else plain)
        if chosen:
            sheet.write(row, col + 1, float(Decimal(chosen['net'])), st['winner_cash'])
            sheet.write(row, col + 2, float(Decimal(chosen['saving'])), st['winner_cash'])
    return sheet


def _build_supplier_summary(book, xlwt, data, result, st):
    sheet = book.add_sheet('Resumo por fornecedor')
    _page_setup(sheet, fit_width=1, repeat_row=2)
    _call(sheet, 'set_header_str', f"&LVyzium · Resumo por fornecedor&R{data['name']}")
    sheet.write_merge(0, 0, 0, 3, f"RESUMO · {data['name']}", st['title'])
    sheet.write(1, 0, 'Mapa', st['subtitle'])
    sheet.write_merge(1, 1, 1, 3, data['name'], st['plain'])
    headings = ['Fornecedor', 'Itens vencedores', 'Total negociado', 'Economia']
    for col, value in enumerate(headings):
        sheet.write(2, col, value, st['header'])
    row = 3
    for supplier in result['suppliers']:
        if not supplier['won']:
            continue
        sheet.write(row, 0, supplier['name'], st['plain'])
        sheet.write(row, 1, supplier['won'], st['center'])
        sheet.write(row, 2, float(Decimal(supplier['net'])), st['cash'])
        sheet.write(row, 3, float(Decimal(supplier['saving'])), st['cash'])
        row += 1
    sheet.write(row, 0, 'TOTAL DEFINIDO', st['winner'])
    sheet.write(row, 1, sum(s['won'] for s in result['suppliers']), st['winner'])
    sheet.write(row, 2, float(Decimal(result['net'])), st['winner_cash'])
    sheet.write(row, 3, float(Decimal(result['saving'])), st['winner_cash'])
    row += 2
    sheet.write(row, 0, 'Itens sem cotação', st['subtitle'])
    sheet.write(row, 1, result['unquoted'], st['plain'])
    row += 1
    sheet.write(row, 0, 'Empates não resolvidos', st['subtitle'])
    sheet.write(row, 1, result['ties'], st['plain'])
    row += 1
    sheet.write(row, 0, 'Critério', st['subtitle'])
    sheet.write_merge(row, row, 1, 3, 'Menor preço negociado por item. Frete e condições de lote não incluídos.', st['plain'])
    for col, width in enumerate((9500, 5200, 6500, 6500)):
        sheet.col(col).width = width
    return sheet


def build_xls(data, result):
    import xlwt

    detailed_columns = 8 + len(data['suppliers']) * 6 + 3
    print_columns = 5 + len(data['suppliers']) * 3 + 3
    if max(detailed_columns, print_columns) > 256 or len(data['items']) + 6 > 65536:
        raise ValueError('O formato XLS aceita até 256 colunas e 65.536 linhas. Divida este mapa em mapas menores.')

    book = xlwt.Workbook(encoding='utf-8')
    st = _styles(xlwt)
    _build_print_sheet(book, xlwt, data, result, st)
    _build_detail_sheet(book, xlwt, data, result, st)
    _build_supplier_summary(book, xlwt, data, result, st)

    out = BytesIO()
    book.save(out)
    return out.getvalue()
