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
  const functionBody = sidebar.slice(sidebar.indexOf('function initializeOperationalSidebar'), sidebar.indexOf('let moduleNavigationBusy'));
  assert.doesNotMatch(functionBody, /localStorage|sessionStorage|ipc|api\(/i);
});

test('compras exposes active completed maps and shared suppliers', () => {
  const html = read('renderer/compras.html');
  const renderer = read('renderer/compras-app.js');
  const main = read('electron/main.js');
  assert.match(html, /data-view="maps"/);
  assert.match(html, /data-view="completed"/);
  assert.match(html, /data-view="suppliers"/);
  assert.match(html, />Mapas ativos</);
  assert.match(html, />Concluídos</);
  assert.match(renderer, /renderSuppliers/);
  assert.match(renderer, /POST','\/supplier-contacts'/);
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
  assert.doesNotMatch(html, /Transforme planilhas|Escolha para onde ir|Fornecedor Atlântico|atividade recente/i);
});

test('3.4 backup restore stack remains packaged and referenced', () => {
  const pkg = JSON.parse(read('package.json'));
  const main = read('electron/main.js');
  assert.match(JSON.stringify(pkg.build?.extraResources || []), /backup-sync-engine\.exe/);
  assert.equal(fs.existsSync(path.join(root, 'backend', 'backup_sync.py')), true);
  assert.equal(fs.existsSync(path.join(root, 'electron', 'backup-restore.js')), true);
  assert.match(main, /BackupRestoreCoordinator/);
  assert.match(main, /backup-sync-engine\.exe/);
});


test('approved desktop visual language is applied to followup and compras without replacing their logic', () => {
  const visual = read('renderer/operational-ui.css');
  const followup = read('renderer/acompanhamento.html');
  const compras = read('renderer/compras.html');
  assert.match(followup, /class="module-followup"/);
  assert.match(compras, /class="module-compras"/);
  assert.match(followup, /href="operational-ui\.css"/);
  assert.match(compras, /href="operational-ui\.css"/);
  assert.match(visual, /operational-workspace/);
  assert.match(visual, /operational-full/);
  assert.match(visual, /cards\.operational-cards/);
  assert.match(visual, /items-catalog-panel/);
  assert.match(visual, /map-library-toolbar/);
  assert.match(visual, /map-workspace/);
  assert.match(visual, /supplier-directory/);
  assert.match(visual, /settings-stack/);
  assert.doesNotMatch(visual, /url\(https?:/i);
});

test('3.4.2 visual layer does not introduce WhatsApp code paths', () => {
  const visual = read('renderer/operational-ui.css');
  const followup = read('renderer/app.js');
  const compras = read('renderer/compras-app.js');
  assert.doesNotMatch(visual, /session-vyzium|LocalAuth|browserWSEndpoint|whatsapp-web\.js/i);
  assert.match(followup, /whatsappPanel\(\)/);
  assert.match(compras, /whatsappPanel\(\)/);
});


test('map completion uses Vyzium modal instead of native Windows confirm', () => {
  const renderer = read('renderer/compras-app.js');
  const visual = read('renderer/operational-ui.css');
  assert.match(renderer, /function completeMapDialog\(map\)/);
  assert.match(renderer, /FINALIZAR COTAÇÃO/);
  assert.match(renderer, /Mapa preservado/);
  assert.match(renderer, /Itens liberados/);
  assert.match(renderer, /await completeMapDialog\(m\)/);
  assert.doesNotMatch(renderer, /confirm\('Concluir este mapa de compra\?/);
  assert.match(visual, /complete-map-card/);
  assert.match(visual, /complete-map-effects/);
  assert.match(visual, /complete-map-actions/);
});
