/* Local operational workspace. No remote resources or network dependencies. */
const OperationalSort = {
  columns: [
    ['urgency', 'Prazo'], ['company', 'Hotel'], ['oc', 'OC'], ['supplier_name', 'Fornecedor'],
    ['control_label', 'Controle / observação'], ['due_date', 'Previsão'],
    ['attendance_label', 'Atendimento'], ['approval_label', 'Aprovação'], ['next_action', 'Próxima ação']
  ],
  rows(rows, key, direction) {
    const rank = {critical: 0, overdue: 1, due_soon: 2, scheduled: 3, no_due_date: 4, completed: 5};
    const collator = new Intl.Collator('pt-BR', {numeric: true, sensitivity: 'base'});
    return [...rows].sort((a, b) => {
      let x = a[key], y = b[key];
      if (key === 'urgency') { x = rank[x]; y = rank[y]; }
      if (key === 'control_label') { x = `${x || ''} ${a.control_note || ''}`; y = `${y || ''} ${b.control_note || ''}`; }
      // Missing dates stay at the end in both directions.
      if (x == null || x === '') return y == null || y === '' ? 0 : 1;
      if (y == null || y === '') return -1;
      const order = typeof x === 'number' ? x - y : collator.compare(String(x), String(y));
      return (direction === 'desc' ? -1 : 1) * order;
    });
  }
};
if (typeof module !== 'undefined') module.exports = OperationalSort;

function syncControlOptions() {
  controlOptions = [['', 'Sem marcação'], ...settings.control_presets.filter(p => p.active).map(p => [p.id, p.label])];
}

function paintBubbles(root) {
  root.querySelectorAll('[data-color]').forEach(el => {
    const color = el.dataset.color;
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      el.style.color = color;
      el.style.backgroundColor = `${color}14`;
      el.style.borderColor = `${color}55`;
    }
  });
}

function readOperationalState() {
  try { return JSON.parse(localStorage.getItem('vyzium.operational') || '{}') || {}; }
  catch (_) { return {}; }
}

