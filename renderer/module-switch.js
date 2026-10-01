'use strict';

function moduleSwitchError(message) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.add('show', 'visible', 'error');
    setTimeout(() => toast.classList.remove('show', 'visible', 'error'), 4500);
  } else {
    console.error(message);
  }
}

function initializeOperationalSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const navigation = document.getElementById('navigation');
  if (!sidebar || !navigation || sidebar.querySelector('.sidebar-toggle')) return;

  const collapsedByDefault = !document.body.classList.contains('home-view');
  document.body.classList.toggle('sidebar-collapsed', collapsedByDefault);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sidebar-toggle';
  toggle.setAttribute('aria-expanded', String(!collapsedByDefault));
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/><path d="M20 4v16"/></svg><span>Recolher menu</span>';
  navigation.before(toggle);

  const sync = () => {
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Expandir menu' : 'Recolher menu';
    const label = toggle.querySelector('span');
    if (label) label.textContent = collapsed ? 'Expandir menu' : 'Recolher menu';
  };

  for (const button of sidebar.querySelectorAll('.nav-item, #logout-account, #check-updates')) {
    const label = button.querySelector('span')?.textContent?.trim();
    if (label) button.title = label;
  }

  toggle.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    sync();
  });
  sync();
}

initializeOperationalSidebar();

let moduleNavigationBusy = false;

function setModuleNavigationDisabled(disabled) {
  document.querySelectorAll('[data-switch-module], [data-go-home]').forEach(button => {
    button.disabled = disabled;
  });
}

async function canLeaveCurrentScreen(context) {
  if (typeof window.vyziumBeforeNavigateAway !== 'function') return true;
  return (await window.vyziumBeforeNavigateAway(context)) !== false;
}

for (const button of document.querySelectorAll('[data-switch-module]')) {
  button.addEventListener('click', async () => {
    if (moduleNavigationBusy) return;
    moduleNavigationBusy = true;
    const target = button.dataset.switchModule;
    const original = button.innerHTML;
    try {
      const allowed = await canLeaveCurrentScreen({ type: 'module', target });
      if (!allowed) {
        moduleNavigationBusy = false;
        return;
      }
      setModuleNavigationDisabled(true);
      button.classList.add('switching');
      button.textContent = 'Abrindo…';
      await window.followup.switchModule(target);
    } catch (error) {
      button.classList.remove('switching');
      button.innerHTML = original;
      moduleSwitchError(String(error.message || error).replace(/^Error:\s*/i, ''));
      moduleNavigationBusy = false;
      setModuleNavigationDisabled(false);
    }
  });
}

for (const button of document.querySelectorAll('[data-go-home]')) {
  button.addEventListener('click', async () => {
    if (moduleNavigationBusy) return;
    moduleNavigationBusy = true;
    try {
      const allowed = await canLeaveCurrentScreen({ type: 'home', target: 'home' });
      if (!allowed) {
        moduleNavigationBusy = false;
        return;
      }
      setModuleNavigationDisabled(true);
      await window.followup.goHome();
    } catch (error) {
      moduleNavigationBusy = false;
      setModuleNavigationDisabled(false);
      moduleSwitchError(String(error.message || error).replace(/^Error:\s*/i, ''));
    }
  });
}
