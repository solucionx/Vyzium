'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const PUBLIC_HOST = 'api-vyzium.solucionx.com.br';
const MAX_OBJECT = 128 * 1024 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const BUNDLE_MAGIC = Buffer.from('VYB1');
const ENVELOPE_MAGIC = Buffer.from('VZB1');

class RemoteBackupError extends Error {
  constructor(message, { code = 'REMOTE_BACKUP_ERROR', status = 0, requestId = null } = {}) {
    super(message);
    this.name = 'RemoteBackupError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function normalizeUid(value) {
  const uid = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw new RemoteBackupError('Identidade Firebase inválida para o backup.', { code:'BACKUP_IDENTITY_INVALID' });
  return uid;
}

function normalizeToken(value) {
  const token = String(value || '').trim();
  if (!token || token.length > 8100 || /\s/.test(token)) throw new RemoteBackupError('A sessão Firebase não possui um token válido.', { code:'BACKUP_TOKEN_INVALID' });
  return token;
}

function safeFilename(value) {
  const name = path.basename(String(value || 'backup.db')).replace(/[^A-Za-z0-9._-]/g, '_');
  return name.slice(0, 180) || 'backup.db';
}

async function prepareSnapshotRecords(files) {
  if (!Array.isArray(files) || !files.length) throw new RemoteBackupError('Nenhum banco local está disponível para o backup.', { code:'BACKUP_NO_DATABASE' });
  const records = [];
  for (const item of files) {
    const moduleName = String(item?.module || '').toLowerCase();
    if (!['followup','compras'].includes(moduleName)) throw new RemoteBackupError('Módulo de backup inválido.', { code:'BACKUP_MODULE_INVALID' });
    const filePath = path.resolve(String(item?.path || ''));
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) throw new RemoteBackupError(`Snapshot de ${moduleName} inválido.`, { code:'BACKUP_SNAPSHOT_INVALID' });
    const actualHash = await sha256File(filePath);
    const expectedHash = String(item?.sha256 || '').toLowerCase();
    if (expectedHash && actualHash !== expectedHash) {
      throw new RemoteBackupError(`O snapshot de ${moduleName} mudou antes do envio.`, { code:'BACKUP_LOCAL_CHECKSUM_MISMATCH' });
    }
    if (Number.isFinite(Number(item?.size_bytes)) && Number(item.size_bytes) !== stat.size) {
      throw new RemoteBackupError(`O tamanho do snapshot de ${moduleName} mudou antes do envio.`, { code:'BACKUP_LOCAL_SIZE_MISMATCH' });
    }
    records.push({
      module: moduleName,
      path: filePath,
      filename: safeFilename(item?.filename || filePath),
      size_bytes: stat.size,
      sha256: actualHash,
      encrypted: item?.encrypted !== false
    });
  }
  return records;
}

async function copyFileIntoHandle(sourcePath, outputHandle, outputPosition, expectedHash) {
  const input = await fs.promises.open(sourcePath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let readPosition = 0;
  let writePosition = outputPosition;
  try {
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, readPosition);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      await outputHandle.write(chunk, 0, chunk.length, writePosition);
      readPosition += bytesRead;
      writePosition += bytesRead;
    }
  } finally {
    await input.close();
  }
  const actual = hash.digest('hex');
  if (expectedHash && actual !== expectedHash) throw new RemoteBackupError('Snapshot alterado durante a montagem do pacote.', { code:'BACKUP_LOCAL_CHECKSUM_MISMATCH' });
  return writePosition;
}

