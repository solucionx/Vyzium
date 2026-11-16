// Draft stays in memory while navigating; batches and results use the encrypted engine database.
const broadcastDraft = { selected: new Set(), manual: [], message: '', job: null, requestId: null };
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
  const el = id => root.querySelector('#broadcast-' + id);
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const invalidate = () => { el('review-panel').innerHTML = ''; broadcastDraft.requestId = null; };
  const draw = () => {
    const query = norm(el('search').value);
    el('suppliers').innerHTML = suppliers.filter(s => norm(`${s.display_name} ${s.contact_name} ${s.phone}`).includes(query)).map(s => `<label class="broadcast-contact"><input type="checkbox" data-key="${escapeHtml(s.supplier_key)}" ${broadcastDraft.selected.has(s.supplier_key) ? 'checked' : ''}><span><strong>${escapeHtml(s.display_name)}</strong> · ${escapeHtml(s.contact_name || '')}<small>${escapeHtml(s.phone || 'Sem WhatsApp — será excluído na revisão')}</small></span></label>`).join('') || '<p>Nenhum fornecedor encontrado.</p>';
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
    el('fields').disabled = Boolean(state.active);
    el('progress').innerHTML = `<h3>${state.active ? 'Transmissão em andamento' : 'Resultado do lote'}</h3><p>${state.processed || 0}/${state.total || 0} processados · ${state.sent || 0} enviados · ${state.simulated || 0} simulados · ${state.failed || 0} falhas · ${state.uncertain || 0} para conferir no WhatsApp</p>${state.error ? `<p>${escapeHtml(state.error)}</p>` : ''}${(state.result?.results || []).map(r => `<p><strong>${escapeHtml(r.supplier_name)}</strong>: ${escapeHtml(HISTORY_STATUS_LABELS[r.status] || r.status)} ${escapeHtml(r.error || '')}</p>`).join('')}<p class="muted">Consulte também o Histórico. Envios sem confirmação exigem conferência no WhatsApp.</p>`;
  };
  const poll = async () => {
    if (!root.isConnected || !broadcastDraft.job) return;
    try {
      const state = await api('GET', '/send-status?job_id=' + encodeURIComponent(broadcastDraft.job));
      if (!root.isConnected) return;
      showState(state);
      if (state.active) setTimeout(poll, 1500);
    } catch (_) { if (root.isConnected) { el('progress').textContent = 'Não foi possível consultar o lote. Tentando novamente…'; setTimeout(poll, 4000); } }
  };
  el('review').onclick = async () => {
    const payload = {supplier_keys: [...broadcastDraft.selected], manual: broadcastDraft.manual.map(s => ({...s})), message: broadcastDraft.message};
    el('review').disabled = true;
    el('fields').disabled = true;
    try {
      const preview = await api('POST', '/broadcast/preview', payload);
      if (!root.isConnected) return;
      // Freeze the reviewed selection until the user confirms or returns to editing.
      el('fields').disabled = true;
      const requestId = broadcastDraft.requestId || crypto.randomUUID();
      broadcastDraft.requestId = requestId;
      el('review-panel').innerHTML = `<h3>Revisão · ${preview.simulation ? 'SIMULAÇÃO — nenhuma mensagem será enviada' : 'ENVIO REAL pelo WhatsApp'}</h3><p>${preview.groups.length} números únicos receberão a mensagem.</p><div class="broadcast-list">${preview.groups.map(s => `<p>${escapeHtml(s.supplier_name)} · ${escapeHtml(s.phone)}</p>`).join('')}</div><pre class="broadcast-preview">${escapeHtml(payload.message)}</pre>${preview.skipped.map(s => `<p>${escapeHtml(s.name)}: ${escapeHtml(s.reason)}</p>`).join('')}<div class="toolbar"><button class="button secondary" id="broadcast-edit">Voltar e editar</button><button class="button primary" id="broadcast-confirm">${preview.simulation ? 'Iniciar simulação' : 'Enviar para ' + preview.groups.length + ' contatos'}</button></div>`;
      el('edit').onclick = () => { el('fields').disabled = false; invalidate(); };
      el('confirm').onclick = async () => {
        el('confirm').disabled = true; el('edit').disabled = true;
        try {
          const state = await api('POST', '/broadcast/start', {...payload, simulation: preview.simulation, request_id: requestId});
          broadcastDraft.job = state.job_id;
          broadcastDraft.requestId = null;
          if (!root.isConnected) return;
          el('review-panel').innerHTML = ''; showState(state); poll();
        } catch (_) { if (root.isConnected) { el('confirm').disabled = false; el('edit').disabled = false; } }
      };
    } catch (_) { if (root.isConnected) el('fields').disabled = false; }
    finally { if (root.isConnected) el('review').disabled = false; }
  };
  draw();
  // Restore an active persisted batch after a page reload or application restart.
  if (!broadcastDraft.job) {
    const state = await api('GET', '/send-status');
    if (state.active) broadcastDraft.job = state.job_id;
  }
  if (broadcastDraft.job) poll();
}
