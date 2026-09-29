'use strict';

const $ = id => document.getElementById(id);
const views = ['loginView','registerView','verifyView','securityView','recoveryView','recoveryCodeView','backupView','readyView','resetView'];
let backupPreflight = null;
let backupPlan = null;
let conflictChoices = {};

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

async function showBackupPreflight(preflight, security) {
  backupPreflight = preflight;
  backupPlan = null;
  conflictChoices = {};
  $('backupSummary').hidden = true;
  $('backupConflicts').hidden = true;
  $('backupApplyBtn').hidden = true;
  $('backupCancelBtn').hidden = true;
  $('backupPrepareBtn').hidden = false;
  $('backupRetryBtn').hidden = true;
  $('backupSkipBtn').hidden = !(preflight.local_has_data && security.ready);
  $('backupNotice').hidden = true;

  if (!preflight.available) {
    $('backupTitle').textContent = 'Vyzium Server indisponível';
    $('backupLead').textContent = preflight.error || 'Não foi possível consultar os backups agora.';
    $('backupPrepareBtn').hidden = true;
    $('backupRetryBtn').hidden = false;
    $('backupSkipBtn').hidden = !security.ready;
    $('backupMeta').innerHTML = '';
    show('backupView');
    return;
  }
  if (!preflight.authorized) {
    $('backupTitle').textContent = 'Aguardando autorização do servidor';
    $('backupLead').textContent = 'Este usuário precisa estar autorizado no aplicativo Vyzium Server do celular antes de restaurar backups.';
    $('backupPrepareBtn').hidden = true;
    $('backupRetryBtn').hidden = false;
    $('backupSkipBtn').hidden = !security.ready;
    $('backupMeta').innerHTML = '';
    show('backupView');
    return;
  }

  const head = preflight.head || {};
  const when = head.created_ms ? new Date(head.created_ms).toLocaleString('pt-BR') : 'data não informada';
  $('backupTitle').textContent = preflight.local_has_data ? 'Há dados para combinar' : 'Backup da sua conta encontrado';
  $('backupLead').textContent = preflight.local_has_data
    ? 'O Vyzium não sobrescreverá este computador. Primeiro ele compara os dois lados e preserva alterações locais.'
    : 'Este computador ainda não possui sua base local. Confirme para baixar, validar e restaurar o backup da sua conta.';
  $('backupMeta').innerHTML = '';
  for (const [label,value] of [
    ['Backup principal', when],
    ['Tamanho', head.bytes ? (head.bytes/1024/1024).toFixed(1)+' MB' : '—'],
    ['Neste computador', preflight.local_has_data ? 'Dados locais encontrados' : 'Sem base local'],
    ['Histórico no celular', preflight.retention ? 'Até '+preflight.retention+' versões válidas' : 'Disponível']
  ]) {
    const row=document.createElement('div'),a=document.createElement('span'),b=document.createElement('strong');
    a.textContent=label;b.textContent=value;row.append(a,b);$('backupMeta').append(row);
  }
  show('backupView');
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
    if (security.recoveryRequired || ((security.secure?.followup || security.secure?.compras) && !security.vaultUsable)) {
      return show('recoveryView');
    }

    if (security.vaultUsable || security.ready) {
      const preflight = await window.followup.backupSync.preflight();
      if (preflight.needs_sync || (!preflight.available && !security.ready) || (!preflight.authorized && !security.ready)) {
        return showBackupPreflight(preflight, security);
      }
      if (security.ready) return show('readyView');
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
    await refreshFlow();
    message('Chave recuperada neste Windows. Agora o Vyzium pode validar o backup desta conta.', 'success');
  } catch (error) { message(errorText(error), 'error'); }
  finally { busy(false); }
};

