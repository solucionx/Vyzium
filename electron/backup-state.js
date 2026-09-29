'use strict';

const fs = require('fs');
const path = require('path');

function statePath(securityManager) {
  return path.join(securityManager.workspaceRoot(), 'backups', 'remote-state.json');
}

function readBackupState(securityManager) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(securityManager), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    // v3.3.8 compatibility: its object_id is still the last backup the PC knew
    // as current. v3.4 adds candidate/server-head metadata without discarding it.
    return {
      version:Number(parsed.version || 1),
      object_id:String(parsed.object_id || '') || null,
      last_success_at:parsed.last_success_at || null,
      bytes:Number(parsed.bytes || 0),
      reason:String(parsed.reason || ''),
      source_fingerprint:parsed.source_fingerprint || null,
      snapshot_signature:Array.isArray(parsed.snapshot_signature) ? parsed.snapshot_signature : [],
      candidate_id:String(parsed.candidate_id || '') || null,
      candidate_fingerprint:parsed.candidate_fingerprint || null,
      candidate_at:parsed.candidate_at || null,
      server_head_id:String(parsed.server_head_id || '') || null
    };
  } catch (_) {
    return null;
  }
}

function writeAtomic(securityManager, next) {
  const target = statePath(securityManager);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({...next, version:2}, null, 2), {encoding:'utf8', mode:0o600});
  fs.renameSync(tmp, target);
  return next;
}

function writeCurrentBackupState(securityManager, {
  objectId, bytes = 0, reason = '', sourceFingerprint = null,
  snapshotSignature = [], serverHeadId = null, clearCandidate = true
} = {}) {
  const previous = readBackupState(securityManager) || {};
  const id = String(objectId || '').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Identificador do backup atual inválido.');
  return writeAtomic(securityManager, {
    ...previous,
    object_id:id,
    last_success_at:new Date().toISOString(),
    bytes:Number(bytes || 0),
    reason:String(reason || ''),
    source_fingerprint:sourceFingerprint || null,
    snapshot_signature:Array.isArray(snapshotSignature) ? snapshotSignature : [],
    server_head_id:String(serverHeadId || id),
    ...(clearCandidate ? {candidate_id:null,candidate_fingerprint:null,candidate_at:null} : {})
  });
}

function writeCandidateBackupState(securityManager, {
  candidateId, sourceFingerprint = null, serverHeadId = null, bytes = 0, reason = ''
} = {}) {
  const previous = readBackupState(securityManager) || {};
  const id = String(candidateId || '').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Identificador do backup divergente inválido.');
  return writeAtomic(securityManager, {
    ...previous,
    candidate_id:id,
    candidate_fingerprint:sourceFingerprint || null,
    candidate_at:new Date().toISOString(),
    server_head_id:String(serverHeadId || previous.server_head_id || '') || null,
    bytes:Number(bytes || previous.bytes || 0),
    reason:String(reason || previous.reason || '')
  });
}

function markRemoteBase(securityManager, {objectId, serverHeadId = null} = {}) {
  const previous = readBackupState(securityManager) || {};
  const id = String(objectId || '').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Identificador da base remota inválido.');
  return writeAtomic(securityManager, {
    ...previous,
    object_id:id,
    source_fingerprint:null,
    server_head_id:String(serverHeadId || id),
    last_success_at:previous.last_success_at || null
  });
}

module.exports = {
  statePath,
  readBackupState,
  writeCurrentBackupState,
  writeCandidateBackupState,
  markRemoteBase
};
