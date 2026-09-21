# Vyzium 3.1 — Gate de release

A 3.1 altera autenticação e formato dos bancos ativos. Não publique a release para clientes até todos os gates abaixo passarem.

## Gate obrigatório

- GitHub Actions totalmente verde.
- `sqlcipher3` instalado no runner Windows.
- testes `.xls` (`xlrd`/`xlwt`) verdes.
- testes de migração SQLCipher verdes.
- `followup-engine.exe security-check` retorna SQLCipher disponível.
- `verify-packaged-engines.ps1` confirma SQLCipher dentro do pacote final.
- validação dos bancos SQLCipher existentes antes de iniciar os serviços;
- Firestore Rules deste repositório publicadas no projeto `vyzium-production`.
- teste com conta Firebase descartável e e-mail verificado.
- teste de banco legado fictício com dados em ambos os módulos.
- teste de interrupção antes de confirmar o código de recuperação.
- teste de código de recuperação incorreto.
- teste de atualização 3.0.4 → 3.1.0 em uma máquina de homologação antes de produção.

## Conferência de dados na homologação

Antes e depois da migração, compare no mínimo:

- quantidade de registros por tabela;
- pedidos/itens visíveis;
- mapas existentes;
- contatos e configurações;
- histórico;
- filtros persistentes;
- integridade (`PRAGMA integrity_check`);
- capacidade de abrir a base nova apenas com SQLCipher/chave correta.

## Distribuição

Código:

```text
solucionx/Vyzium-Core (PRIVATE)
```

Artefatos:

```text
solucionx/Vyzium-Releases (PUBLIC)
```

O workflow permanece manual e cria a 3.1 primeiro como Draft.
