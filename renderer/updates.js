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

const updateModal = document.getElementById('update-modal');
const updateModalTitle = document.getElementById('update-modal-title');
const updateModalMessage = document.getElementById('update-modal-message');
const updateModalInstall = document.getElementById('update-modal-install');
const updateModalLater = document.getElementById('update-modal-later');
const updateModalClose = document.getElementById('update-modal-close');

function closeUpdateModal(action = 'later') {
  if (!updateModal) return;
  updateModal.classList.add('hidden');
  window.followup.respondUpdatePrompt(action);
}

if (updateModalInstall) updateModalInstall.addEventListener('click', () => closeUpdateModal('install'));
if (updateModalLater) updateModalLater.addEventListener('click', () => closeUpdateModal('later'));
if (updateModalClose) updateModalClose.addEventListener('click', () => closeUpdateModal('later'));
window.followup.onUpdatePrompt(payload => {
  updateModalTitle.textContent = payload.title || 'Atualização pronta';
  updateModalMessage.textContent = payload.message || 'Reiniciar o Vyzium para instalar?';
  updateModalInstall.textContent = payload.confirmLabel || 'Reiniciar e instalar';
  updateModalLater.textContent = payload.cancelLabel || 'Mais tarde';
  updateModal.classList.remove('hidden');
});
