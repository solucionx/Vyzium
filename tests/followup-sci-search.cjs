const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
const operational = fs.readFileSync(path.join(root, 'renderer/operational.js'), 'utf8');

test('Acompanhamento advertises SCI lookup in both order views', () => {
  assert.match(app, /Buscar OC, SCI, fornecedor ou item/);
  assert.match(operational, /Buscar OC, SCI, fornecedor, hotel ou observação/);
});

test('both order detail renderers show the SCI stored on each item', () => {
  const sciReferences = app.match(/item\.sci/g) || [];
  assert.ok(sciReferences.length >= 2, 'SCI must appear in inline and full order details');
  assert.match(app, /SCI \\?\$\{escapeHtml\(item\.sci \|\| '—'\)\}/);
});