async function renderOperational() {
  const filters = await api('GET', '/filters');
  if (currentView !== 'operational') return;
  const state = readOperationalState();
  let sortKey = OperationalSort.columns.some(([key]) => key === state.sortKey) ? state.sortKey : 'urgency';
  let direction = state.direction === 'desc' ? 'desc' : 'asc';
  let rows = [], request = 0;
  const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  content.innerHTML = `<section class="panel operational-workspace">
    <div class="panel-head"><div><p class="section-kicker">ACOMPANHAMENTO DAS ORDENS</p><h2>Controle operacional</h2><p>Clique nos títulos para ordenar e nas bolhas para editar o controle.</p></div><span id="op-count" class="badge"></span></div>
    <div class="toolbar">
      <input id="op-search" class="search" aria-label="Buscar ordens" placeholder="Buscar OC, fornecedor, hotel ou observação">
      <select id="op-buyer" aria-label="Comprador">${option('', 'Todos os compradores')}${filters.buyers.map(v => option(v, v)).join('')}</select>
      <select id="op-company" aria-label="Hotel">${option('', 'Todos os hotéis')}${filters.companies.map(v => option(v, v)).join('')}</select>
      <select id="op-attendance_status" aria-label="Atendimento">${[['all','Todos os atendimentos'],['pending','Pendente'],['partial','Atendida parcialmente'],['attended','Atendida'],['canceled','Cancelada']].map(v => option(...v)).join('')}</select>
      <select id="op-urgency" aria-label="Prazo">${[['all','Todos os prazos'],['open','Em aberto'],['critical','Atraso crítico'],['overdue','Atrasados'],['due_soon','Próximos do prazo'],['scheduled','Programados'],['no_due_date','Sem previsão'],['completed','Concluídos']].map(v => option(...v)).join('')}</select>
      <select id="op-control_status" aria-label="Controle">${option('all','Todos os controles')}${option('blank','Sem marcação')}${controlOptions.filter(([id]) => id).map(v => option(...v)).join('')}</select>
      <button id="op-clear" class="button secondary">Limpar filtros</button>
    </div>
    <div class="table-wrap operational-full"><table><thead><tr>${OperationalSort.columns.map(([key,label]) => `<th data-key="${key}"><button type="button" class="sort-heading" data-sort="${key}">${label}<span aria-hidden="true"></span></button></th>`).join('')}</tr></thead><tbody id="op-body"></tbody></table></div>
  </section>`;
  const keys = ['search','buyer','company','attendance_status','urgency','control_status'];
  for (const key of keys) {
    const input = document.getElementById(`op-${key}`);
    const fallback = ['attendance_status','urgency','control_status'].includes(key) ? 'all' : '';
    input.value = state[key] ?? (key === 'buyer' ? settings.buyer_filter || '' : fallback);
    if (input.tagName === 'SELECT' && input.selectedIndex < 0) input.value = fallback;
  }
  const save = () => {
    const snapshot = {sortKey, direction};
    keys.forEach(key => snapshot[key] = document.getElementById(`op-${key}`).value);
    try { localStorage.setItem('vyzium.operational', JSON.stringify(snapshot)); }
    catch (_) { showToast('Não foi possível guardar os filtros neste dispositivo.', true); }
  };
  const draw = () => {
    const sorted = OperationalSort.rows(rows, sortKey, direction);
    document.getElementById('op-count').textContent = `${sorted.length} OC(s)`;
    document.getElementById('op-body').innerHTML = sorted.length ? sorted.map((row, index) => `<tr class="${orderRowClass(row)}">
      <td><span class="badge status-${escapeHtml(row.urgency)}">${escapeHtml(row.urgency_label)}</span></td>
      <td><strong>${escapeHtml(row.company)}</strong></td>
      <td><button class="text-button op-detail" data-index="${index}">${escapeHtml(row.oc)}</button><small class="muted">${row.item_count} item(ns)</small></td>
      <td>${escapeHtml(row.supplier_name)}</td>
      <td><button class="control-edit" data-index="${index}" aria-label="Editar controle da OC ${escapeHtml(row.oc)}">${controlCell(row)}</button></td>
      <td>${formatDate(row.due_date)}</td>
      <td><span class="badge attendance-${escapeHtml(row.attendance_status)}">${escapeHtml(row.attendance_label)}</span></td>
      <td><span class="badge approval-${escapeHtml(row.approval_status)}">${escapeHtml(row.approval_label)}</span></td>
      <td><span class="badge action-${escapeHtml(row.action_priority)}">${escapeHtml(row.next_action)}</span></td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty">Nenhuma ordem encontrada para os filtros selecionados.</td></tr>';
    content.querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => {
      const row = sorted[Number(button.dataset.index)];
      showOrder(row.oc, row.supplier_key);
    }));
    content.querySelectorAll('th[data-key]').forEach(th => {
      const active = th.dataset.key === sortKey;
      th.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
      th.querySelector('span').textContent = active ? (direction === 'asc' ? ' ▲' : ' ▼') : ' ↕';
    });
    paintBubbles(content);
  };
  const load = async () => {
    save();
    const seq = ++request;
    const params = new URLSearchParams(keys.map(key => [key, document.getElementById(`op-${key}`).value]));
    const response = await api('GET', `/orders?${params}`);
    if (seq !== request || currentView !== 'operational') return;
    rows = response.orders;
    draw();
  };
  content.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
    direction = sortKey === button.dataset.sort && direction === 'asc' ? 'desc' : 'asc';
    sortKey = button.dataset.sort; save(); draw();
  }));
  keys.forEach(key => document.getElementById(`op-${key}`).addEventListener(key === 'search' ? 'input' : 'change', load));
  document.getElementById('op-clear').addEventListener('click', () => {
    keys.forEach(key => document.getElementById(`op-${key}`).value = ['attendance_status','urgency','control_status'].includes(key) ? 'all' : '');
    load();
  });
  refreshCurrentOrders = load;
  await load();
}

function setupPresetEditor(initial) {
  const presets = initial.map(p => ({...p}));
  const root = document.getElementById('preset-editor');
  const render = () => {
    root.innerHTML = presets.map((p, index) => p.active ? `<div class="preset-row" data-index="${index}">
      <input class="preset-label" aria-label="Nome da recomendação" maxlength="100" value="${escapeHtml(p.label)}">
      <input class="preset-color" aria-label="Cor da recomendação" type="color" value="${escapeHtml(p.color)}">
      <select class="preset-rule" aria-label="Regra da próxima ação">${[['none','Acompanhamento geral'],['sent','Pedido enviado'],['card_payment','Pagamento no cartão'],['cancel_requested','Solicitação de cancelamento'],['waiting_supplier','Retorno do fornecedor']].map(([id,label]) => `<option value="${id}" ${p.rule === id ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <span class="badge control-bubble" data-color="${escapeHtml(p.color)}">${escapeHtml(p.label)}</span>
      <button class="button small remove-preset" type="button">Remover</button></div>` : '').join('');
    root.querySelectorAll('.preset-row').forEach(row => {
      const p = presets[Number(row.dataset.index)];
      row.addEventListener('input', () => {
        p.label = row.querySelector('.preset-label').value;
        p.color = row.querySelector('.preset-color').value;
        p.rule = row.querySelector('.preset-rule').value;
        const bubble = row.querySelector('.badge'); bubble.textContent = p.label; bubble.dataset.color = p.color;
        paintBubbles(row);
      });
      row.querySelector('.remove-preset').addEventListener('click', () => {p.active = false; render();});
    });
    paintBubbles(root);
  };
  document.getElementById('add-preset').addEventListener('click', () => {
    presets.push({id: `custom_${crypto.randomUUID()}`, label: 'Nova recomendação', color: '#007D9C', rule: 'none', active: true}); render();
  });
  document.getElementById('save-presets').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      settings = await api('POST', '/settings', {control_presets: presets});
      syncControlOptions(); showToast('Recomendações salvas.');
    } finally { document.getElementById('save-presets')?.removeAttribute('disabled'); }
  });
  render();
}
