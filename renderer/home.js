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
