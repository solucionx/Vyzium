# Vyzium 3.1.1 — correções sobre a 3.1.0 (WhatsApp-StartupWatchdogFix)

Base: `Vyzium-v3.1.0-WhatsApp-StartupWatchdogFix`. Nenhuma regra de negócio foi
alterada. Todo o restante do código permanece idêntico; abaixo está o registro
do que mudou e por quê.

---

## Falhas de lógica

### 1. Revisão de envios sem confirmação estava inacessível

**Arquivos:** `renderer/app.js`, `renderer/styles.css`

`renderHistory()` registrava um listener em `.review-followup`, mas
`historyRows()` nunca gerava esse botão. Como `groups()` bloqueia
indefinidamente qualquer item cujo último follow-up esteja em `uncertain`
(`blocked_reason = "Aguardando intervalo anti-spam"`, sem limite de tempo), o
fornecedor ficava travado para sempre e não havia caminho na interface para
liberar. Pior: o histórico rotulava `uncertain` como "Enviado" e escondia o
campo `error`, então nem dava para identificar os casos.

Agora:

- `uncertain` aparece como **"Conferir no WhatsApp"** e `reviewed` como
  **"Liberado após conferência"** (antes ambos diziam "Enviado");
- o motivo real (`row.error`) é exibido;
- a linha ganha destaque visual (`.history-needs-review`);
- o botão **"Conferi: liberar novo envio"** é renderizado e chama
  `POST /followup-reviewed`, que já existia no motor e no `ROUTES` do
  `main.js` — só não tinha quem o acionasse;
- o texto de confirmação explica que o fornecedor segue bloqueado enquanto o
  envio não for conferido.

### 2. `_wait_for_connection()` era um laço infinito

**Arquivo:** `backend/engine.py`

O método tentava `/wait` para sempre, engolindo o `RuntimeError` e dormindo 3 s.
Com a ponte derrubada, o worker girava eternamente: o lote ficava `active`
indefinidamente, `start_send` passava a recusar qualquer lote novo
("Já existe um lote em execução") e `prepare-update` bloqueava as atualizações
até reiniciar o aplicativo.

Agora o laço distingue dois casos:

- **pausa explícita do usuário** — a fila continua esperando pelo tempo que for
  necessário (comportamento intencional) e **não consome o limite**;
- **qualquer outra indisponibilidade** (ponte fechada, processo do WhatsApp
  morto, QR nunca escaneado) — limitada a 30 minutos, após os quais é lançada
  a nova exceção `WhatsAppUnavailable`.

O worker trata `WhatsAppUnavailable` como **final**: em vez de gastar as 5
tentativas com backoff (o que levaria a até ~2,5 h de espera), ele coloca o
item em quarentena e encerra o lote com erro. Durante a espera, o estado do job
passa a `phase="waiting"`.

**Testes:** `backend/test_whatsapp.py::WhatsAppWaitBoundTests`.

### 3. `beforeunload` cancelava navegação silenciosamente

**Arquivos:** `renderer/compras-app.js`, `renderer/account.js`

O Electron cancela `window.loadFile()` do main process quando um handler de
`beforeunload` chama `preventDefault()` — e não exibe diálogo nenhum. A troca de
módulo já passava por `vyziumBeforeNavigateAway`, mas **o logout não**:
`auth-logout` → `returnToAuth()` → `loadFile()`. Com um mapa não salvo aberto, a
tela não trocava, enquanto o main já havia derrubado os serviços e marcado
`activeModule='auth'` — estado dessincronizado.

Agora existe a flag `navigationConfirmed`, ligada por
`vyziumBeforeNavigateAway` sempre que a saída é autorizada, e o logout consulta
esse mesmo hook antes de chamar `auth.logout()`. A proteção contra fechar a
janela com trabalho não salvo continua valendo.

### 4. Rotas de WhatsApp desreferenciando `null`

**Arquivo:** `electron/main.js`

`apiRequest` tratava `/whatsapp/*` antes de qualquer guarda. Durante o logout ou
o `security-setup`, `stopWorkspaceServices()` zera `whatsapp` enquanto o painel
aberto ainda faz polling a cada 1,5 s → `TypeError` no processo principal.
Agora há uma guarda explícita com mensagem clara, e rotas desconhecidas sob
`/whatsapp/` são recusadas.

