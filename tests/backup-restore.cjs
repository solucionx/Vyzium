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

test('new computer full restore installs validated HEAD without merge or promotion',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-full-restore-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const workspace=path.join(dir,'workspace');fs.mkdirSync(workspace,{recursive:true});
  const remoteDir=path.join(dir,'remote');fs.mkdirSync(remoteDir);
  const remoteDb=path.join(remoteDir,'followup.db');fs.writeFileSync(remoteDb,'encrypted-head-bytes');
  const head='e'.repeat(64);let started=0,stopped=0,promoted=0;
  const security={
    workspaceRoot:()=>workspace,
    moduleDb:name=>path.join(workspace,name==='compras'?'compras.sqlite3':'followup.db'),
    status:async()=>({ready:false,vaultUsable:true}),
    getModuleKeyHex:()=> 'ab'.repeat(32),
    validateBackupDatabase:async(_name,p)=>{assert.ok(fs.existsSync(p));return{ok:true};},
    activateRestoredWorkspace:async()=>({ready:true}),
    remoteBackupFingerprint:()=> 'restored-fingerprint'
  };
  const manager={
    status:async()=>({authorized:true,state:'active'}),
    list:async()=>({head_id:head,retention:3,backups:[{id:head,bytes:20,created_ms:1,role:'current'}]}),
    downloadExtract:async()=>({id:head,dir:remoteDir,files:[{module:'followup',path:remoteDb,size_bytes:20,sha256:'a'.repeat(64),encrypted:true}]}),
    cleanupExtracted:async()=>{}
  };
  const {BackupRestoreCoordinator}=require('../electron/backup-restore');
  const coordinator=new BackupRestoreCoordinator({
    securityManager:security,getRemoteManager:()=>manager,
    runSyncTool:async()=>{throw new Error('merge engine must not run for empty PC');},
    stopServices:async()=>{stopped++;},startServices:async()=>{started++;},
    promoteMergedBackup:async()=>{promoted++;return{promoted:true};}
  });
  const plan=await coordinator.prepare();
  assert.equal(plan.local_has_data,false);
  const result=await coordinator.apply(plan.plan_id,{});
  assert.equal(result.merged,false);
  assert.equal(fs.readFileSync(security.moduleDb('followup'),'utf8'),'encrypted-head-bytes');
  assert.equal(readBackupState(security).object_id,head);
  assert.equal(promoted,0);
  assert.ok(stopped>=2);
  assert.equal(started,1);
});

test('atomic install rolls the original database back when post-swap validation fails',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-atomic-rollback-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const workspace=path.join(dir,'workspace');fs.mkdirSync(workspace,{recursive:true});
  const target=path.join(workspace,'followup.db');fs.writeFileSync(target,'ORIGINAL');
  const candidate=path.join(dir,'candidate.db');fs.writeFileSync(candidate,'NEW-CANDIDATE');
  let targetValidationCount=0;
  const security={
    workspaceRoot:()=>workspace,
    moduleDb:()=>target,
    validateBackupDatabase:async(_name,p)=>{
      if(p===target){
        targetValidationCount++;
        if(targetValidationCount===1) throw new Error('forced post-swap validation failure');
      }
      return{ok:true};
    }
  };
  const {BackupRestoreCoordinator}=require('../electron/backup-restore');
  const coordinator=new BackupRestoreCoordinator({securityManager:security});
  await assert.rejects(()=>coordinator._atomicInstall({followup:candidate},'f'.repeat(36)),/forced post-swap/);
  assert.equal(fs.readFileSync(target,'utf8'),'ORIGINAL');
});

test('sync summary aggregates modules without deciding conflicts automatically',()=>{
  const summary=syncSummary({
    followup:{additions:2,updates:3,preserved_local:4,equal:5,history_added:6,conflict_count:1},
    compras:{additions:1,updates:2,preserved_local:3,equal:4,history_added:5,conflict_count:2}
  });
  assert.deepEqual(summary,{additions:3,updates:5,preserved_local:7,equal:9,history_added:11,conflict_count:3});
});