function printable(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '(vazio)';
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}
function updateApplyAvailability() {
  if (!backupPlan) return;
  const conflicts = backupPlan.conflicts || [];
  $('backupApplyBtn').disabled = conflicts.some(c => !conflictChoices[c.id]);
}
function renderBackupPlan(plan) {
  backupPlan = plan;
  conflictChoices = {};
  $('backupPrepareBtn').hidden = true;
  $('backupRetryBtn').hidden = true;
  $('backupSkipBtn').hidden = true;
  $('backupApplyBtn').hidden = false;
  $('backupCancelBtn').hidden = false;
  const summary = plan.summary || {};
  const box=$('backupSummary');box.innerHTML='';box.hidden=false;
  for(const [label,value] of [
    ['Adicionar do backup',summary.additions||0],
    ['Atualizações combinadas',summary.updates||0],
    ['Dados locais preservados',summary.preserved_local||0],
    ['Histórico acrescentado',summary.history_added||0],
    ['Iguais',summary.equal||0],
    ['Conflitos para revisar',summary.conflict_count||0]
  ]) {
    const cell=document.createElement('div'),span=document.createElement('span'),strong=document.createElement('strong');
    span.textContent=label;strong.textContent=String(value);cell.append(span,strong);box.append(cell);
  }
  const list=$('backupConflicts');list.innerHTML='';list.hidden=!(plan.conflicts||[]).length;
  for(const conflict of plan.conflicts||[]) {
    const card=document.createElement('div');card.className='conflict-card';
    const title=document.createElement('h4');
    title.textContent=(conflict.module==='compras'?'Cotação & Mapas':'Acompanhamento')+' — '+String(conflict.field||conflict.kind||'Conflito');
    card.append(title);
    const desc=document.createElement('p');
    if(conflict.kind==='potential_duplicate') desc.textContent='Possível registro duplicado: existe um mapa local com o mesmo nome.';
    else if(conflict.kind==='possible_deletion') desc.textContent='Um lado não possui mais este registro. O Vyzium não presume exclusão; você decide.';
    else desc.textContent='Os dois lados possuem valores diferentes para o mesmo campo.';
    card.append(desc);
    const local=document.createElement('p');local.textContent='Neste computador: '+printable(conflict.local);card.append(local);
    const remote=document.createElement('p');remote.textContent='No backup: '+printable(conflict.remote);card.append(remote);
    const options=document.createElement('div');options.className='conflict-options';
    const addChoice=(label,value)=>{
      const btn=document.createElement('button');btn.type='button';btn.textContent=label;
      btn.onclick=()=>{
        conflictChoices[conflict.id]=value;
        for(const sibling of options.querySelectorAll('button')) sibling.classList.remove('selected');
        btn.classList.add('selected');updateApplyAvailability();
      };
      options.append(btn);
    };
    addChoice('Manter deste computador','local');
    addChoice(conflict.kind==='potential_duplicate'?'Manter os dois':'Usar o backup',conflict.kind==='potential_duplicate'?'both':'remote');
    card.append(options);list.append(card);
  }
  $('backupNotice').hidden=false;
  $('backupNotice').textContent=(plan.conflicts||[]).length
    ? 'Nada será aplicado até todos os conflitos serem escolhidos. Antes da troca, o Vyzium cria um ponto de recuperação local e valida o banco mesclado.'
    : 'Nenhum conflito manual foi encontrado. O Vyzium ainda criará um ponto de recuperação e validará os bancos antes da troca.';
  updateApplyAvailability();
}

$('backupPrepareBtn').onclick=async()=>{
  busy(true);
  try { renderBackupPlan(await window.followup.backupSync.prepare()); }
  catch(error){ message(errorText(error),'error'); }
  finally{busy(false);}
};
$('backupApplyBtn').onclick=async()=>{
  if(!backupPlan)return;
  busy(true);
  try{
    const result=await window.followup.backupSync.apply(backupPlan.plan_id,conflictChoices);
    backupPlan=null;
    message(result?.promotion?.pending_retry
      ? 'Dados combinados e preservados neste computador. O envio consolidado ficou pendente e será tentado no próximo backup.'
      : 'Backup restaurado e dados combinados com segurança.','success');
    await window.followup.security.enterApp();
  }catch(error){message(errorText(error),'error');}
  finally{busy(false);}
};
$('backupCancelBtn').onclick=async()=>{
  busy(true);
  try{if(backupPlan)await window.followup.backupSync.cancel(backupPlan.plan_id);backupPlan=null;await refreshFlow();}
  catch(error){message(errorText(error),'error');}
  finally{busy(false);}
};
$('backupRetryBtn').onclick=()=>refreshFlow();
$('backupSkipBtn').onclick=async()=>{
  if(!backupPreflight?.head_id)return;
  busy(true);
  try{
    if(backupPlan)await window.followup.backupSync.cancel(backupPlan.plan_id);
    await window.followup.backupSync.skip(backupPreflight.head_id);
    await window.followup.security.enterApp();
  }catch(error){message(errorText(error),'error');busy(false);}
};

async function logout() {
  busy(true); try { await window.followup.auth.logout(); show('loginView'); } catch (error) { message(errorText(error), 'error'); } finally { busy(false); }
}
for (const id of ['verifyLogoutBtn','securityLogoutBtn','recoveryLogoutBtn','backupLogoutBtn','readyLogoutBtn']) $(id).onclick = logout;

refreshFlow();