async function buildBundleFile(files, outputPath, { uid, appVersion = '' } = {}) {
  const normalizedUid = normalizeUid(uid);
  const records = await prepareSnapshotRecords(files);
  const header = {
    version: 1,
    format: 'VYB1',
    kind: 'vyzium-workspace-backup',
    created_at: new Date().toISOString(),
    app_version: String(appVersion || ''),
    workspace_id: normalizedUid,
    files: records.map(record => ({
      module: record.module,
      filename: record.filename,
      size_bytes: record.size_bytes,
      sha256: record.sha256,
      encrypted: Boolean(record.encrypted)
    }))
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerBytes.length <= 0 || headerBytes.length > 64 * 1024) throw new RemoteBackupError('Manifesto de backup inválido.', { code:'BACKUP_MANIFEST_INVALID' });
  const prefix = Buffer.alloc(8);
  BUNDLE_MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(headerBytes.length, 4);
  const totalSize = prefix.length + headerBytes.length + records.reduce((sum, record) => sum + record.size_bytes, 0);
  if (totalSize + 32 > MAX_OBJECT) throw new RemoteBackupError('O backup ultrapassa o limite de 128 MiB do servidor.', { code:'BACKUP_SIZE_INVALID' });

  await fs.promises.mkdir(path.dirname(outputPath), { recursive:true, mode:0o700 });
  const out = await fs.promises.open(outputPath, 'wx', 0o600);
  try {
    let position = 0;
    await out.write(prefix, 0, prefix.length, position); position += prefix.length;
    await out.write(headerBytes, 0, headerBytes.length, position); position += headerBytes.length;
    for (const record of records) position = await copyFileIntoHandle(record.path, out, position, record.sha256);
    if (position !== totalSize) throw new RemoteBackupError('Tamanho final do pacote local não confere.', { code:'BACKUP_LOCAL_SIZE_MISMATCH' });
    await out.sync();
  } finally {
    await out.close();
  }
  return { path:outputPath, size_bytes:totalSize, header, records };
}

async function sealBundleFile(inputPath, outputPath, key, uid) {
  const normalizedUid = normalizeUid(uid);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new RemoteBackupError('Chave de backup inválida.', { code:'BACKUP_KEY_INVALID' });
  const inputStat = await fs.promises.stat(inputPath);
  if (!inputStat.isFile() || inputStat.size <= 0 || inputStat.size + 32 > MAX_OBJECT) {
    throw new RemoteBackupError('Tamanho de backup incompatível com o servidor.', { code:'BACKUP_SIZE_INVALID' });
  }

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`vyzium-backup-v1|${normalizedUid}`, 'utf8'));

  const input = await fs.promises.open(inputPath, 'r');
  const output = await fs.promises.open(outputPath, 'wx', 0o600);
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let readPosition = 0;
  let writePosition = 0;
  try {
    await output.write(ENVELOPE_MAGIC, 0, ENVELOPE_MAGIC.length, writePosition); writePosition += ENVELOPE_MAGIC.length;
    await output.write(nonce, 0, nonce.length, writePosition); writePosition += nonce.length;
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, readPosition);
      if (!bytesRead) break;
      readPosition += bytesRead;
      const encrypted = cipher.update(buffer.subarray(0, bytesRead));
      if (encrypted.length) {
        await output.write(encrypted, 0, encrypted.length, writePosition);
        writePosition += encrypted.length;
      }
    }
    const final = cipher.final();
    if (final.length) {
      await output.write(final, 0, final.length, writePosition);
      writePosition += final.length;
    }
    const tag = cipher.getAuthTag();
    await output.write(tag, 0, tag.length, writePosition);
    writePosition += tag.length;
    await output.sync();
  } finally {
    await Promise.allSettled([input.close(), output.close()]);
  }

  const expectedSize = inputStat.size + 32;
  const actualStat = await fs.promises.stat(outputPath);
  if (actualStat.size !== expectedSize) throw new RemoteBackupError('Envelope criptografado ficou com tamanho inesperado.', { code:'BACKUP_ENVELOPE_INVALID' });
  const objectId = await sha256File(outputPath);
  return { path:outputPath, id:objectId, size_bytes:actualStat.size };
}

function parseJsonBody(buffer) {
  if (!buffer?.length) return {};
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (_) { return {}; }
}

