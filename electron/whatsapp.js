const fs = require('fs');
const path = require('path');
const http = require('http');

function findBrowser() {
  const candidates = [process.env.VYZIUM_BROWSER_PATH];
  for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
    if (base) {
      for (const suffix of ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe']) {
        candidates.push(path.join(base, suffix));
      }
    }
  }
  candidates.push(
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  );
  const browser = candidates.find(p => p && fs.existsSync(p));
  if (!browser) throw new Error('Instale o Microsoft Edge ou Google Chrome para conectar o WhatsApp.');
  return browser;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function messageIdentity(message) {
  if (!message) return null;
  if (typeof message === 'string') return message.trim() || null;
  const id = message.id ?? message?._data?.id;
  if (typeof id === 'string') return id.trim() || null;
  if (id && typeof id._serialized === 'string' && id._serialized) return id._serialized;
  // Some whatsapp-web.js/WA Web combinations expose the raw id without
  // _serialized for a short period immediately after sendMessage().
  if (id && typeof id.id === 'string' && id.id) return id.id;
  return null;
}

function phoneCandidates(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return [];
  const candidates = [digits];

  // High-confidence repair for legacy Brazilian mobile numbers:
  // +55 + DDD (2) + old 8-digit mobile beginning with 6-9.
  if (digits.startsWith('55') && digits.length === 12 && /[6-9]/.test(digits[4])) {
    const repaired = `${digits.slice(0, 4)}9${digits.slice(4)}`;
    if (!candidates.includes(repaired)) candidates.push(repaired);
  }
  return candidates;
}

