const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('purchase history routing happens once at the IPC boundary', () => {
  assert.match(main, /if \(activeModule === 'compras' && routePath === '\/purchase-history'\) \{\s*return requestEngine\('followup', method, route, body\);\s*\}/);
  assert.doesNotMatch(main, /async function requestEngine[\s\S]*?if \(routePath === '\/purchase-history'\)[\s\S]*?return requestEngine\('followup'/);
});

test('follow-up engine itself owns the purchase-history GET route', () => {
  assert.match(main, /followup:\s*\{\s*GET: new Set\(\[[^\]]*'\/purchase-history'/s);
});
