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

function normalizeMultiFilterState(value) {
  if (Array.isArray(value)) return [...new Set(value.filter(Boolean).filter(v => v !== 'all'))];
  if (!value || value === 'all') return [];
  return [value];
}

function multiFilterLabel(values, options, allLabel) {
  if (!values.length) return allLabel;
  const labels = values.map(value => options.find(([id]) => id === value)?.[1] || value);
  if (labels.length <= 2) return labels.join(' + ');
  return `${labels.length} selecionados`;
}

async function renderOperational() {
  const filters = await api('GET', '/filters');
  if (currentView !== 'operational') return;
  const state = readOperationalState();
  let sortKey = OperationalSort.columns.some(([key]) => key === state.sortKey) ? state.sortKey : 'urgency';
  let direction = state.direction === 'desc' ? 'desc' : 'asc';
  let rows = [], request = 0;

  const buyerOptions = filters.buyers.map(value => [value, value]);
  const companyOptions = filters.companies.map(value => [value, value]);
  const attendanceOptions = [['pending','Pendente'],['partial','Atendida parcialmente'],['attended','Atendida'],['canceled','Cancelada']];
  const urgencyOptions = [['open','Em aberto'],['critical','Atraso crítico'],['overdue','Atrasados'],['due_soon','Próximos do prazo'],['scheduled','Programados'],['no_due_date','Sem previsão'],['completed','Concluídos']];
  const controlFilterOptions = [['blank','Sem marcação'], ...controlOptions.filter(([id]) => id)];
  const filterConfig = {
    buyer: {title:'Comprador', allLabel:'Todos os compradores', options:buyerOptions},
    company: {title:'Hotel', allLabel:'Todos os hotéis', options:companyOptions},
    attendance_status: {title:'Atendimento', allLabel:'Todos', options:attendanceOptions},
    urgency: {title:'Prazo', allLabel:'Todos os prazos', options:urgencyOptions},
    control_status: {title:'Controle', allLabel:'Todos os controles', options:controlFilterOptions}
  };
  const selected = Object.fromEntries(Object.keys(filterConfig).map(key => [key, normalizeMultiFilterState(state[key])]));

  const multiFilterHtml = (key, config) => `<details id="op-${key}-filter" class="multi-filter">
    <summary aria-label="Filtrar por ${escapeHtml(config.title.toLowerCase())}"><span class="multi-filter-title">${escapeHtml(config.title)}</span><strong id="op-${key}-label"></strong></summary>
    <div class="multi-filter-menu" role="group" aria-label="${escapeHtml(config.title)}">
      ${config.options.map(([value,label]) => `<label class="multi-filter-option"><input type="checkbox" value="${escapeHtml(value)}" ${selected[key].includes(value) ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`).join('')}
      <button id="op-${key}-all" type="button" class="multi-filter-clear">Mostrar todos</button>
    </div>
  </details>`;

  content.innerHTML = `<section class="panel operational-workspace">
    <div class="panel-head"><div><p class="section-kicker">ACOMPANHAMENTO DAS ORDENS</p><h2>Controle operacional</h2><p>Clique nos títulos para ordenar e nas bolhas para editar o controle.</p></div><span id="op-count" class="badge"></span></div>
    <div class="toolbar">
      <input id="op-search" class="search" aria-label="Buscar ordens" placeholder="Buscar OC, fornecedor, hotel ou observação">
      ${multiFilterHtml('buyer', filterConfig.buyer)}
      ${multiFilterHtml('company', filterConfig.company)}
      ${multiFilterHtml('attendance_status', filterConfig.attendance_status)}
      ${multiFilterHtml('urgency', filterConfig.urgency)}
      ${multiFilterHtml('control_status', filterConfig.control_status)}
      <button id="op-clear" class="button secondary">Limpar filtros</button>
    </div>
    <div class="table-wrap operational-full"><table><thead><tr>${OperationalSort.columns.map(([key,label]) => `<th data-key="${key}"><button type="button" class="sort-heading" data-sort="${key}">${label}<span aria-hidden="true"></span></button></th>`).join('')}</tr></thead><tbody id="op-body"></tbody></table></div>
  </section>`;

  const searchInput = document.getElementById('op-search');
  searchInput.value = state.search || '';

  const updateFilterLabel = key => {
    const label = document.getElementById(`op-${key}-label`);
    const config = filterConfig[key];
    if (label) label.textContent = multiFilterLabel(selected[key], config.options, config.allLabel);
  };
  Object.keys(filterConfig).forEach(updateFilterLabel);

  const save = () => {
    const snapshot = {sortKey, direction, search: searchInput.value};
    Object.keys(filterConfig).forEach(key => { snapshot[key] = [...selected[key]]; });
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

  const appendValues = (params, key) => {
    if (selected[key].length) selected[key].forEach(value => params.append(key, value));
    else params.set(key, 'all');
  };

  const load = async () => {
    save();
    const seq = ++request;
    const params = new URLSearchParams();
    params.set('search', searchInput.value);
    Object.keys(filterConfig).forEach(key => appendValues(params, key));
    const response = await api('GET', `/orders?${params}`);
    if (seq !== request || currentView !== 'operational') return;
    rows = response.orders;
    draw();
  };

  content.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
    direction = sortKey === button.dataset.sort && direction === 'asc' ? 'desc' : 'asc';
    sortKey = button.dataset.sort; save(); draw();
  }));

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 180);
  });

  Object.keys(filterConfig).forEach(key => {
    const details = document.getElementById(`op-${key}-filter`);
    details.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener('change', () => {
      selected[key] = [...details.querySelectorAll('input[type="checkbox"]:checked')].map(el => el.value);
      updateFilterLabel(key);
      if (key === 'buyer') persistActiveBuyer(selected.buyer.length === 1 ? selected.buyer[0] : '');
      load();
    }));
    document.getElementById(`op-${key}-all`).addEventListener('click', () => {
      selected[key] = [];
      details.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
      updateFilterLabel(key);
      details.removeAttribute('open');
      if (key === 'buyer') persistActiveBuyer('');
      load();
    });
  });

  document.getElementById('op-clear').addEventListener('click', () => {
    searchInput.value = '';
    Object.keys(filterConfig).forEach(key => {
      selected[key] = [];
      const details = document.getElementById(`op-${key}-filter`);
      details.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
      details.removeAttribute('open');
      updateFilterLabel(key);
    });
    persistActiveBuyer('');
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
