// Draft stays in memory while navigating; batches and results use the encrypted engine database.
const broadcastDraft = { selected: new Set(), manual: [], message: '', job: null, pending: null };
async function renderBroadcast() {
  const data = await api('GET', '/suppliers');
  if (currentView !== 'broadcast') return;
  const suppliers = data.suppliers || [];
  content.innerHTML = `${whatsappPanel()}<section class="panel" id="broadcast-panel">
    <div class="panel-head"><div><h2>Transmissão para fornecedores</h2><p>Avise sobre novas cotações ou envie comunicados. Cada contato recebe uma mensagem individual.</p></div></div>
    <fieldset id="broadcast-fields"><label>Pesquisar fornecedores<input id="broadcast-search" placeholder="Nome, contato ou WhatsApp"></label>
    <div class="toolbar"><button class="button secondary" id="broadcast-all">Selecionar todos os cadastrados</button><button class="button secondary" id="broadcast-clear">Limpar seleção</button></div>
    <p id="broadcast-count" role="status"></p><div id="broadcast-suppliers" class="broadcast-list"></div>
    <h3>Contatos manuais</h3><p class="muted">Adicione contatos para esta transmissão, sem precisar cadastrá-los.</p>
    <div class="toolbar"><label>Nome<input id="broadcast-name" maxlength="160"></label><label>WhatsApp com DDD<input id="broadcast-phone" placeholder="(85) 99999-9999"></label><button class="button secondary" id="broadcast-add">Adicionar contato</button></div>
    <div id="broadcast-manual"></div><label>Mensagem<textarea id="broadcast-message" rows="7" maxlength="60000" placeholder="Boa tarde! Temos uma nova cotação disponível…"></textarea></label>
    <button class="button primary" id="broadcast-review">Revisar transmissão</button></fieldset>
    <div id="broadcast-review-panel"></div><div id="broadcast-progress" role="status" aria-live="polite"></div></section>`;
  startWhatsAppPanel();
  const root = document.getElementById('broadcast-panel');
  let reviewing = false, submitting = false;
  const el = id => root.querySelector('#broadcast-' + id);
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const invalidate = () => { reviewing = false; el('review-panel').innerHTML = ''; };
  const draw = () => {
    const query = norm(el('search').value).trim();
    el('suppliers').innerHTML = suppliers.filter(s => norm(`${s.display_name} ${s.contact_name} ${s.phone}`).includes(query)).map(s => `<label class="broadcast-contact"><input type="checkbox" data-key="${escapeHtml(s.supplier_key)}" ${broadcastDraft.selected.has(s.supplier_key) ? 'checked' : ''}><span><strong>${escapeHtml(s.display_name)}</strong> · ${escapeHtml(s.contact_name || '')}<small>${escapeHtml(s.active === 0 || s.active === false ? 'Desativado — será excluído na revisão' : s.phone || 'Sem WhatsApp — será excluído na revisão')}</small></span></label>`).join('') || '<p>Nenhum fornecedor encontrado.</p>';
    el('count').textContent = `${broadcastDraft.selected.size} cadastrados selecionados · ${broadcastDraft.manual.length} contatos manuais. A revisão remove números repetidos e inválidos.`;
    el('manual').innerHTML = broadcastDraft.manual.map((s,i) => `<p>${escapeHtml(s.name)} · ${escapeHtml(s.phone)} <button class="button secondary small" data-remove="${i}">Remover</button></p>`).join('');
  };
  el('message').value = broadcastDraft.message;
  el('search').addEventListener('input', draw);
  el('message').addEventListener('input', () => { broadcastDraft.message = el('message').value; invalidate(); });
  el('suppliers').addEventListener('change', e => { const key = e.target.dataset.key; if (key === undefined) return; e.target.checked ? broadcastDraft.selected.add(key) : broadcastDraft.selected.delete(key); invalidate(); draw(); });
  el('all').onclick = () => { suppliers.forEach(s => broadcastDraft.selected.add(s.supplier_key)); invalidate(); draw(); };
  el('clear').onclick = () => { broadcastDraft.selected.clear(); broadcastDraft.manual = []; invalidate(); draw(); };
  el('add').onclick = () => {
    const phone = el('phone').value.trim();
    if (!phone) return showToast('Informe o WhatsApp do contato.', true);
    broadcastDraft.manual.push({ name: el('name').value.trim() || phone, phone });
    el('name').value = ''; el('phone').value = ''; invalidate(); draw();
  };
  el('manual').onclick = e => { if (e.target.dataset.remove === undefined) return; broadcastDraft.manual.splice(Number(e.target.dataset.remove), 1); invalidate(); draw(); };
  const showState = state => {
    el('fields').disabled = Boolean(state.active || state.busy || reviewing || broadcastDraft.pending);
    if (!state.exists) { el('progress').textContent = state.busy ? 'Outro lote está em andamento. Aguarde para iniciar a transmissão.' : ''; return; }
    el('progress').innerHTML = `<h3>${state.active ? 'Transmissão em andamento' : state.phase === 'error' ? 'Transmissão interrompida' : 'Resultado do lote'}</h3><p>${state.processed || 0}/${state.total || 0} processados · ${state.sent || 0} enviados · ${state.simulated || 0} simulados · ${state.failed || 0} falhas · ${state.uncertain || 0} para conferir no WhatsApp</p>${state.error ? `<p>${escapeHtml(state.error)}</p>` : ''}${(state.result?.results || []).map(r => `<p><strong>${escapeHtml(r.supplier_name)}</strong>: ${escapeHtml(({queued:'Aguardando envio',sending:'Enviando'}[r.status] || HISTORY_STATUS_LABELS[r.status] || r.status))} ${escapeHtml(r.error || '')}</p>`).join('')}<p class="muted">Consulte também o Histórico. Envios sem confirmação exigem conferência no WhatsApp.</p>`;
  };
  const poll = async () => {
    if (!root.isConnected) return;
    try {
      const state = await api('GET', '/broadcast/status' + (broadcastDraft.job ? '?job_id=' + encodeURIComponent(broadcastDraft.job) : ''));
      if (!root.isConnected) return;
      showState(state);
      if (state.active || state.busy) setTimeout(poll, 1500);
    } catch (_) { if (root.isConnected) { el('progress').textContent = 'Não foi possível consultar o lote. Tentando novamente…'; setTimeout(poll, 4000); } }
  };
  el('review').onclick = async () => {
    const payload = {supplier_keys: [...broadcastDraft.selected], manual: broadcastDraft.manual.map(s => ({...s})), message: broadcastDraft.message};
    if (broadcastDraft.pending || reviewing) return;
    reviewing = true;
    el('review').disabled = true;
    el('fields').disabled = true;
    try {
      const preview = await api('POST', '/broadcast/preview', payload);
      if (!root.isConnected) return;
      // Freeze the reviewed selection until the user confirms or returns to editing.
      el('fields').disabled = true;
      const requestId = crypto.randomUUID();
      el('review-panel').innerHTML = `<h3>Revisão · ${preview.simulation ? 'SIMULAÇÃO — nenhuma mensagem será enviada' : 'ENVIO REAL pelo WhatsApp'}</h3><p>${preview.groups.length} números únicos receberão a mensagem.</p><div class="broadcast-list">${preview.groups.map(s => `<p>${escapeHtml(s.supplier_name)} · ${escapeHtml(s.phone)}</p>`).join('')}</div><pre class="broadcast-preview">${escapeHtml(preview.groups[0].message)}</pre>${preview.skipped.map(s => `<p>${escapeHtml(s.name)}: ${escapeHtml(s.reason)}</p>`).join('')}<div class="toolbar"><button class="button secondary" id="broadcast-edit">Voltar e editar</button><button class="button primary" id="broadcast-confirm">${preview.simulation ? 'Iniciar simulação' : 'Enviar para ' + preview.groups.length + ' contatos'}</button></div>`;
      el('edit').onclick = () => { el('fields').disabled = false; invalidate(); };
      el('confirm').onclick = () => {
        broadcastDraft.pending = {...payload, simulation: preview.simulation, snapshot_hash: preview.snapshot_hash, request_id: requestId};
        submitPending();
      };
    } catch (_) { reviewing = false; if (root.isConnected) el('fields').disabled = false; }
    finally { if (root.isConnected) el('review').disabled = false; }
  };
  async function submitPending() {
    if (submitting || !broadcastDraft.pending) return;
    submitting = true;
    el('fields').disabled = true;
    el('review-panel').innerHTML = '<p>Confirmando a transmissão…</p>';
    try {
      const state = await api('POST', '/broadcast/start', broadcastDraft.pending);
      if (state.accepted === false) {
        broadcastDraft.pending = null;
        reviewing = false;
        if (root.isConnected) {
          el('review-panel').innerHTML = '';
          el('fields').disabled = false;
          showToast(state.error, true);
        }
        return;
      }
      broadcastDraft.job = state.job_id;
      broadcastDraft.pending = null;
      reviewing = false;
      if (!root.isConnected) return;
      el('review-panel').innerHTML = '';
      await poll();
    } catch (_) {
      if (!root.isConnected) return;
      // Keep the exact request ID/payload. Editing after a lost response could duplicate delivery.
      el('review-panel').innerHTML = '<p>Não foi possível confirmar a resposta. Consulte ou retome o mesmo lote; nenhuma nova transmissão será criada.</p><button class="button primary" id="broadcast-retry">Consultar / retomar confirmação</button>';
      el('retry').onclick = submitPending;
    } finally { submitting = false; }
  }
  draw();
  el('fields').disabled = true;
  if (broadcastDraft.pending) {
    el('review-panel').innerHTML = '<p>Existe uma confirmação pendente.</p><button class="button primary" id="broadcast-retry">Consultar / retomar confirmação</button>';
    el('retry').onclick = submitPending;
  } else {
    await poll();
  }
}
