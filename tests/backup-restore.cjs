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

function restoreFixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-restore-errors-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const workspace=path.join(root,'workspace');
  const security={
    workspaceRoot:()=>workspace,
    moduleDb:name=>path.join(workspace,name,name==='compras'?'compras.sqlite3':'followup.db'),
    statePath:()=>path.join(workspace,'security','state.json'),
    validationCachePath:()=>path.join(workspace,'security','validation.json'),
    status:async()=>({ready:true,vaultUsable:true}),
    getModuleKeyHex:()=> 'ab'.repeat(32),
    validateBackupDatabase:async(_name,p)=>{assert.ok(fs.statSync(p).size>0);return{ok:true};},
    activateRestoredWorkspace:async()=>{fs.writeFileSync(security.statePath(),'NEW-ACTIVATION');return{ready:true};},
    remoteBackupFingerprint:()=> 'new-fingerprint'
  };
  fs.mkdirSync(path.dirname(security.statePath()),{recursive:true});
  fs.writeFileSync(security.statePath(),'OLD-ACTIVATION');
  fs.writeFileSync(security.validationCachePath(),'OLD-VALIDATION');
  const files=[];
  for(const name of ['followup','compras']) {
    const target=security.moduleDb(name);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,'ORIGINAL-'+name);
    fs.writeFileSync(target+'-wal','ORIGINAL-WAL-'+name);
    fs.writeFileSync(target+'-shm','ORIGINAL-SHM-'+name);
    const remote=path.join(root,name+'-remote.db');
    fs.writeFileSync(remote,'REMOTE-'+name);
    files.push({module:name,path:remote});
  }
  const head='a'.repeat(64);
  const calls={started:0,stopped:0,promoted:0};
  const manager={
    status:async()=>({authorized:true,state:'active'}),
    list:async()=>({head_id:head,lineage_capable:true,retention:3,backups:[{id:head,role:'current'}]}),
    downloadExtract:async()=>({id:head,dir:root,files}),
    cleanupExtracted:async()=>{}
  };
  const {BackupRestoreCoordinator}=require('../electron/backup-restore');
  const coordinator=new BackupRestoreCoordinator({
    securityManager:security,getRemoteManager:()=>manager,
    runSyncTool:async(_name,args)=>{
      if(args[0]==='analyze') return {conflicts:[],conflict_count:0};
      const source=args[args.indexOf(args[0]==='snapshot'?'--source':'--remote')+1];
      const output=args[args.indexOf('--output')+1];
      fs.copyFileSync(source,output);return{path:output};
    },
    stopServices:async()=>{calls.stopped++;},
    startServices:async()=>{calls.started++;},
    promoteMergedBackup:async()=>{calls.promoted++;return{promoted:true};}
  });
  return {root,workspace,security,files,manager,coordinator,calls,head};
}

function assertOriginal(f) {
  for(const name of ['followup','compras']) {
    assert.equal(fs.readFileSync(f.security.moduleDb(name),'utf8'),'ORIGINAL-'+name);
    assert.equal(fs.readFileSync(f.security.moduleDb(name)+'-wal','utf8'),'ORIGINAL-WAL-'+name);
    assert.equal(fs.readFileSync(f.security.moduleDb(name)+'-shm','utf8'),'ORIGINAL-SHM-'+name);
  }
  assert.equal(fs.readFileSync(f.security.statePath(),'utf8'),'OLD-ACTIVATION');
  assert.equal(fs.readFileSync(f.security.validationCachePath(),'utf8'),'OLD-VALIDATION');
}

test('failed download restarts services without changing either local database',async t=>{
  const f=restoreFixture(t);
  f.manager.downloadExtract=async()=>{throw new Error('download interrupted');};
  await assert.rejects(f.coordinator.prepare(),/download interrupted/);
  assert.equal(f.calls.stopped,1);assert.equal(f.calls.started,1);
  assertOriginal(f);
});

test('HEAD changing during conflict review restarts services and preserves originals',async t=>{
  const f=restoreFixture(t),plan=await f.coordinator.prepare();
  f.manager.list=async()=>({head_id:'b'.repeat(64),backups:[]});
  await assert.rejects(f.coordinator.apply(plan.plan_id),/Outro computador/);
  assert.equal(f.calls.started,1);assert.equal(f.calls.promoted,0);
  assertOriginal(f);
});

test('failure removing a second-module sidecar rolls back both modules including WAL',async t=>{
  const f=restoreFixture(t),plan=await f.coordinator.prepare();
  const original=fs.rmSync;let failed=false;
  t.mock.method(fs,'rmSync',(target,...args)=>{
    if(target===f.security.moduleDb('compras')+'-shm'&&!failed){failed=true;throw new Error('sidecar locked');}
    return original(target,...args);
  });
  await assert.rejects(f.coordinator.apply(plan.plan_id),/sidecar locked/);
  assert.equal(failed,true);assertOriginal(f);
  assert.equal(f.calls.promoted,0);
});

