# Vyzium 3.0.2 — Data Safety

## Objetivo

Proteger os bancos SQLite já existentes sem alterar os fluxos operacionais do Vyzium.

## Adicionado

- verificação read-only de integridade antes de abrir banco existente para escrita;
- snapshot automático e validado antes da primeira abertura da 3.0.2;
- backup automático antes de importações nos dois módulos;
- backup automático dos dois bancos antes de instalar atualização;
- `PRAGMA quick_check` nas importações antes do commit;
- backups pela API oficial `sqlite3.Connection.backup()`;
- `PRAGMA integrity_check` em todo backup gerado;
- manifesto JSON com SHA-256, versão, data, tamanho e motivo;
- retenção dos 10 backups automáticos mais recentes por módulo;
- backups manuais sem limpeza automática;
- tabela técnica `schema_migrations` criada após snapshot de segurança;
- `busy_timeout=10000`, `foreign_keys=ON`, WAL e `synchronous=FULL`;
- painel de Segurança dos dados nas Configurações;
- botão de backup manual e acesso à pasta de backups;
- erro amigável e bloqueio de alterações se o banco existente falhar na integridade;
- testes específicos de compatibilidade com bancos existentes e WAL.
- snapshots `pre-upgrade` e `pre-update` protegidos contra a poda automática;
- revalidação real de backup por tamanho, SHA-256 e `integrity_check` antes de confiar em snapshot existente;
- aviso visual quando o backup mais recente falha na revalidação;
- bloqueio de downgrade quando o banco usa schema mais novo que o suportado;
- testes de rollback forçado após falha de escrita nos dois módulos.

## Mantido

- caminhos históricos dos bancos;
- dados e mapas já existentes;
- filtros e multifiltros;
- Follow-up e WhatsApp;
- proteção de mapa não salvo;
- importadores e regras operacionais;
- layout e navegação dos módulos;
- identidade do aplicativo e `appId`.

## Decisão conservadora

A 3.0.2 não restaura automaticamente um banco. Em caso de falha de integridade, o Vyzium bloqueia escrita e preserva o arquivo e os backups para recuperação deliberada. Isso evita substituir silenciosamente dados de uma instalação em produção.