### 5. QR Code expirado sem renovação

**Arquivo:** `electron/whatsapp.js`

Com `qrMaxRetries: 10`, esgotadas as tentativas o estado permanecia `'qr'`;
`_scheduleReconnect` ignora esse estado de propósito e o watchdog de startup já
havia sido limpo no primeiro evento `qr`. A tela ficava exibindo um QR morto
com a legenda "Ele será renovado automaticamente".

Foi acrescentado o **watchdog de QR** (`_armQrWatchdog` / `_clearQrWatchdog`):
o WhatsApp Web rotaciona o código a cada ~20 s, então se não chegar um novo
evento `qr` nem autenticação em 75 s, a sessão é renovada via
`restartConnection()` — mesmo perfil `LocalAuth`, portanto **não é logout**. O
watchdog é limpo em `authenticated`, `ready`, `auth_failure`, `disconnected`,
`pause`, `newQr`, `restartConnection` e `shutdown`.

---

## Código morto e inconsistências

### 6. Maquinaria de ACK removida

**Arquivo:** `electron/whatsapp.js`

`waitForServerAck`, `_pollMessageAck`, `_waitForAckWithoutStableId`,
`ackWaiters`, `ackCache`, `_clearAckWaiters` e `ackTimeoutMs` — cerca de 180
linhas — nunca eram chamados: `send()` retorna `status:'sent'` logo após
`sendMessage()`, como o próprio comentário do código admitia. Tudo isso saiu.
Ficou apenas `_rememberAck`, reduzido a atualizar `lastAckAt`, que continua
sendo um indicador barato de vitalidade exposto em `status()`.

> Observação de comportamento: um envio é considerado bem-sucedido quando a
> chamada `sendMessage()` termina, sem aguardar confirmação do servidor. Foi
> uma decisão deliberada da 3.1.0 (evitava o travamento em "2/N") e continua
> valendo; o campo `ack` gravado em `finish_queue_item` segue sempre `NULL`.

### 7. Painel do WhatsApp duplicado

**Arquivos:** `renderer/whatsapp.js`, `renderer/compras.html`;
removido `renderer/compras-whatsapp.js`

Os dois arquivos eram byte a byte idênticos (52 linhas), obrigando a corrigir
tudo duas vezes. Ficou um só, carregado pelas duas páginas. O painel passou a
ser autossuficiente: o helper `whatsappApi` usa o `api` da página quando ele
existe (mantendo os toasts) e cai direto na ponte caso contrário, eliminando a
dependência implícita de ordem de carregamento dos scripts.

### 8. Patch do `whatsapp-web.js` falhava em silêncio

**Arquivos:** `scripts/verify-whatsapp-patch.js` (novo), `package.json`,
`.github/workflows/windows-release.yml`, `tests/whatsapp-patch.cjs`

`patch-whatsapp-web.js` captura qualquer erro, emite um aviso e força
`exitCode = 0`; e o teste existente validava `patchClientSource` contra um
*fixture*, não contra o `node_modules` real. Um instalador podia ser publicado
sem o patch — reintroduzindo exatamente a classe de falha que ele corrige.

O `postinstall` continua tolerante (uma máquina de desenvolvimento segue
utilizável), mas agora existe `npm run verify:whatsapp-patch`, que inspeciona o
`Client.js` instalado, confere o `PATCH_MARKER`, rejeita um patch pela metade e
**falha com código 1**. O workflow roda essa verificação logo após o `npm ci`,
antes de compilar qualquer coisa.

### 9. Chave do banco na variável de ambiente

**Arquivo:** `backend/secure_sqlite.py`

A chave por módulo é entregue ao processo filho via `VYZIUM_DB_KEY_HEX`. No
Windows, outro processo do mesmo usuário consegue ler o bloco de ambiente de um
processo vivo. `key_from_env()` agora **consome** a variável: lê e remove
imediatamente de `os.environ`, reduzindo a janela de exposição aos primeiros
instantes do startup. A troca para um canal dedicado (stdin) continua sendo a
solução definitiva e não foi feita aqui por ser invasiva nos quatro
subcomandos e no empacotamento PyInstaller.

### 10. Paridade de robustez entre os dois motores

**Arquivos:** `backend/engine.py`, `backend/compras_engine.py`