async function bounded(promise, ms, message = 'Tempo limite excedido.') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class WhatsAppSession {
  constructor(dataDir, deps = {}) {
    this.dataDir = dataDir;
    this.deps = deps;
    this.client = null;
    this.starting = null;
    this.busy = false;
    this.generation = 0;
    this.ackTimeoutMs = Number(deps.ackTimeoutMs || 45000);
    this.sendTimeoutMs = Number(deps.sendTimeoutMs || 45000);
    this.numberTimeoutMs = Number(deps.numberTimeoutMs || 15000);
    this.healthTimeoutMs = Number(deps.healthTimeoutMs || 5000);
    this.healthIntervalMs = Number(deps.healthIntervalMs || 15000);
    this.healthFailureThreshold = Number(deps.healthFailureThreshold || 3);
    this.authenticatedTimeoutMs = Number(deps.authenticatedTimeoutMs || 45000);
    this.reconnectBaseMs = Number(deps.reconnectBaseMs || 5000);
    this.reconnectMaxMs = Number(deps.reconnectMaxMs || 60000);
    this.readyAt = 0;
    this.lastHealthCheckAt = 0;
    this.lastAckAt = 0;
    this.ackCache = new Map();
    this.ackWaiters = new Map();
    this.monitorTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.consecutiveHealthFailures = 0;
    this.lastHealthyAt = 0;
    this.authenticatedAt = 0;
    this.preferenceFile = path.join(this.dataDir, 'connection-preference.json');
    this.userPaused = this._loadPausedPreference();
    this.state = this.userPaused
      ? {status:'paused', qr:null, account:null, error:null}
      : {status:'offline', qr:null, account:null, error:null};
  }

  status() {
    return {
      ...this.state,
      busy: this.busy,
      monitoring: Boolean(this.monitorTimer) && !this.userPaused,
      lastHealthCheckAt: this.lastHealthCheckAt || null,
      lastHealthyAt: this.lastHealthyAt || null,
      lastAckAt: this.lastAckAt || null,
      healthFailures: this.consecutiveHealthFailures
    };
  }

  _loadPausedPreference() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.preferenceFile, 'utf8'));
      return raw?.paused === true;
    } catch (_) {
      return false;
    }
  }

  _savePausedPreference(paused) {
    try {
      fs.mkdirSync(this.dataDir, {recursive:true, mode:0o700});
      const temp = `${this.preferenceFile}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({paused:Boolean(paused)}), {encoding:'utf8', mode:0o600});
      fs.renameSync(temp, this.preferenceFile);
    } catch (_) {
      // A failure to persist this preference must not break WhatsApp itself.
    }
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  _scheduleReconnect(immediate = false) {
    if (this.userPaused || this.reconnectTimer || this.starting || this.busy) return;
    if (['starting','qr','authenticated'].includes(this.state.status)) return;
    const attempt = this.reconnectAttempts++;
    const wait = immediate ? 0 : Math.min(this.reconnectMaxMs, this.reconnectBaseMs * Math.max(1, 2 ** Math.min(attempt, 4)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.userPaused || this.busy) return;
      this._connectInternal().catch(() => this._scheduleReconnect(false));
    }, wait);
    this.reconnectTimer.unref?.();
  }

  startMonitoring() {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(async () => {
      if (this.userPaused || this.busy || this.starting) return;
      if (this.state.status === 'qr') return;
      if (this.state.status === 'authenticated') {
        if (!this.authenticatedAt) this.authenticatedAt = Date.now();
        if (Date.now() - this.authenticatedAt < this.authenticatedTimeoutMs) return;
        // A session can occasionally authenticate but never reach `ready`.
        // Treat that as a stalled synchronization and renew it silently instead
        // of leaving a batch waiting forever at the same percentage.
        try { await this.restartConnection(); }
        catch (_) { this._scheduleReconnect(false); }
        return;
      }
      if (this.state.status === 'ready') {
        const healthy = await this.connectionHealthy();
        if (healthy) {
          this.consecutiveHealthFailures = 0;
          this.reconnectAttempts = 0;
          return;
        }
        this.consecutiveHealthFailures += 1;
        // One delayed getState() is not enough to tear down a healthy-looking
        // session. Only consecutive failures promote it to offline.
        if (this.consecutiveHealthFailures < this.healthFailureThreshold) return;
        this.readyAt = 0;
        this.state = {status:'offline', qr:null, account:null, error:'Conexão interrompida. O Vyzium está tentando restaurá-la automaticamente.'};
      }
      if (['offline','error'].includes(this.state.status)) this._scheduleReconnect(false);
    }, this.healthIntervalMs);
    this.monitorTimer.unref?.();
  }

  async backgroundHealthCheck() {
    this.startMonitoring();
    if (this.userPaused) return {healthy:false, paused:true, status:'paused'};
    if (this.busy || this.starting || ['qr','starting'].includes(this.state.status)) {
      return {healthy:false, paused:false, status:this.state.status};
    }
    if (this.state.status === 'authenticated') {
      if (!this.authenticatedAt) this.authenticatedAt = Date.now();
      if (Date.now() - this.authenticatedAt >= this.authenticatedTimeoutMs) {
        try { await this.restartConnection(); }
        catch (_) { this._scheduleReconnect(false); }
      }
      return {healthy:false, paused:false, status:this.state.status};
    }
    if (this.state.status === 'ready') {
      const healthy = await this.connectionHealthy();
      if (healthy) {
        this.consecutiveHealthFailures = 0;
        this.reconnectAttempts = 0;
        return {healthy:true, paused:false, status:'ready'};
      }
      this.consecutiveHealthFailures += 1;
      if (this.consecutiveHealthFailures >= this.healthFailureThreshold) {
        this.readyAt = 0;
        this.state = {status:'offline', qr:null, account:null, error:'Conexão interrompida. O Vyzium está tentando restaurá-la automaticamente.'};
      }
    }
    if (['offline','error'].includes(this.state.status)) this._scheduleReconnect(false);
    return {healthy:false, paused:false, status:this.state.status};
  }

  autoStart() {
    this.startMonitoring();
    if (!this.userPaused) this._scheduleReconnect(true);
    return this.status();
  }

  _clearAckWaiters(errorMessage = 'Conexão do WhatsApp encerrada antes da confirmação do envio.') {
    for (const waiter of this.ackWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(errorMessage));
    }
    this.ackWaiters.clear();
  }

  _rememberAck(message, ack) {
    const id = messageIdentity(message);
    if (!id || typeof ack !== 'number') return;

    const now = Date.now();
    this.ackCache.set(id, {ack, at: now});
    if (ack >= 1) this.lastAckAt = now;

    // Keep the cache bounded and short-lived.
    for (const [cachedId, value] of this.ackCache.entries()) {
      if (now - value.at > 120000) this.ackCache.delete(cachedId);
    }

    const waiter = this.ackWaiters.get(id);
    if (!waiter) return;

    if (ack >= 1) {
      clearTimeout(waiter.timer);
      this.ackWaiters.delete(id);
      waiter.resolve(ack);
    } else if (ack < 0) {
      clearTimeout(waiter.timer);
      this.ackWaiters.delete(id);
      waiter.reject(new Error('O WhatsApp rejeitou o envio antes da confirmação do servidor.'));
    }
  }

  async _pollMessageAck(message, messageId, timeout) {
    const deadline = Date.now() + timeout;
    let current = message;

    while (Date.now() < deadline && this.ackWaiters.has(messageId)) {
      // Some WhatsApp Web builds update Message.ack correctly but fail to emit
      // message_ack to whatsapp-web.js. Read the message itself as a second,
      // independent confirmation path.
      const directAck = Number(current?.ack);
      if (Number.isFinite(directAck)) {
        this._rememberAck(current, directAck);
        if (!this.ackWaiters.has(messageId)) return;
      }

      try {
        const remaining = Math.max(250, deadline - Date.now());
        if (typeof current?.reload === 'function') {
          const refreshed = await bounded(
            current.reload(),
            Math.min(2500, remaining),
            'Tempo limite ao atualizar o status da mensagem.'
          );
          if (refreshed) current = refreshed;
        } else if (this.client && typeof this.client.getMessageById === 'function') {
          const refreshed = await bounded(
            this.client.getMessageById(messageId),
            Math.min(2500, remaining),
            'Tempo limite ao consultar a mensagem enviada.'
          );
          if (refreshed) current = refreshed;
        }

        const refreshedAck = Number(current?.ack);
        if (Number.isFinite(refreshedAck)) {
          this._rememberAck(current, refreshedAck);
          if (!this.ackWaiters.has(messageId)) return;
        }
      } catch (_) {
        // A transient cache/read failure must not turn a real delivery into a
        // false failure. The event listener remains active while we retry.
      }

      await delay(Math.min(750, Math.max(100, deadline - Date.now())));
    }
  }

  async _waitForAckWithoutStableId(message, timeout) {
    const deadline = Date.now() + timeout;
    let current = message;
    while (Date.now() < deadline) {
      const ack = Number(current?.ack);
      if (Number.isFinite(ack)) {
        if (ack >= 1) { this.lastAckAt = Date.now(); return ack; }
        if (ack < 0) throw new Error('O WhatsApp rejeitou o envio.');
      }
      try {
        const remaining = Math.max(250, deadline - Date.now());
        if (typeof current?.reload === 'function') {
          const refreshed = await bounded(
            current.reload(),
            Math.min(2500, remaining),
            'Tempo limite ao atualizar o status da mensagem.'
          );
          if (refreshed) current = refreshed;
          const refreshedAck = Number(current?.ack);
          if (Number.isFinite(refreshedAck)) {
            if (refreshedAck >= 1) { this.lastAckAt = Date.now(); return refreshedAck; }
            if (refreshedAck < 0) throw new Error('O WhatsApp rejeitou o envio.');
          }
        }
      } catch (_) {
        // Keep waiting. A temporary cache failure is not proof of delivery
        // failure and must not force a healthy session to restart.
      }
      await delay(Math.min(750, Math.max(100, deadline - Date.now())));
    }
    throw new Error('O WhatsApp não confirmou o envio ao servidor dentro do prazo.');
  }

  waitForServerAck(message, timeout = 45000) {
    const messageId = messageIdentity(message);

    const directAck = Number(typeof message === 'string' ? NaN : message?.ack);
    if (Number.isFinite(directAck)) {
      if (directAck >= 1) {
        this._rememberAck(message, directAck);
        return Promise.resolve(directAck);
      }
      if (directAck < 0) return Promise.reject(new Error('O WhatsApp rejeitou o envio.'));
    }

    if (!messageId) {
      if (typeof message === 'string' || !message) {
        return Promise.reject(new Error('Mensagem sem identificador para confirmação.'));
      }
      // sendMessage() did return a Message object, so the submission may be
      // real even when WA Web omits _serialized temporarily. Confirm it by
      // polling the Message itself instead of immediately tearing down the
      // connection and stalling the remaining queue.
      return this._waitForAckWithoutStableId(message, timeout);
    }

    const cached = this.ackCache.get(messageId);
    if (cached?.ack >= 1) return Promise.resolve(cached.ack);
    if (cached?.ack < 0) return Promise.reject(new Error('O WhatsApp rejeitou o envio.'));

    const pending = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ackWaiters.delete(messageId);
        reject(new Error('O WhatsApp não confirmou o envio ao servidor dentro do prazo.'));
      }, timeout);
      this.ackWaiters.set(messageId, {resolve, reject, timer});
    });

    if (typeof message !== 'string') {
      this._pollMessageAck(message, messageId, timeout).catch(() => {});
    }
    return pending;
  }

  connect() {
    this.userPaused = false;
    this.consecutiveHealthFailures = 0;
    this._savePausedPreference(false);
    this.startMonitoring();
    this._clearReconnectTimer();
    this._connectInternal().catch(() => {});
    return this.status();
  }

  async _connectInternal() {
    if (this.userPaused || this.starting || ['starting','qr','authenticated','ready'].includes(this.state.status)) return this.status();
    this.state = {status:'starting', qr:null, account:null, error:null};
    const generation = ++this.generation;
    this.starting = this.initialize(generation)
      .catch(error => {
        if (generation === this.generation && !this.userPaused) {
          this.state = {
            status:'error',
            qr:null,
            account:null,
            error: error?.message || 'Falha ao conectar. Confira a internet e se Edge ou Chrome está instalado.'
          };
        }
        throw error;
      })
      .finally(() => { this.starting = null; });
    try {
      await this.starting;
      return this.status();
    } catch (error) {
      if (!this.userPaused) this._scheduleReconnect(false);
      throw error;
    }
  }

  async initialize(generation) {
    if (this.client) await bounded(this.client.destroy(), 10000).catch(() => {});
    if (generation !== this.generation) return;

    const {Client, LocalAuth} = this.deps.library || require('whatsapp-web.js');
    const qrCode = this.deps.qrCode || require('qrcode');
    const browser = this.deps.browser || findBrowser();
    fs.mkdirSync(this.dataDir, {recursive:true, mode:0o700});

    const client = new Client({
      authStrategy: new LocalAuth({clientId:'vyzium', dataPath:this.dataDir}),
      puppeteer:{
        headless:true,
        executablePath:browser,
        args:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows']
      },
      // Do not pin a WhatsApp Web build. Let whatsapp-web.js use the current build
      // and its normal cache fallback. Pinned/stale builds are especially fragile.
      authTimeoutMs:120000,
      qrMaxRetries:10
    });

    this.client = client;
    this.readyAt = 0;
    let qrSequence = 0;

    client.on('qr', async value => {
      if (this.client !== client) return;
      const sequence = ++qrSequence;
      this.state = {status:'qr', qr:null, account:null, error:null};
      try {
        const qr = await qrCode.toDataURL(value, {width:280, margin:3});
        if (this.client === client && sequence === qrSequence && this.state.status === 'qr') this.state.qr = qr;
      } catch (_) {
        this.state.error = 'Não foi possível gerar o QR. Tente reconectar.';
      }
    });

    client.on('authenticated', () => {
      if (this.client === client) {
        this.authenticatedAt = Date.now();
        this.state = {status:'authenticated', qr:null, account:null, error:null};
      }
    });

    client.on('ready', () => {
      if (this.client === client) {
        this.readyAt = Date.now();
        this.authenticatedAt = 0;
        this.lastHealthCheckAt = Date.now();
        this.lastHealthyAt = Date.now();
        this.consecutiveHealthFailures = 0;
        this.reconnectAttempts = 0;
        this._clearReconnectTimer();
        this.state = {status:'ready', qr:null, account:client.info?.wid?.user || null, error:null};
      }
    });

    client.on('message_ack', (message, ack) => {
      if (this.client === client) this._rememberAck(message, ack);
    });

    client.on('auth_failure', () => {
      if (this.client === client) {
        this.authenticatedAt = 0;
        this._clearAckWaiters('A sessão do WhatsApp perdeu a autorização durante o envio.');
        this.state = {status:'error',qr:null,account:null,error:'Sessão não autorizada. Um novo QR Code pode ser necessário.'};
        this._scheduleReconnect(false);
      }
    });

    client.on('disconnected', reason => {
      if (this.client === client) {
        this.readyAt = 0;
        this.authenticatedAt = 0;
        this.lastHealthCheckAt = 0;
        this._clearAckWaiters('O WhatsApp desconectou antes de confirmar o envio.');
        this.state = {
          status:'offline',
          qr:null,
          account:null,
          error:`WhatsApp desconectado${reason ? ` (${String(reason)})` : ''}. O Vyzium tentará restaurar a sessão automaticamente.`
        };
        this._scheduleReconnect(false);
      }
    });

    await client.initialize();
  }

  async restartConnection() {
    if (this.busy) throw new Error('Existe um envio em andamento.');
    const oldClient = this.client;
    this.client = null;
    this.readyAt = 0;
    this.authenticatedAt = 0;
    this.lastHealthCheckAt = 0;
    this.consecutiveHealthFailures = 0;
    this._clearAckWaiters('A conexão foi renovada antes da confirmação do envio.');
    this.generation++;
    const generation = this.generation;
    this.state = {status:'starting', qr:null, account:null, error:null};
    if (oldClient) await bounded(oldClient.destroy(), 10000).catch(() => {});

    this.starting = this.initialize(generation)
      .catch(error => {
        if (generation === this.generation) {
          this.state = {status:'error', qr:null, account:null, error:error?.message || 'Falha ao renovar a conexão do WhatsApp.'};
        }
        throw error;
      })
      .finally(() => { this.starting = null; });

    await bounded(this.starting, 30000, 'O WhatsApp demorou demais para renovar a conexão.');
  }

  async connectionHealthy() {
    if (this.state.status !== 'ready' || !this.client) return false;
    if (typeof this.client.getState !== 'function') {
      this.lastHealthCheckAt = Date.now();
      return true;
    }
    try {
      const state = await bounded(
        this.client.getState(),
        this.healthTimeoutMs,
        'Tempo limite ao verificar a conexão do WhatsApp.'
      );
      const healthy = String(state || '').toUpperCase() === 'CONNECTED';
      this.lastHealthCheckAt = Date.now();
      if (healthy) this.lastHealthyAt = this.lastHealthCheckAt;
      return healthy;
    } catch (_) {
      return false;
    }
  }

  async waitReady(timeout = 120000) {
    if (this.userPaused || this.state.status === 'paused') throw new Error('Conexão pausada. Clique em Retomar conexão para continuar.');

    // Reuse a healthy session. If it is degraded, restart it once and let the
    // monitor keep it alive in the background from then on.
    if (this.state.status === 'ready') {
      if (!(await this.connectionHealthy())) await this.restartConnection();
    } else {
      this.connect();
    }

    const deadline = Date.now() + timeout;
    while (this.state.status !== 'ready') {
      if (this.state.status === 'error') throw new Error(this.state.error);
      if (this.state.status === 'paused') throw new Error('Conexão cancelada.');
      if (Date.now() >= deadline) {
        throw new Error('Conecte pelo QR Code em Configurações e tente enviar novamente. Nenhuma mensagem deste lote foi enviada.');
      }
      await delay(250);
    }
    return {ready:true};
  }

  async send(phone, message) {
    if (this.busy) return {status:'failed', error:'Já existe um envio em andamento.'};
    if (this.state.status !== 'ready' || !this.client) return {status:'failed', error:'WhatsApp não conectado.'};
    if (!/^\+?[1-9]\d{7,14}$/.test(phone || '') || typeof message !== 'string' || !message.trim() || message.length > 60000) {
      return {status:'failed', error:'Número ou mensagem inválidos.'};
    }

    this.busy = true;
    let submitted = false;
    let messageId = null;
    let reconnectAfterSend = false;
    const client = this.client;

    try {
      if (!(await this.connectionHealthy())) {
        this.state = {status:'offline', qr:null, account:null, error:'A conexão do WhatsApp não está ativa. Reconecte antes de enviar.'};
        return {status:'failed', error:'Conexão do WhatsApp indisponível antes do envio.'};
      }

      const candidates = phoneCandidates(phone);
      let number = null;
      let resolvedPhone = null;
      for (const candidate of candidates) {
        number = await bounded(
          client.getNumberId(candidate),
          this.numberTimeoutMs,
          'Tempo limite ao validar o número no WhatsApp.'
        );
        if (number) {
          resolvedPhone = `+${candidate}`;
          break;
        }
      }
      if (!number) {
        return {
          status:'failed',
          error:'O número está salvo no Vyzium, mas o WhatsApp não localizou uma conta para ele. Confira país, DDD e, em celular brasileiro, o 9º dígito.'
        };
      }
      if (this.state.status !== 'ready' || this.client !== client) {
        return {status:'failed', error:'Conexão perdida antes do envio.'};
      }

      submitted = true;
      const result = await bounded(
        client.sendMessage(number._serialized, message, {waitUntilMsgSent:true}),
        this.sendTimeoutMs,
        'O WhatsApp não concluiu a chamada de envio dentro do prazo.'
      );

      messageId = messageIdentity(result);

      // For the current WhatsApp Web integration, a completed sendMessage() call
      // is treated as a successful send. Some WA Web builds do not expose a
      // reliable ACK/message id even though the message was actually sent.
      return {status:'sent', message_id:messageId, resolved_phone:resolvedPhone};
    } catch (error) {
      if (submitted) {
        // An ACK timeout means the delivery is uncertain, not that the whole
        // WhatsApp session is broken. Destroying a healthy client here caused
        // the old 2/N stall: one uncertain message forced a full resync before
        // the next supplier. Keep a healthy session alive and only reconnect
        // when the transport itself is demonstrably down.
        let healthy = false;
        try { healthy = this.client === client && await this.connectionHealthy(); }
        catch (_) { healthy = false; }
        if (!healthy) {
          this.readyAt = 0;
          this.authenticatedAt = 0;
          this.lastHealthCheckAt = 0;
          this.state = {
            status:'offline',
            qr:null,
            account:null,
            error:'A conexão do WhatsApp ficou indisponível após um envio sem confirmação. O Vyzium tentará restaurá-la automaticamente.'
          };
          reconnectAfterSend = true;
        }
      }

      return submitted
        ? {
            status:'uncertain',
            message_id:messageId,
            error:`Envio não confirmado pelo servidor do WhatsApp${messageId ? ` (${messageId})` : ''}. Confira a conversa antes de liberar um novo envio. Detalhe: ${error?.message || 'sem confirmação.'}`
          }
        : {status:'failed', error:error?.message || 'Falha ao verificar o contato. Nenhuma mensagem enviada.'};
    } finally {
      this.busy = false;
      if (reconnectAfterSend) this._scheduleReconnect(false);
    }
  }

  async pause(force = false) {
    if (this.busy && !force) throw new Error('Aguarde o envio terminar antes de pausar.');
    this.userPaused = true;
    this._savePausedPreference(true);
    this._clearReconnectTimer();
    this.generation++;
    this.readyAt = 0;
    this.authenticatedAt = 0;
    this.lastHealthCheckAt = 0;
    this.consecutiveHealthFailures = 0;
    this.state = {status:'paused',qr:null,account:null,error:null};
    this._clearAckWaiters('Conexão pausada antes da confirmação do envio.');
    const client = this.client;
    this.client = null;
    if (client) await bounded(client.destroy(), 10000).catch(() => {});
    if (this.starting) await bounded(this.starting, 1500).catch(() => {});
    this.state = {status:'paused',qr:null,account:null,error:null};
    return this.status();
  }

  async shutdown() {
    this._clearReconnectTimer();
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    this.generation++;
    this._clearAckWaiters('Aplicativo encerrado antes da confirmação do envio.');
    const client = this.client;
    this.client = null;
    if (client) await bounded(client.destroy(), 10000).catch(() => {});
  }

}

async function startBridge(session, token) {
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => {
      res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-followup-token'] !== token) {
      reply(401,{error:'Não autorizado.'});
      return;
    }
    try {
      if (req.method === 'POST' && req.url === '/health') {
        reply(200, await session.backgroundHealthCheck());
        return;
      }
      if (req.method === 'POST' && req.url === '/wait') {
        reply(200, await session.waitReady());
        return;
      }
      if (req.method !== 'POST' || req.url !== '/send') {
        reply(404,{error:'Rota inválida.'});
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 300000) {
          reply(413,{error:'Mensagem muito grande.'});
          return;
        }
      }
      const data = JSON.parse(body);
      reply(200, await session.send(data.phone, data.message));
    } catch (error) {
      reply(400,{error:error.message});
    }
  });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {server, url:`http://127.0.0.1:${server.address().port}`};
}

module.exports = {WhatsAppSession, startBridge, phoneCandidates};
