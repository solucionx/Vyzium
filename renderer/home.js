'use strict';

function homeToast(message, error = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(homeToast.timer);
  homeToast.timer = setTimeout(() => { el.className = 'toast'; }, 4200);
}

function dateTime(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString('pt-BR'); } catch (_) { return ''; }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('pt-BR') : '0';
}

function renderHomeOverview(result) {
  const followup = result?.followup || null;
  const compras = result?.compras || null;

  setText('metric-open-orders', followup ? formatCount(followup.open_orders) : '—');
  setText('metric-ready-messages', followup ? formatCount(followup.ready_messages) : '—');
  setText('metric-open-scis', compras ? formatCount(compras.total_scis) : '—');
  setText('metric-active-maps', compras ? formatCount(compras.active_maps) : '—');

  if (followup?.last_import) {
    const imported = followup.last_import;
    const name = imported.source_file || imported.filename || 'Base importada';
    const at = imported.imported_at ? ` · ${dateTime(imported.imported_at)}` : '';
    setText('followup-base', name + at);
  } else {
    setText('followup-base', followup ? 'Nenhuma base importada' : 'Resumo indisponível');
  }

  if (compras?.last_import) {
    const imported = compras.last_import;
    const name = imported.filename || 'BASE SCI importada';
    const at = imported.at ? ` · ${dateTime(imported.at)}` : '';
    setText('compras-base', name + at);
  } else {
    setText('compras-base', compras ? 'Nenhuma BASE SCI importada' : 'Resumo indisponível');
  }

  if (compras) {
    const overdue = Number(compras.overdue_maps || 0);
    const today = Number(compras.due_today_maps || 0);
    const parts = [];
    if (overdue) parts.push(`${overdue} ${overdue === 1 ? 'vencido' : 'vencidos'}`);
    if (today) parts.push(`${today} ${today === 1 ? 'vence hoje' : 'vencem hoje'}`);
    setText('metric-map-alert', parts.length ? parts.join(' · ') : 'Sem alerta de prazo');
  }
}

async function loadHomeOverview() {
  try {
    const result = await window.followup.getOverview();
    renderHomeOverview(result || {});
  } catch (error) {
    renderHomeOverview({});
    homeToast('Não foi possível carregar os resumos dos módulos.', true);
  }
}

loadHomeOverview();

// Search exists only on the home page. Each result keeps its exact record identity.
function initializeHomeSearch() {
  const input=document.getElementById('global-search'),list=document.getElementById('global-search-results'),status=document.getElementById('global-search-status');
  if(!input||!list||!status)return;
  let timer,revision=0,busy=false,opening=false;
  const labels={order:'Pedido / SCI',supplier:'Fornecedor',item:'Item / SCI',map:'Mapa de compra'};
  async function run() {
    if(busy)return;
    const query=input.value.trim(),requestRevision=revision;
    if(query.length<2)return;
    busy=true;status.textContent='Pesquisando…';
    try {
      const response=await window.followup.searchAll(query);
      if(requestRevision!==revision)return;
      list.replaceChildren();
      const rows=response.results||[];
      for(const row of rows){
        const button=document.createElement('button');button.type='button';button.className='home-search-result';
        for(const [tag,text] of [['small',labels[row.kind]||'Registro'],['strong',row.title],['span',row.subtitle]]){
          const el=document.createElement(tag);el.textContent=text;button.append(el);
        }
        button.addEventListener('click',async()=>{
          if(opening)return;opening=true;list.querySelectorAll('button').forEach(b=>b.disabled=true);
          try{await window.followup.switchModule(row.target.module,row.target);}
          catch(error){homeToast(error.message||'Não foi possível abrir o registro.',true);opening=false;list.querySelectorAll('button').forEach(b=>b.disabled=false);}
        });
        list.append(button);
      }
      const messages=[rows.length?`${rows.length} resultados. Selecione para abrir.`:'Nenhum registro encontrado.'];
      if(response.has_more)messages.push('Há mais resultados. Refine a busca.');
      if(response.errors?.length)messages.push(`Busca parcial: ${response.errors.join('; ')}. Tente novamente.`);
      status.textContent=messages.join(' ');
    }catch(error){if(requestRevision===revision){list.replaceChildren();status.textContent=error.message||'Não foi possível pesquisar. Tente novamente.';}}
    finally{busy=false;if(requestRevision!==revision&&input.value.trim().length>=2){clearTimeout(timer);timer=setTimeout(run,250);}}
  }
  input.addEventListener('input',()=>{revision++;clearTimeout(timer);list.replaceChildren();status.textContent=input.value.trim().length>=2?'Pesquisando…':'Digite ao menos 2 caracteres.';if(input.value.trim().length>=2)timer=setTimeout(run,300);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);run();}});
}
initializeHomeSearch();
