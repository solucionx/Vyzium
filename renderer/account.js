'use strict';

(async () => {
  const button = document.getElementById('logout-account');
  if (!button || !window.followup?.auth) return;
  try {
    const state = await window.followup.auth.state();
    if (state?.email) button.title = `Conta: ${state.email}`;
  } catch (_) {}
  button.addEventListener('click', async () => {
    if (!window.confirm('Sair da conta Vyzium neste computador?')) return;
    // Logging out also navigates the window back to auth.html. Screens with
    // unsaved work expose vyziumBeforeNavigateAway; skipping it here used to
    // let the main process tear down the workspace while the renderer stayed
    // on a page whose beforeunload handler had blocked the navigation.
    if (typeof window.vyziumBeforeNavigateAway === 'function') {
      try {
        if ((await window.vyziumBeforeNavigateAway({ type: 'logout', target: 'auth' })) === false) return;
      } catch (_) { return; }
    }
    button.disabled = true;
    try { await window.followup.auth.logout(); }
    catch (error) {
      alert(String(error?.message || error));
      if (button.isConnected) button.disabled = false;
    }
  });
})();