test('lineage write failure rolls back database bytes and activation metadata together',async t=>{
  const f=restoreFixture(t),plan=await f.coordinator.prepare();
  const original=fs.renameSync;let failed=false;
  t.mock.method(fs,'renameSync',(source,target)=>{
    if(String(source).endsWith('remote-state.json.tmp')&&!failed){failed=true;throw new Error('lineage disk failure');}
    return original(source,target);
  });
  await assert.rejects(f.coordinator.apply(plan.plan_id),/lineage disk failure/);
  assert.equal(failed,true);assertOriginal(f);
  assert.equal(readBackupState(f.security),null);
  assert.equal(f.calls.promoted,0);
});

test('concurrent restore requests cannot stop services or replace an active plan',async t=>{
  const f=restoreFixture(t);let unblock,entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const original=f.manager.downloadExtract;
  f.manager.downloadExtract=async()=>{entered();await new Promise(resolve=>{unblock=resolve;});return original();};
  const first=f.coordinator.prepare();await waiting;
  await assert.rejects(f.coordinator.prepare(),/operação de restauração em andamento/);
  assert.equal(f.calls.stopped,1);
  unblock();const plan=await first;
  await f.coordinator.cancel(plan.plan_id);
  assertOriginal(f);
});

function interruptedTransaction(f,phase) {
  const {spawnSync}=require('node:child_process');
  const script=`
    const fs=require('node:fs'),path=require('node:path');
    const root=process.argv[1],phase=process.argv[2];
    const security={workspaceRoot:()=>root,
      moduleDb:n=>path.join(root,n,n==='compras'?'compras.sqlite3':'followup.db'),
      statePath:()=>path.join(root,'security','state.json'),
      validationCachePath:()=>path.join(root,'security','validation.json')};
    const txmod=require(process.argv[3]);
    const tx=txmod.beginRestoreTransaction(security,'c'.repeat(36),['followup','compras']);
    fs.writeFileSync(security.moduleDb('followup'),'INTERRUPTED-NEW-FOLLOWUP');
    fs.rmSync(security.moduleDb('followup')+'-wal');
    fs.writeFileSync(security.statePath(),'INTERRUPTED-NEW-ACTIVATION');
    if(phase==='committed'){
      fs.writeFileSync(security.moduleDb('compras'),'COMMITTED-NEW-COMPRAS');
      const original=fs.rmSync;
      fs.rmSync=(p,...args)=>{if(p===tx.directory)throw new Error('cleanup interrupted');return original(p,...args);};
      txmod.commitRestoreTransaction(tx);
    }
    process.exit(72);
  `;
  const result=spawnSync(process.execPath,['-e',script,f.workspace,phase,require.resolve('../electron/restore-transaction')],{encoding:'utf8'});
  assert.equal(result.status,72,result.stderr);
}

test('a new process recovers an interrupted two-database swap and its activation metadata',t=>{
  const f=restoreFixture(t);
  interruptedTransaction(f,'pending');
  assert.equal(fs.readFileSync(f.security.moduleDb('followup'),'utf8'),'INTERRUPTED-NEW-FOLLOWUP');
  const {recoverRestoreTransaction}=require('../electron/restore-transaction');
  assert.equal(recoverRestoreTransaction(f.security).rolledBack,true);
  assertOriginal(f);
  assert.equal(recoverRestoreTransaction(f.security).recovered,false);
});

test('restart after durable commit keeps restored data even if cleanup was interrupted',t=>{
  const f=restoreFixture(t);
  interruptedTransaction(f,'committed');
  const {recoverRestoreTransaction}=require('../electron/restore-transaction');
  assert.equal(recoverRestoreTransaction(f.security).committed,true);
  assert.equal(fs.readFileSync(f.security.moduleDb('followup'),'utf8'),'INTERRUPTED-NEW-FOLLOWUP');
  assert.equal(fs.readFileSync(f.security.moduleDb('compras'),'utf8'),'COMMITTED-NEW-COMPRAS');
  assert.equal(fs.readFileSync(f.security.statePath(),'utf8'),'INTERRUPTED-NEW-ACTIVATION');
});

test('corrupt recovery copy blocks startup recovery and preserves all remaining evidence',t=>{
  const f=restoreFixture(t);
  interruptedTransaction(f,'pending');
  const saved=path.join(f.workspace,'backups','restore-transactions','c'.repeat(36),'0.original');
  fs.writeFileSync(saved,'CORRUPTED');
  const {recoverRestoreTransaction}=require('../electron/restore-transaction');
  assert.throws(()=>recoverRestoreTransaction(f.security),/inicialização foi bloqueada/);
  assert.ok(fs.existsSync(saved));
  assert.ok(fs.existsSync(path.join(f.workspace,'backups','restore-transaction.json')));
  assert.equal(fs.readFileSync(f.security.moduleDb('compras'),'utf8'),'ORIGINAL-compras');
});
