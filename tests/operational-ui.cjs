'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('operational UI keeps sidebar collapse in renderer only', () => {
  const sidebar = read('renderer/module-switch.js');
  const styles = read('renderer/styles.css');
  assert.match(sidebar, /initializeOperationalSidebar/);
  assert.match(sidebar, /sidebar-collapsed/);
  assert.match(sidebar, /collapsedByDefault = !document\.body\.classList\.contains\('home-view'\)/);
  assert.match(styles, /body\.sidebar-collapsed main \{ margin-left: 68px/);
  assert.doesNotMatch(sidebar, /localStorage|sessionStorage|ipc|api\(/i);
});

test('compras exposes shared suppliers without creating a second supplier store', () => {
  const html = read('renderer/compras.html');
  const renderer = read('renderer/compras-app.js');
  const main = read('electron/main.js');
  assert.match(html, /data-view="suppliers"/);
  assert.match(html, /data-view="completed"/);
  assert.match(html, />Mapas ativos</);
  assert.match(html, />Concluídos</);
  assert.match(renderer, /renderSuppliers/);
  assert.match(renderer, /POST','\/supplier-contacts'/);
  assert.match(main, /route === '\/supplier-contacts'/);
  assert.match(main, /requestEngine\('followup', 'POST', '\/supplier'/);
  assert.match(main, /requestEngine\('followup', 'GET', '\/suppliers'/);
});

test('map deadline is optional and separate from SCI deadline', () => {
  const backend = read('backend/compras_engine.py');
  const renderer = read('renderer/compras-app.js');
  assert.match(backend, /normalize_map_due_date/);
  assert.match(backend, /'due_date': normalize_map_due_date\(body\.get\('due_date'\)\)/);
  assert.match(backend, /if 'due_date' in body:/);
  assert.match(renderer, /id="map-due-date-create"/);
  assert.match(renderer, /id="map-due-date"/);
  assert.match(renderer, /Mapa vencido/);
  assert.match(renderer, /Vence hoje/);
  assert.match(renderer, /não altera o prazo da SCI/);
  assert.match(backend, /DB_SCHEMA_VERSION = 1/);
});

test('home uses real overview fields and contains no demo activity feed', () => {
  const home = read('renderer/home.js');
  const html = read('renderer/index.html');
  assert.match(home, /followup\.open_orders/);
  assert.match(home, /followup\.ready_messages/);
  assert.match(home, /compras\.total_scis/);
  assert.match(home, /compras\.active_maps/);
  assert.doesNotMatch(html, /Fornecedor Atlântico|HOTEL-023|atividade recente/i);
});
