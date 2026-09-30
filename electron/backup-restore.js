'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  readBackupState,
  writeCurrentBackupState,
  markRemoteBase
} = require('./backup-state');

function safeModuleName(value) {
  const name = String(value || '').toLowerCase();
  if (!['followup','compras'].includes(name)) throw new Error('Módulo de restauração inválido.');
  return name;
}

function moduleFilename(name) {
  return name === 'compras' ? 'compras.sqlite3' : 'followup.db';
}

function safePlanId() {
  return crypto.randomBytes(18).toString('hex');
}

function syncSummary(reports) {
  const all = Object.values(reports || {});
  return {
    additions:all.reduce((n,r)=>n+Number(r?.additions||0),0),
    updates:all.reduce((n,r)=>n+Number(r?.updates||0),0),
    preserved_local:all.reduce((n,r)=>n+Number(r?.preserved_local||0),0),
    equal:all.reduce((n,r)=>n+Number(r?.equal||0),0),
    history_added:all.reduce((n,r)=>n+Number(r?.history_added||0),0),
    conflict_count:all.reduce((n,r)=>n+Number(r?.conflict_count||0),0)
  };
}

class BackupRestoreCoordinator {
  constructor({
    securityManager,
    getRemoteManager,
    runSyncTool,
    stopServices,
    startServices,
    promoteMergedBackup,
    audit = null
  } = {}) {
    this.securityManager = securityManager;
    this.getRemoteManager = getRemoteManager;
    this.runSyncTool = runSyncTool;
    this.stopServices = stopServices;
    this.startServices = startServices;
    this.promoteMergedBackup = promoteMergedBackup;
    this.audit = typeof audit === 'function' ? audit : () => {};
    this.plans = new Map();
    this.skippedHeadId = null;
  }

  _event(name, details = {}) {
    try { this.audit(`backup-restore.${name}`, details); } catch (_) {}
  }

  _localDatabases() {
    const result = {};
    for (const moduleName of ['followup','compras']) {
      const target = this.securityManager.moduleDb(moduleName);
      result[moduleName] = {
        path:target,
        exists:fs.existsSync(target) && fs.statSync(target).isFile() && fs.statSync(target).size > 0
      };
    }
    return result;
  }

  async preflight({ failOpen = true } = {}) {
    const local = this._localDatabases();
    const security = await this.securityManager.status();
    try {
      const manager = this.getRemoteManager();
      const access = await manager.status();
      if (!access.authorized) {
        return {
          available:true,
          authorized:false,
          access_state:access.state,
          has_remote:false,
          needs_sync:false,
          local_has_data:Object.values(local).some(x=>x.exists),
          security
        };
      }
      const listing = await manager.list();
      const state = readBackupState(this.securityManager);
      const head = listing.head_id || null;
      const skipped = Boolean(head && this.skippedHeadId === head);
      const needs = Boolean(head && state?.object_id !== head && !skipped);
      return {
        available:true,
        authorized:true,
        access_state:'active',
        has_remote:Boolean(head),
        head_id:head,
        head:head ? listing.backups.find(x=>x.id===head) || null : null,
        retention:listing.retention,
        backups:listing.backups.map(x=>({
          id:x.id,bytes:x.bytes,created_ms:x.created_ms,role:x.role,parent_id:x.parent_id
        })),
        local_base_id:state?.object_id || null,
        candidate_id:state?.candidate_id || null,
        server_head_id:state?.server_head_id || head,
        local_has_data:Object.values(local).some(x=>x.exists),
        local_modules:Object.fromEntries(Object.entries(local).map(([k,v])=>[k,v.exists])),
        needs_sync:needs,
        skipped,
        security
      };
    } catch (error) {
      this._event('preflight-unavailable',{message:String(error?.message||error).slice(0,300)});
      if (!failOpen) throw error;
      return {
        available:false,
        authorized:false,
        has_remote:false,
        needs_sync:false,
        local_has_data:Object.values(local).some(x=>x.exists),
        error:'Vyzium Server temporariamente indisponível. Os dados locais não foram alterados.',
        security
      };
    }
  }

