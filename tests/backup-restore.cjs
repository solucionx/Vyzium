'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {syncSummary}=require('../electron/backup-restore');
const {
  readBackupState,
  writeCurrentBackupState,
  writeCandidateBackupState,
  markRemoteBase
}=require('../electron/backup-state');

function fakeSecurity(root){
  return {workspaceRoot:()=>root};
}

test('backup state keeps current lineage separate from divergent candidate',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-backup-state-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const security=fakeSecurity(dir),head='a'.repeat(64),candidate='b'.repeat(64);
  writeCurrentBackupState(security,{objectId:head,sourceFingerprint:'fp-current',serverHeadId:head,reason:'manual'});
  writeCandidateBackupState(security,{candidateId:candidate,sourceFingerprint:'fp-candidate',serverHeadId:head,reason:'manual'});
  const state=readBackupState(security);
  assert.equal(state.object_id,head);
  assert.equal(state.source_fingerprint,'fp-current');
  assert.equal(state.candidate_id,candidate);
  assert.equal(state.candidate_fingerprint,'fp-candidate');
  assert.equal(state.server_head_id,head);
});

test('marking remote merge base never pretends server already has local merged fingerprint',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-backup-base-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const security=fakeSecurity(dir),head='c'.repeat(64);
  writeCurrentBackupState(security,{objectId:'d'.repeat(64),sourceFingerprint:'local-old'});
  markRemoteBase(security,{objectId:head,serverHeadId:head});
  const state=readBackupState(security);
  assert.equal(state.object_id,head);
  assert.equal(state.source_fingerprint,null);
});

test('sync summary aggregates modules without deciding conflicts automatically',()=>{
  const summary=syncSummary({
    followup:{additions:2,updates:3,preserved_local:4,equal:5,history_added:6,conflict_count:1},
    compras:{additions:1,updates:2,preserved_local:3,equal:4,history_added:5,conflict_count:2}
  });
  assert.deepEqual(summary,{additions:3,updates:5,preserved_local:7,equal:9,history_added:11,conflict_count:3});
});
