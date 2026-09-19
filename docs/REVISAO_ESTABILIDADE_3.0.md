# Vyzium 3.0 — Revisão de estabilidade

Data da revisão: 18/09/2026

## Objetivo

Revisar a base unificada do Vyzium 3.0 em busca de falhas de integração, erros de importação/dependência, condições de corrida, inconsistências de persistência, regressões de WhatsApp, problemas do fluxo de atualização e pontos de risco no empacotamento, mantendo a arquitetura e as regras de negócio atuais.

Esta revisão não reescreve os módulos nem muda o funcionamento de Acompanhamento ou Cotação & Mapas. As correções aplicadas são defensivas e pontuais.

## Resultado

O projeto está estruturalmente coerente para continuar a fase de estabilização. A revisão encontrou alguns riscos reais de integração que valia corrigir antes de ampliar funcionalidades. Os principais estavam no ciclo de vida dos motores Python, concorrência durante troca de módulo/atualização, consistência da fila persistente do WhatsApp, dependências de XLS no ambiente de desenvolvimento e compatibilidade de identidade da instalação existente.

Não é tecnicamente possível afirmar que qualquer aplicativo possui 100% de ausência de bugs. Após as correções e os testes abaixo, a confiança na base aumentou de forma relevante, sem alteração do modelo funcional existente.

## Correções aplicadas

1. **Compatibilidade da instalação e dos dados do Vyzium 2.1.** O identificador interno do pacote voltou a ser `vyzium-gestao-operacional`, mantendo `appId=com.vyzium.gestaooperacional` e `productName=Vyzium`. Isso reduz o risco de a unificação criar uma identidade diferente para a área de dados do Electron. A base de Compras continua no caminho histórico `%APPDATA%\\Vyzium-Compras`.

2. **Corrida no início dos motores Python.** Um motor que ultrapassasse o timeout podia permanecer vivo e emitir `ready` atrasado enquanto uma nova tentativa já começava. O processo expirado agora é encerrado, respostas tardias são ignoradas e um processo antigo não consegue limpar o estado de um processo novo.

3. **Timeout das chamadas aos motores.** As requisições Electron → Python agora possuem limites de tempo adequados por operação. Importações e exportações recebem janelas maiores; chamadas comuns não podem ficar penduradas indefinidamente e bloquear troca de módulo ou atualização.

4. **Troca de módulo serializada.** Cliques rápidos em Acompanhamento/Cotação & Mapas/Visão geral não iniciam mais múltiplos `loadFile()` concorrentes. Há proteção no processo principal e na interface.

5. **Atualizador protegido contra operações concorrentes.** Instalação de atualização não pode começar enquanto há uma operação ativa ou troca de tela em andamento. Seleção de planilha e exportação também ficam protegidas durante a instalação.

6. **Exportação contabilizada como operação ativa.** A exportação do mapa de compra passa a participar da mesma trava de operações usadas pelo restante do aplicativo, evitando encerramento do motor durante a gravação.

7. **Dependências Python de desenvolvimento reconciliadas.** `start-dev.ps1` instala/reconcilia o `backend/requirements.txt` mesmo quando a `.venv` já existe. Isso evita uma venv antiga sem `xlrd`/`xlwt` após a união dos módulos.

8. **Asset do instalador preservado no Git.** `build/installer-sidebar.bmp`, referenciado pelo electron-builder, deixou de poder ser excluído acidentalmente pelo `.gitignore`.

9. **Fila persistente do Follow-up endurecida.** Se ocorrer uma falha interna inesperada depois de uma mensagem ser marcada como `sending`, o item passa para `uncertain` antes de qualquer nova tentativa. O Vyzium não reenvia automaticamente algo cuja entrega já não pode ser provada.

10. **Falhas de transporte do WhatsApp em Compras normalizadas.** Erros HTTP, timeout, conexão e resposta inválida da ponte local passam a gerar erros controlados e compreensíveis, preservando a distinção entre falha antes do envio e estado incerto depois da submissão.

11. **Testes de compatibilidade do projeto.** Foram adicionadas verificações automáticas para impedir alteração acidental do `appId`, nome interno, `productName`, assets do instalador e dependências necessárias para XLS/XLSX.

12. **Documentação interna higienizada.** Foram removidos nomes/dados específicos de uma base real e referências antigas ao mecanismo de WhatsApp que já não corresponde ao código atual.

## Validações executadas

- Sintaxe dos arquivos JavaScript do Electron, renderer e testes: **aprovada**.
- Compilação estática dos módulos Python: **aprovada**.
- Importação em runtime de `engine`, `compras_engine`, `workbook_formats` e `excel_export`: **aprovada**.
- Referências de scripts, CSS e imagens dos três HTMLs: **sem arquivos ausentes**.
- IDs HTML duplicados: **nenhum encontrado**.
- Dependências declaradas no `package.json` e pacote raiz do `package-lock.json`: **coerentes**.
- Manifesto do workflow de release, nomes dos dois motores e assets do NSIS: **coerentes**.
- Busca por bancos/planilhas/dados operacionais versionados no pacote: **nenhum arquivo encontrado**.
- Busca por referências pessoais antigas e à biblioteca de automação descontinuada: **nenhuma ocorrência encontrada**.
- Smoke test autenticado do motor de Acompanhamento: `/health` e `/overview` **HTTP 200**.
- Smoke test autenticado do motor de Compras: `/health` e `/overview` **HTTP 200**.
- Testes Node/WhatsApp/Updater/Compras/configuração: **33/33 aprovados**.
- Verificações de ordenação: **6/6 aprovadas**.
- Testes Python descobertos: **73 no total; 68 aprovados neste ambiente**.

