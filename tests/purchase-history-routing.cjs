const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const requestEngineBody = main.slice(
  main.indexOf('async function requestEngine('),
  main.indexOf('\nfunction pathInside', main.indexOf('async function requestEngine('))
);

test('purchase history redirects only when the requested engine is compras', () => {
  assert.match(requestEngineBody, /if \(moduleName === 'compras' && routePath === '\/purchase-history'\)/);
  assert.doesNotMatch(requestEngineBody, /activeModule === 'compras'/);
});

test('redirecting compras history to followup cannot redirect a second time', () => {
  const guard = /if \(moduleName === 'compras' && routePath === '\/purchase-history'\) \{\s*return requestEngine\('followup', method, route, body\);\s*\}/;
  assert.match(requestEngineBody, guard);
  assert.equal((requestEngineBody.match(/return requestEngine\('followup', method, route, body\);/g) || []).length, 1);
});

test('follow-up engine itself owns the purchase-history GET route', () => {
  assert.match(main, /followup:\s*\{\s*GET: new Set\(\[[^\]]*'\/purchase-history'/s);
});
