'use strict';

const views = {
  overview: { title: 'Operação', breadcrumb: 'VISÃO GERAL' },
  followup: { title: 'Acompanhamento', breadcrumb: 'ACOMPANHAMENTO' },
  quotes: { title: 'Cotação & Mapas', breadcrumb: 'COTAÇÃO & MAPAS' },
  settings: { title: 'Configurações', breadcrumb: 'CONFIGURAÇÕES' }
};

function showView(name) {
  if (!views[name]) return;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  const target = document.getElementById('view-' + name);
  if (target) target.classList.add('active');
  document.getElementById('page-title').textContent = views[name].title;
  document.getElementById('breadcrumb-label').textContent = views[name].breadcrumb;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

document.querySelectorAll('[data-open-view]').forEach(card => {
  card.addEventListener('click', () => showView(card.dataset.openView));
  const button = card.querySelector('button');
  if (button) button.addEventListener('click', event => {
    event.stopPropagation();
    showView(card.dataset.openView);
  });
});

function updateClock() {
  const now = new Date();
  const months = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  document.getElementById('date-label').textContent =
    String(now.getDate()).padStart(2,'0') + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
  document.getElementById('time-label').textContent =
    String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
}
updateClock();
setInterval(updateClock, 30000);

const followupSearch = document.getElementById('followup-search');
const filterButtons = document.querySelectorAll('#view-followup [data-filter]');
let activeFilter = 'all';

function applyFollowupFilter() {
  const query = String(followupSearch?.value || '').trim().toLowerCase();
  document.querySelectorAll('#followup-table tbody tr').forEach(row => {
    const matchesStatus = activeFilter === 'all' || row.dataset.status === activeFilter;
    const matchesText = !query || row.textContent.toLowerCase().includes(query);
    row.hidden = !(matchesStatus && matchesText);
  });
}

if (followupSearch) followupSearch.addEventListener('input', applyFollowupFilter);

filterButtons.forEach(button => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach(item => item.classList.toggle('active', item === button));
    applyFollowupFilter();
  });
});

document.querySelectorAll('.segmented button').forEach(button => {
  button.addEventListener('click', () => {
    const group = button.closest('.segmented');
    group.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
  });
});
