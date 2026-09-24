# Vyzium 3.3.0 — Sentry observacional sobre baseline WhatsApp 3.2.7

## Regra desta build
A máquina de estados do WhatsApp não foi alterada. `electron/whatsapp.js` é byte a byte idêntico ao baseline 3.2.7 usado para esta correção.

O helper `whatsapp-hidden-browser.ps1` mantém a lógica operacional do baseline; a única diferença é a correção da expressão de redação do log diagnóstico (`\\S+` -> `\S+`).

## Sentry
- fail-open e sem dependência npm/runtime;
- não participa de bootstrap, QR, CDP, LocalAuth, watchdog, reconnect ou Storage Recovery;
- aceita eventos de `_audit` tanto com quanto sem o prefixo real `whatsapp.`;
- falhas técnicas como `whatsapp.initialize.attempt-error`, `whatsapp.client.bootstrap-timeout`, `whatsapp.client.initialize-rejected`, `whatsapp.client.auth-failure`, `whatsapp.browser.storage-failure-detected` e `whatsapp.watchdog.startup-fired` são promovidas;
- rejeição esperada de negociação já enviada/incerta não é enviada como Issue;
- erros de rede/Sentry são engolidos e não bloqueiam o Vyzium.

## Diagnóstico
Mantidas as correções de quebras de linha e sanitização do pacote diagnóstico.

## Validação neste ambiente
- Node: 125/125 aprovados + sort checks do script.
- Python: 151 iniciados; 7 erros por dependências `xlrd/xlwt` ausentes e 6 skips de SQLCipher. Esses 7 não são contabilizados como aprovados.
- Windows/Chrome/QR não podem ser validados neste ambiente Linux; validar em Windows antes de release.
