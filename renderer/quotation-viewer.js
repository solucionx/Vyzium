(function(root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => Number(value || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  const number = value => Number(value || 0).toLocaleString('pt-BR', {maximumFractionDigits:6});
  const searchText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const sum = (rows, key) => rows.reduce((total, row) => total + Math.round(Number(row[key] || 0) * 100), 0) / 100;
  const stateLabel = {winner:'Definido', tie:'Empate', unquoted:'Sem cotação'};

  // Decisions and financial values come from the existing backend evaluator.
  // The viewer only reorganizes those values into a spreadsheet-style read-only matrix.
  function createModel(detail) {
    const map = detail.map, result = detail.result;
    const byId = new Map(result.lines.map(line => [line.id, line]));
    const items = map.items.map(item => ({...item, line:byId.get(item.id)}));
    const hotels = [...new Set(items.map(item => item.company))];
    const suppliers = map.suppliers.map(supplier => {
      const offers = items.flatMap(item => {
        const quote = item.line.quotes.find(quote => quote.supplier_id === supplier.id);
        return quote ? [{item, quote, chosen:item.line.chosen?.supplier_id === supplier.id}] : [];
      });
      const awarded = offers.filter(offer => offer.chosen).map(offer => offer.quote);
      return {...supplier, offers, coverage:offers.length, awarded:awarded.length,
        offerTotal:sum(offers.map(offer => offer.quote),'net'), net:sum(awarded,'net'), saving:sum(awarded,'saving')};
    });
    const defined = items.filter(item => item.line.chosen).length;
    return {map, result, items, hotels, suppliers, defined};
  }

  function supplierCell(item, supplier) {
    const line = item.line;
    const quote = line.quotes.find(candidate => candidate.supplier_id === supplier.id);
    if(!quote)return '<span class="qv-no-quote">—</span><small>Sem cotação</small>';
    const chosen = line.chosen?.supplier_id === supplier.id;
    const best = (line.financial_winners || line.winners).some(winner => winner.supplier_id === supplier.id);
    return `<div class="qv-price-cell ${chosen?'is-chosen':''} ${best?'is-best':''}">
      <div class="qv-price-main"><strong>${money(quote.final_price)}</strong><span>/ un.</span></div>
      <small>Inicial: ${money(quote.initial_price)}</small>
      <small>Total: ${money(quote.net)}</small>
      <small>Entrega: ${esc(quote.delivery || 'Não informado')}</small>
      <div class="qv-cell-tags">${chosen?'<span class="qv-cell-tag chosen">Escolhido</span>':''}${best?`<span class="qv-cell-tag best">${line.state==='tie'?'Menor · empate':'Menor preço'}</span>`:''}</div>
    </div>`;
  }

  function matrixHtml(model, rows) {
    const {suppliers} = model;
    if(!rows.length)return '<p class="qv-empty">Nenhum item corresponde aos filtros.</p>';
    return `<div class="qv-sheet-scroll" tabindex="0" aria-label="Planilha de comparação do mapa">
      <table class="qv-sheet">
        <thead><tr>
          <th class="qv-sticky qv-col-hotel">Hotel</th>
          <th class="qv-sticky qv-col-sci">SCI</th>
          <th class="qv-sticky qv-col-item">Item</th>
          <th class="qv-col-qty">Qtd.</th>
          ${suppliers.map(supplier=>`<th class="qv-supplier-head"><strong>${esc(supplier.name)}</strong><small>${supplier.coverage}/${model.items.length} itens cotados</small></th>`).join('')}
          <th class="qv-col-choice">Fornecedor escolhido</th>
          <th class="qv-col-total">Total escolhido</th>
        </tr></thead>
        <tbody>${rows.map(item=>`<tr data-qv-item="${esc(item.id)}">
          <td class="qv-sticky qv-col-hotel"><strong>${esc(item.company)}</strong></td>
          <td class="qv-sticky qv-col-sci"><strong>${esc(item.sci)}</strong></td>
          <td class="qv-sticky qv-col-item"><strong>${esc(item.description)}</strong><small>${item.article?'Artigo '+esc(item.article)+' · ':''}${item.buyer?esc(item.buyer):''}${item.purchase_type?' · '+esc(item.purchase_type):''}</small>${item.note?`<small class="qv-note">${esc(item.note)}</small>`:''}</td>
          <td class="qv-col-qty">${number(item.quantity)}<small>${esc(item.unit)}</small></td>
          ${suppliers.map(supplier=>`<td class="qv-supplier-cell">${supplierCell(item,supplier)}</td>`).join('')}
          <td class="qv-col-choice"><span class="qv-state qv-state-${item.line.state}">${stateLabel[item.line.state]}</span><strong>${esc(item.line.chosen?.supplier || '—')}</strong>${item.line.selection_reason?`<small>${esc(item.line.selection_reason)}</small>`:''}${item.line.selection_note?`<small class="qv-choice-note">${esc(item.line.selection_note)}</small>`:''}</td>
          <td class="qv-col-total"><strong>${item.line.chosen?money(item.line.chosen.net):'—'}</strong>${item.line.chosen?`<small>Economia ${money(item.line.chosen.saving)}</small>`:''}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td class="qv-sticky qv-sheet-total" colspan="3"><strong>Totais do mapa completo</strong><small>Não mudam com os filtros · somatório apenas dos itens cotados em cada fornecedor.</small></td>
          <td></td>
          ${suppliers.map(supplier=>`<td><strong>${money(supplier.offerTotal)}</strong><small>${supplier.coverage}/${model.items.length} itens</small></td>`).join('')}
          <td><strong>${model.defined}/${model.items.length} definidos</strong></td>
          <td><strong>${money(model.result.net)}</strong></td>
        </tr></tfoot>
      </table>
    </div>`;
  }

  function open(detail, options = {}) {
    let model = createModel(detail), unsaved = Boolean(options.unsaved), saving = false;
    const previousFocus = options.returnFocus || document.activeElement, oldOverflow = document.body.style.overflow;
    const dialog = document.createElement('dialog');dialog.className = 'quotation-viewer';dialog.setAttribute('aria-labelledby','qv-title');
    const draw = () => {
      const {map, items} = model;
      dialog.innerHTML = `<header class="qv-header"><div><span class="qv-kicker">VYZIUM / VISUALIZAÇÃO DETALHADA</span><h2 id="qv-title">${esc(map.name)}</h2><p>${map.archived?'Mapa concluído':'Em cotação'}${map.urgent?' · Urgente':''} · ${items.length} itens · ${model.suppliers.length} fornecedores${map.due_date?' · Prazo '+esc(map.due_date.split('-').reverse().join('/')):''}</p></div><button type="button" class="button secondary" id="qv-close">Voltar ao mapa</button></header>
        ${unsaved?`<div class="qv-warning qv-unsaved"><div><strong>Há alterações não salvas na edição.</strong><span>Esta planilha mostra a última comparação salva. Seus campos em edição continuam preservados.</span></div><button type="button" class="button primary" id="qv-save">Salvar e atualizar</button></div>`:''}
        ${detail.changes?.length?`<div class="qv-warning">Atenção à reimportação: ${detail.changes.map(esc).join(' · ')}</div>`:''}<div class="qv-error hidden" role="alert"></div>
        <div class="qv-sheet-toolbar">
          <div class="qv-filters"><label>Buscar item, SCI ou fornecedor<input id="qv-search" type="search" placeholder="Descrição, SCI, artigo ou fornecedor" autocomplete="off"></label><label>Hotel<select id="qv-hotel"><option value="">Todos os hotéis</option>${model.hotels.map(hotel => `<option>${esc(hotel)}</option>`).join('')}</select></label><label>Situação<select id="qv-state"><option value="">Todas</option><option value="winner">Definidos</option><option value="tie">Empates</option><option value="unquoted">Sem cotação</option></select></label></div>
          <div class="qv-sheet-help"><strong>Comparação por fornecedor</strong><span>Preço em destaque = valor final por unidade. Cada célula também mostra valor inicial, total do item e entrega.</span></div>
        </div>
        <p id="qv-count" role="status" aria-live="polite"></p>
        <div id="qv-sheet-host" class="qv-sheet-host"></div>`;
      dialog.querySelector('#qv-close').addEventListener('click',() => dialog.close());
      const filter = () => {
        const query = searchText(dialog.querySelector('#qv-search').value), hotel = dialog.querySelector('#qv-hotel').value, state = dialog.querySelector('#qv-state').value;
        const rows = items.filter(item => (!hotel || item.company === hotel) && (!state || item.line.state === state) && (!query || searchText([item.description,item.sci,item.article,item.buyer,item.company,...item.line.quotes.map(quote=>quote.supplier)].join(' ')).includes(query)));
        dialog.querySelector('#qv-count').textContent = `${rows.length} de ${items.length} itens exibidos · ${model.suppliers.length} fornecedores · Totais do rodapé = mapa completo`;
        dialog.querySelector('#qv-sheet-host').innerHTML = matrixHtml(model,rows);
      };
      dialog.querySelector('#qv-search').addEventListener('input',filter);
      dialog.querySelector('#qv-hotel').addEventListener('change',filter);dialog.querySelector('#qv-state').addEventListener('change',filter);
      dialog.querySelector('#qv-save')?.addEventListener('click',async event => {
        if(saving)return;saving=true;event.currentTarget.disabled=true;dialog.querySelector('#qv-close').disabled=true;
        try {const updated=await options.save();if(dialog.isConnected){detail=updated;model=createModel(updated);unsaved=false;draw();dialog.querySelector('#qv-search')?.focus();}}
        catch(error){if(dialog.isConnected){const warning=dialog.querySelector('.qv-error');warning.textContent=error.message || 'Não foi possível salvar. A comparação anterior continua disponível.';warning.classList.remove('hidden');dialog.querySelector('#qv-save').disabled=false;dialog.querySelector('#qv-close').disabled=false;}}
        finally {saving=false;}
      });
      filter();
    };
    dialog.addEventListener('cancel',event => {if(saving)event.preventDefault();});
    dialog.addEventListener('close',() => {dialog.remove();document.body.style.overflow=oldOverflow;const focus=previousFocus?.isConnected?previousFocus:document.querySelector('#view-map-detail');focus?.focus();});
    draw();document.body.appendChild(dialog);document.body.style.overflow='hidden';dialog.showModal();dialog.querySelector('#qv-close').focus();
    return dialog;
  }
  const viewer = {createModel, open};
  if(typeof module!=='undefined' && module.exports)module.exports=viewer;else root.QuotationViewer=viewer;
})(typeof globalThis!=='undefined'?globalThis:this);
