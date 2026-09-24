# Vyzium 3.2.8 — Auditoria da integração Sentry

## Objetivo
Adicionar telemetria remota de erros sem tornar o Sentry uma dependência operacional do Vyzium e sem alterar o fluxo estabilizado do WhatsApp/Chrome/LocalAuth.

## Decisão de arquitetura
A versão 3.2.8 usa um transporte Sentry mínimo, isolado e sem dependência npm adicional. Isso é deliberado: se DNS, TLS, Sentry, rede ou o próprio transporte falharem, o Vyzium continua normalmente. Não existe await do Sentry no bootstrap e o monitoramento não participa de decisões de reconexão, QR, watchdog, banco, Firebase ou atualização.

## Proteções implementadas
- Fail-open em inicialização, captura e envio.
- HTTPS com timeout de 3 segundos e erros de rede absorvidos.
- Sem usuário, e-mail, telefone, hostname, cookies, sessão, QR ou tokens deliberadamente enviados.
- Sanitização local de campos sensíveis, JWT/hex longos, e-mail, telefone, query secrets e caminhos de usuário Windows/Linux.
- Deduplicação local: mesmo fingerprint não é reenviado por 5 minutos.
- Limite local: no máximo 20 eventos a cada 10 minutos por processo, além do rate limit configurado no Sentry.
- Metadados permitidos: versão do Vyzium, ambiente, componente técnico, plataforma/arquitetura, Node/Electron e versão do SO.
- Erros do renderer já capturados pelo IPC existente passam também pelo transporte remoto sanitizado.
- Falhas técnicas críticas do WhatsApp são promovidas remotamente apenas por allowlist; eventos normais continuam somente no diagnóstico local.
- Diagnóstico local continua sendo a fonte detalhada e permanece independente do Sentry.

## Escopo intencionalmente não alterado
- whatsapp-web.js 1.34.7 e patch existente.
- Chrome/Edge invisível e CDP.
- LocalAuth/perfis e recuperação de Storage.
- Watchdog e política de reconexão.
- Engines Python, bancos SQLCipher e regras de negócio.
- Firebase, updater, preload e segurança da BrowserWindow.
- Interface e filtros, exceto atualização do número de versão.

## Validação executada neste ambiente
- `node --check` em `electron/main.js`, `electron/diagnostics.js` e `electron/sentry-client.js`: aprovado.
- `node --test tests/sentry.cjs`: 5/5 aprovado.
- `npm run test:node`: 119/119 aprovado + 6 verificações de ordenação.
- `tests/project-config.cjs`: 24/24 aprovado.
- `tests/security.cjs`: 4/4 aprovado.
- Suite Python: 151 testes iniciados; 138 aprovações, 6 skips e 7 erros exclusivamente por dependências de teste `xlrd`/`xlwt` ausentes no ambiente Linux. A tentativa de instalar essas dependências falhou por indisponibilidade de rede/DNS do sandbox. Não houve falha de asserção atribuída à integração Sentry.

## Limitações de validação
Este ambiente não é Windows e não possui conectividade externa funcional para o endpoint do Sentry. Portanto não foi alegado teste E2E de entrega ao painel Sentry, QR real, Chrome invisível, instalador NSIS ou executáveis PyInstaller. Esses pontos devem ser validados no Windows antes de promover a release para Latest.

## Critério de produção
A integração é estruturalmente fail-open e não adiciona dependência npm. Ainda assim, antes de publicar como Latest, instalar a build em Windows e confirmar: abertura normal offline, login, bancos, QR/conexão existente do WhatsApp, envio, fechamento sem processos órfãos e aparecimento de um erro controlado no Sentry.
