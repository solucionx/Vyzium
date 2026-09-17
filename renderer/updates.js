'use strict';
const updateButton = document.getElementById('check-updates');
const updateStatus = document.getElementById('update-status');
window.followup.onUpdateStatus(state => { updateStatus.textContent = state.message; });
updateButton.addEventListener('click', async () => {
  updateButton.disabled = true;
  try { await window.followup.checkUpdates(); }
  catch (_) { updateStatus.textContent = 'Não foi possível verificar atualizações. Tente novamente.'; }
  finally { updateButton.disabled = false; }
});