function responseError(status, raw) {
  const payload = parseJsonBody(raw);
  const serverCode = String(payload?.code || '').trim();
  const requestId = String(payload?.request_id || '').trim() || null;
  const fallback = status === 401 ? 'Sessão Firebase recusada pelo servidor.'
    : status === 403 ? 'Este usuário ainda não foi autorizado no servidor.'
    : status === 409 ? 'O servidor rejeitou o objeto de backup.'
    : status === 429 ? 'O servidor limitou temporariamente as solicitações.'
    : status === 503 ? 'O servidor está temporariamente indisponível.'
    : `Falha no servidor de backup (HTTP ${status}).`;
  const detail = String(payload?.error || '').trim();
  return new RemoteBackupError(detail ? `${fallback} ${detail}` : fallback, {
    code: serverCode || `BACKUP_HTTP_${status}`,
    status,
    requestId
  });
}

function requestRemote({ host = PUBLIC_HOST, method = 'GET', route, token, bodyPath = null, bodyLength = 0, timeoutMs = 45000, responseLimit = RESPONSE_LIMIT, extraHeaders = null }) {
  const bearer = normalizeToken(token);
  if (!/^\/[A-Za-z0-9/_-]+$/.test(String(route || ''))) throw new RemoteBackupError('Rota remota inválida.', { code:'BACKUP_ROUTE_INVALID' });
  return new Promise((resolve, reject) => {
    const headers = {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
      Connection: 'close'
    };
    if (extraHeaders && typeof extraHeaders === 'object') {
      for (const [key, raw] of Object.entries(extraHeaders)) {
        if (!/^X-Vyzium-(Parent|Device|Merge-Source)$/i.test(key)) throw new RemoteBackupError('Cabeçalho remoto não permitido.', { code:'BACKUP_HEADER_INVALID' });
        const value = String(raw || '').trim();
        if (value) headers[key] = value;
      }
    }
    if (bodyPath) {
      headers['Content-Type'] = 'application/octet-stream';
      headers['Content-Length'] = String(bodyLength);
    }
    const req = https.request({
      protocol:'https:',
      hostname:host,
      port:443,
      method,
      path:route,
      headers,
      agent:false,
      timeout:timeoutMs,
      rejectUnauthorized:true
    }, response => {
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > responseLimit) {
          response.destroy(new RemoteBackupError('Resposta do servidor excedeu o limite seguro.', { code:'BACKUP_RESPONSE_TOO_LARGE', status:response.statusCode || 0 }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status:Number(response.statusCode || 0), body:Buffer.concat(chunks), headers:response.headers }));
    });
    req.on('timeout', () => req.destroy(new RemoteBackupError('Tempo limite ao acessar o servidor.', { code:'BACKUP_TIMEOUT' })));
    req.on('error', error => {
      if (error instanceof RemoteBackupError) return reject(error);
      reject(new RemoteBackupError('Não foi possível acessar o servidor de backup.', { code:'BACKUP_NETWORK_ERROR' }));
    });
    if (!bodyPath) {
      req.end();
      return;
    }
    const body = fs.createReadStream(bodyPath);
    body.on('error', error => req.destroy(error));
    body.pipe(req);
  });
}

function normalizeObjectId(value, { optional = false } = {}) {
  const id = String(value || '').trim().toLowerCase();
  if (!id && optional) return null;
  if (!/^[a-f0-9]{64}$/.test(id)) throw new RemoteBackupError('Identificador de backup inválido.', { code:'BACKUP_OBJECT_ID_INVALID' });
  return id;
}

function normalizeDeviceId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(id)) throw new RemoteBackupError('Identificador do dispositivo inválido.', { code:'BACKUP_DEVICE_ID_INVALID' });
  return id;
}

