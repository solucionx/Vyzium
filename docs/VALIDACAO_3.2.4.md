# Vyzium 3.2.4 — otimização conservadora do WhatsApp oculto

Base: **Vyzium 3.2.3 Full Stable – GitHub Ready**. Esta revisão é deliberadamente restrita ao custo do navegador auxiliar do WhatsApp no Windows. Não altera regras de Acompanhamento, Cotação & Mapas, banco de dados, Firebase, autenticação, envio, LocalAuth ou persistência da sessão.

## O que foi otimizado

- O guardião Win32 continua iniciando o Chrome/Edge **headful**, suspenso e invisível antes da primeira janela aparecer.
- Os hooks `EVENT_OBJECT_CREATE` e `EVENT_OBJECT_SHOW` agora ficam restritos ao PID raiz do navegador do Vyzium, em vez de receber eventos de todas as janelas do Windows.
- A varredura de segurança caiu de **200 ms para 1500 ms**. Os hooks continuam sendo a resposta imediata; a varredura serve apenas como fallback para janelas de subprocessos.
- A normalização da janela passou a ser idempotente: se a HWND já está fora da tela e com `WS_EX_TOOLWINDOW`/sem `WS_EX_APPWINDOW`, o helper não repete a sequência hide/move/show. Isso evita composição e chamadas Win32 desnecessárias.
- A checagem de vida do navegador no loop permanente usa apenas o PID raiz e ocorre a cada **1500 ms**, evitando snapshots completos da árvore de processos a cada 500 ms. O snapshot completo continua disponível no encerramento para limpar a árvore do navegador.
- Foram adicionados somente três switches conservadores de navegador: `--disable-extensions`, `--disable-sync` e `--disable-default-apps`. Eles não desativam cookies, IndexedDB, CacheStorage, Service Worker, rede, JavaScript, GPU ou renderização do WhatsApp Web.

## Proteções de estabilidade preservadas

Continuam inalterados o modo `headed`, o perfil Chromium/LocalAuth em diretório dedicado, `browserWSEndpoint`, remoção de `DevToolsActivePort` obsoleto, validação HTTP + WebSocket do CDP, bootstrap estável, ausência de probe ativo de CacheStorage, patch do `whatsapp-web.js`, QR, watchdogs, reconexão, fila/envio e flush gracioso do perfil no encerramento. Os switches `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows` e `--disable-renderer-backgrounding` também foram mantidos para não mudar a política de execução que estabilizou o WhatsApp.

## Validação executada nesta revisão

- `node --check electron/whatsapp.js`: aprovado.
- `node --test tests/whatsapp.cjs`: **49/49 aprovados**, incluindo o novo gate do guardião de baixo consumo.
- O pacote conserva a mesma versão de `whatsapp-web.js` (**1.34.7**) e Electron (**39.0.0**).
- Gate Node completo: **110/110 aprovados**. A revisão de diff foi limitada ao helper/args do WhatsApp, testes, documentação e referências de versão.
- Backend: **151 testes descobertos; 138 aprovados, 6 ignorados e 7 bloqueados pelo ambiente** porque `xlrd`/`xlwt` não estavam instalados. A tentativa de instalar as versões já declaradas em `backend/requirements.txt` não pôde acessar a rede. Nenhum desses 7 erros ocorreu em código alterado nesta revisão.

## Limite da validação

Os testes acima validam regressões de código e contratos da sessão, mas **não medem RAM real do Chrome no Windows**. O ganho de memória/CPU precisa ser confirmado no mesmo computador usado nas capturas, após o aplicativo ficar conectado e ocioso por alguns minutos. A expectativa principal desta revisão é eliminar o trabalho repetitivo do PowerShell/Win32 e o hide/show contínuo que mantinha atividade desnecessária no navegador; não há promessa de reduzir drasticamente a memória intrínseca do próprio WhatsApp Web.
