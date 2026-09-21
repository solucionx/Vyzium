'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeEmail, validatePassword } = require('./security-core');
const { FirebaseError } = require('./firebase-client');

const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;

class AuthManager {
  constructor({ firebase, safeStorage, userDataDir }) {
    this.firebase = firebase;
    this.safeStorage = safeStorage;
    this.securityDir = path.join(userDataDir, 'security');
    this.sessionPath = path.join(this.securityDir, 'firebase-session.json');
    this.current = null;
  }

  _encryptionReady() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  _encryptSecret(value) {
    if (!this._encryptionReady()) throw new Error('A proteção de credenciais do Windows não está disponível.');
    return this.safeStorage.encryptString(String(value)).toString('base64');
  }

  _decryptSecret(value) {
    if (!this._encryptionReady()) throw new Error('A proteção de credenciais do Windows não está disponível.');
    return this.safeStorage.decryptString(Buffer.from(String(value || ''), 'base64'));
  }

  _writeFile(data) {
    fs.mkdirSync(this.securityDir, { recursive: true });
    const tmp = this.sessionPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.sessionPath);
  }

  _persist(session) {
    const data = {
      version: 1,
      uid: session.uid,
      email: session.email,
      displayName: session.displayName || '',
      emailVerified: Boolean(session.emailVerified),
      refreshToken: this._encryptSecret(session.refreshToken),
      lastOnlineAt: session.lastOnlineAt || new Date().toISOString()
    };
    this._writeFile(data);
  }

  _public(session = this.current) {
    if (!session) return { authenticated: false };
    return {
      authenticated: true,
      uid: session.uid,
      email: session.email,
      displayName: session.displayName || '',
      emailVerified: Boolean(session.emailVerified),
      offline: Boolean(session.offline),
      workspaceId: session.workspaceId || session.uid
    };
  }

  getState() { return this._public(); }

  async _hydrateTokens(payload, previous = {}) {
    const idToken = payload.idToken || payload.id_token;
    const refreshToken = payload.refreshToken || payload.refresh_token || previous.refreshToken;
    const uid = payload.localId || payload.user_id || previous.uid;
    const expiresIn = Number(payload.expiresIn || payload.expires_in || 3600);
    if (!idToken || !refreshToken || !uid) throw new Error('O Firebase retornou uma sessão incompleta.');
    const user = await this.firebase.lookup(idToken);
    const session = {
      uid,
      email: normalizeEmail(user?.email || previous.email),
      displayName: String(user?.displayName || previous.displayName || ''),
      emailVerified: Boolean(user?.emailVerified),
      idToken,
      refreshToken,
      tokenExpiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
      lastOnlineAt: new Date().toISOString(),
      offline: false,
      workspaceId: uid
    };
    this.current = session;
    this._persist(session);
    return session;
  }

  async restore() {
    if (!fs.existsSync(this.sessionPath)) return this._public(null);
    let cached;
    try {
      cached = JSON.parse(fs.readFileSync(this.sessionPath, 'utf8'));
      const refreshToken = this._decryptSecret(cached.refreshToken);
      const refreshed = await this.firebase.refresh(refreshToken);
      await this._hydrateTokens(refreshed, { ...cached, refreshToken });
      return this._public();
    } catch (error) {
      const lastOnline = Date.parse(cached?.lastOnlineAt || '');
      const withinGrace = Number.isFinite(lastOnline) && Date.now() - lastOnline <= OFFLINE_GRACE_MS;
      if (error instanceof FirebaseError && error.code === 'NETWORK_ERROR' && cached?.emailVerified && withinGrace) {
        try {
          this.current = {
            uid: cached.uid,
            email: cached.email,
            displayName: cached.displayName || '',
            emailVerified: true,
            refreshToken: this._decryptSecret(cached.refreshToken),
            idToken: null,
            tokenExpiresAt: 0,
            lastOnlineAt: cached.lastOnlineAt,
            offline: true,
            workspaceId: cached.uid
          };
          return this._public();
        } catch (_) {}
      }
      this.current = null;
      return { authenticated: false, error: String(error?.message || error) };
    }
  }

  async register({ displayName, email, password }) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) throw new Error('Informe um e-mail válido.');
    const validation = validatePassword(password);
    if (!validation.ok) throw new Error('A senha deve ter 12 caracteres, maiúscula, minúscula, número e símbolo.');
    const payload = await this.firebase.signUp({ email: normalized, password });
    const session = await this._hydrateTokens(payload, { email: normalized, displayName: String(displayName || '').trim() });
    session.displayName = String(displayName || '').trim().slice(0, 120);
    this._persist(session);
    await this.firebase.sendVerification(session.idToken);
    return { ...this._public(session), verificationSent: true };
  }

  async login({ email, password }) {
    const payload = await this.firebase.signIn({ email, password });
    const session = await this._hydrateTokens(payload, { email: normalizeEmail(email) });
    return this._public(session);
  }

  async resendVerification() {
    const token = await this.getIdToken();
    await this.firebase.sendVerification(token);
    return { sent: true };
  }

  async refreshVerification() {
    if (!this.current?.refreshToken) throw new Error('Entre novamente para verificar sua conta.');
    const payload = await this.firebase.refresh(this.current.refreshToken);
    await this._hydrateTokens(payload, this.current);
    return this._public();
  }

  async resetPassword(email) {
    await this.firebase.sendPasswordReset(email);
    // Do not reveal whether the account exists; enumeration protection may also
    // make Firebase return a generic success for unknown addresses.
    return { sent: true };
  }

  async getIdToken() {
    if (!this.current) throw new Error('Sessão não autenticada.');
    if (this.current.offline) throw new Error('Esta operação exige conexão com a internet.');
    if (this.current.idToken && Date.now() < this.current.tokenExpiresAt - 60_000) return this.current.idToken;
    const payload = await this.firebase.refresh(this.current.refreshToken);
    await this._hydrateTokens(payload, this.current);
    return this.current.idToken;
  }

  async ensureWorkspace() {
    if (!this.current?.emailVerified) throw new Error('Confirme seu e-mail antes de continuar.');
    const idToken = await this.getIdToken();
    const result = await this.firebase.ensureProfileAndWorkspace({
      uid: this.current.uid,
      email: this.current.email,
      displayName: this.current.displayName,
      idToken
    });
    this.current.workspaceId = result.workspaceId;
    return result;
  }

  logout() {
    this.current = null;
    try { fs.unlinkSync(this.sessionPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { authenticated: false };
  }
}

module.exports = { AuthManager, OFFLINE_GRACE_MS };
