'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DAY = 86400000;

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Only recognize the exact layout exported by Vyzium. Unknown files and links
// are preserved; never sweep workspace databases or recovery transactions.
async function downloadedCopies(root) {
  const result = [];
  const rootStat = await fs.promises.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return result;
  for (const entry of await fs.promises.readdir(root, {withFileTypes:true})) {
    if (!entry.isDirectory() || !/^backup-\d+-[a-f0-9]{24}$/.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const files = await fs.promises.readdir(dir, {withFileTypes:true});
    if (files.length !== 1 || !files[0].isFile() || !/^[a-f0-9]{64}\.vzb$/.test(files[0].name)) continue;
    const file = path.join(dir, files[0].name);
    const stat = await fs.promises.lstat(file);
    if (stat.size < 32 || stat.size > 128 * 1024 * 1024) continue;
    const id = files[0].name.slice(0,-4);
    if (await hashFile(file) !== id) continue;
    result.push({id, path:file, dir, bytes:stat.size, modified:stat.mtimeMs});
  }
  return result.sort((a,b)=>b.modified-a.modified || a.path.localeCompare(b.path));
}

async function pruneDownloads(root, retainedPath) {
  const copies = await downloadedCopies(root);
  const current = copies.find(x=>x.path === retainedPath);
  if (!current) return; // Never prune without a verified replacement.
  const ids = new Set([current.id]);
  for (const item of copies) {
    if (item.path === retainedPath) continue;
    if (!ids.has(item.id) && ids.size < 3) { ids.add(item.id); continue; }
    // Remove only the recognized file, never recursively delete a directory
    // into which a user might have added data since the scan.
    await fs.promises.unlink(item.path);
    await fs.promises.rmdir(item.dir).catch(()=>{});
  }
}

async function cleanDownloadPartials(root, now = Date.now()) {
  const rootStat = await fs.promises.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
  for (const entry of await fs.promises.readdir(root, {withFileTypes:true})) {
    if (!entry.isDirectory() || !/^\.partial-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const stat = await fs.promises.lstat(dir);
    if (now-stat.mtimeMs < DAY) continue;
    const files = await fs.promises.readdir(dir, {withFileTypes:true});
    const removable = [];
    let safe = true;
    for (const f of files) {
      if (f.isFile() && (/^[a-f0-9]{64}\.vzb$/.test(f.name) || f.name==='workspace.vyb')) removable.push(path.join(dir,f.name));
      else if (f.isDirectory() && f.name==='validation') {
        const nested = await fs.promises.readdir(path.join(dir,f.name),{withFileTypes:true});
        if (nested.some(n=>!n.isFile() || !['followup.db','compras.sqlite3'].includes(n.name))) { safe=false; break; }
        removable.push(...nested.map(n=>path.join(dir,f.name,n.name)));
      } else { safe=false; break; }
    }
    if (!safe) continue;
    for (const file of removable) await fs.promises.unlink(file);
    if (files.some(f=>f.name==='validation')) await fs.promises.rmdir(path.join(dir,'validation'));

    await fs.promises.rmdir(dir).catch(()=>{});
  }
}

function pruneDiagnostics(root, currentDir, now=Date.now()) {
  try {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
    const allowed = /^(timeline\.jsonl(?:\.previous)?|errors\.log(?:\.previous)?|system\.json|processes\.json|RELATORIO\.txt|hidden-browser\.log|whatsapp-debug\.jsonl(?:\.previous)?)$/;
    const entries = fs.readdirSync(root,{withFileTypes:true});
    const runs=entries.filter(e=>e.isDirectory() && /^run-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-z0-9]+-[a-f0-9]{6}$/.test(e.name))
      .map(e=>({dir:path.join(root,e.name),time:fs.lstatSync(path.join(root,e.name)).mtimeMs})).sort((a,b)=>b.time-a.time);
    const keep=new Set([currentDir,...runs.filter(r=>r.dir!==currentDir).slice(0,4).map(r=>r.dir)]);
    for (const r of runs) {
      if(keep.has(r.dir) || now-r.time<DAY) continue;
      const files=fs.readdirSync(r.dir,{withFileTypes:true});
      if(files.some(f=>!f.isFile()||!allowed.test(f.name))) continue;
      for(const f of files) fs.unlinkSync(path.join(r.dir,f.name));
      fs.rmdirSync(r.dir);
    }
    const zips=entries.filter(e=>e.isFile()&&/^Vyzium-Diagnostico-[a-z0-9]+-[a-f0-9]{6}\.zip$/.test(e.name))
      .map(e=>({file:path.join(root,e.name),time:fs.lstatSync(path.join(root,e.name)).mtimeMs})).sort((a,b)=>b.time-a.time);
    for(const z of zips.slice(5)) if(now-z.time>=DAY) fs.unlinkSync(z.file);
  } catch (_) { /* Maintenance must never block application startup. */ }
}
module.exports={downloadedCopies,pruneDownloads,cleanDownloadPartials,pruneDiagnostics};