  skipForSession(headId) {
    const id = String(headId || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Backup remoto inválido.');
    this.skippedHeadId = id;
    this._event('skipped-for-session',{headId:id});
    return {skipped:true,head_id:id};
  }

  clearSession() {
    this.skippedHeadId = null;
    for (const plan of this.plans.values()) {
      this._cleanupPlan(plan).catch(()=>{});
    }
    this.plans.clear();
  }

  _fileMap(extracted) {
    return Object.fromEntries((extracted?.files || []).map(file=>[safeModuleName(file.module),file]));
  }

  async _validateExtraction(extracted) {
    const files = this._fileMap(extracted);
    for (const [moduleName,file] of Object.entries(files)) {
      await this.securityManager.validateBackupDatabase(moduleName,file.path);
    }
    return files;
  }

  async prepare() {
    const preflight = await this.preflight({failOpen:false});
    if (!preflight.authorized) throw new Error('Este usuário ainda não está autorizado no Vyzium Server.');
    if (!preflight.head_id) return {available:true,has_remote:false,needs_sync:false};

    // A remote backup is encrypted with the account root key. A new computer
    // must recover that same key before any download can be opened.
    for (const moduleName of ['followup','compras']) this.securityManager.getModuleKeyHex(moduleName);

    await this.stopServices();
    const manager = this.getRemoteManager();
    const listing = await manager.list();
    if (listing.head_id !== preflight.head_id) {
      throw new Error('O backup principal mudou durante a preparação. Tente novamente para comparar com a versão mais recente.');
    }

    const headExtract = await manager.downloadExtract(listing.head_id);
    let baseExtract = null;
    try {
      const remoteFiles = await this._validateExtraction(headExtract);
      const state = readBackupState(this.securityManager);
      const local = this._localDatabases();
      const baseId = state?.object_id && state.object_id !== listing.head_id
        && listing.backups.some(x=>x.id===state.object_id && ['previous','current'].includes(x.role))
        ? state.object_id : null;

      if (baseId) {
        baseExtract = await manager.downloadExtract(baseId);
        await this._validateExtraction(baseExtract);
      }

      const baseFiles = this._fileMap(baseExtract);
      const reports = {};
      const conflicts = [];
      for (const moduleName of ['followup','compras']) {
        const remote = remoteFiles[moduleName];
        const localDb = local[moduleName];
        if (!remote) {
          reports[moduleName] = {
            module:moduleName,remote_exists:false,local_exists:localDb.exists,
            additions:0,updates:0,preserved_local:localDb.exists?1:0,equal:0,history_added:0,
            conflict_count:0,conflicts:[],warnings:[]
          };
          continue;
        }
        if (!localDb.exists) {
          reports[moduleName] = {
            module:moduleName,remote_exists:true,local_exists:false,
            additions:1,updates:0,preserved_local:0,equal:0,history_added:0,
            conflict_count:0,conflicts:[],warnings:[]
          };
          continue;
        }
        const args=['analyze','--module',moduleName,'--local',localDb.path,'--remote',remote.path];
        if (baseFiles[moduleName]) args.push('--base',baseFiles[moduleName].path);
        const report = await this.runSyncTool(moduleName,args);
        report.local_exists=true;report.remote_exists=true;
        reports[moduleName]=report;
        for (const conflict of report.conflicts || []) conflicts.push({...conflict,module:moduleName});
      }

      const id=safePlanId();
      const plan={
        id,
        createdAt:Date.now(),
        headId:listing.head_id,
        baseId:baseExtract?.id || null,
        candidateId:state?.candidate_id || null,
        headExtract,
        baseExtract,
        remoteFiles,
        baseFiles,
        local,
        reports
      };
      this.plans.set(id,plan);
      // Keep at most one active plan; downloaded decrypted DB copies are sensitive.
      for (const [otherId,other] of [...this.plans.entries()]) {
        if (otherId===id) continue;
        this.plans.delete(otherId);
        await this._cleanupPlan(other).catch(()=>{});
      }
      const summary=syncSummary(reports);
      this._event('plan-ready',{headId:plan.headId,baseId:plan.baseId,conflicts:summary.conflict_count,localHasData:Object.values(local).some(x=>x.exists)});
      return {
        available:true,
        has_remote:true,
        plan_id:id,
        head_id:plan.headId,
        base_id:plan.baseId,
        created_ms:listing.backups.find(x=>x.id===plan.headId)?.created_ms || null,
        local_has_data:Object.values(local).some(x=>x.exists),
        reports,
        conflicts,
        summary
      };
    } catch (error) {
      await manager.cleanupExtracted(headExtract.dir).catch(()=>{});
      if (baseExtract) await manager.cleanupExtracted(baseExtract.dir).catch(()=>{});
      await this.startServices().catch(()=>{});
      throw error;
    }
  }

  async _snapshotBeforeMerge(moduleName,target,planId) {
    const dir=path.join(this.securityManager.workspaceRoot(),'backups','pre-sync');
    fs.mkdirSync(dir,{recursive:true});
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const output=path.join(dir,`${moduleName}-pre-sync-${stamp}-${planId.slice(0,8)}.db`);
    const result=await this.runSyncTool(moduleName,['snapshot','--source',target,'--output',output]);
    await this.securityManager.validateBackupDatabase(moduleName,output);
    return result.path || output;
  }

  _syncFile(source,target) {
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(source,target);
    try { fs.chmodSync(target,0o600); } catch (_) {}
    // Windows requires a writable file handle for FlushFileBuffers/fsync.
    // Keep the durability barrier instead of silently skipping it.
    const fd=fs.openSync(target,'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  async _atomicInstall(candidates,planId) {
    const installed=[];
    try {
      for (const [moduleName,candidate] of Object.entries(candidates)) {
        const target=this.securityManager.moduleDb(moduleName);
        fs.mkdirSync(path.dirname(target),{recursive:true});
        const next=`${target}.restore-${planId}.new`;
        fs.rmSync(next,{force:true});
        this._syncFile(candidate,next);
        await this.securityManager.validateBackupDatabase(moduleName,next);

        const oldBase=`${target}.restore-${planId}.old`;
        const moved=[];
        for (const suffix of ['', '-wal', '-shm']) {
          const source=target+suffix;
          const old=oldBase+(suffix||'.db');
          if (fs.existsSync(source)) {
            fs.rmSync(old,{force:true});
            fs.renameSync(source,old);
            moved.push({source,old});
          }
        }
        try {
          fs.renameSync(next,target);
          await this.securityManager.validateBackupDatabase(moduleName,target);
          installed.push({moduleName,target,moved});
        } catch (error) {
          fs.rmSync(target,{force:true});
          for (const item of [...moved].reverse()) if (fs.existsSync(item.old)) fs.renameSync(item.old,item.source);
          throw error;
        }
      }
      return installed;
    } catch (error) {
      for (const entry of [...installed].reverse()) {
        fs.rmSync(entry.target,{force:true});
        fs.rmSync(entry.target+'-wal',{force:true});
        fs.rmSync(entry.target+'-shm',{force:true});
        for (const item of [...entry.moved].reverse()) if (fs.existsSync(item.old)) fs.renameSync(item.old,item.source);
      }
      throw error;
    }
  }

  _rollbackInstalled(installed) {
    for (const entry of [...(installed || [])].reverse()) {
      try { fs.rmSync(entry.target,{force:true}); } catch (_) {}
      try { fs.rmSync(entry.target+'-wal',{force:true}); } catch (_) {}
      try { fs.rmSync(entry.target+'-shm',{force:true}); } catch (_) {}
      for (const item of [...(entry.moved || [])].reverse()) {
        try {
          if (fs.existsSync(item.old)) fs.renameSync(item.old,item.source);
        } catch (_) {}
      }
    }
  }

  _cleanupOldRaw(installed) {
    for (const entry of installed || []) {
      for (const item of entry.moved || []) {
        try { fs.rmSync(item.old,{force:true}); } catch (_) {}
      }
    }
  }

  async apply(planId,resolutions={}) {
    const id=String(planId||'');
    const plan=this.plans.get(id);
    if (!plan) throw new Error('O plano de restauração expirou. Compare os backups novamente.');
    if (Date.now()-plan.createdAt > 30*60*1000) {
      this.plans.delete(id);await this._cleanupPlan(plan);
      throw new Error('O plano de restauração expirou por segurança. Compare novamente.');
    }

    const cleanResolutions={};
    const expectedConflicts=Object.values(plan.reports).flatMap(r=>r.conflicts||[]);
    const expectedIds=new Set(expectedConflicts.map(c=>String(c.id||'')));
    for (const [key,value] of Object.entries(resolutions||{})) {
      if (!expectedIds.has(String(key))) continue;
      if (!['local','remote','both'].includes(value)) continue;
      cleanResolutions[key]=value;
    }
    const unresolved=expectedConflicts.filter(c=>!cleanResolutions[c.id]);
    if (unresolved.length) throw new Error(`Existem ${unresolved.length} conflitos que ainda precisam de uma escolha.`);

    await this.stopServices();
    const manager=this.getRemoteManager();
    const latest=await manager.list();
    if (latest.head_id!==plan.headId) {
      throw new Error('Outro computador publicou um backup mais novo enquanto você revisava os conflitos. Nada foi alterado; compare novamente.');
    }

    const stageDir=path.join(this.securityManager.workspaceRoot(),'backups','restore-stage',id);
    fs.rmSync(stageDir,{recursive:true,force:true});
    fs.mkdirSync(stageDir,{recursive:true});
    const candidates={};
    const recoveryPoints={};
    let installed=[];
    let databaseCommitComplete=false;
    try {
      const resolutionPath=path.join(stageDir,'resolutions.json');
      fs.writeFileSync(resolutionPath,JSON.stringify(cleanResolutions,null,2),{encoding:'utf8',mode:0o600});

      for (const moduleName of ['followup','compras']) {
        const remote=plan.remoteFiles[moduleName];
        if (!remote) continue;
        const target=this.securityManager.moduleDb(moduleName);
        const output=path.join(stageDir,moduleFilename(moduleName));
        if (plan.local[moduleName].exists) {
          recoveryPoints[moduleName]=await this._snapshotBeforeMerge(moduleName,target,id);
          const args=['apply','--module',moduleName,'--local',target,'--remote',remote.path,'--output',output,'--resolutions',resolutionPath];
          if (plan.baseFiles[moduleName]) args.push('--base',plan.baseFiles[moduleName].path);
          await this.runSyncTool(moduleName,args);
        } else {
          this._syncFile(remote.path,output);
        }
        await this.securityManager.validateBackupDatabase(moduleName,output);
        candidates[moduleName]=output;
      }

      installed=await this._atomicInstall(candidates,id);
      await this.securityManager.activateRestoredWorkspace({sourceId:plan.headId});
      databaseCommitComplete=true;

      const hadLocal=Object.values(plan.local).some(x=>x.exists);
      let promotion=null;
      if (!hadLocal) {
        writeCurrentBackupState(this.securityManager,{
          objectId:plan.headId,
          reason:'remote-restore',
          sourceFingerprint:this.securityManager.remoteBackupFingerprint(),
          serverHeadId:plan.headId,
          clearCandidate:true
        });
      } else {
        // The local database may contain information not present in HEAD.
        // Mark HEAD only as the merge base and immediately publish a consolidated
        // child. A failed upload never rolls the local merge back.
        markRemoteBase(this.securityManager,{objectId:plan.headId,serverHeadId:plan.headId});
      }

      let servicesStarted=true;
      let serviceWarning=null;
      try {
        await this.startServices();
      } catch (error) {
        servicesStarted=false;
        serviceWarning='Os bancos foram restaurados e validados, mas os serviços do Vyzium não reiniciaram nesta sessão. Feche e abra o aplicativo novamente.';
        this._event('services-restart-deferred',{message:String(error?.message||error).slice(0,300)});
      }

      if (hadLocal) {
        if (servicesStarted) {
          try {
            promotion=await this.promoteMergedBackup({
              parentOverride:plan.headId,
              mergeSourceId:plan.candidateId || null
            });
            if (!promotion?.promoted) {
              promotion={...promotion,pending_retry:true,error:promotion?.reason || 'O servidor preservou a consolidação como divergente porque o HEAD mudou. Os dados locais estão seguros e serão comparados novamente antes de qualquer promoção.'};
            }
          } catch (error) {
            promotion={uploaded:false,pending_retry:true,error:'Os dados foram combinados com segurança neste computador, mas o novo backup consolidado não pôde ser enviado agora. O Vyzium tentará novamente no próximo backup manual ou fechamento normal.'};
            this._event('promotion-deferred',{message:String(error?.message||error).slice(0,300)});
          }
        } else {
          promotion={uploaded:false,pending_retry:true,error:'A consolidação local está segura. O novo backup será enviado depois que os serviços iniciarem normalmente.'};
        }
      }

      this._cleanupOldRaw(installed);
      this.skippedHeadId=null;
      this.plans.delete(id);
      await this._cleanupPlan(plan);
      fs.rmSync(stageDir,{recursive:true,force:true});
      this._event('applied',{headId:plan.headId,hadLocal,promotion:Boolean(promotion?.uploaded),recoveryPoints:Object.keys(recoveryPoints),servicesStarted});
      return {
        restored:true,
        merged:hadLocal,
        head_id:plan.headId,
        recovery_points:recoveryPoints,
        promotion,
        service_warning:serviceWarning
      };
    } catch (error) {
      if (!databaseCommitComplete && installed.length) {
        this._rollbackInstalled(installed);
      }
      // Verified pre-sync snapshots remain on disk even after a successful
      // byte-level rollback, providing an additional operator recovery point.
      await this.startServices().catch(()=>{});
      this._event('apply-failed',{headId:plan.headId,rolledBack:!databaseCommitComplete,message:String(error?.message||error).slice(0,500)});
      throw error;
    }
  }

  async cancel(planId) {
    const plan=this.plans.get(String(planId||''));
    if (!plan) return {cancelled:false};
    this.plans.delete(plan.id);
    await this._cleanupPlan(plan);
    await this.startServices().catch(()=>{});
    return {cancelled:true};
  }

  async _cleanupPlan(plan) {
    if (!plan) return;
    const manager=this.getRemoteManager();
    const dirs=new Set([plan.headExtract?.dir,plan.baseExtract?.dir].filter(Boolean));
    for (const dir of dirs) await manager.cleanupExtracted(dir).catch(()=>{});
  }
}

module.exports={BackupRestoreCoordinator,syncSummary};
