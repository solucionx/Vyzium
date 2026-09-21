# Auditoria crítica — Vyzium 3.0.2 Data Safety

Data da revisão: 2026-09-19

## Objetivo

Revisar de forma conservadora a proteção dos bancos SQLite já em uso, evitando perda, corrupção, downgrade destrutivo ou confiança indevida em backups antigos.

## Pontos encontrados e corrigidos nesta revisão

### 1. Backup de recuperação podia entrar na retenção automática
Os snapshots `pre-upgrade-*` e `pre-update-*` eram classificados como automáticos e podiam ser removidos depois de várias importações.

**Correção:** snapshots de pré-upgrade e pré-update agora são marcados como protegidos e não entram na poda automática.

### 2. Um manifesto antigo podia fazer o Vyzium confiar em backup já corrompido
O sistema verificava o backup quando ele era criado, mas ao decidir se já existia um snapshot de versão aceitava o manifesto anterior sem revalidar o arquivo.

**Correção:** antes de reutilizar um snapshot de versão, o Vyzium confere novamente:
- existência e tamanho;
- SHA-256;
- `PRAGMA integrity_check`.

Se qualquer verificação falhar, um novo snapshot é criado e o antigo não é confiado.

### 3. Proteção contra downgrade
Uma versão antiga do aplicativo não deve escrever em um banco criado por uma versão futura com schema maior.

**Correção:** `schema_migrations` é lido em modo somente leitura antes da abertura para escrita. Se a versão do schema for maior que a suportada, o motor bloqueia a abertura sem alterar o banco.

### 4. Diagnóstico do backup mais recente
O painel de Segurança dos dados agora recebe o resultado da revalidação atual do último backup e mostra aviso caso esse arquivo deixe de ser confiável.

## Testes executados

### Data Safety
- snapshot SQLite consistente;
- banco corrompido bloqueado sem alteração;
- conteúdo confirmado em WAL incluído no snapshot;
- backup de versão criado uma única vez quando válido;
- backups manuais preservados;
- pre-upgrade protegido contra poda;
- pre-update protegido contra poda;
- backup de versão corrompido não reutilizado;
- manifesto com SHA-256 adulterado não reutilizado;
- status revalida o backup mais recente;
- compatibilidade com `followup.db` existente;
- compatibilidade com `compras.sqlite3` e mapa existente;
- rollback forçado em importação do Acompanhamento;
- rollback forçado em importação de Compras;
- downgrade de schema bloqueado nos dois módulos.

Resultado: **16/16 testes Data Safety aprovados**.

### Backend completo
Foram encontrados **90 testes Python**.

- **85 executaram e passaram** neste ambiente;
- **5 não puderam executar** exclusivamente porque `xlrd` e `xlwt` não estão instalados neste runtime e o ambiente não possui acesso externo para instalá-los.

Esses cinco são testes de `.xls`. `backend/requirements.txt` mantém `xlrd==2.0.2` e `xlwt==1.3.0`, e o workflow do GitHub instala as dependências antes de `npm test`.

### Node / Electron / WhatsApp / Updater
**36/36 aprovados**.

### Ordenação
**6/6 verificações aprovadas**.

### Sintaxe
- todos os arquivos JS de Electron, renderer e testes: aprovados por `node --check`;
- backend Python: aprovado por `compileall`.

### Teste de integração real dos motores
Os dois motores foram iniciados como processos reais em diretórios temporários:
- `/health`: HTTP 200;
- `/data-safety`: banco íntegro, schema 1;
- backup manual pela API: criado e revalidado;
- requisição sem token: HTTP 401.

Resultado: **Acompanhamento e Compras aprovados**.

### Stress de WAL e concorrência
Um banco em WAL recebeu gravações concorrentes enquanto 16 snapshots eram criados.

- 16/16 snapshots passaram `integrity_check`;
- nenhuma exceção de concorrência;
- 400/400 registros finais preservados;
- snapshots representaram estados transacionalmente consistentes durante a escrita.

### Auditoria estática do pacote
- referências HTML/CSS: nenhuma ausente;
- imagens locais do README: presentes;
- workflow YAML: parseável;
- workflow contém compilação/validação dos dois motores;
- `package.json` e `package-lock.json`: versão 3.0.2 consistente;
- `name` e `appId` históricos preservados;
- assets do instalador presentes;
- nenhum `.db`, `.sqlite3`, `.xls`, `.xlsx`, `.xlsm`, `.env`, certificado ou chave privada incluído no projeto;
- nenhum token GitHub/chave privada detectado pela varredura estática.

## O que deliberadamente não foi feito

- nenhum banco existente foi convertido ou renomeado;
- nenhum caminho histórico de dados foi alterado;
- nenhuma restauração automática foi adicionada;
- nenhuma limpeza automática de banco operacional foi adicionada;
- nenhuma criptografia de banco foi introduzida nesta etapa;
- nenhum fluxo de negócio foi alterado para executar a revisão.

## Limitações da validação local

Este ambiente não possui Windows, PowerShell, `xlrd` ou `xlwt`, nem acesso de rede para instalar essas dependências. Por isso:

1. os cinco testes `.xls` devem ser confirmados no GitHub Actions;
2. o executável PyInstaller e o NSIS final devem ser confirmados no runner `windows-latest`;
3. uma release só deve ser publicada depois que o workflow estiver totalmente verde.

## Critério recomendado para liberação

Não publicar a 3.0.2 enquanto qualquer etapa do workflow estiver vermelha. O gate final deve incluir:

1. `npm ci`;
2. instalação de `backend/requirements.txt`;
3. `npm test` sem falhas;
4. geração de `followup-engine.exe`;
5. geração de `compras-engine.exe`;
6. `verify-engines.ps1`;
7. Electron Builder;
8. `verify-packaged-engines.ps1`;
9. artefato/release somente após todas as etapas anteriores.
