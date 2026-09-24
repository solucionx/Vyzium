# Vyzium 3.3.1 — restauração conservadora da estabilidade do WhatsApp

## Evidência que motivou a correção
A telemetria da 3.3.0 confirmou `storage_initialization_error` com `Cache.put(): Entry already exists` durante o bootstrap do WhatsApp Web.

## Decisão de correção
O caminho funcional do WhatsApp foi restaurado à implementação comprovadamente estável da 3.2.3. A integração Sentry permanece estritamente observacional.

### Removido da 3.3.0
- recuperação destrutiva automática de Storage em primeira conexão;
- rotação/quarentena automática de perfil disparada pelo erro de Cache em modo headed;
- `--disable-features=StorageBuckets`;
- alterações do helper Win32/PowerShell posteriores à 3.2.3;
- ciclo especial de retries associado a `firstConnectionStorageRecoveryUsed`.

### Mantido
- Chrome headed invisível + CDP da 3.2.3;
- LocalAuth e persistência da 3.2.3;
- watchdog/reconnect da 3.2.3;
- patch estável do whatsapp-web.js;
- Sentry/diagnóstico fail-open;
- detecção observacional de `Cache.put(): Entry already exists` para telemetria, sem alterar o lifecycle.

## Invariante de segurança
Falha, indisponibilidade ou timeout do Sentry não controla nem bloqueia WhatsApp, Electron, backend, banco ou UI.

## Validação neste ambiente
- sintaxe Node/Python: OK;
- suíte Node: 121/121 aprovada;
- helper oculto: restaurado byte a byte da 3.2.3;
- testes backend iniciados: 151 descobertos; 138 passaram, 6 foram ignorados e 7 não puderam executar por ausência de `xlrd`/`xlwt` neste ambiente isolado. Não houve falha funcional nesses 7: foram erros de dependência de teste.
- E2E real Windows/Chrome/QR não pode ser executado neste ambiente Linux e deve ser validado antes do release público.
