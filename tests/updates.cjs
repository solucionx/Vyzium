const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createUpdater} = require('../electron/updates');
function fixture({packaged=true, available=true, response=0, blocked=false}={}) {
  const events=[], updater=new EventEmitter(); let downloads=0, installs=0, prepared=0;
  updater.setFeedURL = feed => assert.deepEqual(feed, {provider:'github',owner:'solucionx',repo:'Vyzium'});
  updater.checkForUpdates = async () => {events.push('check'); if(available) updater.emit('update-available',{version:'2.1.0'});};
  updater.downloadUpdate = async () => {downloads++; events.push('download');};
  updater.quitAndInstall = (silent,reopen) => {assert.equal(reopen,true); installs++; events.push('install');};
  const options={app:{isPackaged:packaged,getVersion:()=> '2.1.0'},platform:'win32',autoUpdater:updater,
    getWindow:()=>({isDestroyed:()=>false,webContents:{send:(_channel,s)=>events.push(s.message)}}),
    dialog:{showMessageBox:async()=>({response})},
    promptInstall:async()=>response===0,
    prepareInstall:async()=>{prepared++; if(blocked) throw Error('Envio em andamento');events.push('prepare');}};
  return {client:createUpdater(options),updater,events,counts:()=>({downloads,installs,prepared})};
}
test('development does not query or install',async()=>{
  const f=fixture({packaged:false});await f.client.check();assert.equal(f.events.includes('check'),false);
});
test('current version does not download',async()=>{
  const f=fixture({available:false});await f.client.check();assert.equal(f.counts().downloads,0);
});
test('download completes and services stop before installer runs',async()=>{
  const f=fixture();await f.client.check();assert.deepEqual(f.counts(),{downloads:1,installs:1,prepared:1});
  assert.ok(f.events.indexOf('download')<f.events.indexOf('prepare'));
  assert.ok(f.events.indexOf('prepare')<f.events.indexOf('install'));
  assert.equal(f.updater.allowDowngrade,false);assert.equal(f.updater.autoInstallOnAppQuit,false);
});
test('later preserves download and next click does not redownload',async()=>{
  const f=fixture({response:1});await f.client.check();await f.client.check();assert.deepEqual(f.counts(),{downloads:1,installs:0,prepared:0});
});
test('active operation blocks installation',async()=>{
  const f=fixture({blocked:true});await f.client.check();assert.equal(f.counts().installs,0);assert.ok(f.events.includes('Envio em andamento'));
});
test('network error allows retry and concurrent clicks are ignored',async()=>{
  const f=fixture();f.updater.checkForUpdates=async()=>{throw Error('offline');};await f.client.check();
  let finish;f.updater.checkForUpdates=()=>new Promise(resolve=>{finish=resolve;});
  const first=f.client.check();await f.client.check();finish();await first;
  assert.equal(f.counts().installs,0);
});
