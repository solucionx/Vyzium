'use strict';

const config = require('./firebase-config');
const { normalizeEmail } = require('./security-core');

class FirebaseError extends Error {
  constructor(message, code = 'FIREBASE_ERROR', status = 0) {
    super(message);
    this.name = 'FirebaseError';
    this.code = code;
    this.status = status;
  }
}

const FRIENDLY_ERRORS = {
  EMAIL_EXISTS: 'Este e-mail já possui uma conta Vyzium.',
  INVALID_LOGIN_CREDENTIALS: 'E-mail ou senha incorretos.',
  INVALID_PASSWORD: 'E-mail ou senha incorretos.',
  EMAIL_NOT_FOUND: 'E-mail ou senha incorretos.',
  USER_DISABLED: 'Esta conta foi desativada.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  WEAK_PASSWORD: 'A senha não atende à política mínima de segurança.',
  INVALID_EMAIL: 'Informe um endereço de e-mail válido.',
  TOKEN_EXPIRED: 'Sua sessão expirou. Entre novamente.',
  INVALID_ID_TOKEN: 'Sua sessão não é mais válida. Entre novamente.'
};

function messageForFirebase(code, fallback) {
  const key = String(code || '').split(' : ')[0].trim();
  return FRIENDLY_ERRORS[key] || fallback || 'Não foi possível concluir a operação no Firebase.';
}

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number' && Number.isFinite(value)) return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, nested] of Object.entries(value)) fields[key] = encodeValue(nested);
    return { mapValue: { fields } };
  }
  throw new Error('Tipo de dado não suportado pelo Firestore.');
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) {
    const out = {};
    for (const [key, nested] of Object.entries(value.mapValue.fields || {})) out[key] = decodeValue(nested);
    return out;
  }
  return null;
}

function decodeDocument(document) {
  if (!document) return null;
  const data = {};
  for (const [key, value] of Object.entries(document.fields || {})) data[key] = decodeValue(value);
  return { name: document.name || '', ...data };
}

class FirebaseClient {
  constructor({ fetchImpl = globalThis.fetch, firebaseConfig = config } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch não disponível.');
    this.fetch = fetchImpl;
    this.config = firebaseConfig;
    this.authBase = `https://identitytoolkit.googleapis.com/v1`;
    this.tokenBase = `https://securetoken.googleapis.com/v1`;
    this.firestoreBase = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
  }

