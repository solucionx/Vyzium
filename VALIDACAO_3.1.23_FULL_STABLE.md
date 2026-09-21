# Validação técnica — Vyzium 3.1.23 Full Stable

Data da revisão: 2026-09-20.

## Escopo da estabilização

Esta revisão consolida a auditoria da 3.1.22 sem alterar a identidade visual, o patch V6 do `whatsapp-web.js` ou a arquitetura de dados já existente. Os pontos principais são:

- sessão WhatsApp transacional (`active`, `pending` e `previous`) com `session-state.json` atômico;
- nenhum purge destrutivo de perfil LocalAuth no boot;
- geração de novo QR preservando a última sessão confirmada até a nova atingir `ready`;
- Chrome continua `headless:false` e usa o mecanismo Pre-Show validado no Windows, com guardião Win32 instalado antes de `ResumeThread`;
- endpoint CDP aceito apenas após `/json/version` e handshake WebSocket real;
- restauração do mesmo diretório LocalAuth em `%LOCALAPPDATA%`;
- parser/importadores endurecidos contra cabeçalhos ambíguos, formatos numéricos brasileiros e linhas de metadados;
- correspondência de comprador exata após normalização;
- classificação de atendimento sem o falso positivo de `NÃO ENTREGUE`/`ENTREGUE PARCIALMENTE`;
- versão 3.1.23 propagada a Electron e aos motores Python;
- tabelas internas de Compras protegidas por allowlist;
- cache de integridade de banco baseado em SHA-256 do banco/WAL;
- `.gitignore` e verificação de repositório bloqueiam bases SCI/planilhas operacionais e artefatos de sessão do WhatsApp.

## Testes executados neste ambiente

### Node/Electron

`npm run test:node`

- 104/104 testes aprovados;
- 6/6 verificações adicionais de ordenação aprovadas;
- zero falhas.

### Backend Python sem dependências nativas/ausentes

Foram executados 91 testes dos módulos de Acompanhamento, Compras, operação, atualização, fila WhatsApp e Data Safety disponíveis neste ambiente:

- 91/91 aprovados.

Também foram executados separadamente 5 testes compatíveis adicionais de migração/Compras V11:

- 5/5 aprovados.

Na descoberta completa existem 105 testes Python. Neste container:

- 96 passam;
- 4 ficam `skipped` porque `sqlcipher3` não está instalado;
- 5 não iniciam porque `xlrd`/`xlwt` não estão instalados.

`sqlcipher3==0.6.2`, `xlrd==2.0.2` e `xlwt==1.3.0` continuam fixados em `backend/requirements.txt`, e o workflow Windows instala essas dependências antes de rodar `npm test`. A indisponibilidade é do ambiente de validação atual, não uma remoção de dependência do projeto.

### Verificação sintática

- todos os `.js`/`.cjs` do projeto passaram em `node --check`;
- todo o diretório `backend` passou em `python -m compileall`.

## Validação que precisa ocorrer no Windows antes da publicação

O container desta revisão não executa PowerShell/Win32, portanto a camada `CreateProcessW + CREATE_SUSPENDED + WinEvent` não pode ser exercitada aqui. O mesmo desenho Pre-Show já foi validado manualmente no computador de teste: Chrome headful presente no Gerenciador de Tarefas sem janela/miniatura na barra de tarefas.

Antes de publicar o instalador, executar no Windows o seguinte gate:

1. primeira autenticação por QR e espera até `Conectado`;
2. fechar normalmente e abrir 10 vezes, sem novo QR;
3. confirmar em cada boot que Chrome existe no Gerenciador de Tarefas e não aparece na barra/área de trabalho;
4. confirmar ausência de `ECONNREFUSED 127.0.0.1:<porta>`;
5. iniciar `Gerar novo QR`, cancelar/falhar a nova autenticação e confirmar que o perfil anterior não foi apagado;
6. concluir um novo QR, fechar e reabrir, confirmando que o novo perfil foi promovido e persiste;
7. importar um `.xls` real no módulo Compras;
8. executar os testes SQLCipher com `sqlcipher3` instalado;
9. executar `npm test` completo no Windows;
10. gerar o instalador somente se todos os itens acima passarem.

## Arquivos sensíveis preservados

A release de código não contém banco operacional, planilha de usuário ou sessão WhatsApp. O verificador do repositório rejeita, entre outros, `.db`, `.sqlite3`, `.xls`, `.xlsx`, `.xlsm`, `.csv`, chaves privadas, `.env` e os arquivos de estado/sessão do WhatsApp.
