'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  generateRootKey,
  deriveModuleKey,
  generateRecoveryCode,
  wrapRootKeyForRecovery,
  unwrapRootKeyFromRecovery
} = require('./security-core');

class SecurityManager {
  constructor({ app, safeStorage, firebase, auth, runSecurityTool, reportProgress = null }) {
    this.app = app;
    this.safeStorage = safeStorage;
    this.firebase = firebase;
    this.auth = auth;
    this.runSecurityTool = runSecurityTool;
    this.reportProgress = typeof reportProgress === 'function' ? reportProgress : () => {};
  }


  _progress(message, { module = '', stage = '' } = {}) {
    try { this.reportProgress({ message: String(message || ''), module, stage }); } catch (_) {}
  }

  async _withTimeout(promise, ms, message) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  get userData() { return this.app.getPath('userData'); }
  get legacyComprasDir() { return path.join(this.app.getPath('appData'), 'Vyzium-Compras'); }
  get legacyFollowupDb() { return path.join(this.userData, 'followup.db'); }
  get legacyComprasDb() { return path.join(this.legacyComprasDir, 'compras.sqlite3'); }
  get legacyWhatsApp() { return path.join(this.userData, 'whatsapp-session'); }

  _workspaceId() {
    const state = this.auth.getState();
    if (!state.authenticated || !state.uid) throw new Error('Entre na sua conta Vyzium.');
    return state.workspaceId || state.uid;
  }

  workspaceRoot(workspaceId = this._workspaceId()) {
    return path.join(this.userData, 'workspaces', workspaceId);
  }

  moduleDir(moduleName, workspaceId = this._workspaceId()) {
    return path.join(this.workspaceRoot(workspaceId), moduleName);
  }

  moduleDb(moduleName, workspaceId = this._workspaceId()) {
    return path.join(this.moduleDir(moduleName, workspaceId), moduleName === 'compras' ? 'compras.sqlite3' : 'followup.db');
  }

  whatsappDir(workspaceId = this._workspaceId()) {
    return path.join(this.workspaceRoot(workspaceId), 'whatsapp-session');
  }

  whatsappRuntimeDir(workspaceId = this._workspaceId()) {
    // Chromium profile/cache data is machine-local on Windows. Electron's
    // userData is normally under AppData\Roaming, so keep browser runtime data
    // explicitly in LOCALAPPDATA while the Vyzium metadata stays in the workspace.
    const localRoot = process.env.LOCALAPPDATA || this.app.getPath('userData');
    return path.join(localRoot, 'Vyzium', 'workspaces', workspaceId, 'whatsapp-runtime');
  }

  vaultPath(workspaceId = this._workspaceId()) {
    return path.join(this.workspaceRoot(workspaceId), 'security', 'vault.json');
  }

  statePath(workspaceId = this._workspaceId()) {
    return path.join(this.workspaceRoot(workspaceId), 'security', 'state.json');
  }

  recoveryEnvelopePath(workspaceId = this._workspaceId()) {
    return path.join(this.workspaceRoot(workspaceId), 'security', 'recovery-envelope.json');
  }

  validationCachePath(workspaceId = this._workspaceId()) {
    return path.join(this.workspaceRoot(workspaceId), 'security', 'validation.json');
  }

  _hashFileSync(filePath) {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let bytesRead = 0;
      let position = 0;
      do {
        bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
        if (bytesRead > 0) {
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
      } while (bytesRead > 0);
      return hash.digest('hex');
    } finally {
      fs.closeSync(fd);
    }
  }

  _databaseFingerprint(target) {
    // Integrity cache keys are content-based. Size/mtime alone can be spoofed
    // or restored while bytes changed, and committed SQLite changes may live in WAL.
    const mainHash = this._hashFileSync(target);
    const walPath = `${target}-wal`;
    const walHash = fs.existsSync(walPath) ? this._hashFileSync(walPath) : 'none';
    return `sha256:${mainHash}:${walHash}:${this.app.getVersion?.() || ''}`;
  }