### Limitação do ambiente desta revisão

Cinco testes Python específicos de XLS binário não puderam ser executados aqui porque este ambiente não possui `xlrd` e `xlwt` instalados e não tem acesso externo para baixá-los. Eles falharam por `ModuleNotFoundError`, não por falha de asserção do código.

O projeto declara corretamente `xlrd==2.0.2` e `xlwt==1.3.0` em `backend/requirements.txt`, e o workflow do GitHub instala esse arquivo **antes** de executar `npm test`. Portanto, o GitHub Actions no Windows deve ser usado como gate final para confirmar esses cinco testes e a geração do instalador.

Também não foi possível, neste ambiente, validar uma sessão real conectada ao WhatsApp Web nem executar o instalador NSIS final em Windows. Os testes automatizados da ponte, reconexão, fila e updater foram executados e aprovados, mas uma validação real do executável instalado continua sendo necessária antes de considerar uma release de produção estabilizada.

## Pontos que permanecem como risco controlado

### 1. Concorrência entre envio automático do Follow-up e envio de Cotação

O Electron consulta o lote do Follow-up antes de autorizar uma cotação e a própria ponte WhatsApp rejeita envios simultâneos. Existe, porém, uma janela pequena em que o agendador do Follow-up pode iniciar entre essa consulta e o envio da Cotação. O resultado esperado é uma falha segura que pede nova tentativa, e não envio paralelo. Eliminar completamente essa janela exige transformar a ponte em uma fila/arbitrador compartilhado, o que seria uma mudança arquitetural e foi deliberadamente deixado fora desta revisão.

### 2. Migrações de banco ainda são ad hoc

Acompanhamento possui compatibilidade incremental de colunas, mas ainda não existe um framework formal de `schema_version` + migrações numeradas + backup pré-migração. Para a base atual isso não apresentou erro nos testes; para muitas versões futuras, esse deve ser o próximo trabalho de robustez.

### 3. Corrupção manual/de disco de JSON/configurações

Alguns registros persistidos ainda pressupõem JSON e configurações válidos. Corrupção física/manual do banco pode gerar erro ao carregar um módulo. O próximo nível de endurecimento deve adicionar diagnóstico de integridade e tratamento de configuração corrompida sem apagar dados operacionais.

### 4. Visão geral pode precisar de otimização com bases muito grandes

Os endpoints `/overview` estão corretos, mas ainda reutilizam parte do processamento dos dashboards/catálogos. Não foi feita otimização prematura. Recomenda-se medir o tempo de abertura com bancos reais grandes antes de alterar consultas ou caches.

### 5. Fórmulas em planilhas

O importador de Compras abre XLSX com `data_only=True`, apropriado ao relatório validado. O Follow-up preserva o comportamento existente da sua base. Mudanças de política de fórmulas devem ser feitas somente com fixtures reais de cada exportação para evitar regressão silenciosa.

## Pontos fortes confirmados na base

- Electron com `contextIsolation: true`, `nodeIntegration: false` e `sandbox: true`.
- Navegação externa e abertura de janelas bloqueadas.
- API local Python vinculada a `127.0.0.1` e protegida por token aleatório.
- Ponte WhatsApp local também protegida por token.
- Allowlist explícita de rotas por módulo no processo principal.
- Uma única sessão de WhatsApp para os dois módulos.
- Follow-up com SQLite WAL, `foreign_keys`, `busy_timeout`, índices e substituição transacional do snapshot.
- Importação de Follow-up preserva o snapshot anterior em arquivo inválido/sem dados e possui proteção contra redução suspeita de base.
- Fila persistente do Follow-up trata mensagens em voo como `uncertain` após interrupção, evitando replay automático.
- Compras possui revisão de estado incerto, fingerprint/revision contra prévia obsoleta, proteção contra perda de atualização, importação transacional e proteção contra fórmula maliciosa em CSV.
- Dependências principais estão fixadas por versão.
- Workflow de release confere tag/versão, instala dependências, executa testes, compila os dois motores e só então gera/publica os artefatos de atualização.

## Gate recomendado antes de publicar uma release estável

1. Fazer push desta revisão para uma branch de estabilização.
2. Executar o workflow Windows com todas as dependências disponíveis e exigir `npm test` 100% verde, incluindo os cinco testes XLS.
3. Instalar o `Vyzium-Setup.exe` sobre uma cópia de teste de uma instalação 2.1 existente e confirmar preservação de `followup.db`, filtros, configurações e sessão do WhatsApp.
4. Confirmar que a base histórica `%APPDATA%\\Vyzium-Compras\\compras.sqlite3` reaparece no módulo Cotação & Mapas.
5. Fazer uma importação real em cada módulo, alternar repetidamente entre os módulos, fechar/reabrir o aplicativo e verificar persistência.
6. Enviar uma mensagem real controlada pelo Acompanhamento e uma por Cotação & Mapas, confirmando histórico e prevenção de duplicidade.
7. Testar atualização automática de uma versão de homologação para outra e confirmar que nenhum banco em `userData`/`Vyzium-Compras` é apagado.

## Arquivos modificados nesta revisão

- `.gitignore`
- `backend/compras_engine.py`
- `backend/engine.py`
- `backend/test_whatsapp.py`
- `docs/ANALISE_DOS_ARQUIVOS.md`
- `electron/main.js`
- `package.json`
- `package-lock.json`
- `renderer/module-switch.js`
- `scripts/start-dev.ps1`
- `tests/project-config.cjs` (novo)

Nenhuma tela de negócio, regra de classificação, cálculo de cotação, estrutura visual, fluxo de filtros ou modelo de dados foi reescrito nesta revisão.
