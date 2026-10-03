'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {patchMediaSource, verifyMediaPatch, INSERTION, mediaFile} = require('../scripts/patch-whatsapp-media');
const installed = fs.readFileSync(mediaFile(), 'utf8');
const original = installed.replace(INSERTION, '');

// Execute the dependency's actual injected sendMessage implementation. Only the
// remote WhatsApp modules are doubles; no real account or message is used.
function page(source, internalId) {
  const sent = [];
  class MsgKey {
    constructor(data) {Object.assign(this, data);this._serialized='synthetic-key';}
    static async newId() {return 'synthetic-id';}
  }
  const modules = {
    WAWebChatGetters:{getIsNewsletter:()=>false, getIsBroadcast:()=>false},
    WALinkify:{findLink:()=>null},
    WAWebUserPrefsMeUser:{getMaybeMeLidUser:()=>({user:'me-lid'}),getMaybeMePnUser:()=>({user:'me'})},
    WAWebMsgKey:MsgKey,
    WAWebGetEphemeralFieldsMsgActionsUtils:{getEphemeralFields:()=>({})},
    WAWebSendMsgChatAction:{addAndSendMsgToChat(_chat, message) {
      // Current MediaData has an enumerable private id. The Msg constructor
      // prefers that private field, even when undefined, over the valid MsgKey.
      const id = Object.hasOwn(message,'__x_id') ? message.__x_id : message.id;
      if (!(id instanceof MsgKey)) throw Error("Data passed to getter must include an id property (it's how we memoize) but got undefined");
      sent.push(message);return [Promise.resolve(),Promise.resolve()];
    }},
    WAWebCollections:{Msg:{get:()=>sent.at(-1)}}
  };
  const window = {require:name=>modules[name]};
  const context = vm.createContext({exports:{},window,console});
  vm.runInContext(source,context);
  context.exports.LoadUtils();
  window.WWebJS.processMediaData = async()=>({
    __x_id:internalId, preview:'preview', clientUrl:'upload-url', uploadhash:'upload-hash',
    toJSON:()=>({type:'image',mimetype:'image/jpeg',filehash:'file-hash'})
  });
  return {sent, send:options=>window.WWebJS.sendMessage({id:{isLid:()=>false}},'text',options)};
}

test('unpatched 1.34.7 reproduces the exact reported getter error for images, while text succeeds', async()=>{
  const p=page(original,undefined);
  await p.send({waitUntilMsgSent:true});
  await assert.rejects(p.send({media:{},caption:'Reference',waitUntilMsgSent:true}),/Data passed to getter must include an id property/);
  assert.equal(p.sent.length,1);
});

test('patched real media path preserves message identity, caption and upload fields', async()=>{
  for (const internalId of [undefined,null,'private-media-id']) {
    const p=page(patchMediaSource(original).source,internalId);
    const message=await p.send({media:{},caption:'1. Item — Hotel',waitUntilMsgSent:true});
    assert.equal(message.id._serialized,'synthetic-key');
    assert.equal(Object.hasOwn(message,'__x_id'),false);
    assert.equal(message.caption,'1. Item — Hotel');
    assert.equal(message.type,'image');
    assert.equal(message.clientUrl,'upload-url');
    assert.equal(message.uploadhash,'upload-hash');
    assert.equal(message.filehash,'file-hash');
    assert.equal(p.sent.length,1);
  }
});

test('media fix leaves the actual text send result unchanged', async()=>{
  const before=await page(original).send({waitUntilMsgSent:true});
  const after=await page(patchMediaSource(original).source).send({waitUntilMsgSent:true});
  delete before.t;delete after.t;
  assert.equal(JSON.stringify(before),JSON.stringify(after));
});

test('media patch is idempotent and rejects unrelated dependency changes',()=>{
  const patched=patchMediaSource(original);
  assert.equal(patched.changed,true);
  assert.equal(patchMediaSource(patched.source).changed,false);
  assert.throws(()=>patchMediaSource(original+'\n// unexpected change'),/difere/);
  assert.throws(()=>patchMediaSource(patched.source.replace('delete message.__x_id;', 'delete message.id;')),/difere/);
});

test('installed media dependency contains the verified fix',()=>{
  assert.match(verifyMediaPatch().sha256,/^[a-f0-9]{64}$/);
});
