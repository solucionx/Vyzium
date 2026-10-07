/* Read-only purchase references. All amounts come from the imported snapshot. */
'use strict';
window.PurchaseHistory = (() => {
 const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const missing = value => value === null || value === undefined || value === '';
 const money = value => missing(value)?'Não informado':Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:6});
 const quantity = value => missing(value)?'Não informada':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:6});
 const date = value => value?value.slice(0,10).split('-').reverse().join('/'):'Não informada';
 const label = value => escape(value||'Não informado');
 const unitLabel = item => item.unit_basis==='sci'?'Unidade da SCI':'Unidade da OC';
 const priceUnit = item => item.unit_basis==='sci'?'unidade da OC não informada':'unidade da OC';
 const state = {q:'',company:'',supplier:'',status:'valid',page:0,id:'',detailPage:0};
 const params = extra => new URLSearchParams({q:state.q,company:state.company,supplier:state.supplier,status:state.status,...extra}).toString();
 const pageButtons = (data, scope) => data.total>data.page_size?`<div class="ph-pagination"><button type="button" class="button secondary" data-ph-page="${scope}" data-page="${data.page-1}" ${data.page===0?'disabled':''}>Anterior</button><span>Página ${data.page+1} de ${Math.ceil(data.total/data.page_size)}</span><button type="button" class="button secondary" data-ph-page="${scope}" data-page="${data.page+1}" ${(data.page+1)*data.page_size>=data.total?'disabled':''}>Próxima</button></div>`:'';
 const priceSource = value => value==='total_div_quantity'?'<small>Calculado: total ÷ quantidade</small>':value==='conflict'?'<small>Valores divergentes na planilha</small>':'';
 const receiptConflict = fields => {
  if(!Array.isArray(fields)||!fields.length)return '';
  const names={date:'data',invoice:'nota fiscal',quantity:'quantidade recebida',unit:'unidade recebida',price:'preço de entrada',total:'total de entrada'};
  return `<small class="ph-warning ph-receipt-warning">Dados divergentes: ${fields.map(f=>names[f]||f).join(', ')}.</small>`;
 };

 async function mount(container, {api}) {
  container.innerHTML=`<section class="panel ph-search-panel"><div class="ph-heading"><div><span class="section-kicker">REFERÊNCIAS DE COMPRA</span><h2>Consulte antes de comprar</h2><p class="muted">Pesquise um artigo e abra suas últimas OCs, preços e entradas na planilha importada.</p></div><span class="ph-readonly">Somente consulta</span></div><div class="ph-filters"><label class="ph-query">Código ou descrição do item<input id="ph-search" type="search" autocomplete="off" placeholder="Ex.: lâmpada, detergente ou código do artigo" value="${escape(state.q)}"></label><label>Hotel<select id="ph-company"><option value="">Todos os hotéis</option></select></label><label>Fornecedor<select id="ph-supplier"><option value="">Todos os fornecedores</option></select></label><label>Compras exibidas<select id="ph-status"><option value="valid">Sem itens cancelados</option><option value="received">Com entrada registrada</option><option value="all">Incluir itens cancelados</option></select></label></div><p id="ph-source" class="muted"></p></section><div class="ph-workspace"><section class="panel ph-results-panel"><div class="section-head"><h2>Itens encontrados</h2><span id="ph-count" class="muted" role="status" aria-live="polite"></span></div><div id="ph-results" aria-busy="true"></div></section><section class="panel ph-detail-panel" id="ph-detail" aria-label="Últimas compras do item"><div class="ph-empty"><span class="ph-empty-icon" aria-hidden="true">⌕</span><h2>Escolha um item</h2><p>Abra um resultado para consultar suas OCs e os recebimentos registrados.</p></div></section></div>`;
  const root = document.createElement('div');
  root.className='purchase-history';
  while(container.firstChild)root.appendChild(container.firstChild);
  container.appendChild(root);
  const $ = selector => root.querySelector(selector);
  $('#ph-status').value=state.status;
  let searchRequest=0, detailRequest=0, timer;
  const error = (element, message, retry) => {
   element.innerHTML=`<div class="ph-error" role="alert"><p>${escape(message||'Não foi possível consultar o histórico.')}</p><button type="button" class="button secondary">Tentar novamente</button></div>`;
   element.querySelector('button').addEventListener('click',retry);
  };
  const fillOptions = (selector, values, current, first) => {
   const choices=[...new Set([...values,...(current?[current]:[])])];
   $(selector).innerHTML=`<option value="">${first}</option>${choices.map(v=>`<option value="${escape(v)}" ${v===current?'selected':''}>${escape(v)}</option>`).join('')}`;
  };
  const emptyDetail = () => {$('#ph-detail').innerHTML='<div class="ph-empty"><h2>Escolha um item</h2><p>Abra um resultado para consultar suas últimas compras.</p></div>';};
  const bindPages = (element, scope, load) => element.querySelectorAll(`[data-ph-page="${scope}"]`).forEach(button=>button.addEventListener('click',()=>{state[scope==='results'?'page':'detailPage']=Number(button.dataset.page);load();}));
  async function loadDetail() {
   const id=state.id, request=++detailRequest;
   if(!id){emptyDetail();return;}
   $('#ph-detail').setAttribute('aria-busy','true');
   $('#ph-detail').innerHTML='<p class="muted" role="status">Carregando as últimas compras…</p>';
   try {
    const data=await api('GET','/purchase-history?'+params({id,page:state.detailPage}));
    if(!root.isConnected||request!==detailRequest||state.id!==id)return;
    const item=data.item, columns=data.source.columns||{};
    $('#ph-detail').innerHTML=`<div class="ph-item-heading"><span class="section-kicker">HISTÓRICO DO ITEM</span><h2>${escape(item.description)}</h2><p>Artigo ${label(item.article)} · ${unitLabel(item)}: <strong>${label(item.unit)}</strong></p><span class="ph-count-badge">${data.total} ${data.total===1?'ordem de compra':'ordens de compra'}</span></div><div class="ph-explanation"><strong>Preço da OC</strong> é a referência principal de valor. <strong>NF da entrada</strong>, data e quantidade vêm do recebimento registrado. O preço de entrada só é mostrado quando a planilha traz um campo explícito de entrada/recebimento.${!columns.receipt_price&&!columns.receipt_total?' Nesta base, use o valor unitário da OC junto da nota fiscal registrada na entrada.':''}</div><p class="muted">Mais recentes primeiro, pela data da OC. Na ausência dela, usamos a data de entrada e indicamos isso. OCs sem data ficam por último.</p><div class="ph-orders">${data.orders.map(order=>`<article class="ph-order" data-ph-order="${escape(order.order_id)}"><div class="ph-order-head"><h3>OC ${escape(order.oc)}</h3><span>${date(order.sort_date)}${order.date_basis==='receipt'?'<small>Data da entrada · OC sem data</small>':order.date_basis==='missing'?'<small>Sem data para ordenar</small>':'<small>Data da OC</small>'}</span></div><div class="ph-order-parties"><div><small>Hotel</small><strong>${label(order.company)}</strong></div><div><small>Fornecedor</small><strong>${label(order.supplier)}</strong></div></div>${order.lines.map(line=>`<div class="ph-order-line" data-ph-line="${escape(line.id)}"><div class="ph-line-caption"><span>SCI ${label(line.sci)} · ${label(line.description)}</span>${line.cancelled?'<span class="ph-cancelled">Item cancelado</span>':''}</div><div class="ph-values"><div><small>Quantidade da OC</small><strong>${quantity(line.quantity)} ${line.unit_basis==='sci'?'(unidade da OC não informada)':escape(line.unit)}</strong></div><div><small>Preço unitário da OC</small><strong>${money(line.order_price)}</strong>${priceSource(line.price_source)}</div><div><small>Total do item na OC</small><strong>${money(line.order_total)}</strong></div></div>${line.conflicts.length?'<p class="ph-warning">Existem campos divergentes nas linhas da planilha. Os valores afetados ficam sem referência até a base ser conferida.</p>':''}<div class="ph-receipts"><h4>Entradas registradas <span>${line.receipts.length}</span></h4>${line.receipts.length?`<div class="ph-receipt-table"><table><thead><tr><th>Data / nota fiscal</th><th>Qtd. recebida / unidade</th><th>Preço unitário de entrada</th><th>Total de entrada</th></tr></thead><tbody>${line.receipts.map(receipt=>`<tr data-ph-receipt="${escape(receipt.id)}"><td>${date(receipt.date)}<small>NF ${label(receipt.invoice)}</small>${receiptConflict(receipt.conflicts)}</td><td>${quantity(receipt.quantity)}<small>${label(receipt.unit)}</small></td><td><strong>${money(receipt.price)}</strong>${priceSource(receipt.price_source)}</td><td>${money(receipt.total)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Nenhum recebimento informado para este item da OC.</p>'}</div></div>`).join('')}</article>`).join('')}</div>${pageButtons(data,'detail')}`;
    bindPages($('#ph-detail'),'detail',loadDetail);
   } catch(e) {if(root.isConnected&&request===detailRequest)error($('#ph-detail'),e.message,loadDetail);}
   finally {if(root.isConnected&&request===detailRequest)$('#ph-detail').setAttribute('aria-busy','false');}
  }
  async function loadSearch() {
   const request=++searchRequest;
   $('#ph-results').setAttribute('aria-busy','true');$('#ph-count').textContent='Pesquisando…';
   try {
    const data=await api('GET','/purchase-history?'+params({page:state.page}));
    if(!root.isConnected||request!==searchRequest)return;
    fillOptions('#ph-company',data.companies,state.company,'Todos os hotéis');
    fillOptions('#ph-supplier',data.suppliers,state.supplier,'Todos os fornecedores');
    const source=data.source;
    $('#ph-source').textContent=source.available?`Base: ${source.filename} · Importada em ${date(source.at)} · ${source.orders||0} OCs na planilha. O histórico corresponde a esta importação.`:'Importe novamente a BASE SCI para carregar as OCs no novo módulo.';
    $('#ph-count').textContent=`${data.total} ${data.total===1?'item':'itens'}`;
    $('#ph-results').innerHTML=data.items.length?`<div class="ph-item-list">${data.items.map(item=>`<button type="button" class="ph-item" data-ph-item="${escape(item.id)}" aria-pressed="${state.id===item.id}"><span class="ph-item-code">Artigo ${label(item.article)} · ${item.unit_basis==='sci'?'SCI: ':''}${label(item.unit)}</span><strong>${escape(item.description)}</strong><span class="ph-item-meta">${item.orders} ${item.orders===1?'OC':'OCs'} · Última referência: ${date(item.latest.sort_date)}</span><span class="ph-item-price">${money(item.latest.order_price)} <small>/ ${priceUnit(item)}</small></span><span class="ph-item-open">Ver compras →</span></button>`).join('')}</div>${pageButtons(data,'results')}`:`<div class="ph-empty"><h3>${source.available?'Nenhum item encontrado':'Histórico ainda não carregado'}</h3><p>${source.available?'Confira a pesquisa e os filtros. Somente OCs presentes na planilha importada aparecem aqui.':'Use Importar BASE SCI. Os mapas salvos serão preservados.'}</p></div>`;
    $('#ph-results').querySelectorAll('[data-ph-item]').forEach(button=>button.addEventListener('click',()=>{
     state.id=button.dataset.phItem;state.detailPage=0;
     $('#ph-results').querySelectorAll('[data-ph-item]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
     loadDetail();
    }));
    bindPages($('#ph-results'),'results',()=>{state.id='';++detailRequest;emptyDetail();loadSearch();});
    if(state.id&&!data.items.some(i=>i.id===state.id)){state.id='';++detailRequest;emptyDetail();}
   } catch(e) {if(root.isConnected&&request===searchRequest){$('#ph-count').textContent='Consulta indisponível';error($('#ph-results'),e.message,loadSearch);}}
   finally {if(root.isConnected&&request===searchRequest)$('#ph-results').setAttribute('aria-busy','false');}
  }
  function changed() {
   clearTimeout(timer);state.page=0;state.id='';++detailRequest;++searchRequest;emptyDetail();
   $('#ph-results').setAttribute('aria-busy','true');$('#ph-count').textContent='Pesquisando…';
   $('#ph-results').innerHTML='<p class="muted">Consultando os itens…</p>';
   state.q=$('#ph-search').value;state.company=$('#ph-company').value;state.supplier=$('#ph-supplier').value;state.status=$('#ph-status').value;
  }
  $('#ph-search').addEventListener('input',()=>{changed();timer=setTimeout(()=>{if(root.isConnected)loadSearch();},250);});
  for(const selector of ['#ph-company','#ph-supplier','#ph-status'])$(selector).addEventListener('change',()=>{changed();loadSearch();});
  await loadSearch();
  if(root.isConnected&&state.id)await loadDetail();
 }
 return {mount};
})();
