# Vyzium 3.1 — Arquitetura de segurança

## Objetivo

A 3.1 adiciona identidade e proteção criptográfica sem sobrescrever os bancos que já estão em produção. O desenho separa quatro responsabilidades:

- **Firebase Authentication** identifica o usuário e mantém a sessão.
- **Cloud Firestore** guarda somente perfil, workspace, associação e o envelope criptografado de recuperação.
- **Electron `safeStorage`** protege localmente a chave raiz usando a proteção do sistema operacional; no Windows, o backend é o DPAPI quando disponível.
- **SQLCipher** protege os bancos locais em repouso.

Os pedidos, fornecedores, telefones, mapas, preços, históricos e observações continuam locais. Eles não são enviados ao Firestore pela 3.1.

## Material criptográfico

Cada workspace recebe uma chave raiz aleatória de 256 bits. Ela nunca deriva da senha do Firebase.

A partir dela o Vyzium deriva chaves distintas por módulo com HKDF-SHA-256:

- `vyzium:followup:v1`
- `vyzium:compras:v1`

A chave raiz é armazenada localmente somente dentro de um blob protegido por `safeStorage`. A chave de cada banco é entregue ao motor Python apenas durante a execução do workspace.

## Recuperação

Na primeira proteção, o Vyzium gera um código de recuperação aleatório. Esse código **não é armazenado**.

A chave raiz é envolvida com:

- scrypt para derivar a KEK a partir do código;
- AES-256-GCM para autenticar e cifrar a chave raiz.

Somente o envelope criptografado é salvo:

- no Firestore em `workspaces/{workspaceId}/keyRecovery/current`;
- localmente em `security/recovery-envelope.json` como redundância de recuperação.

Ter o envelope sem o código não entrega a chave raiz. Ter a senha do Firebase, isoladamente, também não entrega a chave local.

Se o usuário fechar o aplicativo antes de confirmar que guardou o código, o próximo início de configuração gera **um novo código** e substitui o envelope anterior. A migração não é ativada silenciosamente.

## Estrutura local protegida

```text
%APPDATA%/Vyzium/
└── workspaces/
    └── <firebase-uid>/
        ├── followup/
        │   ├── followup.db
        │   └── backups/
        ├── compras/
        │   ├── compras.sqlite3
        │   └── backups/
        ├── whatsapp-session/
        └── security/
            ├── vault.json
            ├── recovery-envelope.json
            └── state.json
```

`vault.json` não contém a chave em texto puro. Os bancos dentro do workspace são SQLCipher.

## Sessão Firebase

O refresh token do Firebase é persistido somente depois de ser protegido com `safeStorage`. UID, e-mail e nome de exibição podem existir no arquivo local de sessão; eles não são chaves criptográficas.

A 3.1 permite uma janela offline limitada de 24 horas somente para uma sessão que já havia sido verificada online. Operações de primeira configuração e acesso ao envelope de recuperação em nuvem exigem internet. Se houver um envelope local válido, uma sessão já autenticada em grace offline também pode restaurar o cofre local com o código de recuperação.

## Fail closed

Antes de iniciar os serviços operacionais, cada banco protegido existente é revalidado com a chave correta e `PRAGMA integrity_check`. Isso também cobre retomadas de uma migração interrompida.

O Vyzium bloqueia a abertura operacional quando:

- a conta não está autenticada;
- o e-mail ainda não foi verificado;
- o workspace não foi ativado;
- a chave local não pode ser descriptografada;
- SQLCipher não está disponível no motor empacotado;
- a integridade do banco falha;
- um banco possui schema mais novo que o suportado.

Nenhuma dessas situações causa reparo ou substituição automática do banco legado.

## O que não vai para o aplicativo

Nunca incluir no Electron, executável ou repositório:

- `service-account.json`;
- chave privada de Service Account;
- `client_email` administrativo;
- segredo do Firebase Admin SDK;
- token pessoal do GitHub.

A configuração Web do Firebase em `electron/firebase-config.js` é configuração de cliente e não concede privilégios administrativos. A autorização de dados depende do Firebase Auth e das Security Rules.

## Limitações conhecidas

Criptografia em repouso protege arquivos copiados/roubados. Ela não transforma um computador já comprometido por malware executando como o mesmo usuário em um ambiente confiável. Quando o Vyzium está aberto, as chaves precisam existir temporariamente na memória dos processos que usam os bancos.

A 3.1 também não sincroniza os dados operacionais entre computadores. Workspace multiusuário e sincronização são evoluções futuras e exigem um desenho adicional de chaves e permissões.
