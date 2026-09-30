'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// A journal survives process termination between the two database swaps.
// Originals include WAL files and activation/lineage metadata, and stay intact
// until the complete local transaction has a durable commit marker.
const active = new Set();
const modules = ['followup', 'compras'];
const suffixes = ['', '-wal', '-shm'];

function journalPath(security) {
  return path.join(security.workspaceRoot(), 'backups', 'restore-transaction.json');
}

function hash(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) h.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function syncDirectory(dir) {
  // Windows cannot open a directory with Node's fs.openSync. File contents
  // still have their own FlushFileBuffers barrier on that platform.
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function durableCopy(source, target) {
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.copyFileSync(source, target);
  const fd = fs.openSync(target, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeJournal(file, record) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temporary = file + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(record));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  syncDirectory(path.dirname(file));
}

function targets(security, selected) {
  const result = selected.flatMap(name => suffixes.map(suffix => security.moduleDb(name) + suffix));
  if (security.statePath) result.push(security.statePath());
  if (security.validationCachePath) result.push(security.validationCachePath());
  result.push(path.join(security.workspaceRoot(), 'backups', 'remote-state.json'));
  const root = path.resolve(security.workspaceRoot());
  for (const file of result) {
    const rel = path.relative(root, path.resolve(file));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Destino de restauração fora do workspace.');
  }
  return result;
}

function loadTransaction(security) {
  const file = journalPath(security);
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Registro de restauração inválido. Os bancos foram preservados; a inicialização foi bloqueada.');
  }
  if (record.version !== 1 || !/^[a-f0-9]{36}$/.test(record.id || '') ||
      !['pending', 'committed'].includes(record.phase) || !Array.isArray(record.modules) ||
      !record.modules.length || new Set(record.modules).size !== record.modules.length ||
      record.modules.some(name => !modules.includes(name))) {
    throw new Error('Registro de restauração incompatível. Os bancos foram preservados.');
  }
  const expected = targets(security, record.modules);
  if (!Array.isArray(record.files) || record.files.length !== expected.length ||
      record.files.some((entry, i) => entry.target !== expected[i] || typeof entry.existed !== 'boolean' ||
        (entry.existed && !/^[a-f0-9]{64}$/.test(entry.sha256 || '')))) {
    throw new Error('Registro de restauração inconsistente. Os bancos foram preservados.');
  }
  return {file, record, directory:path.join(path.dirname(file), 'restore-transactions', record.id), security};
}

function cleanup(tx) {
  for (const name of tx.record.modules) {
    fs.rmSync(`${tx.security.moduleDb(name)}.restore-${tx.record.id}.new`, {force:true});
  }
  for (const entry of tx.record.files) fs.rmSync(entry.target + '.restore-rollback', {force:true});
  fs.rmSync(tx.directory, {recursive:true, force:true});
  fs.rmSync(tx.file, {force:true});
  syncDirectory(path.dirname(tx.file));
}

function rollbackRestoreTransaction(tx) {
  try {
    // Verify every original before changing anything. An interrupted rollback
    // may already have restored a target and removed its redundant copy.
    const sources = tx.record.files.map((entry, i) => {
      if (!entry.existed) return null;
      const saved = path.join(tx.directory, `${i}.original`);
      if (fs.existsSync(saved) && hash(saved) === entry.sha256) return saved;
      if (fs.existsSync(entry.target) && hash(entry.target) === entry.sha256) return entry.target;
      throw new Error('A cópia anterior não passou na verificação. A inicialização foi bloqueada para preservar os bancos.');
    });
    for (let i = 0; i < tx.record.files.length; i++) {
      const entry = tx.record.files[i];
      if (!entry.existed) {
        fs.rmSync(entry.target, {force:true});
      } else if (sources[i] !== entry.target) {
        const next = entry.target + '.restore-rollback';
        durableCopy(sources[i], next);
        fs.renameSync(next, entry.target);
        if (hash(entry.target) !== entry.sha256) throw new Error('Falha ao validar a recuperação do banco anterior.');
      }
      if (fs.existsSync(path.dirname(entry.target))) syncDirectory(path.dirname(entry.target));
    }
    cleanup(tx);
  } catch (error) {
    error.restoreUnsafe = true;
    throw error;
  } finally { active.delete(tx.file); }
}

function recoverRestoreTransaction(security) {
  const file = journalPath(security);
  if (active.has(file)) return {active:true};
  const tx = loadTransaction(security);
  if (!tx) return {recovered:false};
  if (tx.record.phase === 'committed') {
    // Cleanup errors never undo a committed restoration.
    try { cleanup(tx); } catch (_) {}
    return {recovered:true, committed:true};
  }
  rollbackRestoreTransaction(tx);
  return {recovered:true, rolledBack:true};
}

function beginRestoreTransaction(security, id, selected) {
  const file = journalPath(security);
  if (active.has(file)) throw new Error('Já existe uma restauração em andamento.');
  recoverRestoreTransaction(security);
  if (fs.existsSync(file)) throw new Error('A limpeza da restauração anterior ainda está pendente.');
  if (!/^[a-f0-9]{36}$/.test(id) || !selected.length || selected.some(x => !modules.includes(x))) {
    throw new Error('Transação de restauração inválida.');
  }
  const directory = path.join(path.dirname(file), 'restore-transactions', id);
  fs.mkdirSync(directory, {recursive:true, mode:0o700});
  const record = {version:1, id, phase:'pending', modules:selected, files:[]};
  for (const [i, target] of targets(security, selected).entries()) {
    const existed = fs.existsSync(target);
    let sha256 = null;
    if (existed) {
      const original = path.join(directory, `${i}.original`);
      durableCopy(target, original);
      sha256 = hash(original);
      if (sha256 !== hash(target)) throw new Error('O banco foi alterado enquanto a restauração era preparada.');
    }
    record.files.push({target, existed, sha256});
  }
  syncDirectory(directory);
  writeJournal(file, record);
  active.add(file);
  return {file, directory, record, security};
}

function commitRestoreTransaction(tx) {
  // Activation and lineage writers use atomic renames. Flush their final
  // contents, the installed databases and WAL before committing the journal.
  const directories = new Set();
  for (const entry of tx.record.files) {
    if (fs.existsSync(entry.target)) {
      const fd = fs.openSync(entry.target, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    if (fs.existsSync(path.dirname(entry.target))) directories.add(path.dirname(entry.target));
  }
  for (const directory of directories) syncDirectory(directory);
  writeJournal(tx.file, {...tx.record, phase:'committed'});
  tx.record.phase = 'committed';
  active.delete(tx.file);
  try { cleanup(tx); } catch (_) {}
}

module.exports = {beginRestoreTransaction, commitRestoreTransaction, rollbackRestoreTransaction, recoverRestoreTransaction};
