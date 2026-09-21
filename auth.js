'use strict';

const $ = id => document.getElementById(id);
const views = ['loginView','registerView','verifyView','securityView','recoveryView','recoveryCodeView','readyView','resetView'];

function show(view) {
  for (const id of views) $(id).hidden = id !== view;
  clearMessage();
}
function busy(value) { $('busy').hidden = !value; if (!value && $('busyText')) $('busyText').textContent = 'Processando com segurança…'; }
function message(text, type = '') {
  $('message').textContent = text;
  $('message').className = `message ${type}`.trim();
  $('message').hidden = false;
}
function clearMessage() { $('message').hidden = true; $('message').textContent = ''; }
function errorText(error) { return String(error?.message || error || 'Ocorreu um erro.').replace(/^Error:\s*/, ''); }


if (window.followup?.security?.onProgress) {
  window.followup.security.onProgress(payload => {
    if (!$('busy') || $('busy').hidden) return;
    const moduleLabel = payload?.module === 'followup' ? 'Acompanhamento' : payload?.module === 'compras' ? 'Cotação & Mapas' : '';
    const prefix = moduleLabel ? `${moduleLabel}: ` : '';
    $('busyText').textContent = prefix + (payload?.message || 'Processando com segurança…');
  });
}

function passwordChecks(value) {
  return {
    minLength: value.length >= 12,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    number: /\d/.test(value),
    special: /[^A-Za-z0-9]/.test(value)
  };
}

async function refreshFlow() {
  busy(true);
  try {
    const auth = await window.followup.auth.state();
    if (!auth.authenticated) return show('loginView');
    if (!auth.emailVerified) {
      $('verifyEmail').textContent = auth.email || '';
      return show('verifyView');
    }
    const security = await window.followup.security.status();
    if (security.ready) return show('readyView');
    if (security.recoveryRequired || ((security.secure?.followup || security.secure?.compras) && !security.vaultUsable)) {
      return show('recoveryView');
    }
    $('legacyFollowup').textContent = security.legacy?.followup ? 'Encontrado — será migrado' : 'Novo banco protegido';
    $('legacyCompras').textContent = security.legacy?.compras ? 'Encontrado — será migrado' : 'Novo banco protegido';
    show('securityView');
  } catch (error) {
    show('loginView');
    message(errorText(error), 'error');
  } finally { busy(false); }
}

$('showRegister').onclick = () => show('registerView');
$('showLogin').onclick = () => show('loginView');
$('forgotBtn').onclick = () => { $('resetEmail').value = $('loginEmail').value; show('resetView'); };
$('resetBack').onclick = () => show('loginView');

$('registerPassword').addEventListener('input', event => {
  const checks = passwordChecks(event.target.value);
  document.querySelectorAll('#passwordRules [data-rule]').forEach(el => el.classList.toggle('ok', checks[el.dataset.rule]));
});

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault(); busy(true);
  try {
    const auth = await window.followup.auth.login({ email: $('loginEmail').value, password: $('loginPassword').value });
    if (!auth.emailVerified) {
      $('verifyEmail').textContent = auth.email || $('loginEmail').value;
      show('verifyView');
      message('Sua conta existe, mas o e-mail ainda precisa ser confirmado.');
    } else await refreshFlow();
  } catch (error) { message(errorText(error), 'error'); }
  finally { busy(false); }
});

$('registerForm').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('registerPassword').value !== $('registerPassword2').value) return message('As senhas não são iguais.', 'error');
  const checks = passwordChecks($('registerPassword').value);
  if (!Object.values(checks).every(Boolean)) return message('A senha ainda não atende a todos os requisitos.', 'error');
  busy(true);
  try {
    const auth = await window.followup.auth.register({
      displayName: $('registerName').value,
      email: $('registerEmail').value,
      password: $('registerPassword').value
    });
    $('verifyEmail').textContent = auth.email || $('registerEmail').value;
    show('verifyView');
    message('Conta criada. Verifique sua caixa de entrada.', 'success');
  } catch (error) { message(errorText(error), 'error'); }
  finally { busy(false); }
});

$('resendBtn').onclick = async () => {
  busy(true); try { await window.followup.auth.resendVerification(); message('E-mail de verificação reenviado.', 'success'); }
  catch (error) { message(errorText(error), 'error'); } finally { busy(false); }
};
$('verifiedBtn').onclick = async () => {
  busy(true);
  try {
    const auth = await window.followup.auth.refreshVerification();
    if (!auth.emailVerified) return message('O Firebase ainda não confirmou o e-mail. Abra o link recebido e tente novamente.');
    await refreshFlow();
  } catch (error) { message(errorText(error), 'error'); }
  finally { busy(false); }
};

$('resetForm').addEventListener('submit', async event => {
  event.preventDefault(); busy(true);
  try {
    await window.followup.auth.resetPassword($('resetEmail').value);
    message('Se houver uma conta compatível, as instruções foram enviadas para o e-mail informado.', 'success');
  } catch (error) { message(errorText(error), 'error'); }
  finally { busy(false); }
});

$('protectBtn').onclick = async () => {
  busy(true);
  try {
    const result = await window.followup.security.setup();
    if (result.recoveryCode) {
      $('recoveryCode').textContent = result.recoveryCode;
      $('recoverySaved').checked = false;
      $('finishSecurityBtn').disabled = true;
      show('recoveryCodeView');
    } else {
      await window.followup.security.finalize();
      show('readyView');
      message('A proteção dos dados foi validada.', 'success');
    }
  } catch (error) { message(errorText(error), 'error'); }
  finally { busy(false); }
};

$('recoverySaved').onchange = event => { $('finishSecurityBtn').disabled = !event.target.checked; };
$('copyRecoveryBtn').onclick = async () => {
  try { await window.followup.copyText($('recoveryCode').textContent); message('Código copiado.', 'success'); }
  catch (_) { message('Selecione e copie o código manualmente.', 'error'); }
};
$('finishSecurityBtn').onclick = async () => {
  busy(true);
  try {
    await window.followup.security.finalize();
    await window.followup.security.enterApp();
  } catch (error) { message(errorText(error), 'error'); busy(false); }
};
$('enterBtn').onclick = async () => {
  busy(true); try { await window.followup.security.enterApp(); } catch (error) { message(errorText(error), 'error'); busy(false); }
};

$('recoverBtn').onclick = async () => {
  busy(true);
  try {
    await window.followup.security.recover($('recoveryInput').value);
    const security = await window.followup.security.status();
    if (security.ready) show('readyView'); else show('securityView');
    message('Chave recuperada e protegida novamente neste Windows.', 'success');
  } catch (error) { message(errorText(error), 'error'); }
  finally { busy(false); }
};

async function logout() {
  busy(true); try { await window.followup.auth.logout(); show('loginView'); } catch (error) { message(errorText(error), 'error'); } finally { busy(false); }
}
for (const id of ['verifyLogoutBtn','securityLogoutBtn','recoveryLogoutBtn','readyLogoutBtn']) $(id).onclick = logout;

refreshFlow();
