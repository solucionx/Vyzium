'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl = v => Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const qty = v => Number(v).toLocaleString('pt-BR',{maximumFractionDigits:6});
const statusLabel = {pending:'Pendente',quoting:'Em cotação',approved:'Aprovada',waiting:'Aguardando aprovação'};
let currentView = 'items', catalog = [], selected = new Set(), page = 0, ui = {filters:{}}, activeMap = null, dirty = false, sending = false, mapListScope = 'active', mapSearch = '';
let filtered = [], importReport = null, previewData = null, toastTimer, savingSettings = Promise.resolve();
function toast(message) {$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),6500);}
async function api(method,route,body) {try{return await window.followup.api(method,route,body);}catch(e){toast(e.message);throw e;}}
function on(el,event,fn) {el.addEventListener(event, e=>Promise.resolve().then(()=>fn(e)).catch(err=>{const message=err?.message||String(err||'Erro inesperado.');try{window.followup?.logRendererError?.({page:'compras',message,stack:err?.stack||''});}catch(_){};toast(message);}));}
function persist() {const snapshot=JSON.parse(JSON.stringify(ui));savingSettings=savingSettings.catch(()=>{}).then(()=>api('POST','/settings',snapshot));return savingSettings;}
function closeModal() {if(sending||$('#order-modal').classList.contains('hidden'))return;stopWhatsAppPanel();$('#order-modal').classList.add('hidden');}
function modal(html) {$('#modal-content').innerHTML=html;const title=$('#modal-content h2');if(title)title.id='modal-title';$('#order-modal').classList.remove('hidden');$('#modal-content').querySelector('input,button,select')?.focus();}
on($('#modal-close'),'click',closeModal);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Tab'&&!$('#order-modal').classList.contains('hidden')){const a=[...$('#order-modal').querySelectorAll('button:not(:disabled),input,select,textarea')];if(e.shiftKey&&document.activeElement===a[0]){e.preventDefault();a.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===a.at(-1)){e.preventDefault();a[0].focus();}}});
// Electron cancels main-process navigation (window.loadFile) whenever a
// beforeunload handler calls preventDefault, and shows no dialog. Any screen
// change already confirmed through vyziumBeforeNavigateAway must therefore be
// allowed through, or the renderer would stay put while the main process
// believed the module had changed.
let navigationConfirmed = false;
window.addEventListener('beforeunload',e=>{if(!navigationConfirmed&&(dirty||sending)){e.preventDefault();e.returnValue='';}});
function today() {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function days(i) {return PurchaseModel.days(i,today());}
function dateLabel(v) {return v?v.split('-').reverse().join('/'):'Não informada';}
function deadline(i) {const d=days(i);return d===null?'Sem data':d<0?`${-d} dias em atraso`:d===0?'Hoje':`Em ${d} dias`;}
function leaveMapDialog(destination) {
 return new Promise(resolve=>{
  const overlay=document.createElement('div');
  overlay.className='modal leave-map-modal';
  overlay.innerHTML=`<div class="modal-card leave-map-card" role="dialog" aria-modal="true" aria-labelledby="leave-map-title">
    <div class="leave-map-icon">!</div>
    <h2 id="leave-map-title">Mapa com alterações não salvas</h2>
    <p>Você está saindo para <strong>${esc(destination)}</strong>. Deseja salvar as alterações deste mapa antes de continuar?</p>
    <div class="leave-map-actions">
      <button type="button" class="button primary" data-leave-action="save">Salvar e continuar</button>
      <button type="button" class="button secondary" data-leave-action="discard">Descartar e continuar</button>
      <button type="button" class="button secondary" data-leave-action="cancel">Cancelar</button>
    </div>
  </div>`;
  const finish=value=>{document.removeEventListener('keydown',onKey);overlay.remove();resolve(value);};
  const onKey=e=>{if(e.key==='Escape')finish('cancel');};
  overlay.addEventListener('click',e=>{if(e.target===overlay)finish('cancel');});
  overlay.querySelectorAll('[data-leave-action]').forEach(button=>button.addEventListener('click',()=>finish(button.dataset.leaveAction)));
  document.addEventListener('keydown',onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('[data-leave-action="save"]')?.focus();
 });
}
async function confirmUnsavedMap(destination) {
 if(sending){toast('Aguarde o envio terminar antes de sair do mapa.');return false;}
 if(!dirty)return true;
 const action=await leaveMapDialog(destination);
 if(action==='cancel')return false;
 if(action==='discard'){dirty=false;return true;}
 if(action==='save'){
  try{await saveMap();return true;}
  catch(_){toast('Não foi possível salvar o mapa. A troca de tela foi cancelada.');return false;}
 }
 return false;
}
window.vyziumBeforeNavigateAway=async context=>{
 const destination=context?.type==='module'&&context?.target==='followup'?'Acompanhamento'
  :context?.type==='home'?'Visão geral'
  :context?.type==='logout'?'a tela de acesso'
  :'outra tela';
 const allowed=await confirmUnsavedMap(destination);
 if(allowed)navigationConfirmed=true;
 return allowed;
};
async function navigate(view) {
 const labels={dashboard:'Dashboard',items:'Itens a comprar',maps:'Mapas de compra',history:'Histórico',settings:'Configurações'};
 if(!(await confirmUnsavedMap(labels[view]||'outra tela')))return;
 dirty=false;stopWhatsAppPanel();currentView=view;
 document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 $('#view-title').textContent=({dashboard:'Dashboard de itens',items:'Itens a comprar',maps:'Mapas de compra',history:'Histórico de cotações',settings:'Configurações',map:'Mapa de compra'})[view];
 if(view==='dashboard'||view==='items')await renderItems();if(view==='maps')await renderMaps();if(view==='history')await renderHistory();if(view==='settings')await renderSettings();
}
document.querySelectorAll('.nav-item').forEach(b=>on(b,'click',()=>navigate(b.dataset.view)));
on($('#import-button'),'click',async()=>{
 if(dirty||sending){toast('Salve o mapa e aguarde o envio antes de importar.');return;}
 const path=await window.followup.chooseWorkbook();if(!path)return;
 $('#import-button').disabled=true;$('#import-button').textContent='Importando…';
 try{const r=await api('POST','/import',{path});toast(`${r.eligible} itens elegíveis importados. Mapas existentes preservados.`);selected.clear();await navigate('items');}
 finally{$('#import-button').disabled=false;$('#import-button').textContent='Importar BASE SCI';}
});
const filterSpecs=[['buyer','Comprador'],['company','Hotel'],['group','Grupo'],['status','Atendimento'],['approval','Aprovação'],['deadline','Prazo'],['control','Controle'],['search','Buscar SCI, artigo ou descrição']];
function filterOptions(key) {
 if(['buyer','company','group'].includes(key))return [...new Set(catalog.map(i=>i[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(v=>[v,v]);
 return ({status:[['pending','Pendente'],['quoting','Em cotação']],approval:[['approved','Aprovada'],['waiting','Aguardando aprovação']],deadline:[['on_time','No prazo'],['overdue','Em atraso'],['soon','Próximos 3 dias'],['future','Após 3 dias'],['none','Sem data'],['urgent','Urgente']],control:[['available','Sem mapa ativo'],['mapped','Em mapa ativo']]})[key]||[];
}
async function renderItems() {
 const data=await api('GET','/items');catalog=data.items;importReport=data.import;for(const k of ['buyer','company','group']){if(ui.filters[k]&&!catalog.some(i=>i[k]===ui.filters[k]))delete ui.filters[k];}
 $('#content').innerHTML=`<div id="catalog-summary"></div>
 <section class="panel"><div class="section-head"><div><h2>${currentView==='dashboard'?'Linhas de itens em aberto por hotel':'Controle de itens a comprar'}</h2><p class="muted">Pendentes e em cotação, sem OC. Cancelados, reprovados e atendidos ficam fora desta lista.</p></div></div>
 <div class="filters-grid">${filterSpecs.map(([k,label])=>`<label>${label}${k==='search'?`<input id="filter-${k}" value="${esc(ui.filters[k]||'')}" placeholder="Digite para localizar…">`:`<select id="filter-${k}"><option value="">Todos</option>${filterOptions(k).map(([v,t])=>`<option value="${esc(v)}" ${ui.filters[k]===v?'selected':''}>${esc(t)}</option>`).join('')}</select>`}</label>`).join('')}</div>
 <div class="toolbar ${currentView==='dashboard'?'hidden':''}"><button id="create-map" class="button primary">Montar mapa com selecionados</button><button id="select-visible" class="button secondary">Selecionar filtrados disponíveis</button><button id="clear-select" class="button secondary">Limpar seleção</button><span id="selection-count" class="count"></span></div>
 <p class="muted">${importReport?`Última importação: ${esc(importReport.filename)} · ${dateLabel(importReport.at.slice(0,10))} · ${importReport.rows.toLocaleString('pt-BR')} linhas analisadas.`:'Importe sua BASE SCI para começar.'}</p>
 <div id="items-table"></div></section>`;
 filterSpecs.forEach(([k])=>on($('#filter-'+k),k==='search'?'input':'change',()=>{ui.filters[k]=$('#filter-'+k).value;page=0;selected.clear();drawItems();return persist();}));
 on($('#select-visible'),'click',()=>{filtered.filter(i=>!i.maps.length).forEach(i=>selected.add(i.id));drawItems();});
 on($('#clear-select'),'click',()=>{selected.clear();drawItems();});
 on($('#create-map'),'click',createMapDialog);drawItems();
}
function drawItems() {
 const f=ui.filters;filtered=catalog.filter(i=>PurchaseModel.matches(i,f,today()));
 if(currentView==='dashboard'){drawDashboard();return;}
 const sort=ui.sort||{key:'needed',direction:1};filtered.sort((a,b)=>{const av=a[sort.key],bv=b[sort.key];if(!av&&bv)return 1;if(av&&!bv)return -1;return String(av??'').localeCompare(String(bv??''),'pt-BR',{numeric:true})*sort.direction;});
 const cols=[['needed','Prazo (12 dias)'],['company','Hotel'],['sci','SCI'],['description','Item'],['quantity','Quantidade'],['buyer','Comprador'],['status','Atendimento'],['approval','Aprovação'],['maps','Controle']];
 $('#catalog-summary').innerHTML=`<div class="summary-grid"><div class="metric"><small>Itens neste filtro</small><strong>${filtered.length}</strong></div><div class="metric"><small>SCIs em aberto neste filtro</small><strong>${PurchaseModel.summarize(filtered,today()).total}</strong></div><div class="metric"><small>SCIs atrasadas neste filtro</small><strong>${PurchaseModel.summarize(filtered,today()).overdue}</strong></div><div class="metric"><small>Itens em mapas ativos</small><strong>${filtered.filter(i=>i.maps.length).length}</strong></div></div>`;
 const totalPages=Math.max(1,Math.ceil(filtered.length/60));page=Math.min(page,totalPages-1);
 $('#items-table').innerHTML=`<div class="purchase-table"><table><thead><tr><th>Selecionar</th>${cols.map(([k,label])=>`<th><button data-sort="${k}">${label} ${sort.key===k?(sort.direction===1?'▲':'▼'):''}</button></th>`).join('')}</tr></thead><tbody>${filtered.slice(page*60,page*60+60).map(i=>`<tr class="${days(i)!==null&&days(i)<0?'overdue':days(i)!==null&&days(i)<=3?'soon':''}"><td><input aria-label="Selecionar SCI ${esc(i.sci)} item ${esc(i.description)}" type="checkbox" data-id="${esc(i.id)}" ${selected.has(i.id)?'checked':''} ${i.maps.length?'disabled':''}></td><td>${esc(deadline(i))}<small>Limite: ${dateLabel(i.needed)}<br>Aprovação: ${dateLabel(i.approved_at)}</small>${i.urgent?'<span class="badge action-urgent">Urgente</span>':''}</td><td>${esc(i.company)}</td><td><strong>${esc(i.sci)}</strong></td><td class="description">${esc(i.description)}<small>${esc(i.article)} · ${esc(i.group)}</small></td><td>${qty(i.quantity)} ${esc(i.unit)}</td><td>${esc(i.buyer)}</td><td><span class="badge action-normal">${statusLabel[i.status]}</span></td><td><span class="badge ${i.approval==='approved'?'approval-approved':'approval-waiting'}">${statusLabel[i.approval]}</span></td><td>${i.maps.length?`<span class="badge action-attention">${i.maps.map(esc).join(', ')}</span>`:'Disponível'}</td></tr>`).join('')||'<tr><td colspan="10" class="empty-state">Nenhum item neste filtro.</td></tr>'}</tbody></table></div><div class="pagination"><button id="prev" class="button secondary" ${page===0?'disabled':''}>Anterior</button><span>${filtered.length} itens · Página ${page+1}/${totalPages}</span><button id="next" class="button secondary" ${page+1===totalPages?'disabled':''}>Próxima</button></div>`;
 $('#selection-count').textContent=`${selected.size} selecionados`;$('#create-map').disabled=!selected.size;
 document.querySelectorAll('[data-id]').forEach(el=>on(el,'change',()=>{el.checked?selected.add(el.dataset.id):selected.delete(el.dataset.id);$('#selection-count').textContent=`${selected.size} selecionados`;$('#create-map').disabled=!selected.size;}));
 document.querySelectorAll('[data-sort]').forEach(el=>on(el,'click',()=>{ui.sort={key:el.dataset.sort,direction:sort.key===el.dataset.sort?-sort.direction:1};drawItems();return persist();}));
 on($('#prev'),'click',()=>{page--;drawItems();});on($('#next'),'click',()=>{page++;drawItems();});
}
function drawDashboard() {
 const r=PurchaseModel.summarizeLines(filtered,today());
 const specs=[['total','Total de linhas / itens'],['on_time','Itens no prazo'],['overdue','Itens atrasados'],['none','Itens sem prazo']];
 $('#catalog-summary').innerHTML=`<div class="summary-grid">${specs.map(([key,label])=>`<button class="metric dashboard-card" data-slice="${key}" data-hotel="${esc(ui.filters.company||'')}"><small>${label}</small><strong>${r[key]}</strong></button>`).join('')}</div>`;
 $('#items-table').innerHTML=`<p class="muted">${r.total} linhas de itens, distribuídas em ${r.scis} SCIs no filtro. Cada linha conta como um item, independentemente da quantidade de unidades solicitadas. Pendentes e em cotação sem OC. Prazo: 12 dias corridos após a aprovação; o dia limite ainda está no prazo.</p><div class="purchase-table"><table><thead><tr><th>Hotel</th><th>Total de linhas / itens</th><th>No prazo</th><th>Atrasadas</th><th>Sem prazo</th></tr></thead><tbody>${r.hotels.map(h=>`<tr><td><strong>${esc(h.company)}</strong></td>${['total','on_time','overdue','none'].map(k=>`<td><button class="dashboard-count" data-slice="${k}" data-hotel="${esc(h.company)}">${h[k]}</button></td>`).join('')}</tr>`).join('')||'<tr><td colspan="5">Nenhum item neste filtro.</td></tr>'}</tbody></table></div>`;
 document.querySelectorAll('[data-slice]').forEach(el=>on(el,'click',async()=>{ui.filters.company=el.dataset.hotel;ui.filters.deadline=el.dataset.slice==='total'?'':el.dataset.slice;selected.clear();await persist();await navigate('items');}));
}
function refreshDiscounts() {
 document.querySelectorAll('.quote-cell').forEach(cell=>{const value=PurchaseModel.negotiation(cell.querySelector('[data-price]').value,cell.querySelector('[data-negotiated]').value);cell.querySelector('.discount-auto').textContent=value.valid?`${value.percent.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}% de desconto`:value.label;});
}
function createMapDialog() {
 modal(`<h2>Novo mapa de compra</h2><p class="muted">${selected.size} itens selecionados. As quantidades e os hotéis serão mantidos.</p><form id="new-map"><label>Nome do mapa<input id="map-name" required maxlength="160" placeholder="Ex.: Manutenção · Setembro"></label><button class="button primary">Criar mapa</button></form>`);
 on($('#new-map'),'submit',async e=>{e.preventDefault();const m=await api('POST','/maps/create',{name:$('#map-name').value,ids:[...selected]});selected.clear();closeModal();await openMap(m.id);});
}
function normalizedSearch(value) {return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();}
function mapMatchesSearch(map,term) {
 const q=normalizedSearch(term);if(!q)return true;
 return normalizedSearch([map.name,...(map.scis||[]),...(map.items||[]),...(map.articles||[])].join(' ')).includes(q);
}
function mapCardHtml(m) {
 const scis=(m.scis||[]).slice(0,4),items=(m.items||[]).slice(0,2),moreScis=(m.scis||[]).length-scis.length,moreItems=(m.items||[]).length-items.length;
 const referenceDate=(m.archived?(m.completed_at||m.updated||m.created):m.created)||'';
 return `<article class="map-card map-library-card"><div class="map-card-top"><span class="badge ${m.archived?'action-neutral':'action-normal'}">${m.archived?'Concluído':'Em cotação'}</span><span class="map-card-date">${referenceDate?dateLabel(referenceDate.slice(0,10)):''}</span></div><h3>${esc(m.name)}</h3><p class="map-card-count">${m.count} ${m.count===1?'item':'itens'}</p>${scis.length?`<div class="map-card-reference"><small>SCI</small><span>${scis.map(esc).join(' · ')}${moreScis>0?` · +${moreScis}`:''}</span></div>`:''}${items.length?`<div class="map-card-items">${items.map(item=>`<span>${esc(item)}</span>`).join('')}${moreItems>0?`<small>+ ${moreItems} ${moreItems===1?'item':'itens'}</small>`:''}</div>`:''}<button class="button secondary" data-open-map="${m.id}">Abrir mapa</button></article>`;
}
function drawMapLibrary(maps) {
 const activeCount=maps.filter(m=>!m.archived).length,completedCount=maps.length-activeCount;
 document.querySelectorAll('[data-map-scope]').forEach(button=>{button.classList.toggle('active',button.dataset.mapScope===mapListScope);const count=button.dataset.mapScope==='active'?activeCount:completedCount;button.querySelector('span').textContent=count;});
 const scoped=maps.filter(m=>mapListScope==='completed'?m.archived:!m.archived).filter(m=>mapMatchesSearch(m,mapSearch));
 const count=$('#map-library-count');if(count)count.textContent=`${scoped.length} ${scoped.length===1?'mapa':'mapas'}`;
 const grid=$('#map-library-grid');
 grid.innerHTML=scoped.map(mapCardHtml).join('')||`<div class="empty-state map-library-empty">${mapSearch?'Nenhum mapa encontrado para esta pesquisa.':mapListScope==='completed'?'Nenhum mapa concluído.':'Nenhum mapa em cotação.'}</div>`;
 grid.querySelectorAll('[data-open-map]').forEach(b=>on(b,'click',()=>openMap(b.dataset.openMap)));
}
async function renderMaps() {
 const maps=await api('GET','/maps');
 $('#content').innerHTML=`<section class="map-library-toolbar"><div class="map-library-tabs" role="tablist" aria-label="Status dos mapas"><button type="button" class="map-library-tab" data-map-scope="active">Em cotação <span>0</span></button><button type="button" class="map-library-tab" data-map-scope="completed">Concluídos <span>0</span></button></div><div class="map-library-actions"><label class="map-library-search"><span>Pesquisar mapa</span><input id="map-search" value="${esc(mapSearch)}" placeholder="Nome, SCI ou item" autocomplete="off"></label><button id="new-from-items" class="button primary">Selecionar itens para novo mapa</button></div></section><div class="map-library-meta"><strong id="map-library-count"></strong></div><div id="map-library-grid" class="map-cards"></div>`;
 document.querySelectorAll('[data-map-scope]').forEach(button=>on(button,'click',()=>{mapListScope=button.dataset.mapScope;drawMapLibrary(maps);}));
 on($('#map-search'),'input',()=>{mapSearch=$('#map-search').value;drawMapLibrary(maps);});
 on($('#new-from-items'),'click',()=>navigate('items'));
 drawMapLibrary(maps);
}
async function openMap(id) {stopWhatsAppPanel();currentView='map';const d=await api('GET','/map?id='+encodeURIComponent(id));activeMap=d.map;dirty=false;$('#view-title').textContent=activeMap.name;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view==='maps'));renderMap(d);}
function markDirty() {dirty=true;document.querySelectorAll('.quote-total').forEach(x=>x.textContent='Recalcular ao salvar');document.querySelectorAll('.winner-cell').forEach(x=>x.textContent='Recalcular ao salvar');$('#save-note').textContent='Alterações não salvas. Salve para recalcular o resultado.';$('#result-wrap').innerHTML='<div class="notice">Salve os preços e descontos para atualizar os vencedores.</div>';}
function captureMap() {
 activeMap.name=$('#edit-name').value;
 activeMap.saving_target=$('#saving-target')?.value||activeMap.saving_target||'5';
 activeMap.awards??={};
 document.querySelectorAll('[data-supplier-name]').forEach(el=>{const s=activeMap.suppliers.find(s=>s.id===el.dataset.supplierName);s.name=el.value;s.phone=document.querySelector(`[data-supplier-phone="${s.id}"]`).value;});
 document.querySelectorAll('[data-note]').forEach(el=>{activeMap.items.find(i=>i.id===el.dataset.note).note=el.value;});
 document.querySelectorAll('[data-type]').forEach(el=>{activeMap.items.find(i=>i.id===el.dataset.type).purchase_type=el.value;});
 document.querySelectorAll('[data-price]').forEach(el=>{
  const id=el.dataset.item,sid=el.dataset.price;activeMap.quotes[id]??={};
  const cell=el.closest('.quote-cell');const initial=el.value.trim();const negotiated=initial?cell.querySelector('[data-negotiated]').value:'';const delivery=cell.querySelector('[data-delivery]')?.value||'';
  const previous=activeMap.quotes[id][sid];const oldDelivery=previous?.delivery||'';
  if(!previous||'negotiated' in previous||el.value!==el.dataset.original||negotiated!==cell.querySelector('[data-negotiated]').dataset.original){activeMap.quotes[id][sid]={price:initial,negotiated,delivery};}
  else if(delivery!==oldDelivery){activeMap.quotes[id][sid]={...previous,delivery};}
 });
}

async function saveMap() {captureMap();const d=await api('POST','/maps/save',activeMap);activeMap=d.map;dirty=false;renderMap(d);toast('Mapa salvo e comparação atualizada.');return d;}
const awardReasons=['Prazo de entrega','Disponibilidade imediata','Qualidade','Frete','Condição de pagamento','Histórico do fornecedor','Necessidade do hotel','Outro'];
async function awardDialog(itemId) {
 const detail=await api('GET','/map?id='+encodeURIComponent(activeMap.id));activeMap=detail.map;
 const item=activeMap.items.find(i=>i.id===itemId),line=detail.result.lines.find(l=>l.id===itemId);if(!item||!line)return;
 const current=activeMap.awards?.[itemId]||{};const bestIds=new Set((line.financial_winners||line.winners||[]).map(q=>q.supplier_id));
 modal(`<h2>Escolher fornecedor</h2><p class="muted"><strong>${esc(item.description)}</strong> · ${qty(item.quantity)} ${esc(item.unit)}</p><p class="muted">O menor preço continua indicado como referência. Se escolher outra proposta, registre o motivo operacional.</p><form id="award-form"><label>Fornecedor<select id="award-supplier"><option value="">Automático — usar o menor preço</option>${line.quotes.map(q=>`<option value="${esc(q.supplier_id)}" ${current.supplier_id===q.supplier_id?'selected':''}>${esc(q.supplier)} · ${brl(q.net)}${q.delivery?` · ${esc(q.delivery)}`:''}${bestIds.has(q.supplier_id)?' · menor preço':''}</option>`).join('')}</select></label><div id="award-premium" class="award-premium"></div><label>Motivo<select id="award-reason"><option value="">Selecione quando necessário</option>${awardReasons.map(r=>`<option value="${esc(r)}" ${current.reason===r?'selected':''}>${esc(r)}</option>`).join('')}</select></label><label>Observação<textarea id="award-note" rows="3" maxlength="500" placeholder="Ex.: hotel precisa receber até sexta-feira">${esc(current.note||'')}</textarea></label><div class="modal-actions"><button type="submit" class="button primary">Confirmar escolha</button></div></form>`);
 const update=()=>{const sid=$('#award-supplier').value,q=line.quotes.find(q=>q.supplier_id===sid),best=line.financial_winners?.[0]||line.winners?.[0];if(!sid){$('#award-premium').innerHTML='<span class="muted">O Vyzium voltará a considerar automaticamente o menor preço.</span>';return;}const premium=best?Math.max(0,Number(q.net)-Number(best.net)):0;$('#award-premium').innerHTML=premium>0?`<strong>Diferença para o menor preço: ${brl(premium)}</strong><span>Informe abaixo por que esta proposta será escolhida.</span>`:'<strong>Esta proposta está no menor preço.</strong>';};
 on($('#award-supplier'),'change',update);update();
 on($('#award-form'),'submit',async e=>{e.preventDefault();const sid=$('#award-supplier').value;activeMap.awards??={};activeMap.choices??={};delete activeMap.choices[itemId];if(!sid)delete activeMap.awards[itemId];else activeMap.awards[itemId]={supplier_id:sid,reason:$('#award-reason').value,note:$('#award-note').value};closeModal();await saveMap();});
}
function renderMap(detail) {
 const m=activeMap,r=detail.result;$('#view-title').textContent=m.name;m.awards??={};m.saving_target??='5';
 const defined=Math.max(0,m.items.length-r.unquoted-r.ties),quoted=Math.max(0,m.items.length-r.unquoted);
 const quoteProgress=m.items.length?Math.round((quoted/m.items.length)*100):0;
 $('#content').innerHTML=`${detail.changes.length?`<div class="notice"><strong>Atenção à reimportação:</strong><br>${detail.changes.map(esc).join('<br>')}<br>Preços anteriores foram preservados. O envio fica bloqueado; conclua este mapa e crie outro com os itens atuais.</div>`:''}
 ${m.archived?'<div class="notice completed-map-notice">Mapa concluído. Valores, comparação e exportação permanecem disponíveis para consulta.</div>':''}
 <div class="map-workspace">
 <section class="panel map-command-panel">
   <div class="map-command-main">
     <div class="map-name-block">
       <span class="map-kicker">MAPA DE COMPRA</span>
       <label class="map-name-field">Nome do mapa<input id="edit-name" value="${esc(m.name)}" maxlength="160"></label>
       <div class="map-status-row">
         <span class="map-status ${m.archived?'is-archived':'is-active'}">${m.archived?'Concluído':'Em cotação'}</span>
         <span>${m.items.length} ${m.items.length===1?'item':'itens'}</span>
         <span>${m.suppliers.length} ${m.suppliers.length===1?'fornecedor':'fornecedores'}</span>
         <span>${defined} ${defined===1?'item definido':'itens definidos'}</span>
         <label class="saving-target-inline">Meta de saving <span><input id="saving-target" inputmode="decimal" value="${esc(m.saving_target)}" maxlength="6">%</span></label>
       </div>
     </div>
     <div class="map-actions">
       <button id="save-map" class="button primary" ${m.archived?'disabled':''}>Salvar e calcular</button>
       <button id="export-map" class="button secondary">Exportar mapa Excel (.xls)</button>
       ${m.archived?'':`<button id="complete-map" class="button secondary">Concluir mapa</button>`}
       <button id="delete-map" class="button danger">Excluir mapa</button>
     </div>
   </div>
   <div class="map-progress-line"><span style="width:${quoteProgress}%"></span></div>
   <div class="map-save-row"><p id="save-note" class="save-note">Salvo · Valores em R$ · Preço inicial → preço negociado → saving automático.</p><span>${quoted}/${m.items.length} itens com cotação</span></div>
   <details class="supplier-manager" ${m.suppliers.length?'':'open'}><summary><span>Fornecedores do mapa</span><strong>${m.suppliers.length}</strong><small>Gerenciar nomes e WhatsApp</small></summary><div id="supplier-list">${m.suppliers.map(s=>`<div class="supplier-card"><label>Fornecedor<input data-supplier-name="${s.id}" value="${esc(s.name)}" maxlength="160"></label><label>WhatsApp com país e DDD<input data-supplier-phone="${s.id}" value="${esc(s.phone)}" placeholder="5585999999999"></label><button class="button secondary" data-remove-supplier="${s.id}">Remover</button></div>`).join('')}</div><p><button id="add-supplier" class="button secondary">+ Adicionar fornecedor</button></p></details>
 </section>
 <section class="panel quote-workbench">
   <div class="quote-workbench-head">
     <div><span class="section-kicker">ANÁLISE DE PREÇOS</span><h2>Mapa de cotação</h2><p class="muted">Compare preço, negociação e prazo. O menor valor é a referência financeira, mas você pode escolher outra proposta e registrar o motivo.</p></div>
     <div class="quote-action-group"><button id="request-negotiation" class="button secondary" ${!m.suppliers.length||m.archived||detail.changes.length?'disabled':''}>Solicitar negociação</button><button id="request-quote" class="button primary" ${!m.suppliers.length||m.archived||detail.changes.length?'disabled':''}>Solicitar cotação por WhatsApp</button></div>
   </div>
   <div class="purchase-table map-quote-table"><table><thead><tr><th class="sticky-col origin-col">Hotel / SCI</th><th class="sticky-col item-col">Item / especificação</th><th class="sticky-col qty-col">Qtd.</th>${m.suppliers.map(s=>`<th class="supplier-heading"><span class="supplier-initial">${esc((s.name||'?').trim().charAt(0).toUpperCase()||'?')}</span><span>${esc(s.name)}</span></th>`).join('')}<th class="result-heading">Decisão</th></tr></thead><tbody>${m.items.map((i,idx)=>{const line=r.lines[idx],quotedCount=line.quotes.length;return `<tr class="quote-item-row"><td class="sticky-col origin-col origin-cell"><strong>${esc(i.company)}</strong><small>SCI ${esc(i.sci)}</small><small>${esc(i.buyer)}</small><span class="badge ${i.approval==='approved'?'approval-approved':'approval-waiting'}">${statusLabel[i.approval]}</span></td><td class="sticky-col item-col description"><strong>${esc(i.description)}</strong>${i.article?`<small>${esc(i.article)}</small>`:''}<span class="item-quote-progress ${quotedCount?'has-quotes':''}">${quotedCount}/${m.suppliers.length} fornecedores cotaram</span><details class="item-details"><summary>Observação / tipo de compra</summary><label>Tipo de compra<input data-type="${esc(i.id)}" value="${esc(i.purchase_type)}" placeholder="Opcional"></label><label>Observação<textarea data-note="${esc(i.id)}" rows="2" maxlength="2000" placeholder="Marca, especificação, entrega…">${esc(i.note)}</textarea></label></details></td><td class="sticky-col qty-col qty-cell"><strong>${qty(i.quantity)}</strong><small>${esc(i.unit)}</small></td>${m.suppliers.map(s=>{const q=m.quotes[i.id]?.[s.id]||{},calc=line.quotes.find(q=>q.supplier_id===s.id),isChosen=line.chosen?.supplier_id===s.id,isFinancial=(line.financial_winners||line.winners||[]).some(w=>w.supplier_id===s.id),isTie=line.state==='tie'&&isFinancial;const finalValue='negotiated' in q?(q.negotiated??''):(calc?.final_price??'');const target=calc?.target_price?brl(calc.target_price):'';const targetInfo=calc?calc.target_met?`<span class="target-met">Meta de ${Number(r.saving_target_percent).toLocaleString('pt-BR')}% atingida</span>`:`<span>Meta ${target}</span><strong>Falta ${brl(calc.target_reduction_unit)}/un · ${Number(calc.required_reduction_percent).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%</strong>`:'';return `<td class="quote-cell ${isChosen?'is-winner':''} ${isTie?'is-tie':''}"><div class="quote-card">${isChosen?'<span class="best-offer-tag">Escolhido</span>':isTie?'<span class="tie-offer-tag">Empatada</span>':isFinancial?'<span class="financial-offer-tag">Menor preço</span>':''}<div class="price-pair"><label>Preço inicial<input aria-label="Preço inicial ${esc(s.name)}" inputmode="decimal" data-price="${s.id}" data-item="${esc(i.id)}" data-original="${esc(q.price??'')}" value="${esc(q.price??'')}" placeholder="R$ 0,00"></label><label>Negociado<input aria-label="Preço negociado ${esc(s.name)}" inputmode="decimal" data-negotiated data-original="${esc(finalValue)}" value="${esc(finalValue)}" placeholder="R$ 0,00"></label></div><label class="delivery-field">Prazo de entrega<input data-delivery value="${esc(q.delivery||'')}" maxlength="120" placeholder="Ex.: 3 dias úteis"></label><div class="quote-insight"><span class="discount-auto ${calc&&Number(calc.discount_percent)>0?'has-discount':''}">${calc?`${Number(calc.discount_percent).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}% de desconto`:'Sem cotação'}</span>${calc?`<span class="quote-saving">Economia ${brl(calc.saving)}</span>`:''}</div>${calc?`<div class="negotiation-target ${calc.target_met?'is-met':''}">${targetInfo}</div>`:''}<div class="quote-total">${calc?`<span>Total do item</span><strong>${brl(calc.net)}</strong>`:'Sem cotação'}</div></div></td>`;}).join('')}<td class="winner-cell result-cell">${line.chosen?`<span class="result-label">${line.manual_selection?'Fornecedor escolhido':'Melhor proposta'}</span><strong>${esc(line.chosen.supplier)}</strong><span class="result-price">${brl(line.chosen.net)}</span>${line.selection_reason?`<small class="decision-reason">${esc(line.selection_reason)}${line.selection_note?` · ${esc(line.selection_note)}`:''}</small>`:''}${Number(line.opportunity_cost)>0?`<small class="decision-premium">+ ${brl(line.opportunity_cost)} vs menor preço</small>`:''}`:line.state==='tie'?`<span class="badge action-attention">Empate</span><small>Escolha o fornecedor para fechar este item.</small>`:'<span class="result-empty">Aguardando cotação</span>'}${line.quotes.length&&!m.archived?`<button class="button secondary choose-supplier-button" data-award="${esc(i.id)}">Escolher fornecedor</button>`:''}</td></tr>`;}).join('')}</tbody></table></div>
 </section>
 <div id="result-wrap">${resultHtml(r,m)}</div>
 </div>`;
 document.querySelectorAll('#edit-name,#saving-target,[data-supplier-name],[data-supplier-phone],[data-note],[data-type],[data-price],[data-negotiated],[data-delivery]').forEach(el=>on(el,'input',()=>{markDirty();document.querySelectorAll('.quote-total').forEach(x=>x.textContent='Recalcular ao salvar');document.querySelectorAll('.winner-cell').forEach(x=>x.textContent='Recalcular ao salvar');refreshDiscounts();}));
 on($('#save-map'),'click',saveMap);
 on($('#export-map'),'click',async()=>{if(dirty)await saveMap();if(await window.followup.exportMap(m.id))toast('Mapa exportado.');});
 if($('#complete-map'))on($('#complete-map'),'click',async()=>{if(!confirm('Concluir este mapa de compra? Ele sairá de Em cotação, ficará disponível em Concluídos e os itens poderão ser usados em novos mapas.'))return;if(dirty)await saveMap();await api('POST','/maps/complete',{id:m.id});dirty=false;activeMap=null;mapListScope='completed';toast('Mapa concluído e movido para Concluídos.');await navigate('maps');});
 on($('#delete-map'),'click',async()=>{if(!confirm('Excluir definitivamente este mapa e todas as cotações registradas nele? Mensagens já enviadas permanecem no Histórico. Esta ação não pode ser desfeita pela tela.'))return;await api('POST','/maps/delete',{id:m.id});dirty=false;activeMap=null;toast('Mapa e cotações excluídos.');await navigate('maps');});
 on($('#add-supplier'),'click',()=>{captureMap();m.suppliers.push({id:crypto.randomUUID(),name:`Fornecedor ${m.suppliers.length+1}`,phone:''});renderMap({...detail,result:r});markDirty();});
 document.querySelectorAll('[data-remove-supplier]').forEach(el=>on(el,'click',()=>{if(!confirm('Remover este fornecedor e os preços dele deste mapa?'))return;captureMap();m.suppliers=m.suppliers.filter(s=>s.id!==el.dataset.removeSupplier);for(const [itemId,award] of Object.entries(m.awards||{})){if(award.supplier_id===el.dataset.removeSupplier)delete m.awards[itemId];}renderMap({...detail,result:r});markDirty();}));
 document.querySelectorAll('[data-award]').forEach(el=>on(el,'click',async()=>{if(dirty)await saveMap();await awardDialog(el.dataset.award);}));
 on($('#request-quote'),'click',async()=>{if(dirty)await saveMap();quoteDialog();});
 on($('#request-negotiation'),'click',async()=>{if(dirty)await saveMap();negotiationDialog();});
 if(m.archived){document.querySelectorAll('#content input,#content textarea,#content select,#save-map,#add-supplier,[data-remove-supplier],[data-award]').forEach(el=>el.disabled=true);}
}
function resultHtml(r,m) {
 const gross=Number(r.gross??(Number(r.net)+Number(r.saving))),defined=Math.max(0,m.items.length-r.unquoted-r.ties),completion=m.items.length?Math.round((defined/m.items.length)*100):0;
 const chosenSuppliers=r.suppliers.filter(s=>s.won),target=Number(r.saving_target_percent||m.saving_target||5),savingPct=Number(r.saving_percent||0),gap=Number(r.saving_target_gap||0),decisionCost=Number(r.opportunity_cost||0);
 return `<section class="panel map-results-panel"><div class="results-heading"><div><span class="section-kicker">RESUMO DA NEGOCIAÇÃO</span><h2>Resultado da comparação</h2><p class="muted">O menor preço é a referência financeira; a escolha final pode considerar prazo e necessidade operacional.</p></div><div class="completion-ring" style="--progress:${completion}"><strong>${completion}%</strong><span>definido</span></div></div><div class="map-summary-grid"><div class="map-metric"><small>Valor inicial dos escolhidos</small><strong>${brl(gross)}</strong><span>Base antes da negociação</span></div><div class="map-metric primary"><small>Valor negociado</small><strong>${brl(r.net)}</strong><span>${defined} de ${m.items.length} itens definidos</span></div><div class="map-metric success"><small>Economia obtida</small><strong>${brl(r.saving)}</strong><span>Saving efetivo dos escolhidos</span></div><div class="map-metric ${r.unquoted?'attention':''}"><small>Itens sem cotação</small><strong>${r.unquoted}</strong><span>${r.ties} ${r.ties===1?'empate pendente':'empates pendentes'}</span></div></div><div class="negotiation-summary"><div><small>Meta de saving</small><strong>${target.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%</strong></div><div class="${savingPct>=target?'goal-ok':'goal-open'}"><small>Saving atual</small><strong>${savingPct.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%</strong></div><div><small>${gap>0?'Falta economizar':'Meta atingida'}</small><strong>${gap>0?brl(gap):'✓'}</strong></div><div class="${decisionCost>0?'decision-cost':''}"><small>Diferença por decisão operacional</small><strong>${brl(decisionCost)}</strong></div></div><div class="result-explainer">A economia compara o preço inicial com o preço negociado do fornecedor efetivamente escolhido. A diferença por decisão operacional mostra quanto uma escolha manual ficou acima do menor preço disponível.</div>${chosenSuppliers.length?`<div class="supplier-results-head"><div><h3>Distribuição da compra</h3><p class="muted">Fornecedores escolhidos para os itens já definidos.</p></div><span>${chosenSuppliers.length} ${chosenSuppliers.length===1?'fornecedor':'fornecedores'}</span></div><div class="supplier-result-grid">${chosenSuppliers.map(s=>`<article class="supplier-result-card"><div class="supplier-result-title"><span class="supplier-result-mark">${esc((s.name||'?').trim().charAt(0).toUpperCase()||'?')}</span><div><h3>${esc(s.name)}</h3><p>${s.won} ${s.won===1?'item escolhido':'itens escolhidos'}</p></div></div><div class="supplier-result-value"><small>Total definido</small><strong>${brl(s.net)}</strong></div><div class="supplier-result-saving"><span>Economia</span><strong>${brl(s.saving)}</strong></div><ul>${r.lines.filter(l=>l.chosen?.supplier_id===s.id).map(l=>{const i=m.items.find(i=>i.id===l.id);return `<li><span>${esc(i.description)}</span><small>${qty(i.quantity)} ${esc(i.unit)} · ${esc(i.company)}${l.selection_reason?` · ${esc(l.selection_reason)}`:''}</small></li>`;}).join('')}</ul></article>`).join('')}</div>`:'<div class="empty-result-state"><strong>Nenhum fornecedor definido ainda.</strong><span>Preencha as cotações para visualizar a distribuição da compra.</span></div>'}</section>`;
}
function negotiationDialog() {
 modal(`<h2>Solicitar negociação</h2><p class="muted">Esta é a segunda mensagem da conversa. Ela vai direto ao ponto, sem nova saudação.</p><details><summary>Conexão do WhatsApp / QR Code</summary>${whatsappPanel()}</details><label>Fornecedor<select id="negotiation-supplier"><option value="">Selecione um fornecedor</option>${activeMap.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)} · ${esc(s.phone||'sem WhatsApp')}</option>`).join('')}</select></label><div id="negotiation-preview"></div><button id="send-negotiation" class="button primary" disabled>Enviar negociação</button>`);
 previewData=null;startWhatsAppPanel();
 on($('#negotiation-supplier'),'change',async()=>{const sid=$('#negotiation-supplier').value;$('#send-negotiation').disabled=true;previewData=null;$('#negotiation-preview').innerHTML='';if(!sid)return;try{const p=await api('GET',`/negotiation-preview?id=${encodeURIComponent(activeMap.id)}&supplier=${encodeURIComponent(sid)}`);if($('#negotiation-supplier')?.value!==sid)return;previewData=p;$('#negotiation-preview').innerHTML=`<div class="negotiation-preview-head"><strong>Meta do mapa: ${Number(p.saving_target).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%</strong><span>${p.targets.length} ${p.targets.length===1?'item':'itens'} para negociar</span></div><div class="negotiation-target-list">${p.targets.map(t=>`<div><span>${esc(t.description)} · ${qty(t.quantity)} ${esc(t.unit)}</span><strong>${brl(t.target_price)} / un</strong></div>`).join('')}</div><label>Mensagem<textarea id="negotiation-message" rows="9" maxlength="60000">${esc(p.message)}</textarea></label><p class="muted">Você pode ajustar o texto antes de enviar. SCI e preços dos concorrentes não são incluídos.</p>`;$('#send-negotiation').disabled=!p.supplier.phone;}catch(_){previewData=null;}});
 on($('#send-negotiation'),'click',async()=>{if(!previewData||sending)return;const p=previewData,message=$('#negotiation-message')?.value||'';sending=true;$('#send-negotiation').disabled=true;$('#negotiation-supplier').disabled=true;$('#send-negotiation').textContent='Aguardando conexão e envio…';try{const r=await api('POST','/send-negotiation',{map_id:activeMap.id,supplier_id:p.supplier.id,fingerprint:p.fingerprint,revision:p.revision,message});toast(r.status==='sent'?'Negociação enviada ao WhatsApp.':`${r.status==='uncertain'?'Envio incerto':'Falha'}: ${r.error||'Consulte o histórico.'}`);sending=false;closeModal();}finally{sending=false;if($('#send-negotiation')){$('#send-negotiation').textContent='Enviar negociação';$('#send-negotiation').disabled=false;$('#negotiation-supplier').disabled=false;}}});
}
function quoteDialog() {
 modal(`<h2>Solicitar cotação</h2><details><summary>Conexão do WhatsApp / QR Code</summary>${whatsappPanel()}</details><label>Fornecedor<select id="quote-supplier"><option value="">Selecione um fornecedor</option>${activeMap.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)} · ${esc(s.phone||'sem WhatsApp')}</option>`).join('')}</select></label><div id="quote-preview"></div><p class="muted">Somente os itens deste mapa serão enviados. Os preços dos concorrentes não aparecem na mensagem.</p><button id="send-quote" class="button primary" disabled>Enviar solicitação</button>`);
 previewData=null;startWhatsAppPanel();
 on($('#quote-supplier'),'change',async()=>{const sid=$('#quote-supplier').value;$('#send-quote').disabled=true;previewData=null;$('#quote-preview').innerHTML='';if(!sid)return;const p=await api('GET',`/preview?id=${encodeURIComponent(activeMap.id)}&supplier=${encodeURIComponent(sid)}`);if($('#quote-supplier')?.value!==sid)return;previewData=p;$('#quote-preview').innerHTML=`<p><strong>Destino: ${esc(p.supplier.name)} · ${esc(p.supplier.phone||'Cadastre o número antes de enviar')}</strong></p><pre class="message-preview">${esc(p.message)}</pre>`;$('#send-quote').disabled=!p.supplier.phone;});
 on($('#send-quote'),'click',async()=>{if(!previewData||sending)return;const p=previewData;sending=true;$('#send-quote').disabled=true;$('#quote-supplier').disabled=true;$('#send-quote').textContent='Aguardando conexão e envio…';try{const r=await api('POST','/send',{map_id:activeMap.id,supplier_id:p.supplier.id,fingerprint:p.fingerprint,revision:p.revision});toast(r.status==='sent'?'Solicitação enviada ao WhatsApp.':`${r.status==='uncertain'?'Envio incerto':'Falha'}: ${r.error||'Consulte o histórico.'}`);sending=false;closeModal();}finally{sending=false;if($('#send-quote')){$('#send-quote').textContent='Enviar solicitação';$('#send-quote').disabled=false;$('#quote-supplier').disabled=false;}}});
}
async function renderHistory() {
 const rows=await api('GET','/history');const labels={sending:'Em andamento',sent:'Enviada',failed:'Falha antes de concluir',uncertain:'Envio incerto',reviewed_not_received:'Conferida: não recebida'};
 $('#content').innerHTML=`<section class="panel"><h2>Cotações e negociações</h2><p class="muted">“Enviada” indica conclusão da chamada ao WhatsApp, sem comprovar leitura pelo fornecedor.</p>${rows.map(r=>`<article class="history-row"><div class="section-head"><strong>${esc(r.supplier.name)} · ${esc(r.supplier.phone)} <small class="history-kind">${r.kind==='negotiation'?'Negociação':'Cotação'}</small></strong><span class="badge ${r.status==='sent'?'action-normal':'action-attention'}">${labels[r.status]||esc(r.status)}</span></div><small>${esc(r.at.replace('T',' '))}</small>${r.error?`<p>${esc(r.error)}</p>`:''}<details><summary>Ver mensagem</summary><pre>${esc(r.message)}</pre></details>${r.status==='uncertain'?`<p>Confira a conversa no WhatsApp antes de liberar outra tentativa.</p><button class="button secondary" data-review="${r.id}" data-outcome="received">Conferi: foi recebida</button> <button class="button secondary" data-review="${r.id}" data-outcome="not_received">Conferi: não foi recebida</button>`:''}</article>`).join('')||'<div class="empty-state">Nenhuma solicitação enviada.</div>'}</section>`;
 document.querySelectorAll('[data-review]').forEach(el=>on(el,'click',async()=>{if(!confirm('Você conferiu esta mensagem na conversa do fornecedor?'))return;await api('POST','/review',{id:el.dataset.review,outcome:el.dataset.outcome});await renderHistory();}));
}
async function renderSettings() {
 $('#content').innerHTML=whatsappPanel()+`<section class="panel"><h2>Segurança dos dados</h2><p>O banco local deste módulo é criptografado e verificado quanto à integridade.</p><div id="compras-data-safety" class="notice">Verificando banco de dados…</div><div class="toolbar"><button id="compras-backup-now" class="button primary">Criar backup agora</button></div></section><section class="panel"><h2>Vyzium · Cotação &amp; Mapas · v${esc(window.vyziumAppVersion||'3.2.1')}</h2><p>Dados, mapas e filtros deste módulo continuam salvos separadamente neste computador.</p><p class="muted">A conexão do WhatsApp pertence ao Vyzium e é reutilizada pelos dois módulos. As bases operacionais de Acompanhamento e Cotação &amp; Mapas continuam independentes.</p><p class="muted">A integração usa WhatsApp Web, sem API oficial. Alterações no serviço podem exigir reconexão.</p><label>Zoom<select id="zoom">${[75,85,89,100,110].map(v=>`<option value="${v}" ${(ui.zoom||85)===v?'selected':''}>${v}%</option>`).join('')}</select></label></section>`;
 startWhatsAppPanel();
 on($('#zoom'),'change',async()=>{ui.zoom=Number($('#zoom').value);await window.followup.setZoom(ui.zoom);await persist();});
 const loadSafety=async()=>{try{const state=await api('GET','/data-safety');const protection=state.encrypted?'🔒 Criptografado com SQLCipher':'Banco legado sem criptografia';$('#compras-data-safety').innerHTML=`<strong>${state.integrity?.ok?'✓ Banco íntegro':'⚠ Verificação requer atenção'}</strong> · ${esc(protection)}<br>Schema ${esc(state.schema_version??'—')}`;}catch(e){$('#compras-data-safety').textContent='Não foi possível verificar a segurança do banco.';}};
 on($('#compras-backup-now'),'click',async e=>{const b=e.currentTarget;b.disabled=true;const old=b.textContent;b.textContent='Criando backup…';try{const r=await api('POST','/data-safety/backup',{reason:'manual',automatic:false});toast(r.created?`Backup criado: ${r.filename}`:(r.reason||'Backup não necessário.'));await loadSafety();}finally{b.disabled=false;b.textContent=old;}});
 await loadSafety();
}
(async()=>{ui=await api('GET','/settings');ui.filters??={};if(ui.zoom)await window.followup.setZoom(ui.zoom);await navigate('dashboard');})().catch(()=>{$('#content').innerHTML='<div class="notice">Não foi possível carregar o aplicativo. Reinicie e confira o motor Python.</div>';});