async function requestRemoteToFile({ host = PUBLIC_HOST, route, token, outputPath, expectedId, timeoutMs = 120000 }) {
  const bearer = normalizeToken(token);
  const id = normalizeObjectId(expectedId);
  if (String(route || '') !== `/v1/backups/${id}`) throw new RemoteBackupError('Rota de download incompatível com o objeto.', { code:'BACKUP_ROUTE_INVALID' });
  await fs.promises.mkdir(path.dirname(outputPath), { recursive:true, mode:0o700 });
  await fs.promises.rm(outputPath, { force:true });

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = async error => {
      if (settled) return;
      settled = true;
      await fs.promises.rm(outputPath, { force:true }).catch(() => {});
      reject(error instanceof RemoteBackupError ? error : new RemoteBackupError('Não foi possível baixar o backup do servidor.', { code:'BACKUP_DOWNLOAD_ERROR' }));
    };
    const req = https.request({
      protocol:'https:', hostname:host, port:443, method:'GET', path:route,
      headers:{Authorization:`Bearer ${bearer}`,Accept:'application/octet-stream',Connection:'close'},
      agent:false, timeout:timeoutMs, rejectUnauthorized:true
    }, response => {
      const status = Number(response.statusCode || 0);
      if (status !== 200) {
        const chunks=[]; let total=0;
        response.on('data', chunk => { total += chunk.length; if (total <= RESPONSE_LIMIT) chunks.push(chunk); });
        response.on('error', fail);
        response.on('end', () => fail(responseError(status, Buffer.concat(chunks))));
        return;
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (!Number.isSafeInteger(declared) || declared < 32 || declared > MAX_OBJECT) {
        response.resume();
        fail(new RemoteBackupError('O servidor informou tamanho inválido para o backup.', { code:'BACKUP_DOWNLOAD_SIZE_INVALID' }));
        return;
      }
      const hash = crypto.createHash('sha256');
      let total = 0;
      const output = fs.createWriteStream(outputPath, { flags:'wx', mode:0o600 });
      output.on('error', fail);
      response.on('error', fail);
      response.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_OBJECT || total > declared) {
          response.destroy(new RemoteBackupError('O download excedeu o tamanho anunciado.', { code:'BACKUP_DOWNLOAD_SIZE_INVALID' }));
          return;
        }
        hash.update(chunk);
      });
      response.pipe(output);
      output.on('finish', async () => {
        if (settled) return;
        if (total !== declared) return fail(new RemoteBackupError('O download terminou incompleto.', { code:'BACKUP_DOWNLOAD_INCOMPLETE' }));
        const actual = hash.digest('hex');
        if (actual !== id) return fail(new RemoteBackupError('O backup baixado não passou na verificação SHA-256.', { code:'BACKUP_DOWNLOAD_CHECKSUM_MISMATCH' }));
        settled = true;
        resolve({ path:outputPath, id, bytes:total });
      });
    });
    req.on('timeout', () => req.destroy(new RemoteBackupError('Tempo limite ao baixar o backup do servidor.', { code:'BACKUP_TIMEOUT' })));
    req.on('error', fail);
    req.end();
  });
}

async function unsealEnvelopeFile(inputPath, outputPath, key, uid) {
  const normalizedUid = normalizeUid(uid);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new RemoteBackupError('Chave de backup inválida.', { code:'BACKUP_KEY_INVALID' });
  const stat = await fs.promises.stat(inputPath);
  if (!stat.isFile() || stat.size < 32 || stat.size > MAX_OBJECT) throw new RemoteBackupError('Envelope remoto inválido.', { code:'BACKUP_ENVELOPE_INVALID' });
  const input = await fs.promises.open(inputPath, 'r');
  await fs.promises.rm(outputPath, { force:true });
  const output = await fs.promises.open(outputPath, 'wx', 0o600);
  try {
    const header = Buffer.alloc(16);
    const h = await input.read(header, 0, 16, 0);
    if (h.bytesRead !== 16 || !header.subarray(0,4).equals(ENVELOPE_MAGIC)) throw new RemoteBackupError('Envelope remoto não possui formato VZB1.', { code:'BACKUP_ENVELOPE_INVALID' });
    const tag = Buffer.alloc(16);
    const t = await input.read(tag, 0, 16, stat.size - 16);
    if (t.bytesRead !== 16) throw new RemoteBackupError('Envelope remoto truncado.', { code:'BACKUP_ENVELOPE_INVALID' });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(4,16));
    decipher.setAAD(Buffer.from(`vyzium-backup-v1|${normalizedUid}`, 'utf8'));
    decipher.setAuthTag(tag);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const cipherBytes = stat.size - 32;
    let readPosition = 16, written = 0, left = cipherBytes;
    while (left > 0) {
      const size = Math.min(buffer.length, left);
      const {bytesRead} = await input.read(buffer, 0, size, readPosition);
      if (!bytesRead) throw new RemoteBackupError('Envelope remoto truncado.', { code:'BACKUP_ENVELOPE_INVALID' });
      readPosition += bytesRead; left -= bytesRead;
      const plain = decipher.update(buffer.subarray(0, bytesRead));
      if (plain.length) { await output.write(plain, 0, plain.length, written); written += plain.length; }
    }
    let final;
    try { final = decipher.final(); }
    catch (_) { throw new RemoteBackupError('A autenticação criptográfica do backup falhou.', { code:'BACKUP_AUTHENTICATION_FAILED' }); }
    if (final.length) { await output.write(final, 0, final.length, written); written += final.length; }
    await output.sync();
    return { path:outputPath, bytes:written };
  } finally {
    await Promise.allSettled([input.close(), output.close()]);
  }
}

