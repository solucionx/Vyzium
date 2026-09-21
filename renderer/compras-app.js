'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl = v => Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const qty = v => Number(v).toLocaleString('pt-BR',{maximumFractionDigits:6});
const statusLabel = {pending:'Pendente',quoting:'Em cotação',approved:'Aprovada',waiting:'Aguardando aprovação'};
let currentView = 'items', catalog = [], selected = new Set(), page = 0, ui = {filters:{}}, activeMap = null, dirty = false, sending = false;
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
async function renderMaps() {
 const maps=await api('GET','/maps');$('#content').innerHTML=`<div class="section-head"><p class="muted">Cotações salvas por item, com SCI e hotel preservados.</p><button id="new-from-items" class="button primary">Selecionar itens para novo mapa</button></div><div class="map-cards">${maps.map(m=>`<article class="map-card"><span class="badge ${m.archived?'action-neutral':'action-normal'}">${m.archived?'Arquivado':'Em cotação'}</span><h3>${esc(m.name)}</h3><p>${m.count} itens · ${dateLabel(m.created.slice(0,10))}</p><button class="button secondary" data-open-map="${m.id}">Abrir mapa</button></article>`).join('')||'<div class="empty-state">Seus mapas aparecerão aqui.</div>'}</div>`;
 on($('#new-from-items'),'click',()=>navigate('items'));document.querySelectorAll('[data-open-map]').forEach(b=>on(b,'click',()=>openMap(b.dataset.openMap)));
}
async function openMap(id) {stopWhatsAppPanel();currentView='map';const d=await api('GET','/map?id='+encodeURIComponent(id));activeMap=d.map;dirty=false;$('#view-title').textContent=activeMap.name;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view==='maps'));renderMap(d);}
function markDirty() {dirty=true;document.querySelectorAll('.quote-total').forEach(x=>x.textContent='Recalcular ao salvar');document.querySelectorAll('.winner-cell').forEach(x=>x.textContent='Recalcular ao salvar');$('#save-note').textContent='Alterações não salvas. Salve para recalcular o resultado.';$('#result-wrap').innerHTML='<div class="notice">Salve os preços e descontos para atualizar os vencedores.</div>';}
function captureMap() {
 activeMap.name=$('#edit-name').value;
 document.querySelectorAll('[data-supplier-name]').forEach(el=>{const s=activeMap.suppliers.find(s=>s.id===el.dataset.supplierName);s.name=el.value;s.phone=document.querySelector(`[data-supplier-phone="${s.id}"]`).value;});
 document.querySelectorAll('[data-note]').forEach(el=>{activeMap.items.find(i=>i.id===el.dataset.note).note=el.value;});
 document.querySelectorAll('[data-type]').forEach(el=>{activeMap.items.find(i=>i.id===el.dataset.type).purchase_type=el.value;});
 document.querySelectorAll('[data-price]').forEach(el=>{const id=el.dataset.item,sid=el.dataset.price;activeMap.quotes[id]??={};const cell=el.closest('.quote-cell');const initial=el.value.trim();const negotiated=initial?cell.querySelector('[data-negotiated]').value:'';const previous=activeMap.quotes[id][sid];if(!previous||'negotiated' in previous||el.value!==el.dataset.original||negotiated!==cell.querySelector('[data-negotiated]').dataset.original){activeMap.quotes[id][sid]={price:initial,negotiated};}});
}
async function saveMap() {captureMap();const d=await api('POST','/maps/save',activeMap);activeMap=d.map;dirty=false;renderMap(d);toast('Mapa salvo e comparação atualizada.');return d;}
function renderMap(detail) {
 const m=activeMap,r=detail.result;$('#view-title').textContent=m.name;
 $('#content').innerHTML=`${detail.changes.length?`<div class="notice"><strong>Atenção à reimportação:</strong><br>${detail.changes.map(esc).join('<br>')}<br>Preços anteriores foram preservados. O envio fica bloqueado; arquive este mapa e crie outro com os itens atuais.</div>`:''}
 ${m.archived?'<div class="notice">Mapa arquivado. Seus valores e histórico estão disponíveis para consulta.</div>':''}
 <section class="panel"><div class="section-head"><label>Nome do mapa<input id="edit-name" value="${esc(m.name)}" maxlength="160"></label><div class="toolbar"><button id="save-map" class="button primary">Salvar e calcular</button><button id="export-map" class="button secondary">Exportar mapa Excel (.xls)</button><button id="archive-map" class="button secondary" ${m.archived?'disabled':''}>Arquivar</button></div></div><p id="save-note" class="save-note">Salvo · Valores em R$ · Preço inicial → preço negociado → desconto automático.</p>
 <details ${m.suppliers.length?'':'open'}><summary>Fornecedores (${m.suppliers.length}) — nomes e WhatsApp</summary><div id="supplier-list">${m.suppliers.map(s=>`<div class="supplier-card"><label>Fornecedor<input data-supplier-name="${s.id}" value="${esc(s.name)}" maxlength="160"></label><label>WhatsApp com país e DDD<input data-supplier-phone="${s.id}" value="${esc(s.phone)}" placeholder="5585999999999"></label><button class="button secondary" data-remove-supplier="${s.id}">Remover</button></div>`).join('')}</div><p><button id="add-supplier" class="button secondary">+ Adicionar fornecedor</button></p></details></section>
 <section class="panel"><div class="section-head"><div><h2>Mapa de cotação</h2><p class="muted">Informe o preço inicial e o preço unitário negociado. Se o fornecedor não cotar um item, deixe o 1º valor vazio. Sem negociação, deixe o 2º valor vazio. Frete não incluído.</p></div><button id="request-quote" class="button primary" ${!m.suppliers.length||m.archived||detail.changes.length?'disabled':''}>Solicitar cotação por WhatsApp</button></div>
 <div class="purchase-table"><table><thead><tr><th>Hotel / SCI</th><th>Item / Observações</th><th>Quantidade</th>${m.suppliers.map(s=>`<th>${esc(s.name)}</th>`).join('')}<th>Vencedor por item</th></tr></thead><tbody>${m.items.map((i,idx)=>{const line=r.lines[idx];return `<tr><td>${esc(i.company)}<small>SCI ${esc(i.sci)} · ${esc(i.buyer)}</small><span class="badge ${i.approval==='approved'?'approval-approved':'approval-waiting'}">${statusLabel[i.approval]}</span></td><td class="description"><strong>${esc(i.description)}</strong><small>${esc(i.article)}</small><details class="item-details"><summary>Observação / tipo de compra</summary><label>Tipo de compra<input data-type="${esc(i.id)}" value="${esc(i.purchase_type)}" placeholder="Opcional"></label><label>Observação<textarea data-note="${esc(i.id)}" rows="2" maxlength="2000" placeholder="Marca, especificação, entrega…">${esc(i.note)}</textarea></label></details></td><td>${qty(i.quantity)} ${esc(i.unit)}</td>${m.suppliers.map(s=>{const q=m.quotes[i.id]?.[s.id]||{},calc=line.quotes.find(q=>q.supplier_id===s.id);const finalValue='negotiated' in q?(q.negotiated??''):(calc?.final_price??'');return `<td class="quote-cell"><div class="price-pair"><label>1º valor R$<input aria-label="Preço inicial ${esc(s.name)}" inputmode="decimal" data-price="${s.id}" data-item="${esc(i.id)}" data-original="${esc(q.price??'')}" value="${esc(q.price??'')}" placeholder="Inicial"></label><label>2º valor R$<input aria-label="Preço negociado ${esc(s.name)}" inputmode="decimal" data-negotiated data-original="${esc(finalValue)}" value="${esc(finalValue)}" placeholder="Negociado"></label></div><div class="discount-auto">${calc?`${Number(calc.discount_percent).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}% de desconto`:'Sem cotação'}</div><div class="quote-total">${calc?`Total ${brl(calc.net)} · economia ${brl(calc.saving)}`:'Sem cotação'}</div></td>`;}).join('')}<td class="winner-cell">${line.chosen?`<strong>${esc(line.chosen.supplier)}</strong><span class="badge action-normal">${brl(line.chosen.net)}</span>`:line.state==='tie'?`<span class="badge action-attention">Empate</span><select data-tie="${esc(i.id)}"><option value="">Escolher entre empatados</option>${line.winners.map(w=>`<option value="${w.supplier_id}">${esc(w.supplier)}</option>`).join('')}</select>`:'Sem cotação'}</td></tr>`;}).join('')}</tbody></table></div></section>
 <div id="result-wrap">${resultHtml(r,m)}</div>`;
 document.querySelectorAll('#edit-name,[data-supplier-name],[data-supplier-phone],[data-note],[data-type],[data-price],[data-negotiated]').forEach(el=>on(el,'input',()=>{markDirty();document.querySelectorAll('.quote-total').forEach(x=>x.textContent='Recalcular ao salvar');document.querySelectorAll('.winner-cell').forEach(x=>x.textContent='Recalcular ao salvar');refreshDiscounts();}));
 on($('#save-map'),'click',saveMap);
 on($('#export-map'),'click',async()=>{if(dirty)await saveMap();if(await window.followup.exportMap(m.id))toast('Mapa exportado.');});
 on($('#archive-map'),'click',async()=>{if(!confirm('Arquivar este mapa? Os itens voltarão a ficar disponíveis para novos mapas.'))return;if(dirty)await saveMap();await api('POST','/maps/archive',{id:m.id});await openMap(m.id);});
 on($('#add-supplier'),'click',()=>{captureMap();m.suppliers.push({id:crypto.randomUUID(),name:`Fornecedor ${m.suppliers.length+1}`,phone:''});renderMap({...detail,result:r});markDirty();});
 document.querySelectorAll('[data-remove-supplier]').forEach(el=>on(el,'click',()=>{if(!confirm('Remover este fornecedor e os preços dele deste mapa?'))return;captureMap();m.suppliers=m.suppliers.filter(s=>s.id!==el.dataset.removeSupplier);renderMap({...detail,result:r});markDirty();}));
 document.querySelectorAll('[data-tie]').forEach(el=>on(el,'change',async()=>{if(!el.value)return;captureMap();m.choices[el.dataset.tie]=el.value;await saveMap();}));
 on($('#request-quote'),'click',async()=>{if(dirty)await saveMap();quoteDialog();});
 if(m.archived){document.querySelectorAll('#content input,#content textarea,#content select,#save-map,#add-supplier,[data-remove-supplier]').forEach(el=>el.disabled=true);}
}
function resultHtml(r,m) {
 return `<section class="panel"><h2>Resultado da comparação</h2><div class="summary-grid"><div class="metric"><small>Total dos itens definidos</small><strong>${brl(r.net)}</strong></div><div class="metric"><small>Descontos nos vencedores</small><strong>${brl(r.saving)}</strong></div><div class="metric"><small>Itens sem cotação</small><strong>${r.unquoted}</strong></div><div class="metric"><small>Empates a decidir</small><strong>${r.ties}</strong></div></div><p class="muted">Economia = desconto negociado sobre o preço bruto do fornecedor vencedor. Itens sem cotação e empates não resolvidos ficam fora do total. Vencedor indica menor preço líquido; não gera OC nem confirma compra.</p><div class="map-cards">${r.suppliers.filter(s=>s.won).map(s=>`<article class="map-card"><h3>${esc(s.name)}</h3><p>${s.won} itens · ${brl(s.net)} · desconto ${brl(s.saving)}</p><ul>${r.lines.filter(l=>l.chosen?.supplier_id===s.id).map(l=>{const i=m.items.find(i=>i.id===l.id);return `<li>${esc(i.description)} — ${qty(i.quantity)} ${esc(i.unit)}<br><small>${esc(i.company)} · SCI ${esc(i.sci)}</small></li>`;}).join('')}</ul></article>`).join('')}</div></section>`;
}
function quoteDialog() {
 modal(`<h2>Solicitar cotação</h2><details><summary>Conexão do WhatsApp / QR Code</summary>${whatsappPanel()}</details><label>Fornecedor<select id="quote-supplier"><option value="">Selecione um fornecedor</option>${activeMap.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)} · ${esc(s.phone||'sem WhatsApp')}</option>`).join('')}</select></label><div id="quote-preview"></div><p class="muted">Somente os itens deste mapa serão enviados. Os preços dos concorrentes não aparecem na mensagem.</p><button id="send-quote" class="button primary" disabled>Enviar solicitação</button>`);
 previewData=null;startWhatsAppPanel();
 on($('#quote-supplier'),'change',async()=>{const sid=$('#quote-supplier').value;$('#send-quote').disabled=true;previewData=null;$('#quote-preview').innerHTML='';if(!sid)return;const p=await api('GET',`/preview?id=${encodeURIComponent(activeMap.id)}&supplier=${encodeURIComponent(sid)}`);if($('#quote-supplier')?.value!==sid)return;previewData=p;$('#quote-preview').innerHTML=`<p><strong>Destino: ${esc(p.supplier.name)} · ${esc(p.supplier.phone||'Cadastre o número antes de enviar')}</strong></p><pre class="message-preview">${esc(p.message)}</pre>`;$('#send-quote').disabled=!p.supplier.phone;});
 on($('#send-quote'),'click',async()=>{if(!previewData||sending)return;const p=previewData;sending=true;$('#send-quote').disabled=true;$('#quote-supplier').disabled=true;$('#send-quote').textContent='Aguardando conexão e envio…';try{const r=await api('POST','/send',{map_id:activeMap.id,supplier_id:p.supplier.id,fingerprint:p.fingerprint,revision:p.revision});toast(r.status==='sent'?'Solicitação enviada ao WhatsApp.':`${r.status==='uncertain'?'Envio incerto':'Falha'}: ${r.error||'Consulte o histórico.'}`);sending=false;closeModal();}finally{sending=false;if($('#send-quote')){$('#send-quote').textContent='Enviar solicitação';$('#send-quote').disabled=false;$('#quote-supplier').disabled=false;}}});
}
async function renderHistory() {
 const rows=await api('GET','/history');const labels={sending:'Em andamento',sent:'Enviada',failed:'Falha antes de concluir',uncertain:'Envio incerto',reviewed_not_received:'Conferida: não recebida'};
 $('#content').innerHTML=`<section class="panel"><h2>Solicitações de cotação</h2><p class="muted">“Enviada” indica conclusão da chamada ao WhatsApp, sem comprovar leitura pelo fornecedor.</p>${rows.map(r=>`<article class="history-row"><div class="section-head"><strong>${esc(r.supplier.name)} · ${esc(r.supplier.phone)}</strong><span class="badge ${r.status==='sent'?'action-normal':'action-attention'}">${labels[r.status]||esc(r.status)}</span></div><small>${esc(r.at.replace('T',' '))}</small>${r.error?`<p>${esc(r.error)}</p>`:''}<details><summary>Ver mensagem</summary><pre>${esc(r.message)}</pre></details>${r.status==='uncertain'?`<p>Confira a conversa no WhatsApp antes de liberar outra tentativa.</p><button class="button secondary" data-review="${r.id}" data-outcome="received">Conferi: foi recebida</button> <button class="button secondary" data-review="${r.id}" data-outcome="not_received">Conferi: não foi recebida</button>`:''}</article>`).join('')||'<div class="empty-state">Nenhuma solicitação enviada.</div>'}</section>`;
 document.querySelectorAll('[data-review]').forEach(el=>on(el,'click',async()=>{if(!confirm('Você conferiu esta mensagem na conversa do fornecedor?'))return;await api('POST','/review',{id:el.dataset.review,outcome:el.dataset.outcome});await renderHistory();}));
}
async function renderSettings() {
 $('#content').innerHTML=whatsappPanel()+`<section class="panel"><h2>Segurança dos dados</h2><p>O banco local deste módulo é criptografado e verificado quanto à integridade.</p><div id="compras-data-safety" class="notice">Verificando banco de dados…</div><div class="toolbar"><button id="compras-backup-now" class="button primary">Criar backup agora</button></div></section><section class="panel"><h2>Vyzium · Cotação &amp; Mapas · v${esc(window.vyziumAppVersion||'3.1.25')}</h2><p>Dados, mapas e filtros deste módulo continuam salvos separadamente neste computador.</p><p class="muted">A conexão do WhatsApp pertence ao Vyzium e é reutilizada pelos dois módulos. As bases operacionais de Acompanhamento e Cotação &amp; Mapas continuam independentes.</p><p class="muted">A integração usa WhatsApp Web, sem API oficial. Alterações no serviço podem exigir reconexão.</p><label>Zoom<select id="zoom">${[75,85,89,100,110].map(v=>`<option value="${v}" ${(ui.zoom||85)===v?'selected':''}>${v}%</option>`).join('')}</select></label></section>`;
 startWhatsAppPanel();
 on($('#zoom'),'change',async()=>{ui.zoom=Number($('#zoom').value);await window.followup.setZoom(ui.zoom);await persist();});
 const loadSafety=async()=>{try{const state=await api('GET','/data-safety');const protection=state.encrypted?'🔒 Criptografado com SQLCipher':'Banco legado sem criptografia';$('#compras-data-safety').innerHTML=`<strong>${state.integrity?.ok?'✓ Banco íntegro':'⚠ Verificação requer atenção'}</strong> · ${esc(protection)}<br>Schema ${esc(state.schema_version??'—')}`;}catch(e){$('#compras-data-safety').textContent='Não foi possível verificar a segurança do banco.';}};
 on($('#compras-backup-now'),'click',async e=>{const b=e.currentTarget;b.disabled=true;const old=b.textContent;b.textContent='Criando backup…';try{const r=await api('POST','/data-safety/backup',{reason:'manual',automatic:false});toast(r.created?`Backup criado: ${r.filename}`:(r.reason||'Backup não necessário.'));await loadSafety();}finally{b.disabled=false;b.textContent=old;}});
 await loadSafety();
}
(async()=>{ui=await api('GET','/settings');ui.filters??={};if(ui.zoom)await window.followup.setZoom(ui.zoom);await navigate('dashboard');})().catch(()=>{$('#content').innerHTML='<div class="notice">Não foi possível carregar o aplicativo. Reinicie e confira o motor Python.</div>';});
