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
    this.readyAt = 0;
    this.lastHealthCheckAt = 0;
    this.lastAckAt = 0;
    this.ackCache = new Map();
    this.ackWaiters = new Map();
    this.state = {status:'offline', qr:null, account:null, error:null};
  }

  status() {
    return {
      ...this.state,
      busy: this.busy,
      lastAckAt: this.lastAckAt || null
    };
  }

  _clearAckWaiters(errorMessage = 'Conexão do WhatsApp encerrada antes da confirmação do envio.') {
    for (const waiter of this.ackWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(errorMessage));
    }
    this.ackWaiters.clear();
  }

  _rememberAck(message, ack) {
    const id = message?.id?._serialized;
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

  waitForServerAck(message, timeout = 45000) {
    const messageId = typeof message === 'string' ? message : message?.id?._serialized;
    if (!messageId) return Promise.reject(new Error('Mensagem sem identificador para confirmação.'));

    const directAck = Number(typeof message === 'string' ? NaN : message?.ack);
    if (Number.isFinite(directAck)) {
      if (directAck >= 1) {
        this._rememberAck(message, directAck);
        return Promise.resolve(directAck);
      }
      if (directAck < 0) return Promise.reject(new Error('O WhatsApp rejeitou o envio.'));
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
    if (this.starting || ['starting','qr','authenticated','ready'].includes(this.state.status)) return this.status();
    this.state = {status:'starting', qr:null, account:null, error:null};
    const generation = ++this.generation;
    this.starting = this.initialize(generation)
      .catch(error => {
        if (generation === this.generation) {
          this.state = {
            status:'error',
            qr:null,
            account:null,
            error: error?.message || 'Falha ao conectar. Confira a internet e se Edge ou Chrome está instalado; depois tente reconectar.'
          };
        }
      })
      .finally(() => { this.starting = null; });
    return this.status();
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
      if (this.client === client) this.state = {status:'authenticated', qr:null, account:null, error:null};
    });

    client.on('ready', () => {
      if (this.client === client) {
        this.readyAt = Date.now();
        this.lastHealthCheckAt = Date.now();
        this.state = {status:'ready', qr:null, account:client.info?.wid?.user || null, error:null};
      }
    });

    client.on('message_ack', (message, ack) => {
      if (this.client === client) this._rememberAck(message, ack);
    });

    client.on('auth_failure', () => {
      if (this.client === client) {
        this._clearAckWaiters('A sessão do WhatsApp perdeu a autorização durante o envio.');
        this.state = {status:'error',qr:null,account:null,error:'Sessão não autorizada. Reconecte e leia um novo QR Code.'};
      }
    });

    client.on('disconnected', reason => {
      if (this.client === client) {
        this.readyAt = 0;
        this.lastHealthCheckAt = 0;
        this._clearAckWaiters('O WhatsApp desconectou antes de confirmar o envio.');
        this.state = {
          status:'offline',
          qr:null,
          account:null,
          error:`WhatsApp desconectado${reason ? ` (${String(reason)})` : ''}. Clique em Conectar para restaurar a sessão.`
        };
      }
    });

    await client.initialize();
  }

  async restartConnection() {
    if (this.busy) throw new Error('Existe um envio em andamento.');
    const oldClient = this.client;
    this.client = null;
    this.readyAt = 0;
    this.lastHealthCheckAt = 0;
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
      if (healthy) this.lastHealthCheckAt = Date.now();
      return healthy;
    } catch (_) {
      return false;
    }
  }

  async waitReady(timeout = 120000) {
    if (this.state.status === 'paused') throw new Error('Conexão pausada. Clique em Conectar para continuar.');

    // Do not recycle a healthy session merely because it has been open for a
    // while. Ask WhatsApp Web for its real connection state and reconnect only
    // when that health check fails.
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

      messageId = result?.id?._serialized || null;
      if (!messageId) {
        throw new Error('O WhatsApp não retornou um identificador confiável para confirmar a mensagem.');
      }

      // IMPORTANT: sendMessage() returning a message object is only a local success.
      // We only mark the follow-up as sent after ACK >= 1, confirmed either by
      // the event stream or by reloading the sent message from WhatsApp Web.
      const ack = await this.waitForServerAck(result, this.ackTimeoutMs);
      return {status:'sent', message_id:messageId, ack, resolved_phone:resolvedPhone};
    } catch (error) {
      if (submitted) {
        const staleClient = this.client;
        this.client = null;
        this.readyAt = 0;
        this.lastHealthCheckAt = 0;
        this._clearAckWaiters('A confirmação do envio não chegou.');
        this.state = {
          status:'error',
          qr:null,
          account:null,
          error:'Envio não confirmado pelo servidor do WhatsApp. A conexão foi encerrada para evitar falso positivo. Reconecte antes de tentar novamente.'
        };
        if (staleClient) await bounded(staleClient.destroy(), 10000).catch(() => {});
      }

      return submitted
        ? {
            status:'uncertain',
            error:`Envio não confirmado pelo servidor do WhatsApp${messageId ? ` (${messageId})` : ''}. Confira a conversa antes de liberar um novo envio. Detalhe: ${error?.message || 'sem confirmação.'}`
          }
        : {status:'failed', error:error?.message || 'Falha ao verificar o contato. Nenhuma mensagem enviada.'};
    } finally {
      this.busy = false;
    }
  }

  async pause(force = false) {
    if (this.busy && !force) throw new Error('Aguarde o envio terminar antes de pausar.');
    this.generation++;
    this.readyAt = 0;
    this.lastHealthCheckAt = 0;
    this.state = {status:'paused',qr:null,account:null,error:null};
    this._clearAckWaiters('Conexão pausada antes da confirmação do envio.');
    const client = this.client;
    this.client = null;
    if (client) await bounded(client.destroy(), 10000).catch(() => {});
    if (this.starting) await bounded(this.starting, 1500).catch(() => {});
    this.state = {status:'paused',qr:null,account:null,error:null};
    return this.status();
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
