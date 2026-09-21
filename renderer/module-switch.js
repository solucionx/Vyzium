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
