(function(root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => Number(value || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  const number = value => Number(value || 0).toLocaleString('pt-BR', {maximumFractionDigits:6});
  const percent = value => Number(value || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%';
  const searchText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const sum = (rows, key) => rows.reduce((total, row) => total + Math.round(Number(row[key] || 0) * 100), 0) / 100;
  const stateLabel = {winner:'Definido', tie:'Empate pendente', unquoted:'Sem cotação'};

  // Decisions and financial values come from the existing backend evaluator.
  // Hotel/supplier totals only aggregate those values in integer cents.
  function createModel(detail) {
    const map = detail.map, result = detail.result;
    const byId = new Map(result.lines.map(line => [line.id, line]));
    const items = map.items.map(item => ({...item, line:byId.get(item.id)}));
    const hotels = [...new Set(items.map(item => item.company))].map(name => {
      const rows = items.filter(item => item.company === name), chosen = rows.map(item => item.line.chosen).filter(Boolean);
      return {name, count:rows.length, defined:chosen.length, net:sum(chosen,'net'), saving:sum(chosen,'saving')};
    });
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
    return {map, result, items, hotels, suppliers, defined, completion:items.length ? Math.round(defined / items.length * 100) : 0};
  }
  function quoteRows(item) {
    const line = item.line;
    return [...line.quotes].sort((a,b) => Number(a.net) - Number(b.net)).map(quote => {
      const chosen = line.chosen?.supplier_id === quote.supplier_id;
      const best = (line.financial_winners || line.winners).some(winner => winner.supplier_id === quote.supplier_id);
      return `<tr class="${chosen?'qv-chosen-row':''}"><td><strong>${esc(quote.supplier)}</strong><small>${chosen?'Escolhido':best?(line.state==='tie'?'Menor preço · empate':'Menor preço'):'Proposta'}</small></td><td>${money(quote.initial_price)}</td><td>${money(quote.final_price)}</td><td><strong>${money(quote.net)}</strong></td><td>${money(quote.saving)}<small>${percent(quote.discount_percent)}</small></td><td>${esc(quote.delivery || 'Não informado')}</td></tr>`;
    }).join('');
  }
  function itemHtml(item, index, suppliers) {
    const line = item.line;
    const missing = suppliers.filter(supplier => !line.quotes.some(quote => quote.supplier_id === supplier.id));
    return `<article class="qv-item" data-qv-item="${esc(item.id)}">
      <header class="qv-item-head"><div><span class="qv-kicker">ITEM ${index+1} · ${esc(item.company)} · SCI ${esc(item.sci)}</span><h3>${esc(item.description)}</h3><p>${number(item.quantity)} ${esc(item.unit)}${item.article?' · Artigo '+esc(item.article):''}${item.buyer?' · '+esc(item.buyer):''}</p></div><span class="qv-state qv-state-${line.state}">${stateLabel[line.state]}</span></header>
      ${item.note || item.purchase_type?`<div class="qv-item-note">${item.purchase_type?`<strong>${esc(item.purchase_type)}</strong> · `:''}${esc(item.note)}</div>`:''}
      <div class="qv-decision"><div><small>${line.manual_selection?'Escolha operacional':'Proposta escolhida'}</small><strong>${esc(line.chosen?.supplier || (line.state==='tie'?'Escolha um fornecedor na edição do mapa':'Aguardando propostas'))}</strong>${line.selection_reason || line.selection_note?`<p>${esc(line.selection_reason)}${line.selection_note?' · '+esc(line.selection_note):''}</p>`:''}</div>${line.chosen?`<div class="qv-decision-value"><small>Total escolhido</small><strong>${money(line.chosen.net)}</strong>${Number(line.opportunity_cost)>0?`<span>+ ${money(line.opportunity_cost)} sobre o menor preço</span>`:''}</div>`:''}</div>
      ${line.quotes.length?`<div class="qv-table-scroll" tabindex="0" aria-label="Propostas para ${esc(item.description)}"><table class="qv-table"><thead><tr><th>Fornecedor</th><th>Inicial / un.</th><th>Final / un.</th><th>Total do item</th><th>Economia</th><th>Entrega</th></tr></thead><tbody>${quoteRows(item)}</tbody></table></div>`:'<p class="qv-empty">Nenhum preço informado para este item.</p>'}
      <footer class="qv-item-foot"><span>${line.quotes.length}/${suppliers.length} fornecedores cotaram</span>${line.target_price?`<span>Meta por unidade: ${money(line.target_price)}</span>`:''}${missing.length?`<span>Sem cotação: ${missing.map(supplier => esc(supplier.name)).join(', ')}</span>`:''}</footer>
    </article>`;
  }
  function summaryHtml(model) {
    const {result, hotels, suppliers, defined, items, completion} = model;
    return `<section class="qv-section"><div class="qv-section-title"><div><h3>Andamento do mapa</h3><p>${defined} de ${items.length} itens com fornecedor definido.</p></div><strong>${completion}%</strong></div><progress max="100" value="${completion}" aria-label="Conclusão do mapa"></progress>
      <div class="qv-status-grid"><div><small>Meta de economia</small><strong>${percent(result.saving_target_percent)}</strong></div><div><small>Economia atual</small><strong>${percent(result.saving_percent)}</strong></div><div><small>Falta para a meta</small><strong>${money(result.saving_target_gap)}</strong></div><div><small>Diferença por escolha operacional</small><strong>${money(result.opportunity_cost)}</strong></div></div>
      <p class="qv-explainer">Os totais consideram os fornecedores escolhidos. A economia compara seus preços iniciais e finais. Itens sem cotação e empates sem escolha ficam fora do total definido.</p>
      ${result.unquoted || result.ties?`<p class="qv-warning">${result.unquoted} itens sem cotação · ${result.ties} empates aguardando escolha.</p>`:'<p class="qv-success">Todos os itens têm fornecedor definido.</p>'}</section>
      <section class="qv-section"><h3>Por hotel</h3><div class="qv-hotel-grid">${hotels.map(hotel => `<article><h4>${esc(hotel.name)}</h4><p>${hotel.count} itens · ${hotel.defined} definidos</p><small>Total definido</small><strong>${money(hotel.net)}</strong><span>Economia ${money(hotel.saving)}</span></article>`).join('')}</div></section>
      <section class="qv-section"><h3>Distribuição da compra</h3><div class="qv-allocation">${suppliers.filter(supplier => supplier.awarded).map(supplier => `<div><span><strong>${esc(supplier.name)}</strong><small>${supplier.awarded} itens escolhidos</small></span><strong>${money(supplier.net)}</strong></div>`).join('') || '<p class="qv-empty">Nenhum fornecedor escolhido ainda.</p>'}</div></section>`;
  }
  function supplierHtml(supplier, count) {
    return `<article class="qv-section qv-supplier"><div class="qv-section-title"><div><h3>${esc(supplier.name)}</h3><p>${esc(supplier.phone || 'WhatsApp não cadastrado')}</p></div><span class="qv-state">${supplier.coverage}/${count} itens cotados</span></div>
      <div class="qv-status-grid"><div><small>Itens escolhidos</small><strong>${supplier.awarded}</strong></div><div><small>Total escolhido</small><strong>${money(supplier.net)}</strong></div><div><small>Economia dos escolhidos</small><strong>${money(supplier.saving)}</strong></div><div><small>Total das propostas (${supplier.coverage}/${count})</small><strong>${money(supplier.offerTotal)}</strong></div></div>
      <p class="qv-explainer">O total das propostas inclui somente os itens cotados por este fornecedor; coberturas diferentes não são comparáveis como um mapa completo.</p>
      ${supplier.offers.length?`<div class="qv-table-scroll" tabindex="0" aria-label="Itens cotados por ${esc(supplier.name)}"><table class="qv-table"><thead><tr><th>Item / hotel</th><th>Qtd.</th><th>Inicial / un.</th><th>Final / un.</th><th>Total</th><th>Entrega</th><th>Decisão</th></tr></thead><tbody>${supplier.offers.map(({item,quote,chosen}) => `<tr class="${chosen?'qv-chosen-row':''}"><td><strong>${esc(item.description)}</strong><small>${esc(item.company)} · SCI ${esc(item.sci)}</small></td><td>${number(item.quantity)} ${esc(item.unit)}</td><td>${money(quote.initial_price)}</td><td>${money(quote.final_price)}</td><td>${money(quote.net)}</td><td>${esc(quote.delivery || 'Não informado')}</td><td>${chosen?'Escolhido':'Não escolhido'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="qv-empty">Este fornecedor ainda não informou preços.</p>'}</article>`;
  }
  function open(detail, options = {}) {
    let model = createModel(detail), unsaved = Boolean(options.unsaved), saving = false, tab = 'summary';
    const previousFocus = options.returnFocus || document.activeElement, oldOverflow = document.body.style.overflow;
    const dialog = document.createElement('dialog');dialog.className = 'quotation-viewer';dialog.setAttribute('aria-labelledby','qv-title');
    const draw = () => {
      const {map, result, items} = model;
      dialog.innerHTML = `<header class="qv-header"><div><span class="qv-kicker">VYZIUM / VISUALIZAÇÃO DETALHADA</span><h2 id="qv-title">${esc(map.name)}</h2><p>${map.archived?'Mapa concluído':'Em cotação'}${map.urgent?' · Urgente':''} · ${items.length} itens · ${model.suppliers.length} fornecedores${map.due_date?' · Prazo '+esc(map.due_date.split('-').reverse().join('/')):''}</p></div><button type="button" class="button secondary" id="qv-close">Voltar ao mapa</button></header>
        ${unsaved?`<div class="qv-warning qv-unsaved"><div><strong>Há alterações não salvas na edição.</strong><span>Esta consulta mostra a última comparação salva. Seus campos em edição continuam preservados.</span></div><button type="button" class="button primary" id="qv-save">Salvar e atualizar</button></div>`:''}
        ${detail.changes?.length?`<div class="qv-warning">Atenção à reimportação: ${detail.changes.map(esc).join(' · ')}</div>`:''}<div class="qv-error hidden" role="alert"></div>
        <div class="qv-metrics"><div><small>Valor inicial dos escolhidos</small><strong>${money(result.gross)}</strong></div><div><small>Valor final dos escolhidos</small><strong>${money(result.net)}</strong></div><div><small>Economia obtida</small><strong>${money(result.saving)}</strong><span>${percent(result.saving_percent)}</span></div><div><small>Itens definidos</small><strong>${model.defined} <span>/ ${items.length}</span></strong></div></div>
        <nav class="qv-tabs" aria-label="Áreas da visualização"><button type="button" data-qv-tab="summary">Resumo</button><button type="button" data-qv-tab="items">Itens e propostas</button><button type="button" data-qv-tab="suppliers">Por fornecedor</button></nav>
        <div class="qv-body"><section data-qv-panel="summary">${summaryHtml(model)}</section>
        <section data-qv-panel="items" hidden><div class="qv-filters"><label>Buscar item ou SCI<input id="qv-search" type="search" placeholder="Descrição, SCI, artigo ou fornecedor" autocomplete="off"></label><label>Hotel<select id="qv-hotel"><option value="">Todos os hotéis</option>${model.hotels.map(hotel => `<option>${esc(hotel.name)}</option>`).join('')}</select></label><label>Situação<select id="qv-state"><option value="">Todas</option><option value="winner">Definidos</option><option value="tie">Empates pendentes</option><option value="unquoted">Sem cotação</option></select></label></div><p id="qv-count" role="status" aria-live="polite"></p><div id="qv-items"></div></section>
        <section data-qv-panel="suppliers" hidden>${model.suppliers.map(supplier => supplierHtml(supplier,items.length)).join('') || '<p class="qv-empty">Nenhum fornecedor cadastrado neste mapa.</p>'}</section></div>`;
      dialog.querySelector('#qv-close').addEventListener('click',() => dialog.close());
      const selectTab = value => {
        tab = value;dialog.querySelectorAll('[data-qv-tab]').forEach(button => {const active=button.dataset.qvTab === value;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');});
        dialog.querySelectorAll('[data-qv-panel]').forEach(panel => panel.hidden = panel.dataset.qvPanel !== value);
      };
      dialog.querySelectorAll('[data-qv-tab]').forEach(button => button.addEventListener('click',() => selectTab(button.dataset.qvTab)));
      const filter = () => {
        const query = searchText(dialog.querySelector('#qv-search').value), hotel = dialog.querySelector('#qv-hotel').value, state = dialog.querySelector('#qv-state').value;
        const rows = items.filter(item => (!hotel || item.company === hotel) && (!state || item.line.state === state) && (!query || searchText([item.description,item.sci,item.article,...item.line.quotes.map(quote=>quote.supplier)].join(' ')).includes(query)));
        dialog.querySelector('#qv-count').textContent = `${rows.length} de ${items.length} itens · Totais do mapa completo acima`;
        dialog.querySelector('#qv-items').innerHTML = rows.map(item => itemHtml(item,items.indexOf(item),model.suppliers)).join('') || '<p class="qv-empty">Nenhum item corresponde aos filtros.</p>';
      };
      dialog.querySelector('#qv-search').addEventListener('input',filter);
      dialog.querySelector('#qv-hotel').addEventListener('change',filter);dialog.querySelector('#qv-state').addEventListener('change',filter);
      dialog.querySelector('#qv-save')?.addEventListener('click',async event => {
        if(saving)return;saving=true;event.currentTarget.disabled=true;dialog.querySelector('#qv-close').disabled=true;
        try {const updated=await options.save();if(dialog.isConnected){detail=updated;model=createModel(updated);unsaved=false;draw();dialog.querySelector('[data-qv-tab="'+tab+'"]').focus();}}
        catch(error){if(dialog.isConnected){const warning=dialog.querySelector('.qv-error');warning.textContent=error.message || 'Não foi possível salvar. A comparação anterior continua disponível.';warning.classList.remove('hidden');dialog.querySelector('#qv-save').disabled=false;dialog.querySelector('#qv-close').disabled=false;}}
        finally {saving=false;}
      });
      selectTab(tab);filter();
    };
    dialog.addEventListener('cancel',event => {if(saving)event.preventDefault();});
    dialog.addEventListener('close',() => {dialog.remove();document.body.style.overflow=oldOverflow;const focus=previousFocus?.isConnected?previousFocus:document.querySelector('#view-map-detail');focus?.focus();});
    draw();document.body.appendChild(dialog);document.body.style.overflow='hidden';dialog.showModal();dialog.querySelector('#qv-close').focus();
    return dialog;
  }
  const viewer = {createModel, open};
  if(typeof module!=='undefined' && module.exports)module.exports=viewer;else root.QuotationViewer=viewer;
})(typeof globalThis!=='undefined'?globalThis:this);
