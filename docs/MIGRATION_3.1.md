# Vyzium 3.1 — Migração segura dos bancos existentes

## Regra principal

O banco legado em produção **nunca é criptografado por cima, renomeado ou apagado** pela migração 3.1.

Fontes legadas:

```text
Acompanhamento:
<userData>/followup.db

Cotação & Mapas:
%APPDATA%/Vyzium-Compras/compras.sqlite3
```

Destinos 3.1:

```text
<userData>/workspaces/<firebase-uid>/followup/followup.db
<userData>/workspaces/<firebase-uid>/compras/compras.sqlite3
```

## Fluxo

```text
login + e-mail verificado
        ↓
workspace Firebase
        ↓
SQLCipher disponível?
        ↓
gerar/proteger chave + código de recuperação
        ↓
usuário confirma que guardou o código
        ↓
integrity_check do banco legado
        ↓
snapshot SQLite consistente e temporário
        ↓
criar NOVO banco SQLCipher temporário
        ↓
importar conteúdo
        ↓
preservar user_version/application_id
        ↓
integrity_check do banco criptografado
        ↓
comparar contagem de todas as tabelas
        ↓
confirmar que SQLite comum NÃO consegue abrir o destino
        ↓
ativação atômica do novo arquivo
        ↓
marker do workspace somente após todos os módulos
```

Se qualquer etapa falhar, o banco legado continua no local original e o workspace não é marcado como ativo.

## Interrupção no meio da migração

O destino final só é criado por `os.replace()` depois que o banco criptografado temporário passa nas validações. Arquivos temporários são removidos pelo diretório temporário.

Se um módulo já terminou e o segundo falhar, o marker global não é ativado. Na tentativa seguinte, o destino existente é **revalidado com a chave correta + `PRAGMA integrity_check`** antes de ser aceito; somente o módulo ausente é migrado. Um arquivo presente nunca é considerado confiável apenas por existir.

## WhatsApp

A sessão legada do WhatsApp é **copiada**, não movida, para o workspace. A sessão original não é apagada pela 3.1.

## Após a migração

O app passa a abrir somente os bancos dentro do workspace protegido. Os arquivos legados continuam retidos como rollback histórico e não são usados operacionalmente pelo Vyzium 3.1.

Não apague os bancos legados logo após atualizar. A remoção/arquivamento definitivo deve ser uma decisão posterior, depois de uma janela real de validação em produção e com backups externos confirmados.
