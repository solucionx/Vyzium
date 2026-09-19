'use strict';

function homeToast(message, error = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(homeToast.timer);
  homeToast.timer = setTimeout(() => { el.className = 'toast'; }, 4200);
}

function setModuleStatus(id, html) {
  const target = document.getElementById(id);
  if (target) target.innerHTML = html;
}

function dateTime(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString('pt-BR'); } catch (_) { return ''; }
}

function renderHomeOverview(result) {
  const followup = result?.followup;
  const compras = result?.compras;

  if (followup) {
    const imported = followup.last_import;
    const baseName = imported?.source_file || imported?.filename || 'nenhuma base importada';
    const importedAt = imported?.imported_at ? ` · ${dateTime(imported.imported_at)}` : '';
    setModuleStatus(
      'followup-status',
      `<strong>Resumo atual:</strong> ${Number(followup.open_orders || 0).toLocaleString('pt-BR')} pedidos em aberto, ${Number(followup.ready_messages || 0).toLocaleString('pt-BR')} mensagens prontas.<br><strong>Base:</strong> ${baseName}${importedAt}`
    );
  } else {
    setModuleStatus('followup-status', '<strong>Resumo atual:</strong> módulo pronto para uso. Importe a base operacional para começar o acompanhamento.');
  }

  if (compras) {
    const imported = compras.last_import;
    const baseName = imported?.filename || 'nenhuma BASE SCI importada';
    const importedAt = imported?.at ? ` · ${dateTime(imported.at)}` : '';
    setModuleStatus(
      'compras-status',
      `<strong>Resumo atual:</strong> ${Number(compras.total_scis || 0).toLocaleString('pt-BR')} SCIs em aberto, ${Number(compras.active_maps || 0).toLocaleString('pt-BR')} mapas ativos.<br><strong>Base:</strong> ${baseName}${importedAt}`
    );
  } else {
    setModuleStatus('compras-status', '<strong>Resumo atual:</strong> módulo pronto para uso. Importe a BASE SCI para iniciar cotações e mapas.');
  }
}

async function loadHomeOverview() {
  try {
    const result = await window.followup.getOverview();
    renderHomeOverview(result || {});
  } catch (error) {
    setModuleStatus('followup-status', '<strong>Resumo atual:</strong> não foi possível carregar o resumo do Acompanhamento agora.');
    setModuleStatus('compras-status', '<strong>Resumo atual:</strong> não foi possível carregar o resumo de Cotação &amp; Mapas agora.');
    homeToast('Não foi possível carregar os resumos dos módulos.', true);
  }
}

loadHomeOverview();
