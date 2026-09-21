// Painel único do WhatsApp, compartilhado por Acompanhamento e Cotação & Mapas.
// Cada página define seu próprio helper `api` (com toast). Quando ele não
// existir, o painel fala direto com a ponte para nunca quebrar por ordem de
// carregamento dos scripts.
const whatsappApi = (method, route, body) => (typeof api === 'function'
  ? api(method, route, body)
  : window.followup.api(method, route, body));

let whatsappPoll = null;
function stopWhatsAppPanel() { clearTimeout(whatsappPoll); whatsappPoll = null; }
function whatsappPanel() {
  return `<section class="panel whatsapp-panel"><div class="panel-head"><div><h2>WhatsApp</h2><p>Conecte seu WhatsApp para realizar os envios. A sessão fica salva neste computador após a primeira conexão.</p></div><span id="wa-status" class="badge">Consultando…</span></div>
    <div class="whatsapp-body"><img id="wa-qr" class="hidden" alt="QR Code para conectar o WhatsApp" width="280" height="280">
      <div><p id="wa-description" aria-live="polite">Verificando conexão…</p><p class="muted">No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
      <div class="toolbar"><button type="button" class="button primary" id="wa-connect">Conectar / reconectar</button><button type="button" class="button secondary" id="wa-new-qr">Gerar novo QR Code</button><button type="button" class="button secondary" id="wa-pause">Pausar conexão</button></div>
      </div></div>
    </section>`;
}
function startWhatsAppPanel() {
  stopWhatsAppPanel();
  const target = document.getElementById('wa-status');
  const labels = {offline:'Desconectado',starting:'Iniciando',qr:'Aguardando QR Code',authenticated:'Sincronizando',ready:'Conectado',error:'Erro de conexão',paused:'Pausado'};
  const update = async () => {
    try {
      const data = await window.followup.api('GET','/whatsapp/status');
      if (!target.isConnected) return;
      target.textContent = labels[data.status] || data.status;
      target.className = `badge ${data.status === 'ready' ? 'status-completed' : 'status-no_due_date'}`;
      const qr = document.getElementById('wa-qr');
      if (data.qr && /^data:image\/png;base64,/.test(data.qr)) {qr.src = data.qr; qr.classList.remove('hidden');}
      else {qr.removeAttribute('src');qr.classList.add('hidden');}
      document.getElementById('wa-description').textContent = data.error || (data.status === 'ready'
        ? `Conectado${data.account ? ' ao número ' + data.account : ''}. Sessão pronta para envio.`
        : data.status === 'qr' ? 'Escaneie o QR Code. Ele será renovado automaticamente enquanto aguarda.'
        : data.status === 'authenticated' ? 'Conta autorizada. Aguarde o término da sincronização.'
        : data.status === 'paused' ? 'Conexão pausada. Clique em Retomar conexão quando quiser usar o WhatsApp novamente.'
        : data.firstConnectionPending ? 'Preparando uma conexão nova. Nenhuma sessão anterior será reutilizada; a sessão só será preservada após a primeira conexão ser concluída.'
        : 'O Vyzium tentará restaurar a sessão automaticamente. Você também pode reconectar agora.');
      const connectButton = document.getElementById('wa-connect');
      connectButton.textContent = data.status === 'paused' ? 'Retomar conexão' : (data.status === 'ready' ? 'Conectado' : (data.firstConnectionPending ? 'Conectar' : 'Conectar / reconectar'));
      connectButton.disabled = ['starting','qr','authenticated','ready'].includes(data.status);
      const newQrButton = document.getElementById('wa-new-qr');
      newQrButton.disabled = data.busy || ['qr','authenticated'].includes(data.status);
      document.getElementById('wa-pause').disabled = data.busy || data.status === 'paused';
    } catch (_) {if (target.isConnected) target.textContent = 'Não foi possível consultar a conexão.';}
    if (target.isConnected) whatsappPoll = setTimeout(update, 1500);
  };
  for (const [id, route] of [['wa-connect','/whatsapp/connect'],['wa-pause','/whatsapp/pause']]) {
    document.getElementById(id).addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try {await whatsappApi('POST', route);}
      finally {if (event.target.isConnected) event.target.disabled = false;}
    });
  }
  document.getElementById('wa-new-qr').addEventListener('click', async event => {
    if (!confirm('Gerar um novo QR Code encerrará a sessão local atual do WhatsApp neste computador. Deseja continuar?')) return;
    event.currentTarget.disabled = true;
    try { await whatsappApi('POST', '/whatsapp/new-qr'); }
    finally { if (event.target.isConnected) event.target.disabled = false; }
  });
  update();
}