  _readValidationCache(workspaceId) {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.validationCachePath(workspaceId), 'utf8'));
      return parsed && typeof parsed === 'object' && parsed.modules ? parsed : { version: 1, modules: {} };
    } catch (_) {
      return { version: 1, modules: {} };
    }
  }

  _encryptionAvailable() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  _writeJsonAtomic(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  _saveRecoveryEnvelope(envelope, workspaceId) {
    // This file contains only the AES-GCM wrapped root key. It is safe to keep
    // alongside the encrypted databases because the recovery code is never stored.
    this._writeJsonAtomic(this.recoveryEnvelopePath(workspaceId), {
      ...envelope,
      workspaceId,
      savedAt: new Date().toISOString()
    });
  }

  _loadRecoveryEnvelope(workspaceId) {
    const file = this.recoveryEnvelopePath(workspaceId);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number(parsed?.version) !== 1 || !parsed?.ciphertext || !parsed?.tag) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  _saveRootKey(rootKey, workspaceId) {
    if (!this._encryptionAvailable()) throw new Error('A proteção segura de chaves do Windows não está disponível.');
    const encrypted = this.safeStorage.encryptString(rootKey.toString('hex')).toString('base64');
    this._writeJsonAtomic(this.vaultPath(workspaceId), {
      version: 1,
      workspaceId,
      protectedBy: process.platform === 'win32' ? 'Windows DPAPI via Electron safeStorage' : 'Electron safeStorage',
      encryptedRootKey: encrypted,
      createdAt: new Date().toISOString()
    });
  }

  _loadRootKey(workspaceId = this._workspaceId()) {
    if (!this._encryptionAvailable()) throw new Error('A proteção segura de chaves do sistema não está disponível.');
    const file = this.vaultPath(workspaceId);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const hex = this.safeStorage.decryptString(Buffer.from(data.encryptedRootKey, 'base64'));
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) throw new Error('O cofre local de chaves está inválido.');
    return key;
  }

  getModuleKeyHex(moduleName) {
    const rootKey = this._loadRootKey();
    if (!rootKey) throw new Error('O banco protegido ainda não foi configurado para esta conta.');
    try {
      const moduleKey = deriveModuleKey(rootKey, moduleName);
      try { return moduleKey.toString('hex'); }
      finally { moduleKey.fill(0); }
    } finally {
      rootKey.fill(0);
    }
  }

  async status() {
    const authState = this.auth.getState();
    if (!authState.authenticated) return { authenticated: false, ready: false };
    const workspaceId = authState.workspaceId || authState.uid;
    const vault = fs.existsSync(this.vaultPath(workspaceId));
    let vaultUsable = false;
    let vaultError = '';
    if (vault) {
      try {
        const rootKey = this._loadRootKey(workspaceId);
        vaultUsable = Boolean(rootKey);
        if (rootKey) rootKey.fill(0);
      } catch (error) {
        vaultError = String(error?.message || error);
      }
    }
    const followupSecure = fs.existsSync(this.moduleDb('followup', workspaceId));
    const comprasSecure = fs.existsSync(this.moduleDb('compras', workspaceId));
    const legacyFollowup = fs.existsSync(this.legacyFollowupDb);
    const legacyCompras = fs.existsSync(this.legacyComprasDb);
    let marker = null;
    try { marker = JSON.parse(fs.readFileSync(this.statePath(workspaceId), 'utf8')); } catch (_) {}
    const active = Boolean(marker?.active);
    return {
      authenticated: true,
      workspaceId,
      encryptionAvailable: this._encryptionAvailable(),
      vault,
      vaultUsable,
      vaultError,
      recoveryEnvelopeLocal: fs.existsSync(this.recoveryEnvelopePath(workspaceId)),
      secure: { followup: followupSecure, compras: comprasSecure },
      legacy: { followup: legacyFollowup, compras: legacyCompras },
      migrationRequired: !active || !vaultUsable || (legacyFollowup && !followupSecure) || (legacyCompras && !comprasSecure),
      recoveryRequired: active && !vaultUsable,
      ready: Boolean(active && vaultUsable),
      marker
    };
  }

  async validateProtectedDatabases({ force = false } = {}) {
    const authState = this.auth.getState();
    if (!authState.authenticated || !authState.emailVerified) {
      throw new Error('Entre em uma conta verificada para validar os bancos protegidos.');
    }
    const workspaceId = authState.workspaceId || authState.uid;
    // Revalidating both databases on every login spawned two engine processes
    // (each with a multi-minute timeout) even when nothing had changed since
    // the last successful check. Skip a module whose file is byte-identical to
    // the one already validated by this app version; force it with `force`.
    const cache = force ? { version: 1, modules: {} } : this._readValidationCache(workspaceId);
    const results = {};
    let cacheChanged = force;
    for (const moduleName of ['followup', 'compras']) {
      const target = this.moduleDb(moduleName, workspaceId);
      if (!fs.existsSync(target)) {
        results[moduleName] = { ok: true, exists: false };
        if (cache.modules[moduleName]) {
          delete cache.modules[moduleName];
          cacheChanged = true;
        }
        continue;
      }
      let fingerprint = null;
      try { fingerprint = this._databaseFingerprint(target); } catch (_) {}
      const cached = cache.modules[moduleName];
      if (fingerprint && cached?.fingerprint === fingerprint && cached?.result?.ok) {
        results[moduleName] = { ...cached.result, cached: true };
        continue;
      }
      this._progress('Verificando integridade…', { module: moduleName, stage: 'validate' });
      let keyHex = this.getModuleKeyHex(moduleName);
      try {
        results[moduleName] = await this.runSecurityTool(
          ['validate-db', '--path', target, '--module', moduleName],
          { VYZIUM_DB_KEY_HEX: keyHex }
        );
      } finally {
        keyHex = '';
      }
      if (!results[moduleName]?.ok) {
        delete cache.modules[moduleName];
        try { this._writeJsonAtomic(this.validationCachePath(workspaceId), cache); } catch (_) {}
        throw new Error(`O banco protegido de ${moduleName === 'compras' ? 'Cotação & Mapas' : 'Acompanhamento'} não passou na validação.`);
      }
      if (fingerprint) {
        cache.modules[moduleName] = { fingerprint, validatedAt: new Date().toISOString(), result: results[moduleName] };
        cacheChanged = true;
      }
    }
    if (cacheChanged) {
      try { this._writeJsonAtomic(this.validationCachePath(workspaceId), cache); } catch (_) {}
    }
    return results;
  }


  _quarantineFailedMigrationTarget(moduleName, target, workspaceId) {
    const dir = path.join(this.workspaceRoot(workspaceId), 'backups', 'migration-failed');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(dir, `${moduleName}-${stamp}`);
    const moved = [];
    for (const [suffix, label] of [['', '.db'], ['-wal', '.wal'], ['-shm', '.shm']]) {
      const source = target + suffix;
      if (!fs.existsSync(source)) continue;
      const destination = base + label;
      fs.renameSync(source, destination);
      moved.push(destination);
    }
    return moved;
  }

  async _copyLegacyWhatsApp(workspaceId) {
    const destination = this.whatsappDir(workspaceId);
    if (!fs.existsSync(this.legacyWhatsApp) || fs.existsSync(destination)) return false;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(this.legacyWhatsApp, destination, { recursive: true, errorOnExist: false });
    return true;
  }

  async prepare() {
    const authState = this.auth.getState();
    if (!authState.authenticated || !authState.emailVerified) throw new Error('Confirme seu e-mail antes de proteger os dados.');
    if (authState.offline) throw new Error('A primeira configuração de segurança exige conexão com a internet.');
    if (!this._encryptionAvailable()) throw new Error('A proteção segura de chaves do Windows não está disponível neste computador.');

    this._progress('Validando workspace da sua conta…', { stage: 'workspace' });
    const workspace = await this._withTimeout(
      this.auth.ensureWorkspace(),
      60_000,
      'A preparação do workspace no Firebase excedeu 60 segundos. Verifique sua conexão e tente novamente.'
    );
    const workspaceId = workspace.workspaceId;
    fs.mkdirSync(this.workspaceRoot(workspaceId), { recursive: true });
    this._progress('Verificando o SQLCipher local…', { stage: 'sqlcipher-check' });
    const runtime = await this.runSecurityTool(['security-check'], {});
    if (!runtime?.available) throw new Error('SQLCipher não está disponível no motor instalado. A migração foi bloqueada.');

    this._progress('Preparando a chave protegida pelo Windows…', { stage: 'key' });
    let rootKey = this._loadRootKey(workspaceId);
    if (!rootKey) {
      rootKey = generateRootKey();
      this._saveRootKey(rootKey, workspaceId);
    }

    try {
      // Until activation is committed, always issue a fresh recovery code. This
      // makes an interrupted first-run safe: closing the app before confirming the
      // code never leaves the user with an unrecoverable vault. A new code simply
      // replaces the previous encrypted envelope while keeping the same root key.
      let marker = null;
      try { marker = JSON.parse(fs.readFileSync(this.statePath(workspaceId), 'utf8')); } catch (_) {}
      let recoveryCode = null;
      if (!marker?.active) {
        this._progress('Gerando seu código de recuperação…', { stage: 'recovery-code' });
        recoveryCode = generateRecoveryCode();
        const envelope = wrapRootKeyForRecovery(rootKey, recoveryCode);
        this._progress('Atualizando a sessão segura…', { stage: 'token' });
        const idToken = await this._withTimeout(
          this.auth.getIdToken(),
          30_000,
          'A atualização da sessão no Firebase excedeu 30 segundos. Entre novamente e tente de novo.'
        );
        // Upload only the encrypted envelope. The plaintext root key and recovery
        // code never leave this process. Keep a local ciphertext copy as an extra
        // disaster-recovery aid; it is useless without the recovery code.
        this._progress('Salvando o envelope criptografado de recuperação…', { stage: 'recovery-envelope' });
        await this._withTimeout(
          this.firebase.putRecoveryEnvelope(workspaceId, envelope, idToken),
          45_000,
          'O salvamento do envelope de recuperação no Firebase excedeu 45 segundos. Nenhum banco foi migrado; tente novamente.'
        );
        this._saveRecoveryEnvelope(envelope, workspaceId);
      }
      this._progress('Preparação concluída.', { stage: 'prepared' });
      return { prepared: true, recoveryCode, workspaceId, cipherVersion: runtime.cipher_version || '' };
    } finally {
      rootKey.fill(0);
    }
  }

  async finalize() {
    const authState = this.auth.getState();
    if (!authState.authenticated || !authState.emailVerified) throw new Error('Confirme seu e-mail antes de proteger os dados.');
    if (!this._encryptionAvailable()) throw new Error('A proteção segura de chaves do Windows não está disponível neste computador.');
    const workspaceId = authState.workspaceId || authState.uid;
    const rootKey = this._loadRootKey(workspaceId);
    if (!rootKey) throw new Error('A chave local ainda não foi preparada.');

    try {
      this._progress('Verificando o SQLCipher antes da migração…', { stage: 'sqlcipher-check' });
      const runtime = await this.runSecurityTool(['security-check'], {});
      if (!runtime?.available) throw new Error('SQLCipher não está disponível no motor instalado.');

      let existingMarker = null;
      try { existingMarker = JSON.parse(fs.readFileSync(this.statePath(workspaceId), 'utf8')); } catch (_) {}
      const migrations = {};
      for (const moduleName of ['followup', 'compras']) {
        const source = moduleName === 'followup' ? this.legacyFollowupDb : this.legacyComprasDb;
        const target = this.moduleDb(moduleName, workspaceId);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const sourceExists = fs.existsSync(source);
        let targetExists = fs.existsSync(target);
        let quarantined = [];

        // If activation was never committed, any pre-existing encrypted target is
        // residue from an interrupted/older migration. The legacy source is still
        // the authoritative copy, so do NOT spend minutes integrity-checking an
        // untrusted partial SQLCipher file. Quarantine it immediately and rebuild.
        // Only an already-active workspace is allowed to validate/reuse a target.
        if (sourceExists && targetExists && !existingMarker?.active) {
          this._progress('Isolando uma tentativa anterior incompleta…', { module: moduleName, stage: 'quarantine' });
          quarantined = this._quarantineFailedMigrationTarget(moduleName, target, workspaceId);
          targetExists = false;
        } else if (sourceExists && targetExists) {
          this._progress('Validando banco protegido existente…', { module: moduleName, stage: 'validate-existing' });
          const moduleKey = deriveModuleKey(rootKey, moduleName);
          let keyHex;
          try { keyHex = moduleKey.toString('hex'); }
          finally { moduleKey.fill(0); }
          try {
            await this.runSecurityTool(
              ['validate-db', '--path', target, '--module', moduleName],
              { VYZIUM_DB_KEY_HEX: keyHex }
            );
          } catch (error) {
            // An active database contains post-migration customer changes. A
            // timeout, wrong key or lock must never roll it back to legacy data.
            throw new Error(`O banco ativo de ${moduleName} não pôde ser validado. Os arquivos atuais foram preservados. Detalhe: ${error?.message || error}`);
          } finally {
            keyHex = '';
          }
        }

        if (sourceExists && !targetExists) {
          const moduleKey = deriveModuleKey(rootKey, moduleName);
          let keyHex;
          try { keyHex = moduleKey.toString('hex'); }
          finally { moduleKey.fill(0); }
          try {
            this._progress('Iniciando migração segura…', { module: moduleName, stage: 'migrate' });
            migrations[moduleName] = await this.runSecurityTool([
              'migrate-db', '--source', source, '--target', target, '--module', moduleName
            ], { VYZIUM_DB_KEY_HEX: keyHex });
            if (quarantined.length) migrations[moduleName].quarantined_previous_target = quarantined;
          } finally {
            keyHex = '';
          }
        } else {
          migrations[moduleName] = {
            migrated: false,
            source_exists: sourceExists,
            target_exists: targetExists,
            ...(quarantined.length ? { quarantined_previous_target: quarantined } : {})
          };
        }
      }

      // Revalidate every encrypted target immediately before activation. This also
      // protects a retry after an interrupted migration: an existing target is
      // never trusted solely because the file is present.
      this._progress('Executando validação final dos bancos protegidos…', { stage: 'final-validation' });
      const protectedValidation = await this.validateProtectedDatabases({ force: true });

      this._progress('Finalizando a proteção do workspace…', { stage: 'finalize' });
      const whatsappCopied = await this._copyLegacyWhatsApp(workspaceId);
      const marker = {
        version: 1,
        active: true,
        workspaceId,
        activatedAt: new Date().toISOString(),
        legacyDatabasesRetained: true,
        legacyPaths: { followup: this.legacyFollowupDb, compras: this.legacyComprasDb },
        securePaths: { followup: this.moduleDb('followup', workspaceId), compras: this.moduleDb('compras', workspaceId) },
        migrations,
        protectedValidation,
        whatsappCopied,
        cipherVersion: runtime.cipher_version || ''
      };
      this._writeJsonAtomic(this.statePath(workspaceId), marker);
      this._progress('Proteção concluída.', { stage: 'ready' });
      return { ready: true, marker };
    } finally {
      rootKey.fill(0);
    }
  }

  async recoverWithCode(recoveryCode) {
    const authState = this.auth.getState();
    if (!authState.authenticated || !authState.emailVerified) {
      throw new Error('Entre em uma conta verificada para recuperar a chave.');
    }
    const workspaceId = authState.workspaceId || authState.uid;

    let envelope = null;
    if (!authState.offline) {
      try {
        const idToken = await this.auth.getIdToken();
        envelope = await this.firebase.getRecoveryEnvelope(workspaceId, idToken);
        if (envelope) this._saveRecoveryEnvelope(envelope, workspaceId);
      } catch (_) {
        // A previously cached encrypted envelope is a safe fallback when the
        // Firestore request is temporarily unavailable.
      }
    }
    if (!envelope) envelope = this._loadRecoveryEnvelope(workspaceId);
    if (!envelope) {
      throw new Error('Não existe envelope de recuperação disponível para este workspace. Conecte-se à internet e tente novamente.');
    }

    let rootKey;
    try {
      rootKey = unwrapRootKeyFromRecovery(envelope, recoveryCode);
    } catch (_) {
      throw new Error('Código de recuperação inválido.');
    }
    try {
      this._saveRootKey(rootKey, workspaceId);
    } finally {
      rootKey.fill(0);
    }
    return { recovered: true };
  }

  clearKeyFromMemory() {
    // Root keys are loaded only for the duration of individual operations. There
    // is intentionally no long-lived root-key property to wipe here.
  }
}

module.exports = { SecurityManager };