async function extractBundleFile(bundlePath, outputDir, uid) {
  const normalizedUid = normalizeUid(uid);
  const stat = await fs.promises.stat(bundlePath);
  const input = await fs.promises.open(bundlePath, 'r');
  const created = [];
  try {
    const prefix = Buffer.alloc(8);
    const first = await input.read(prefix, 0, 8, 0);
    if (first.bytesRead !== 8 || !prefix.subarray(0,4).equals(BUNDLE_MAGIC)) throw new RemoteBackupError('Pacote descriptografado não possui formato VYB1.', { code:'BACKUP_MANIFEST_INVALID' });
    const headerLength = prefix.readUInt32BE(4);
    if (headerLength <= 0 || headerLength > 64 * 1024) throw new RemoteBackupError('Manifesto remoto possui tamanho inválido.', { code:'BACKUP_MANIFEST_INVALID' });
    const headerBytes = Buffer.alloc(headerLength);
    const hr = await input.read(headerBytes, 0, headerLength, 8);
    if (hr.bytesRead !== headerLength) throw new RemoteBackupError('Manifesto remoto truncado.', { code:'BACKUP_MANIFEST_INVALID' });
    let header;
    try { header = JSON.parse(headerBytes.toString('utf8')); }
    catch (_) { throw new RemoteBackupError('Manifesto remoto não é JSON válido.', { code:'BACKUP_MANIFEST_INVALID' }); }
    if (Number(header?.version) !== 1 || header?.format !== 'VYB1' || header?.workspace_id !== normalizedUid || !Array.isArray(header?.files)) {
      throw new RemoteBackupError('Manifesto remoto não pertence a este workspace.', { code:'BACKUP_MANIFEST_INVALID' });
    }
    const modules = new Set();
    let offset = 8 + headerLength;
    await fs.promises.mkdir(outputDir, { recursive:true, mode:0o700 });
    for (const entry of header.files) {
      const moduleName = String(entry?.module || '').toLowerCase();
      if (!['followup','compras'].includes(moduleName) || modules.has(moduleName)) throw new RemoteBackupError('Manifesto remoto possui módulos inválidos ou duplicados.', { code:'BACKUP_MANIFEST_INVALID' });
      modules.add(moduleName);
      const size = Number(entry?.size_bytes);
      const expectedHash = String(entry?.sha256 || '').toLowerCase();
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_OBJECT || !/^[a-f0-9]{64}$/.test(expectedHash) || entry?.encrypted === false || offset + size > stat.size) {
        throw new RemoteBackupError('Manifesto remoto possui um arquivo inválido.', { code:'BACKUP_MANIFEST_INVALID' });
      }
      const target = path.join(outputDir, moduleName === 'compras' ? 'compras.sqlite3' : 'followup.db');
      const out = await fs.promises.open(target, 'wx', 0o600);
      const hash = crypto.createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let left = size, writePosition = 0;
      try {
        while (left > 0) {
          const count = Math.min(buffer.length, left);
          const {bytesRead} = await input.read(buffer, 0, count, offset);
          if (!bytesRead) throw new RemoteBackupError('Arquivo remoto truncado.', { code:'BACKUP_MANIFEST_INVALID' });
          const chunk = buffer.subarray(0, bytesRead);
          hash.update(chunk);
          await out.write(chunk, 0, chunk.length, writePosition);
          offset += bytesRead; writePosition += bytesRead; left -= bytesRead;
        }
        await out.sync();
      } finally { await out.close(); }
      if (hash.digest('hex') !== expectedHash) throw new RemoteBackupError('Um banco do backup não passou na verificação SHA-256.', { code:'BACKUP_BUNDLE_CHECKSUM_MISMATCH' });
      created.push({module:moduleName,path:target,size_bytes:size,sha256:expectedHash,filename:path.basename(target),encrypted:true});
    }
    if (offset !== stat.size) throw new RemoteBackupError('O pacote remoto possui bytes excedentes não declarados.', { code:'BACKUP_MANIFEST_INVALID' });
    return { header, files:created };
  } catch (error) {
    await Promise.allSettled(created.map(item => fs.promises.rm(item.path,{force:true})));
    throw error;
  } finally { await input.close(); }
}

