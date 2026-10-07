const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const apiBody = main.slice(
  main.indexOf('async function apiRequest('),
  main.indexOf('\nasync function comprasOverview', main.indexOf('async function apiRequest('))
);
const engineBody = main.slice(
  main.indexOf('async function requestEngine('),
  main.indexOf('\nfunction pathInside', main.indexOf('async function requestEngine('))
);

test('purchase history redirects exactly once at the API boundary', () => {
  assert.match(apiBody, /activeModule === 'compras' && routePath === '\/purchase-history'/);
  assert.match(apiBody, /return requestEngine\('followup', 'GET', route\)/);
});

test('requestEngine contains no purchase-history forwarding or self-call', () => {
  assert.doesNotMatch(engineBody, /purchase-history/);
  assert.equal((engineBody.match(/requestEngine\(/g) || []).length, 1, 'Only the function declaration may mention requestEngine(');
  assert.doesNotMatch(engineBody, /return\s+requestEngine\(/);
});

test('purchase history is read-only and owned by followup allowlist only', () => {
  assert.match(apiBody, /Últimas compras é uma consulta somente leitura/);
  assert.match(main, /followup:\s*\{\s*GET: new Set\(\[[^\]]*'\/purchase-history'/s);
  assert.doesNotMatch(main, /compras:\s*\{\s*GET: new Set\(\[[^\]]*'\/purchase-history'/s);
});
