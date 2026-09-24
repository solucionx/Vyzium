# Vyzium 3.2.5 — hotfix de primeira conexão do WhatsApp

Base: **Vyzium 3.2.4 WhatsApp Resource Optimized**. Esta revisão corrige um risco introduzido pela otimização do guardião do Chrome/Edge sem alterar regras de negócio, bancos, Firebase, autenticação Vyzium, envio ou persistência do WhatsApp.

## Falha encontrada na auditoria

Na 3.2.4, a checagem de vida do helper foi reduzida para observar apenas o PID raiz criado por `CreateProcessW`. Isso diminuiu snapshots de processos, porém tornou o bootstrap sensível a uma transição em que Chrome/Edge encerra o PID inicial e mantém o navegador em um processo descendente. Nessa condição o helper podia concluir prematuramente que o navegador morreu, encerrar a árvore e impedir o evento `qr` — um risco especialmente relevante em primeira execução/PC limpo.

## Correção

- `HasLiveBrowserProcess()` usa o PID raiz como caminho rápido e barato.
- Somente quando o PID raiz não está mais vivo, o helper atualiza a árvore e verifica descendentes ainda ativos.
- A varredura Win32 fica em 150 ms apenas durante o bootstrap para proteger contra flash/taskbar de processos descendentes e é reduzida para 1500 ms assim que o endpoint CDP foi validado.
- O comportamento idempotente de janela da 3.2.4 permanece, evitando `hide → mover → show` repetitivo quando a HWND já está normalizada.
- Foram removidos `--disable-extensions`, `--disable-sync` e `--disable-default-apps`. Esses switches não eram necessários para a principal economia de CPU e mudavam desnecessariamente o ambiente do navegador na primeira execução.

## Estabilidade preservada

Permanecem intactos: `headless:false`, criação suspensa, guardião Win32 pre-show, `--window-position=-30000,-30000`, LocalAuth, perfil em `%LOCALAPPDATA%`, `browserWSEndpoint`, limpeza de `DevToolsActivePort`, validação HTTP/WebSocket do CDP, ausência de probe ativo de CacheStorage/IndexedDB, patch V6 do `whatsapp-web.js`, QR, `authenticated`, `ready`, watchdogs, reconexão, rotação transacional de perfil e flush gracioso no encerramento.

## Testes de regressão

- `node --check electron/whatsapp.js`: aprovado.
- `node --test tests/whatsapp.cjs`: **50/50 aprovados**.
- Novo caso: diretórios de metadata/runtime vazios, `firstConnectionPending=true`, `autoStart()`, launcher oculto e geração de QR.
- Novo gate estático: não aceitar novamente `HasLiveRootProcess()` como única prova de vida e não reintroduzir os três switches experimentais.
- O gate Node completo deve ser executado antes de publicação.

## Limite

O ambiente de CI/Linux não reproduz `CreateProcessW`, hooks Win32 ou o ciclo real do Edge/Chrome no Windows. Portanto, a confirmação definitiva continua sendo o smoke test em uma máquina Windows limpa. O pacote foi estruturado para manter diagnóstico em `whatsapp-debug.jsonl` caso a primeira conexão ainda falhe.