- comparação do token passou a usar `hmac.compare_digest` (o `compras_engine`
  já fazia isso; o `engine` usava `==`);
- `_body()` passou a respeitar o mesmo teto de 5 MB do `compras_engine`, em vez
  de ler o `Content-Length` sem limite;
- `POST /settings` do Compras rejeita corpo que não seja objeto, em vez de
  persistir qualquer JSON.

---

## Otimização

### 11. Fim das cópias integrais do dataset a cada leitura

**Arquivo:** `backend/engine.py`

`orders()` devolvia `[dict(row) for row in cached]` — cópia rasa de **todas** as
linhas a cada chamada. `dashboard()` chamava `orders()` *e* `order_summaries()`
(que chamava `orders()` de novo); `filters()` copiava a base inteira só para
montar dois `set`.

Foi introduzido `_orders_view()`, uma visão **somente leitura** do snapshot em
cache. `filters()`, `order_summaries()` e `dashboard()` passaram a usá-la.
`groups()` (que grava `_blocked_reason`) e `order_detail()` (que anexa
`receipts`) continuam usando `orders()` com cópia — o contrato está
documentado na própria docstring.

### 12. `order_detail()` deixou de recalcular a base inteira

**Arquivo:** `backend/engine.py`

Ele chamava `order_summaries(search=str(oc))`, que reprocessava toda a base e
ainda gravava no `summary_cache` (limitado a 32 entradas e limpo por inteiro ao
encher) — em uma tabela de pedidos, cada expansão de linha disparava isso e
despejava o cache.

A construção da linha foi extraída para `_summary_row(...)`, agora usada tanto
por `order_summaries()` quanto por `order_detail()`, que monta apenas a sua
própria linha a partir dos itens que já tem em mãos. O `haystack` de busca é
calculado uma vez dentro do builder e descartado antes de sair.

### 13. Heartbeat duplicado eliminado

**Arquivo:** `backend/engine.py`

`WhatsAppSupervisor` batia em `/health` a cada 20 s enquanto o `monitorTimer` do
Electron já rodava a cada 15 s — ambos terminando em `client.getState()` sobre o
mesmo Puppeteer. A classe foi removida; a saúde da sessão é responsabilidade
exclusiva do gerenciador de conexão no Electron.

### 14. Validação de integridade deixou de repetir a cada login

**Arquivo:** `electron/security-manager.js`

`startWorkspaceServices()` executava `validateProtectedDatabases()` para os dois
módulos a cada abertura, cada um gerando um processo do motor com timeout de até
2 minutos — mesmo quando nada havia mudado.

Agora um cache por workspace (`security/validation.json`) guarda a impressão
digital de cada banco validado (tamanho + `mtime` + versão do app). Um módulo
cujo arquivo seja idêntico ao já validado é pulado; qualquer escrita do motor
muda o `mtime` e invalida a entrada. A validação final que antecede a ativação
em `finalize()` usa `{ force: true }` e **nunca** confia no cache.

### 15. Importação em massa mais rápida sem perder durabilidade

**Arquivo:** `backend/engine.py`

`replace_snapshot()` roda com `PRAGMA synchronous=FULL`, pagando um `fsync` por
frame do WAL durante a reescrita completa da base. Como um backup verificado
acabou de ser feito e toda a operação está em uma única transação com rollback,
o modo passa a `NORMAL` durante a importação e volta a `FULL` no `finally`
(inclusive em caso de erro), seguido de `wal_checkpoint(FULL)`.

---

## Testes

`npm run test:node` — 78 testes, todos passando. Novos:

- `tests/whatsapp.cjs` — painel único compartilhado pelas duas páginas; botão de
  liberação no histórico; fase `waiting` no progresso do lote;
- `tests/whatsapp-patch.cjs` — o verificador de build detecta um `Client.js` sem
  a correção.

`npm run test:backend` — novos testes em
`backend/test_whatsapp.py::WhatsAppWaitBoundTests` (ponte morta aborta o lote;
pausa do usuário não consome o limite).

> Os 5 erros de `test_compras_v11` por `xlrd`/`xlwt` ausentes são de ambiente,
> não de código: as duas bibliotecas estão em `backend/requirements.txt` e são
> instaladas pelo workflow.
