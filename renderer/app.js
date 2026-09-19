const content = document.getElementById('content');
const title = document.getElementById('view-title');
const modeBadge = document.getElementById('mode-badge');
const toastElement = document.getElementById('toast');
const modal = document.getElementById('order-modal');
const modalContent = document.getElementById('modal-content');
let currentView = 'operational';
let settings = { simulation: true };
let refreshCurrentOrders = null;

let controlOptions = [
  ['', 'Sem marcação'],
  ['sent', 'Pedido enviado'],
  ['card_payment', 'Aguardando pagamento no cartão'],
  ['waiting_supplier', 'Aguardando retorno do fornecedor'],
  ['delivery_scheduled', 'Entrega programada'],
  ['pending', 'Pendência']
];

const titles = {
  operational: 'Controle operacional', dashboard: 'Dashboard', orders: 'Pedidos', suppliers: 'Fornecedores',
  messages: 'Mensagens', history: 'Histórico', settings: 'Configurações'
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const formatDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const formatDateTime = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
const formatPhone = value => value || 'Não cadastrado';
const formatCurrency = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });


const APP_ZOOM_KEY = 'vyzium.interfaceZoom';
const DEFAULT_APP_ZOOM = 85;
const getSavedZoom = () => {
  const value = Number(localStorage.getItem(APP_ZOOM_KEY) || DEFAULT_APP_ZOOM);
  return Number.isFinite(value) && value >= 70 && value <= 120 ? value : DEFAULT_APP_ZOOM;
};
async function applyAppZoom(percent, persist = true) {
  const value = Math.max(70, Math.min(120, Number(percent) || DEFAULT_APP_ZOOM));
  await window.followup.setZoom(value);
  if (persist) localStorage.setItem(APP_ZOOM_KEY, String(value));
  return value;
}

function showToast(message, error = false) {
  toastElement.textContent = message;
  toastElement.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastElement.className = 'toast', 4200);
}

