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
    : status === 403 ? 'Este usuário ainda não foi autorizado no Poco.'
    : status === 409 ? 'O servidor rejeitou o objeto de backup.'
    : status === 429 ? 'O servidor limitou temporariamente as solicitações.'
    : status === 503 ? 'O servidor do Poco está temporariamente indisponível.'
    : `Falha no servidor de backup (HTTP ${status}).`;
  const detail = String(payload?.error || '').trim();
  return new RemoteBackupError(detail ? `${fallback} ${detail}` : fallback, {
    code: serverCode || `BACKUP_HTTP_${status}`,
    status,
    requestId
  });
}

function requestRemote({ host = PUBLIC_HOST, method = 'GET', route, token, bodyPath = null, bodyLength = 0, timeoutMs = 45000, responseLimit = RESPONSE_LIMIT }) {
  const bearer = normalizeToken(token);
  if (!/^\/[A-Za-z0-9/_-]+$/.test(String(route || ''))) throw new RemoteBackupError('Rota remota inválida.', { code:'BACKUP_ROUTE_INVALID' });
  return new Promise((resolve, reject) => {
    const headers = {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
      Connection: 'close'
    };
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
    req.on('timeout', () => req.destroy(new RemoteBackupError('Tempo limite ao acessar o servidor do Poco.', { code:'BACKUP_TIMEOUT' })));
    req.on('error', error => {
      if (error instanceof RemoteBackupError) return reject(error);
      reject(new RemoteBackupError('Não foi possível acessar o servidor de backup do Poco.', { code:'BACKUP_NETWORK_ERROR' }));
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

class RemoteBackupManager {
  constructor({ tempRoot, getToken, getUid, withBackupKey, host = PUBLIC_HOST, audit = null, requestFn = requestRemote } = {}) {
    this.tempRoot = path.resolve(String(tempRoot || '.'));
    this.getToken = getToken;
    this.getUid = getUid;
    this.withBackupKey = withBackupKey;
    this.host = host;
    this.audit = typeof audit === 'function' ? audit : () => {};
    this.requestFn = requestFn;
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

  async upload(files, { appVersion = '' } = {}) {
    const { uid, token } = await this._tokenAndUid();
    this._event('upload-start', { snapshotCount:Array.isArray(files) ? files.length : 0 });

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
          ? 'Solicitação registrada no Poco. Autorize este usuário no aplicativo do servidor e tente novamente.'
          : `Acesso ao backup não autorizado no Poco (estado: ${state}).`
      };
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

      const uploadResponse = await this.requestFn({
        host:this.host,
        method:'PUT',
        route:`/v1/backups/${envelope.id}`,
        token,
        bodyPath:envelope.path,
        bodyLength:envelope.size_bytes,
        timeoutMs:120000
      });
      if (uploadResponse.status !== 200) throw responseError(uploadResponse.status, uploadResponse.body);
      const uploadPayload = parseJsonBody(uploadResponse.body);
      this._event('put-complete', { id:envelope.id, bytes:envelope.size_bytes, serverStatus:String(uploadPayload?.status || '') });

      const listResponse = await this.requestFn({ host:this.host, method:'GET', route:'/v1/backups', token, timeoutMs:45000 });
      if (listResponse.status !== 200) throw responseError(listResponse.status, listResponse.body);
      const listPayload = parseJsonBody(listResponse.body);
      const item = Array.isArray(listPayload?.backups)
        ? listPayload.backups.find(entry => String(entry?.id || '') === envelope.id)
        : null;
      if (!item || Number(item.bytes) !== envelope.size_bytes) {
        throw new RemoteBackupError('O servidor respondeu ao envio, mas o objeto não apareceu na verificação final.', { code:'BACKUP_VERIFY_MISSING' });
      }
      this._event('verified', { id:envelope.id, bytes:envelope.size_bytes });
      return {
        uploaded:true,
        authorized:true,
        state,
        id:envelope.id,
        bytes:envelope.size_bytes,
        server_status:String(uploadPayload?.status || 'stored'),
        created_ms:Number(item.created_ms || 0) || null,
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
  sha256File,
  sha256Buffer,
  requestRemote,
  responseError
};
