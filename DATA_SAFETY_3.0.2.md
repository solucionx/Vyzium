# Vyzium 3.0.2 — Data Safety

Esta versão foi desenhada para proteger bancos SQLite que já estão em uso em instalações reais do Vyzium.

## Princípios

1. Um banco existente é verificado em modo somente leitura antes de qualquer migração ou manutenção.
2. A primeira abertura da 3.0.2 cria um snapshot verificado antes de tocar no banco existente.
3. Toda importação válida cria um backup antes de substituir o snapshot importado.
4. Toda atualização futura do aplicativo cria snapshots dos dois módulos antes da instalação.
5. Os backups são feitos pela API `sqlite3.Connection.backup()`, não por cópia simples do arquivo vivo.
6. Todo backup precisa passar por `PRAGMA integrity_check` antes de ser aceito.
7. Importações continuam transacionais: qualquer exceção causa rollback.
8. O aplicativo usa `busy_timeout`, `foreign_keys=ON`, WAL e `synchronous=FULL` para privilegiar consistência.
9. O Vyzium não restaura nem substitui automaticamente um banco com problema.
10. Uma versão antiga do Vyzium bloqueia a escrita se detectar um `schema_migrations` mais novo que o suportado, evitando corrupção por downgrade.

## Compatibilidade com dados existentes

Os caminhos dos bancos não foram alterados:

- Acompanhamento continua usando `followup.db` no `userData` existente do Vyzium.
- Cotação & Mapas continua usando `compras.sqlite3` no diretório histórico `Vyzium-Compras`.

A 3.0.2 adiciona apenas uma tabela técnica `schema_migrations` a cada banco, depois de criar o backup de pré-atualização.

## Backups

Cada módulo possui uma pasta separada:

```text
backups/
├── followup/
└── compras/
```

Cada snapshot possui um `.json` ao lado com:

- versão do aplicativo;
- data/hora;
- motivo;
- SHA-256;
- tamanho;
- confirmação de integridade.

Os backups automáticos comuns mantêm os 10 mais recentes por módulo. Backups manuais não são removidos automaticamente.

Snapshots de **pré-upgrade** e **pré-update** são tratados como cópias de recuperação protegidas e não entram na limpeza automática. Antes de um snapshot de versão ser reutilizado, o Vyzium revalida tamanho, SHA-256 e `PRAGMA integrity_check`; um arquivo adulterado ou corrompido nunca é aceito apenas porque o manifesto antigo dizia `ok`.

## Operações protegidas

- primeira abertura da 3.0.2 sobre banco existente;
- importação de nova base no Acompanhamento;
- importação de BASE SCI em Cotação & Mapas;
- preparação de atualização do aplicativo;
- verificação manual em Configurações.

## Banco com falha de integridade

Se `PRAGMA quick_check` falhar na abertura, o motor interrompe a inicialização antes de executar migrações ou reparos. O arquivo existente é mantido no lugar e o erro é apresentado ao aplicativo.

Não há recuperação automática nesta versão. Essa decisão é intencional: em uma instalação em produção é mais seguro preservar o arquivo e os backups do que substituir dados silenciosamente.