class RemoteBackupManager {
  constructor({ tempRoot, getToken, getUid, withBackupKey, host = PUBLIC_HOST, audit = null, requestFn = requestRemote, downloadFn = requestRemoteToFile } = {}) {
    this.tempRoot = path.resolve(String(tempRoot || '.'));
    this.getToken = getToken;
    this.getUid = getUid;
    this.withBackupKey = withBackupKey;
    this.host = host;
    this.audit = typeof audit === 'function' ? audit : () => {};
    this.requestFn = requestFn;
    this.downloadFn = downloadFn;
  }

  _event(name, details = {}) {
    try { this.audit(`remote-backup.${name}`, details); } catch (_) {}
  }

  async _tokenAndUid() {
    const uid = normalizeUid(await Promise.resolve(this.getUid?.()));
    const token = normalizeToken(await Promise.resolve(this.getToken?.()));
    return { uid, token };
  }

  async status() {
    const { uid, token } = await this._tokenAndUid();
    this._event('status-start');
    const response = await this.requestFn({ host:this.host, method:'GET', route:'/v1/access/status', token });
    if (response.status !== 200) throw responseError(response.status, response.body);
    const payload = parseJsonBody(response.body);
    const state = String(payload?.state || 'unknown').toLowerCase();
    const authorized = payload?.authorized === true;
    this._event('status-complete', { state, authorized });
    return { uid, state, authorized };
  }

  async list() {
    const { uid, token } = await this._tokenAndUid();
    const response = await this.requestFn({ host:this.host, method:'GET', route:'/v1/backups', token, timeoutMs:45000 });
    if (response.status !== 200) throw responseError(response.status, response.body);
    const payload = parseJsonBody(response.body);
    const backups = (Array.isArray(payload?.backups) ? payload.backups : [])
      .map(entry => {
        const id = normalizeObjectId(entry?.id, {optional:true});
        if (!id) return null;
        return {
          id,
          bytes:Number(entry?.bytes || 0),
          created_ms:Number(entry?.created_ms || 0),
          role:String(entry?.role || ''),
          parent_id:normalizeObjectId(entry?.parent_id, {optional:true})
        };
      })
      .filter(entry => entry && entry.bytes >= 32 && entry.bytes <= MAX_OBJECT)
      .sort((a,b) => b.created_ms - a.created_ms || a.id.localeCompare(b.id));
    const lineageCapable = Object.prototype.hasOwnProperty.call(payload || {}, 'head_id')
      && Number(payload?.retention || 0) === 3
      && backups.every(item => ['current','previous','divergent'].includes(item.role));
    let headId = normalizeObjectId(payload?.head_id, {optional:true});
    if (!headId) headId = backups[0]?.id || null; // read-only compatibility with the 3.3.8/RC5 server
    for (const item of backups) {
      if (!item.role) item.role = item.id === headId ? 'current' : 'previous';
    }
    return {
      uid,
      head_id:headId,
      retention:Number(payload?.retention || 0) || null,
      lineage_capable:lineageCapable,
      backups
    };
  }