  async _request(url, { method = 'GET', headers = {}, body, timeout = 20000 } = {}) {
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeout)
      });
    } catch (error) {
      const wrapped = new FirebaseError('Não foi possível conectar ao serviço de autenticação. Verifique sua internet.', 'NETWORK_ERROR');
      wrapped.cause = error;
      throw wrapped;
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); } catch (_) { payload = { raw: text }; }
    }
    if (!response.ok) {
      const remote = payload?.error?.message || payload?.error?.status || '';
      const code = String(remote || `HTTP_${response.status}`);
      throw new FirebaseError(messageForFirebase(code, payload?.error?.message), code, response.status);
    }
    return payload;
  }

  async signUp({ email, password }) {
    return this._request(`${this.authBase}/accounts:signUp?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizeEmail(email), password: String(password), returnSecureToken: true })
    });
  }

  async signIn({ email, password }) {
    return this._request(`${this.authBase}/accounts:signInWithPassword?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizeEmail(email), password: String(password), returnSecureToken: true })
    });
  }

  async refresh(refreshToken) {
    const payload = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: String(refreshToken || '') });
    return this._request(`${this.tokenBase}/token?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload.toString()
    });
  }

  async lookup(idToken) {
    const payload = await this._request(`${this.authBase}/accounts:lookup?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    return payload?.users?.[0] || null;
  }

  async sendVerification(idToken) {
    return this._request(`${this.authBase}/accounts:sendOobCode?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken })
    });
  }

  async sendPasswordReset(email) {
    return this._request(`${this.authBase}/accounts:sendOobCode?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: normalizeEmail(email) })
    });
  }

  async firestoreGet(path, idToken) {
    try {
      const document = await this._request(`${this.firestoreBase}/${path}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      return decodeDocument(document);
    } catch (error) {
      if (error instanceof FirebaseError && error.status === 404) return null;
      throw error;
    }
  }

  async firestoreCreate(path, fields, idToken, { requestTimeField = 'createdAt' } = {}) {
    const name = `projects/${this.config.projectId}/databases/(default)/documents/${path}`;
    const writes = [{
      update: {
        name,
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]))
      },
      currentDocument: { exists: false },
      updateTransforms: requestTimeField ? [{ fieldPath: requestTimeField, setToServerValue: 'REQUEST_TIME' }] : []
    }];
    return this._request(`https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ writes })
    });
  }

  async firestorePatch(path, fields, idToken, { requestTimeField = null } = {}) {
    const name = `projects/${this.config.projectId}/databases/(default)/documents/${path}`;
    const writes = [{
      update: {
        name,
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]))
      },
      updateMask: { fieldPaths: Object.keys(fields) },
      currentDocument: { exists: true },
      ...(requestTimeField ? { updateTransforms: [{ fieldPath: requestTimeField, setToServerValue: 'REQUEST_TIME' }] } : {})
    }];
    return this._request(`https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ writes })
    });
  }

  async ensureProfileAndWorkspace({ uid, email, displayName, idToken }) {
    const userPath = `users/${encodeURIComponent(uid)}`;
    let user = await this.firestoreGet(userPath, idToken);
    if (!user) {
      await this.firestoreCreate(userPath, {
        displayName: String(displayName || '').trim().slice(0, 120),
        email: normalizeEmail(email)
      }, idToken);
      user = await this.firestoreGet(userPath, idToken);
    }

    // One primary workspace per account in 3.1. The deterministic ID avoids a
    // cloud query during startup and can later be migrated to multi-workspace.
    const workspaceId = uid;
    const workspacePath = `workspaces/${encodeURIComponent(workspaceId)}`;
    let workspace = await this.firestoreGet(workspacePath, idToken);
    if (!workspace) {
      await this.firestoreCreate(workspacePath, {
        name: 'Workspace Vyzium',
        ownerUid: uid,
        schemaVersion: 1
      }, idToken);
      workspace = await this.firestoreGet(workspacePath, idToken);
    }

    const memberPath = `workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(uid)}`;
    let member = await this.firestoreGet(memberPath, idToken);
    if (!member) {
      await this.firestoreCreate(memberPath, {
        uid,
        email: normalizeEmail(email),
        role: 'owner'
      }, idToken);
      member = await this.firestoreGet(memberPath, idToken);
    }

    return { user, workspace, member, workspaceId };
  }

  async putRecoveryEnvelope(workspaceId, envelope, idToken) {
    const path = `workspaces/${encodeURIComponent(workspaceId)}/keyRecovery/current`;
    const existing = await this.firestoreGet(path, idToken);
    const fields = {
      version: Number(envelope.version),
      algorithm: String(envelope.algorithm),
      kdf: String(envelope.kdf),
      salt: String(envelope.salt),
      iv: String(envelope.iv),
      ciphertext: String(envelope.ciphertext),
      tag: String(envelope.tag)
    };
    if (!existing) return this.firestoreCreate(path, fields, idToken, { requestTimeField: 'updatedAt' });
    return this.firestorePatch(path, fields, idToken, { requestTimeField: 'updatedAt' });
  }

  async getRecoveryEnvelope(workspaceId, idToken) {
    return this.firestoreGet(`workspaces/${encodeURIComponent(workspaceId)}/keyRecovery/current`, idToken);
  }
}

module.exports = { FirebaseClient, FirebaseError, encodeValue, decodeValue, decodeDocument };