async function api(method, route, body) {
  try {
    return await window.followup.api(method, route, body);
  } catch (error) {
    const message = String(error.message || error)
      .replace(/^Error invoking remote method ['"]api['"]:\s*Error:\s*/i, '')
      .replace(/^Error:\s*/i, '');
    showToast(message, true);
    throw error;
  }
}

function setMode() {
  modeBadge.textContent = settings.simulation ? 'Simulação' : 'Envio real';
  modeBadge.classList.toggle('real', !settings.simulation);
}

function persistActiveBuyer(value) {
  // O comprador ativo nasce exclusivamente do filtro escolhido pelo usuário.
  // A cópia no backend existe apenas para que a automação diária respeite a
  // mesma escolha, sem criar um comprador padrão no código.
  window.followup.api('POST', '/settings', { buyer_filter: String(value || '') }).catch(() => {});
}

async function navigate(view) {
  stopWhatsAppPanel();
  currentView = view;
  content.classList.toggle('operational-content', view === 'operational');
  document.body.classList.toggle('view-operational', view === 'operational');
  if (view !== 'orders') refreshCurrentOrders = null;
  title.textContent = titles[view];
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  content.innerHTML = '<div class="loading">Carregando...</div>';
  const renderers = { operational: renderOperational, dashboard: renderDashboard, orders: renderOrders, suppliers: renderSuppliers, messages: renderMessages, history: renderHistory, settings: renderSettings };
  await renderers[view]();
  paintBubbles(content);
}

function historyRows(history) {
  if (!history.length) return '<tr><td colspan="5" class="empty">Nenhuma cobrança registrada.</td></tr>';
  return history.map(row => `<tr>
    <td>${escapeHtml(formatDateTime(row.sent_at))}</td>
    <td>${escapeHtml(row.supplier_name)}</td>
    <td><span class="badge status-${escapeHtml(row.urgency)}">${escapeHtml(row.urgency)}</span></td>
    <td>${escapeHtml(({sent:'Enviado',simulated:'Simulada',uncertain:'Enviado',reviewed:'Enviado',failed:'Falha'})[row.status] || row.status)}</td>
    <td class="muted">${escapeHtml(['uncertain','reviewed'].includes(row.status) ? '—' : (row.error || '—'))}</td>
  </tr>`).join('');
}

function controlCell(row) {
  const status = row.control_status
    ? `<span class="badge control-bubble" data-color="${escapeHtml(row.control_color || '#647789')}">${escapeHtml(row.control_label)}</span>`
    : '<span class="badge control-bubble">Sem marcação</span>';
  const note = row.control_note
    ? `<div class="control-note" title="${escapeHtml(row.control_note)}">${escapeHtml(row.control_note)}</div>`
    : '';
  return status + note;
}

function orderRowClass(row) {
  return row.control_status === 'request_collection'
    ? 'row-request-collection'
    : `row-${String(row.urgency || '').replace(/[^a-z_]/gi, '')}`;
}

async function renderDashboard() {
  const persisted = readOperationalState();
  const activeBuyer = persisted.buyer || '';
  const data = await api('GET', `/dashboard?buyer=${encodeURIComponent(activeBuyer)}`);
  const importedAt = data.last_import?.imported_at ? formatDateTime(data.last_import.imported_at) : 'Nenhuma base importada';
  const sourceFile = data.last_import?.source_file || 'Importe a BASE SCI.xlsx para começar';
  const priorityRows = data.priority_orders?.length ? data.priority_orders.map(row => `<tr class="${orderRowClass(row)}">
    <td><span class="status-dot dot-${escapeHtml(row.urgency)}"></span><span class="badge status-${escapeHtml(row.urgency)}">${escapeHtml(row.urgency_label)}</span></td>
    <td><strong class="order-number">${escapeHtml(row.oc)}</strong></td>
    <td>${escapeHtml(row.company)}</td>
    <td><strong>${escapeHtml(row.supplier_name)}</strong></td>
    <td>${controlCell(row)}</td>
    <td>${formatDate(row.due_date)}</td>
    <td class="money">${formatCurrency(row.total_value)}</td>
    <td><button class="button small secondary open-dashboard-order" data-oc="${escapeHtml(row.oc)}" data-supplier="${escapeHtml(row.supplier_key)}">Detalhes</button></td>
  </tr>`).join('') : '<tr><td colspan="8" class="empty">Importe a base para visualizar os pedidos em acompanhamento.</td></tr>';
  content.innerHTML = `
    <section class="source-strip">
      <div><span class="source-label">BASE EM USO</span><strong>${escapeHtml(sourceFile)}</strong><span>Atualizada em ${escapeHtml(importedAt)}</span></div>
      <div class="source-stats"><span><strong>${data.total_orders}</strong> OCs</span><span><strong>${data.total_items}</strong> itens</span><span><strong>${escapeHtml(data.buyer_filter || 'Todos')}</strong> comprador</span></div>
    </section>
    <div class="cards operational-cards">
      <article class="card neutral dashboard-filter-card" data-dashboard-filter="open" role="button" tabindex="0"><span class="label">Pedidos em aberto</span><strong class="value">${data.open_orders}</strong><span class="detail">Acompanhamento ativo</span></article>
      <article class="card danger dashboard-filter-card" data-dashboard-filter="critical" role="button" tabindex="0"><span class="label">Atraso crítico</span><strong class="value">${data.counts.critical}</strong><span class="detail">Mais de ${data.critical_after_days} dias</span></article>
      <article class="card warning dashboard-filter-card" data-dashboard-filter="attention" role="button" tabindex="0"><span class="label">Próximos e atrasados</span><strong class="value">${data.counts.due_soon + data.counts.overdue}</strong><span class="detail">Exigem atenção agora</span></article>
      <article class="card purple dashboard-filter-card" data-dashboard-filter="card_payment" role="button" tabindex="0"><span class="label">Aguardando cartão</span><strong class="value">${data.control_counts?.card_payment || 0}</strong><span class="detail">Controle manual</span></article>
      <article class="card success dashboard-filter-card" data-dashboard-filter="sent" role="button" tabindex="0"><span class="label">Pedidos enviados</span><strong class="value">${data.control_counts?.sent || 0}</strong><span class="detail">Marcados por você</span></article>
      <article class="card collection dashboard-filter-card" data-dashboard-filter="request_collection" role="button" tabindex="0"><span class="label">Solicitar coleta</span><strong class="value">${data.control_counts?.request_collection || 0}</strong><span class="detail">Aguardam solicitação</span></article>
      <article class="card awaiting dashboard-filter-card" data-dashboard-filter="awaiting_collection" role="button" tabindex="0"><span class="label">Aguardando ser coletado</span><strong class="value">${data.control_counts?.awaiting_collection || 0}</strong><span class="detail">Coleta já solicitada</span></article>
    </div>
    <section class="panel orders-overview">
      <div class="panel-head"><div><p class="section-kicker">CONTROLE OPERACIONAL</p><h2>Pedidos em acompanhamento</h2><p>Prioridade por prazo, com a observação igual ao seu controle da planilha.</p></div><button class="button secondary" data-go="orders">Ver todos os pedidos</button></div>
      <div class="table-wrap operational-table"><table><thead><tr><th>Prazo</th><th>OC</th><th>Empresa</th><th>Fornecedor</th><th>Controle e observação</th><th>Previsão</th><th>Valor</th><th></th></tr></thead><tbody id="dashboard-orders-body">${priorityRows}</tbody></table></div>
    </section>
    <div class="split dashboard-lower">
      <section class="panel summary-panel">
        <div class="panel-head"><div><p class="section-kicker">RESUMO DA BASE</p><h2>Situação dos pedidos</h2></div></div>
        <div class="summary-grid">
          <div><span>Programados</span><strong>${data.counts.scheduled}</strong></div>
          <div><span>Sem marcação manual</span><strong>${data.control_counts?.blank || 0}</strong></div>
          <div><span>Recebimentos parciais</span><strong>${data.partial_items}</strong></div>
          <div><span>Fornecedores sem telefone</span><strong>${data.suppliers_without_phone}</strong></div>
          <div><span>Concluídos ou cancelados</span><strong>${data.counts.completed}</strong></div>
          <div><span>Valor aberto</span><strong class="money">${formatCurrency(data.total_value_open)}</strong></div>
        </div>
      </section>
      <section class="panel activity-panel">
        <div class="panel-head"><div><p class="section-kicker">FOLLOW-UP</p><h2>Atividade recente</h2></div><button class="button small secondary" data-go="history">Ver histórico</button></div>
        <div class="table-wrap compact-table"><table><thead><tr><th>Data</th><th>Fornecedor</th><th>Status</th></tr></thead><tbody>${data.last_history.length ? data.last_history.slice(0, 5).map(row => `<tr><td>${escapeHtml(formatDateTime(row.sent_at))}</td><td>${escapeHtml(row.supplier_name)}</td><td>${escapeHtml(row.status)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty small-empty">Nenhuma cobrança registrada.</td></tr>'}</tbody></table></div>
      </section>
    </div>`;
  content.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', event => navigate(event.currentTarget.dataset.go)));
  const dashboardBody = document.getElementById('dashboard-orders-body');
  const dashboardRowHtml = row => `<tr class="${orderRowClass(row)}">
    <td><span class="status-dot dot-${escapeHtml(row.urgency)}"></span><span class="badge status-${escapeHtml(row.urgency)}">${escapeHtml(row.urgency_label)}</span></td>
    <td><strong class="order-number">${escapeHtml(row.oc)}</strong></td>
    <td>${escapeHtml(row.company)}</td>
    <td><strong>${escapeHtml(row.supplier_name)}</strong></td>
    <td>${controlCell(row)}</td>
    <td>${formatDate(row.due_date)}</td>
    <td class="money">${formatCurrency(row.total_value)}</td>
    <td><button class="button small secondary open-dashboard-order" data-oc="${escapeHtml(row.oc)}" data-supplier="${escapeHtml(row.supplier_key)}">Detalhes</button></td>
  </tr>`;
  const bindDashboardDetails = () => dashboardBody?.querySelectorAll('.open-dashboard-order').forEach(button => button.addEventListener('click', () => showOrder(button.dataset.oc, button.dataset.supplier)));
  bindDashboardDetails();
  const applyDashboardFilter = filter => {
    const source = data.dashboard_orders || data.priority_orders || [];
    const rows = source.filter(row => {
      if (filter === 'open') return true;
      if (filter === 'critical') return row.urgency === 'critical';
      if (filter === 'attention') return ['due_soon','overdue'].includes(row.urgency);
      if (filter === 'card_payment') return row.control_status === 'card_payment';
      if (filter === 'sent') return row.control_status === 'sent';
      if (filter === 'request_collection') return row.control_status === 'request_collection';
      if (filter === 'awaiting_collection') return row.control_status === 'awaiting_collection';
      return true;
    });
    if (!dashboardBody) return;
    dashboardBody.innerHTML = rows.length ? rows.map(dashboardRowHtml).join('') : '<tr><td colspan="8" class="empty">Nenhuma ordem neste filtro.</td></tr>';
    bindDashboardDetails();
    paintBubbles(dashboardBody);
  };
  content.querySelectorAll('.dashboard-filter-card').forEach(card => {
    const activate = () => {
      content.querySelectorAll('.dashboard-filter-card').forEach(item => item.classList.toggle('is-active', item === card));
      applyDashboardFilter(card.dataset.dashboardFilter);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
  });
}

async function renderOrders() {
  const filters = await api('GET', '/filters');
  if (currentView !== 'orders') return;
  const persisted = readOperationalState();
  const options = [
    ['all', 'Todos os prazos'], ['open', 'Somente em aberto'], ['critical', 'Atraso crítico'],
    ['overdue', 'Atrasados'], ['due_soon', 'Próximos do prazo'], ['scheduled', 'Programados'],
    ['no_due_date', 'Sem previsão'], ['completed', 'Concluídos ou cancelados']
  ];
  const attendanceOptions = [
    ['pending', 'Pendente'], ['partial', 'Atendida parcialmente'],
    ['attended', 'Atendida'], ['canceled', 'Cancelada']
  ];
  let attendanceValues = normalizeMultiFilterState(persisted.attendance_status);
  content.innerHTML = `<section class="panel orders-panel">
    <div class="panel-head"><div><p class="section-kicker">ACOMPANHAMENTO SCI</p><h2>Controle de ordens de compra</h2><p>Clique em qualquer linha para mostrar os itens da ordem.</p></div></div>
    <div class="toolbar">
      <input id="order-search" class="search" placeholder="Buscar OC, fornecedor ou item">
      <select id="buyer-filter"><option value="">Todos os compradores</option>${filters.buyers.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select>
      <select id="company-filter"><option value="">Todas as empresas</option>${filters.companies.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select>
      <details id="attendance-filter" class="multi-filter">
        <summary aria-label="Filtrar por atendimento"><span class="multi-filter-title">Atendimento</span><strong id="attendance-filter-label"></strong></summary>
        <div class="multi-filter-menu" role="group" aria-label="Status de atendimento">
          ${attendanceOptions.map(([value,label]) => `<label class="multi-filter-option"><input type="checkbox" value="${escapeHtml(value)}" ${attendanceValues.includes(value) ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`).join('')}
          <button id="attendance-filter-all" type="button" class="multi-filter-clear">Mostrar todos</button>
        </div>
      </details>
      <select id="order-status">${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
      <select id="control-filter"><option value="all">Todos os controles</option><option value="blank">Sem marcação</option>${controlOptions.filter(([value]) => value).map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}</select>
      <span class="muted" id="order-count"></span>
    </div>
    <div class="table-wrap orders-table"><table><thead><tr><th>Hotel</th><th>Ordem</th><th>Fornecedor</th><th>Observação</th><th>Data prevista</th><th>Atendimento</th><th>WhatsApp do fornecedor</th></tr></thead><tbody id="order-body"></tbody></table></div>
  </section>`;
  const body = document.getElementById('order-body');
  let request = 0;
  const persistedFields = {
    'order-search': persisted.search ?? '',
    'buyer-filter': Object.prototype.hasOwnProperty.call(persisted, 'buyer') ? persisted.buyer : '',
    'company-filter': persisted.company ?? '',
    'order-status': persisted.urgency ?? 'all',
    'control-filter': persisted.control_status ?? 'all'
  };
  for (const [id, value] of Object.entries(persistedFields)) {
    const input = document.getElementById(id);
    if (!input) continue;
    input.value = value;
    if (input.tagName === 'SELECT' && input.selectedIndex < 0) {
      input.value = ['order-status','control-filter'].includes(id) ? 'all' : '';
    }
  }
  const updateAttendanceFilterLabel = () => {
    const label = document.getElementById('attendance-filter-label');
    if (label) label.textContent = multiFilterLabel(attendanceValues, attendanceOptions, 'Todos');
  };
  updateAttendanceFilterLabel();

  const saveOrderFilters = () => {
    const snapshot = {...readOperationalState(),
      search: document.getElementById('order-search').value,
      buyer: document.getElementById('buyer-filter').value,
      company: document.getElementById('company-filter').value,
      attendance_status: [...attendanceValues],
      urgency: document.getElementById('order-status').value,
      control_status: document.getElementById('control-filter').value
    };
    try { localStorage.setItem('vyzium.operational', JSON.stringify(snapshot)); }
    catch (_) { showToast('Não foi possível guardar os filtros neste dispositivo.', true); }
  };

  const renderPhone = row => row.phone
    ? `<div class="phone-registered"><span>${escapeHtml(formatPhone(row.phone))}</span><button class="text-button edit-phone" data-key="${escapeHtml(row.supplier_key)}" data-name="${escapeHtml(row.supplier_name)}" data-phone="${escapeHtml(row.phone)}">Editar</button></div>`
    : `<div class="phone-missing"><strong>Número não cadastrado</strong><div class="inline-phone-editor"><input class="inline-phone" inputmode="tel" placeholder="DDD + número"><button class="button small primary save-inline-phone" data-key="${escapeHtml(row.supplier_key)}" data-name="${escapeHtml(row.supplier_name)}">Salvar</button></div></div>`;

  const saveInlinePhone = async button => {
    const editor = button.closest('td').querySelector('.inline-phone-editor');
    const input = editor.querySelector('.inline-phone');
    if (!input.value.trim()) return showToast('Informe o número com DDD.', true);
    button.disabled = true;
    try {
      await api('POST', '/supplier', {
        supplier_key: button.dataset.key,
        display_name: button.dataset.name,
        phone: input.value,
        active: true
      });
      showToast(`WhatsApp de ${button.dataset.name} salvo para todas as ordens.`);
      await load();
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };

  const renderInlineDetail = data => {
    const summary = data.summary || {};
    return `<div class="inline-order-detail">
      <div class="inline-detail-head"><div><strong>Itens da OC ${escapeHtml(summary.oc)}</strong><span>${summary.item_count} item(ns) · ${formatCurrency(summary.total_value)}</span></div><button class="button small secondary edit-order-control" data-oc="${escapeHtml(summary.oc)}" data-supplier="${escapeHtml(summary.supplier_key)}">Editar observação e controle</button></div>
      <div class="items-grid"><table><thead><tr><th>Item</th><th>Pedido</th><th>Recebido</th><th>Saldo</th><th>Situação</th><th>Previsão</th><th>Nota fiscal / entrada</th></tr></thead><tbody>${data.items.map(item => {
        const receipts = item.receipts.length
          ? item.receipts.map(receipt => `NF ${escapeHtml(receipt.invoice || 's/n')} · ${formatDate(receipt.receipt_date)}`).join('<br>')
          : '<span class="muted">Sem entrada</span>';
        return `<tr><td><strong>${escapeHtml(item.article_code || '')}</strong><br>${escapeHtml(item.description)}</td><td>${Number(item.quantity || 0).toLocaleString('pt-BR')} ${escapeHtml(item.unit || '')}</td><td>${Number(item.received_qty || 0).toLocaleString('pt-BR')}</td><td>${Number(item.remaining_qty || 0).toLocaleString('pt-BR')}</td><td>${escapeHtml(item.order_status || 'Pendente')}</td><td>${formatDate(item.due_date)}</td><td>${receipts}</td></tr>`;
      }).join('')}</tbody></table></div>
    </div>`;
  };

  const load = async () => {
    saveOrderFilters();
    const seq = ++request;
    const query = document.getElementById('order-search').value;
    const buyer = document.getElementById('buyer-filter').value;
    const company = document.getElementById('company-filter').value;
    const status = document.getElementById('order-status').value;
    const controlStatus = document.getElementById('control-filter').value;
    const params = new URLSearchParams({buyer, company, urgency: status, control_status: controlStatus, search: query});
    if (attendanceValues.length) attendanceValues.forEach(value => params.append('attendance_status', value));
    else params.set('attendance_status', 'all');
    const response = await api('GET', `/orders?${params}`);
    if (seq !== request || currentView !== 'orders' || !body.isConnected) return;
    const rows = response.orders;
    document.getElementById('order-count').textContent = `${rows.length} OC(s)`;
    body.innerHTML = rows.length ? rows.slice(0, 1000).map(row => `<tr class="order-row ${orderRowClass(row)}" data-oc="${escapeHtml(row.oc)}" data-supplier="${escapeHtml(row.supplier_key)}" aria-expanded="false">
      <td><strong>${escapeHtml(row.company)}</strong></td>
      <td><span class="expand-chevron">›</span><strong class="order-number">${escapeHtml(row.oc)}</strong><small>${row.item_count} item(ns)</small></td>
      <td>${escapeHtml(row.supplier_name)}</td>
      <td>${controlCell(row)}</td>
      <td><strong>${formatDate(row.due_date)}</strong><span class="deadline-text">${escapeHtml(row.urgency_label)}</span></td>
      <td><span class="badge attendance-${escapeHtml(row.attendance_status)}">${escapeHtml(row.attendance_label)}</span></td>
      <td>${renderPhone(row)}</td>
    </tr><tr class="inline-detail-row is-hidden"><td colspan="7"><div class="inline-detail-content"></div></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Nenhuma OC encontrada.</td></tr>';

    body.querySelectorAll('.order-row').forEach(row => row.addEventListener('click', async event => {
      if (event.target.closest('button,input,select,textarea')) return;
      const detailRow = row.nextElementSibling;
      const opening = detailRow.classList.contains('is-hidden');
      detailRow.classList.toggle('is-hidden', !opening);
      row.classList.toggle('expanded', opening);
      row.setAttribute('aria-expanded', String(opening));
      if (opening && !detailRow.dataset.loaded) {
        const container = detailRow.querySelector('.inline-detail-content');
        container.innerHTML = '<div class="loading inline-loading">Carregando itens...</div>';
        const detail = await api('GET', `/order?oc=${encodeURIComponent(row.dataset.oc)}&supplier_key=${encodeURIComponent(row.dataset.supplier)}`);
        if (currentView !== 'orders' || !row.isConnected || !container.isConnected) return;
        container.innerHTML = renderInlineDetail(detail);
        detailRow.dataset.loaded = 'true';
        container.querySelector('.edit-order-control').addEventListener('click', buttonEvent => {
          const button = buttonEvent.currentTarget;
          showOrder(button.dataset.oc, button.dataset.supplier);
        });
      }
    }));
    body.querySelectorAll('.save-inline-phone').forEach(button => button.addEventListener('click', () => saveInlinePhone(button)));
    body.querySelectorAll('.edit-phone').forEach(button => button.addEventListener('click', () => {
      const cell = button.closest('td');
      cell.innerHTML = `<div class="inline-phone-editor"><input class="inline-phone" inputmode="tel" value="${escapeHtml(button.dataset.phone)}"><button class="button small primary save-inline-phone" data-key="${escapeHtml(button.dataset.key)}" data-name="${escapeHtml(button.dataset.name)}">Atualizar</button></div>`;
      const save = cell.querySelector('.save-inline-phone');
      save.addEventListener('click', () => saveInlinePhone(save));
      cell.querySelector('input').focus();
    }));
  };
  let searchTimer;
  document.getElementById('order-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); });
  ['buyer-filter', 'company-filter', 'order-status', 'control-filter'].forEach(id => document.getElementById(id).addEventListener('change', () => {
    if (id === 'buyer-filter') persistActiveBuyer(document.getElementById(id).value);
    load();
  }));
  document.querySelectorAll('#attendance-filter input[type="checkbox"]').forEach(input => input.addEventListener('change', () => {
    attendanceValues = [...document.querySelectorAll('#attendance-filter input[type="checkbox"]:checked')].map(el => el.value);
    updateAttendanceFilterLabel();
    load();
  }));
  document.getElementById('attendance-filter-all').addEventListener('click', () => {
    attendanceValues = [];
    document.querySelectorAll('#attendance-filter input[type="checkbox"]').forEach(input => { input.checked = false; });
    updateAttendanceFilterLabel();
    document.getElementById('attendance-filter').removeAttribute('open');
    load();
  });
  refreshCurrentOrders = load;
  await load();
}

async function showOrder(oc, supplierKey) {
  modal.classList.remove('hidden');
  modalContent.innerHTML = '<div class="loading">Carregando OC...</div>';
  const data = await api('GET', `/order?oc=${encodeURIComponent(oc)}&supplier_key=${encodeURIComponent(supplierKey)}`);
  const summary = data.summary || {};
  const control = data.control || { control_status: '', note: '', history: [] };
  const modalOptions = [...controlOptions];
  if (control.control_status && !modalOptions.some(([id]) => id === control.control_status)) {
    const old = settings.control_presets.find(p => p.id === control.control_status);
    modalOptions.push([control.control_status, old?.label || control.control_status]);
  }
  modalContent.innerHTML = `<p class="eyebrow">DETALHES DA ORDEM DE COMPRA</p><h1 id="modal-title">OC ${escapeHtml(oc)}</h1>
    <div class="detail-grid">
      <div class="detail-box"><span>Empresa</span><strong>${escapeHtml(summary.company)}</strong></div>
      <div class="detail-box"><span>Fornecedor</span><strong>${escapeHtml(summary.supplier_name)}</strong></div>
      <div class="detail-box"><span>Comprador</span><strong>${escapeHtml(summary.buyer)}</strong></div>
      <div class="detail-box"><span>Previsão mais próxima</span><strong>${formatDate(summary.due_date)}</strong></div>
      <div class="detail-box"><span>Situação</span><strong>${escapeHtml(summary.urgency_label)}</strong></div>
      <div class="detail-box"><span>Itens</span><strong>${summary.item_count}</strong></div>
      <div class="detail-box"><span>Parcialmente recebidos</span><strong>${summary.partial_item_count}</strong></div>
      <div class="detail-box"><span>Valor da OC</span><strong class="money">${formatCurrency(summary.total_value)}</strong></div>
    </div>
    <section class="order-control">
      <div class="control-head"><div><h2>Controle manual</h2><p>Este acompanhamento é seu e não é substituído pela importação diária.</p></div>${control.updated_at ? `<span class="muted">Atualizado em ${escapeHtml(formatDateTime(control.updated_at))}</span>` : ''}</div>
      <div class="control-form">
        <div class="field"><label for="manual-status">Situação de controle</label><select id="manual-status">${modalOptions.map(([value, label]) => `<option value="${escapeHtml(value)}" ${control.control_status === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>
        <div class="field control-note-field"><label for="manual-note">Observação</label><textarea id="manual-note" maxlength="1000" rows="3" placeholder="Ex.: fornecedor confirmou entrega na sexta-feira">${escapeHtml(control.note || '')}</textarea></div>
        <button id="save-order-control" class="button primary">Salvar controle</button>
      </div>
      <div class="quick-controls">${settings.control_presets.filter(p => p.active).map(p => `<button type="button" class="badge control-bubble quick-control" data-id="${escapeHtml(p.id)}" data-color="${escapeHtml(p.color)}">${escapeHtml(p.label)}</button>`).join('')}</div>
      ${control.sent_at ? `<p class="control-meta">Pedido marcado como enviado em ${escapeHtml(formatDateTime(control.sent_at))}.</p>` : ''}
      ${control.history?.length ? `<details class="control-history"><summary>Ver alterações anteriores</summary>${control.history.map(entry => `<div><strong>${escapeHtml(entry.control_label)}</strong> — ${escapeHtml(entry.note || 'Sem observação')} <span>${escapeHtml(formatDateTime(entry.changed_at))}</span></div>`).join('')}</details>` : ''}
    </section>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th>Situação</th><th>Pedido</th><th>Recebido</th><th>Restante</th><th>Previsão</th><th>Valor</th></tr></thead><tbody>
      ${data.items.map(item => {
        const ordered = Number(item.quantity || 0); const received = Number(item.received_qty || 0);
        const progress = ordered > 0 ? Math.min(100, Math.round(received / ordered * 100)) : 0;
        const receiptText = item.receipts.length ? item.receipts.map(receipt => `NF ${escapeHtml(receipt.invoice || 's/n')} — ${formatDate(receipt.receipt_date)} — ${Number(receipt.quantity || 0).toLocaleString('pt-BR')} ${escapeHtml(receipt.unit || item.unit || '')}`).join('<br>') : 'Nenhuma entrada registrada';
        const warning = item.data_warning ? `<div class="data-warning">⚠ ${escapeHtml(item.data_warning)}</div>` : '';
        return `<tr><td><strong>${escapeHtml(item.article_code || '')}</strong><br>${escapeHtml(item.description)}${warning}<div class="receipts">${receiptText}</div></td>
          <td><span class="badge status-${escapeHtml(item.urgency)}">${escapeHtml(item.order_status)}</span></td>
          <td>${ordered.toLocaleString('pt-BR')} ${escapeHtml(item.unit || '')}</td><td>${received.toLocaleString('pt-BR')}</td><td>${Number(item.remaining_qty || 0).toLocaleString('pt-BR')}</td>
          <td>${formatDate(item.due_date)}</td><td class="money">${formatCurrency(item.value_total)}<progress class="progress" max="100" value="${progress}"></progress></td></tr>`;
      }).join('')}
    </tbody></table></div>`;
  paintBubbles(modalContent);
  modalContent.querySelectorAll('.quick-control').forEach(button => button.addEventListener('click', () => {
    document.getElementById('manual-status').value = button.dataset.id;
    modalContent.querySelectorAll('.quick-control').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
  document.getElementById('save-order-control').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Salvando...';
    try {
      await api('POST', '/order-control', {
        oc,
        supplier_key: supplierKey,
        control_status: document.getElementById('manual-status').value,
        note: document.getElementById('manual-note').value
      });
      showToast(`Controle da OC ${oc} salvo.`);
      if (refreshCurrentOrders) await refreshCurrentOrders();
      await showOrder(oc, supplierKey);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = 'Salvar controle';
      }
    }
  });
}

document.getElementById('modal-close').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });

async function renderSuppliers() {
  const data = await api('GET', '/suppliers');
  content.innerHTML = `<section class="panel">
    <div class="panel-head"><div><h2>Cadastro de fornecedores</h2><p>Os nomes vêm da planilha. Informe o WhatsApp com DDD.</p></div><span class="badge">${data.suppliers.length} fornecedores</span></div>
    <div class="toolbar"><input id="supplier-search" class="search" placeholder="Buscar fornecedor"><select id="phone-filter"><option value="all">Todos</option><option value="missing">Sem telefone</option><option value="ready">Com telefone</option></select></div>
    <div class="table-wrap"><table><thead><tr><th>Fornecedor</th><th>Contato</th><th>WhatsApp</th><th>Itens</th><th>Ação</th></tr></thead><tbody id="supplier-body"></tbody></table></div>
  </section>`;
  const body = document.getElementById('supplier-body');
  const render = () => {
    const query = document.getElementById('supplier-search').value.toLowerCase();
    const filter = document.getElementById('phone-filter').value;
    const rows = data.suppliers.filter(row => row.display_name.toLowerCase().includes(query) &&
      (filter === 'all' || (filter === 'missing' && !row.phone) || (filter === 'ready' && row.phone)));
    body.innerHTML = rows.length ? rows.map(row => `<tr data-key="${escapeHtml(row.supplier_key)}">
      <td><strong>${escapeHtml(row.display_name)}</strong></td>
      <td><input class="contact" value="${escapeHtml(row.contact_name)}" placeholder="Nome do contato"></td>
      <td><input class="phone" value="${escapeHtml(row.phone)}" placeholder="(85) 99999-9999"></td>
      <td>${row.order_items}</td>
      <td><button class="button small save-supplier">Salvar</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">Nenhum fornecedor encontrado.</td></tr>';
    body.querySelectorAll('.save-supplier').forEach(button => button.addEventListener('click', saveSupplier));
  };
  async function saveSupplier(event) {
    const row = event.target.closest('tr');
    const original = data.suppliers.find(item => item.supplier_key === row.dataset.key);
    event.target.disabled = true;
    try {
      const saved = await api('POST', '/supplier', {
        supplier_key: row.dataset.key, display_name: original.display_name,
        contact_name: row.querySelector('.contact').value,
        phone: row.querySelector('.phone').value, active: true
      });
      original.contact_name = saved.contact_name; original.phone = saved.phone;
      row.querySelector('.phone').value = saved.phone;
      showToast('Fornecedor atualizado.');
    } finally { event.target.disabled = false; }
  }
  document.getElementById('supplier-search').addEventListener('input', render);
  document.getElementById('phone-filter').addEventListener('change', render);
  render();
}

async function renderMessages() {
  const persisted = readOperationalState();
  const activeBuyer = persisted.buyer || '';
  const data = await api('GET', `/preview?buyer=${encodeURIComponent(activeBuyer)}`);
  content.innerHTML = `${whatsappPanel()}<div class="split">
    <section class="panel">
      <div class="panel-head"><div><h2>Prévia das mensagens</h2><p>Confira antes de iniciar. Pedidos do mesmo fornecedor já estão agrupados.</p></div></div>
      <div class="message-list">${data.groups.length ? data.groups.map((group, index) => `<article class="message-card ${group.blocked_reasons.length ? 'blocked' : ''}">
        <div class="message-head">
          <input type="checkbox" class="group-check" data-key="${escapeHtml(group.supplier_key)}" ${group.blocked_reasons.length ? 'disabled' : 'checked'}>
          <strong>${escapeHtml(group.supplier_name)}</strong>
          <span class="badge status-${escapeHtml(group.urgency)}">${group.order_count} OC(s)</span>
        </div>
        ${group.blocked_reasons.length ? `<div class="callout">Bloqueado: ${escapeHtml(group.blocked_reasons.join(', '))}</div>` : ''}
        <div class="message-edit-wrap">
          <div class="message-edit-bar"><span>Mensagem que será enviada</span><button type="button" class="button small reset-message" data-key="${escapeHtml(group.supplier_key)}" ${group.blocked_reasons.length ? 'disabled' : ''}>Restaurar padrão</button></div>
          <textarea class="message-editor" data-key="${escapeHtml(group.supplier_key)}" rows="14" maxlength="60000" ${group.blocked_reasons.length ? 'disabled' : ''}>${escapeHtml(group.message)}</textarea>
          <div class="message-edit-help"><span>Você pode editar livremente antes do envio. A alteração vale somente para este lote.</span><span class="message-char-count" data-key="${escapeHtml(group.supplier_key)}">${group.message.length} caracteres</span></div>
        </div>
      </article>`).join('') : '<div class="empty">Nenhuma mensagem elegível. Importe uma planilha ou complete os telefones.</div>'}</div>
    </section>
    <aside class="panel">
      <div class="panel-head"><div><h2>Executar lote</h2><p>${settings.simulation ? 'Nenhuma mensagem real será enviada.' : 'Envio em segundo plano. O lote aguarda até 2 minutos pela conexão antes de começar.'}</p></div></div>
      <div class="callout">Um clique inicia o lote inteiro. O Vyzium envia automaticamente para cada fornecedor selecionado, confirma cada envio no servidor do WhatsApp e segue para o próximo sem pedir nova confirmação.</div>
      <div class="metric-row"><span>Grupos disponíveis</span><strong>${data.groups.filter(group => !group.blocked_reasons.length).length}</strong></div>
      <div class="metric-row"><span>Modo atual</span><strong>${settings.simulation ? 'Simulação' : 'Real'}</strong></div>
      <div id="batch-progress" class="batch-progress hidden" aria-live="polite">
        <div class="batch-progress-head"><span id="batch-progress-label">Preparando lote…</span><strong id="batch-progress-count">0/0</strong></div>
        <progress id="batch-progress-bar" max="1" value="0"></progress>
        <small id="batch-progress-detail" class="muted">Aguardando início.</small>
      </div>
      <button id="send-button" class="button full-button ${settings.simulation ? 'primary' : 'danger'}" ${data.groups.some(group => !group.blocked_reasons.length) ? '' : 'disabled'}>${settings.simulation ? 'Executar lote de simulação' : 'Enviar lote pelo WhatsApp'}</button>
    </aside>
  </div>`;
  startWhatsAppPanel();

  const originalMessages = new Map(data.groups.map(group => [group.supplier_key, group.message]));
  const updateMessageCount = textarea => {
    const counter = document.querySelector(`.message-char-count[data-key="${CSS.escape(textarea.dataset.key)}"]`);
    if (counter) counter.textContent = `${textarea.value.length} caracteres`;
  };
  document.querySelectorAll('.message-editor').forEach(textarea => {
    textarea.addEventListener('input', () => updateMessageCount(textarea));
  });
  document.querySelectorAll('.reset-message').forEach(button => button.addEventListener('click', () => {
    const textarea = document.querySelector(`.message-editor[data-key="${CSS.escape(button.dataset.key)}"]`);
    if (!textarea) return;
    textarea.value = originalMessages.get(button.dataset.key) || '';
    updateMessageCount(textarea);
    textarea.focus();
    showToast('Mensagem restaurada para o texto automático.');
  }));

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const updateBatchProgress = state => {
    const box = document.getElementById('batch-progress');
    if (!box) return;
    box.classList.remove('hidden');
    const total = Number(state.total || 0);
    const processed = Number(state.processed || 0);
    const bar = document.getElementById('batch-progress-bar');
    bar.max = Math.max(1, total);
    bar.value = Math.min(processed, Math.max(1, total));
    document.getElementById('batch-progress-count').textContent = `${processed}/${total}`;
    document.getElementById('batch-progress-label').textContent = state.active
      ? (state.current_supplier ? `Enviando para ${state.current_supplier}` : 'Preparando lote…')
      : state.phase === 'done' ? 'Lote concluído' : state.phase === 'error' ? 'Lote interrompido' : 'Lote finalizado';
    const parts = [`${state.sent || 0} enviada(s)`, `${state.failed || 0} falha(s)`];
    if (state.uncertain) parts.push(`${state.uncertain} para conferência`);
    if (state.simulated) parts.push(`${state.simulated} simulada(s)`);
    document.getElementById('batch-progress-detail').textContent = state.error || parts.join(' · ');
  };

  document.getElementById('send-button')?.addEventListener('click', async event => {
    const supplierKeys = [...document.querySelectorAll('.group-check:checked')].map(check => check.dataset.key);
    if (!supplierKeys.length) return showToast('Selecione pelo menos um fornecedor.', true);
    const messageOverrides = {};
    for (const key of supplierKeys) {
      const textarea = document.querySelector(`.message-editor[data-key="${CSS.escape(key)}"]`);
      if (!textarea || !textarea.value.trim()) return showToast('A mensagem não pode ficar vazia.', true);
      messageOverrides[key] = textarea.value.trim();
    }
    if (!settings.simulation && !confirm(`Iniciar um único lote com ${supplierKeys.length} fornecedor(es)? O Vyzium seguirá automaticamente até concluir a fila.`)) return;
    event.target.disabled = true;
    event.target.textContent = settings.simulation ? 'Executando lote…' : 'Lote em andamento…';
    try {
      let state = await api('POST', '/send-start', { supplier_keys: supplierKeys, message_overrides: messageOverrides, buyer: activeBuyer });
      updateBatchProgress(state);
      while (state.active) {
        await sleep(650);
        state = await api('GET', `/send-status?job_id=${encodeURIComponent(state.job_id)}`);
        updateBatchProgress(state);
      }
      if (state.phase === 'error') throw new Error(state.error || 'O lote foi interrompido.');
      const result = state.result || {};
      const needsReview = Number(result.failed || 0) > 0 || Number(result.uncertain || 0) > 0 || result.aborted;
      showToast(
        `Lote concluído: ${result.sent || 0} enviada(s), ${result.simulated || 0} simulada(s), ${result.failed || 0} falha(s)${result.uncertain ? `, ${result.uncertain} para conferência` : ''}.`,
        needsReview
      );
      if (currentView === 'messages') {
        await sleep(900);
        await renderMessages();
      }
    } finally {
      if (event.target.isConnected) {
        event.target.disabled = false;
        event.target.textContent = settings.simulation ? 'Executar lote de simulação' : 'Enviar lote pelo WhatsApp';
      }
    }
  });

}

async function renderHistory() {
  const data = await api('GET', '/history');
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Histórico de cobranças</h2><p>Registro local de envios, simulações e falhas.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Data</th><th>Fornecedor</th><th>Urgência</th><th>Status</th><th>Observação</th></tr></thead><tbody>${historyRows(data.history)}</tbody></table></div></section>`;
  content.querySelectorAll('.review-followup').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Confira a conversa no WhatsApp. Libere somente se a mensagem NÃO foi enviada. Deseja permitir uma nova tentativa?')) return;
    button.disabled = true;
    try {await api('POST','/followup-reviewed',{id:Number(button.dataset.id)});await renderHistory();}
    finally {if (button.isConnected) button.disabled = false;}
  }));
}

function dataSafetyPanelHtml() {
  return `<section class="panel narrow" id="data-safety-panel">
    <div class="panel-head"><div><h2>Segurança dos dados</h2><p>Backups SQLite consistentes e verificação de integridade da base em uso.</p></div></div>
    <div id="data-safety-status" class="callout">Verificando banco de dados…</div>
    <div class="toolbar" style="margin-top:12px">
      <button id="create-db-backup" class="button primary" type="button">Criar backup agora</button>
      <button id="open-db-backups" class="button secondary" type="button">Abrir pasta de backups</button>
    </div>
    <p class="muted">O Vyzium cria backups automáticos antes de importações, mudanças de versão e atualizações. Backups automáticos antigos são limitados; backups manuais não são removidos automaticamente.</p>
  </section>`;
}

async function refreshDataSafetyPanel() {
  const target = document.getElementById('data-safety-status');
  if (!target) return;
  try {
    const state = await api('GET', '/data-safety');
    const ok = state.integrity?.ok;
    const last = state.last_backup;
    const when = last?.created_at ? new Date(last.created_at).toLocaleString('pt-BR') : 'Nenhum backup registrado';
    const backupWarning = last && last.valid_now === false ? '<br><small>⚠ O último backup não passou na revalidação atual. Crie um novo backup antes de operações críticas.</small>' : '';
    target.innerHTML = `<strong>${ok ? '✓ Banco íntegro' : '⚠ Verificação requer atenção'}</strong><br>` +
      `Schema ${escapeHtml(state.schema_version ?? '—')} · ${escapeHtml(state.backup_count ?? 0)} backup(s)<br>` +
      `<small>Último backup: ${escapeHtml(when)}${last?.reason ? ` · ${escapeHtml(last.reason)}` : ''}</small>${backupWarning}`;
    target.classList.toggle('notice', !ok || Boolean(last && last.valid_now === false));
  } catch (error) {
    target.textContent = `Não foi possível verificar a segurança do banco: ${String(error.message || error)}`;
  }
}

function wireDataSafetyPanel() {
  document.getElementById('create-db-backup')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Criando backup…';
    try {
      const result = await api('POST', '/data-safety/backup', { reason: 'manual', automatic: false });
      showToast(result.created ? `Backup criado: ${result.filename}` : (result.reason || 'Backup não necessário.'));
      await refreshDataSafetyPanel();
    } catch (error) {
      showToast(`Falha ao criar backup: ${String(error.message || error)}`, true);
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  });
  document.getElementById('open-db-backups')?.addEventListener('click', async () => {
    try { await window.followup.openBackupFolder(); }
    catch (error) { showToast(`Não foi possível abrir os backups: ${String(error.message || error)}`, true); }
  });
}

async function renderSettings() {
  const data = await api('GET', '/settings');
  content.innerHTML = `${whatsappPanel()}${dataSafetyPanelHtml()}<section class="panel narrow">
    <div class="panel-head"><div><h2>Regras do motor</h2><p>Os ajustes passam a valer na próxima análise.</p></div></div>
    <form id="settings-form" class="form-grid">
      <div class="field"><label>Dias para alertar antes do vencimento</label><input name="warning_days" type="number" min="0" max="30" value="${data.warning_days}"></div>
      <div class="field"><label>Atraso crítico depois de quantos dias</label><input name="critical_after_days" type="number" min="1" max="365" value="${data.critical_after_days}"></div>
      <div class="field"><label>Intervalo anti-spam (horas)</label><input name="cooldown_hours" type="number" min="1" max="8760" value="${data.cooldown_hours}"></div>
      <div class="field full"><label>Identificação do remetente</label><input name="sender_name" value="${escapeHtml(data.sender_name)}"></div>
      <div class="field full"><label>Assinatura da mensagem</label><textarea name="message_signature" rows="3">${escapeHtml(data.message_signature)}</textarea></div>
      <label class="switch-line field full"><input name="simulation" type="checkbox" ${data.simulation ? 'checked' : ''}><span>Modo simulação (recomendado durante a configuração)</span></label>
      <div class="field"><label>Horário da execução diária</label><input name="schedule_time" type="time" value="${escapeHtml(data.schedule_time)}"></div>
      <label class="switch-line field"><input name="automatic_enabled" type="checkbox" ${data.automatic_enabled ? 'checked' : ''}><span>Ativar envio automático diário</span></label>
      <div class="field full"><label>Zoom da interface</label><select id="app-zoom" aria-label="Zoom da interface">${[70,75,80,85,90,95,100,105,110,115,120].map(value => `<option value="${value}" ${value === getSavedZoom() ? 'selected' : ''}>${value}%</option>`).join('')}</select></div>
      <div class="field full"><div class="callout">O envio diário exige modo simulação desligado, aplicativo aberto, computador ligado e com internet, e WhatsApp conectado. Antes do disparo, o motor relê a última planilha importada. Não funciona com o computador suspenso.</div></div>
      <div class="field full"><button class="button primary" type="submit">Salvar configurações</button></div>
    </form>
  </section><section class="panel"><div class="panel-head"><div><h2>Recomendações de controle</h2><p>Edite o nome, a cor e a regra da próxima ação. Remover oculta a sugestão, sem apagar marcações anteriores.</p></div><button type="button" class="button secondary" id="add-preset">Adicionar recomendação</button></div><div id="preset-editor"></div><button type="button" id="save-presets" class="button primary">Salvar recomendações</button></section>`;
  setupPresetEditor(data.control_presets);
  startWhatsAppPanel();
  wireDataSafetyPanel();
  await refreshDataSafetyPanel();
  document.getElementById('app-zoom')?.addEventListener('change', async event => {
    try {
      await applyAppZoom(event.currentTarget.value);
      showToast(`Zoom ajustado para ${event.currentTarget.value}%.`);
    } catch (_) {
      showToast('Não foi possível ajustar o zoom.', true);
    }
  });
  document.getElementById('settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    settings = await api('POST', '/settings', {
      warning_days: Number(form.get('warning_days')),
      critical_after_days: Number(form.get('critical_after_days')),
      cooldown_hours: Number(form.get('cooldown_hours')),
      sender_name: form.get('sender_name'),
      message_signature: form.get('message_signature'),
      simulation: event.target.elements.simulation.checked,
      schedule_time: form.get('schedule_time'),
      automatic_enabled: event.target.elements.automatic_enabled.checked
    });
    setMode(); showToast('Configurações salvas.');
  });
}

document.getElementById('navigation').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) navigate(button.dataset.view);
});

document.getElementById('import-button').addEventListener('click', async event => {
  const path = await window.followup.chooseWorkbook();
  if (!path) return;
  event.target.disabled = true; event.target.textContent = 'Importando...';
  try {
    const result = await api('POST', '/import', { path });
    showToast(`${result.read} linhas lidas. ${result.order_items} itens consolidados, ${result.receipts} recebimentos, ${result.duplicate_rows} duplicidades removidas e ${result.skipped} linhas sem OC ignoradas.`);
    await navigate('operational');
  } finally { event.target.disabled = false; event.target.textContent = 'Importar planilha'; }
});

(async () => {
  document.body.classList.add('compact-ui');
  try { await applyAppZoom(getSavedZoom(), false); } catch (_) {}
  settings = await api('GET', '/settings');
  syncControlOptions();
  setMode();
  await navigate(currentView);
})();
