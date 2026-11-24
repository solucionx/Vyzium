'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {PNG} = require('pngjs');
const decode = require('jsqr');
const {WhatsAppSession} = require('../electron/whatsapp');

async function check() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-live-qr-'));
  const session = new WhatsAppSession(dir, {
    profileDataDir:path.join(dir, 'profile'),
    compatibilityMode:'legacy-2.1',
    browserMode:'headless'
  });
  try {
    session.connect();
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const status = session.status();
      if (status.status === 'error') throw new Error('WhatsApp startup failed before a readable QR.');
      if (status.qr?.startsWith('data:image/png;base64,')) {
        const png = PNG.sync.read(Buffer.from(status.qr.split(',')[1], 'base64'));
        const qr = decode(new Uint8ClampedArray(png.data), png.width, png.height);
        if (qr?.data) {
          console.log('Decoded the live login QR from the session on a clean profile.');
          return;
        }
      }
      await delay(500);
    }
    throw new Error('The live endpoint did not provide a readable login QR within two minutes.');
  } finally {
    await session.shutdown();
    fs.rmSync(dir, {recursive:true, force:true, maxRetries:6, retryDelay:500});
  }
}

check().catch(error => {console.error(error.message); process.exitCode = 1;});