  async upload(files, { appVersion = '', parentId = null, deviceId = null, mergeSourceId = null } = {}) {
    const { uid, token } = await this._tokenAndUid();
    parentId = normalizeObjectId(parentId, {optional:true});
    mergeSourceId = normalizeObjectId(mergeSourceId, {optional:true});
    if (deviceId) deviceId = normalizeDeviceId(deviceId);
    this._event('upload-start', { snapshotCount:Array.isArray(files) ? files.length : 0, hasParent:Boolean(parentId), hasMergeSource:Boolean(mergeSourceId) });

    const statusResponse = await this.requestFn({ host:this.host, method:'GET', route:'/v1/access/status', token });
    if (statusResponse.status !== 200) throw responseError(statusResponse.status, statusResponse.body);
    const access = parseJsonBody(statusResponse.body);
    const state = String(access?.state || 'unknown').toLowerCase();
    if (access?.authorized !== true) {
      this._event('access-pending', { state });
      return {
        uploaded:false,
        authorized:false,
        state,
        reason: state === 'pending'
          ? 'Solicitação registrada no servidor. Autorize este usuário no aplicativo do servidor e tente novamente.'
          : `Acesso ao backup não autorizado no servidor (estado: ${state}).`
      };
    }

    const lineage = await this.list();
    if (!lineage.lineage_capable) {
      throw new RemoteBackupError(
        'O Vyzium Server precisa ser atualizado para a versão com histórico seguro antes de aceitar backups do Vyzium 3.4.',
        { code:'BACKUP_SERVER_UPGRADE_REQUIRED' }
      );
    }
    if (parentId && lineage.head_id && parentId !== lineage.head_id) {
      this._event('stale-parent-detected', { parentId, headId:lineage.head_id });
      // The upload is still allowed: the v0.4 server will preserve it as a
      // divergent candidate instead of promoting it. This local check is only
      // diagnostic and must never override server-side lineage enforcement.
    }

    const stamp = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
    await fs.promises.mkdir(this.tempRoot, { recursive:true, mode:0o700 });
    const bundlePath = path.join(this.tempRoot, `workspace-${stamp}.vyb.partial`);
    const envelopePath = path.join(this.tempRoot, `workspace-${stamp}.vzb.partial`);
    try {
      const bundle = await buildBundleFile(files, bundlePath, { uid, appVersion });
      this._event('bundle-ready', { bytes:bundle.size_bytes, files:bundle.records.map(r => ({ module:r.module, bytes:r.size_bytes })) });
      const envelope = await this.withBackupKey(async key => sealBundleFile(bundlePath, envelopePath, key, uid));
      this._event('envelope-ready', { id:envelope.id, bytes:envelope.size_bytes });

      const extraHeaders = {};
      if (parentId) extraHeaders['X-Vyzium-Parent'] = parentId;
      if (deviceId) extraHeaders['X-Vyzium-Device'] = deviceId;
      if (mergeSourceId) extraHeaders['X-Vyzium-Merge-Source'] = mergeSourceId;
      const uploadResponse = await this.requestFn({
        host:this.host,
        method:'PUT',
        route:`/v1/backups/${envelope.id}`,
        token,
        bodyPath:envelope.path,
        bodyLength:envelope.size_bytes,
        timeoutMs:120000,
        extraHeaders
      });
      if (uploadResponse.status !== 200) throw responseError(uploadResponse.status, uploadResponse.body);
      const uploadPayload = parseJsonBody(uploadResponse.body);
      this._event('put-complete', { id:envelope.id, bytes:envelope.size_bytes, serverStatus:String(uploadPayload?.status || ''), classification:String(uploadPayload?.classification || '') });

      const listing = await this.list();
      const item = listing.backups.find(entry => entry.id === envelope.id);
      if (!item || Number(item.bytes) !== envelope.size_bytes) {
        throw new RemoteBackupError('O servidor respondeu ao envio, mas o objeto não apareceu na verificação final.', { code:'BACKUP_VERIFY_MISSING' });
      }
      const classification = String(uploadPayload?.classification || (listing.head_id === envelope.id ? 'current' : 'divergent')).toLowerCase();
      const promoted = classification === 'current' && listing.head_id === envelope.id;
      this._event('verified', { id:envelope.id, bytes:envelope.size_bytes, classification, promoted, headId:listing.head_id });
      return {
        uploaded:true,
        authorized:true,
        state,
        id:envelope.id,
        bytes:envelope.size_bytes,
        classification,
        promoted,
        head_id:listing.head_id,
        server_status:String(uploadPayload?.status || 'stored'),
        created_ms:Number(item.created_ms || 0) || null,
        role:item.role,
        modules:bundle.records.map(record => ({ module:record.module, bytes:record.size_bytes, sha256:record.sha256 }))
      };
    } catch (error) {
      this._event('error', {
        code:String(error?.code || 'REMOTE_BACKUP_ERROR'),
        status:Number(error?.status || 0),
        requestId:error?.requestId || null,
        message:String(error?.message || error).slice(0, 500)
      });
      throw error;
    } finally {
      await Promise.allSettled([
        fs.promises.rm(bundlePath, { force:true }),
        fs.promises.rm(envelopePath, { force:true })
      ]);
    }
  }

  async downloadExtract(objectId) {
    const {uid, token} = await this._tokenAndUid();
    const id = normalizeObjectId(objectId);
    await fs.promises.mkdir(this.tempRoot, {recursive:true, mode:0o700});
    const dir = path.join(this.tempRoot, `restore-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
    const envelopePath = path.join(dir, `${id}.vzb`);
    const bundlePath = path.join(dir, 'workspace.vyb');
    const filesDir = path.join(dir, 'files');
    await fs.promises.mkdir(dir, {recursive:false, mode:0o700});
    try {
      const downloaded = await this.downloadFn({host:this.host, route:`/v1/backups/${id}`, token, outputPath:envelopePath, expectedId:id, timeoutMs:120000});
      const unsealed = await this.withBackupKey(async key => unsealEnvelopeFile(downloaded.path, bundlePath, key, uid));
      const extracted = await extractBundleFile(unsealed.path, filesDir, uid);
      await Promise.allSettled([
        fs.promises.rm(envelopePath,{force:true}),
        fs.promises.rm(bundlePath,{force:true})
      ]);
      this._event('download-extracted',{id,files:extracted.files.map(x=>({module:x.module,bytes:x.size_bytes}))});
      return {id,dir,header:extracted.header,files:extracted.files,bytes:downloaded.bytes};
    } catch (error) {
      await fs.promises.rm(dir,{recursive:true,force:true}).catch(()=>{});
      this._event('download-error',{id,code:String(error?.code||'REMOTE_BACKUP_ERROR'),message:String(error?.message||error).slice(0,500)});
      throw error;
    }
  }

  async cleanupExtracted(dir) {
    const target = path.resolve(String(dir || ''));
    const relative = path.relative(this.tempRoot,target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new RemoteBackupError('Diretório temporário inválido.', {code:'BACKUP_TEMP_INVALID'});
    await fs.promises.rm(target,{recursive:true,force:true});
  }
}
module.exports = {
  PUBLIC_HOST,
  MAX_OBJECT,
  BUNDLE_MAGIC,
  ENVELOPE_MAGIC,
  RemoteBackupError,
  RemoteBackupManager,
  buildBundleFile,
  sealBundleFile,
  unsealEnvelopeFile,
  extractBundleFile,
  sha256File,
  sha256Buffer,
  requestRemote,
  requestRemoteToFile,
  responseError,
  normalizeObjectId
};
