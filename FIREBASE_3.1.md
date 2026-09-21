# Vyzium 3.1 — Configuração Firebase

Projeto utilizado pela aplicação:

```text
Project ID: vyzium-production
Authentication: Email/Password
Firestore: (default)
```

## Antes de testar a 3.1

1. Em **Authentication > Método de login**, mantenha `E-mail/Senha` habilitado.
2. Configure a política de senha no servidor com pelo menos 12 caracteres e os requisitos adotados pelo Vyzium.
3. Mantenha a proteção contra enumeração de e-mail habilitada.
4. Mantenha o Realtime Database bloqueado; a 3.1 não o utiliza.
5. Publique **exatamente** `firebase/firestore.rules` deste repositório.
6. Não crie `users`, `workspaces`, `members` ou `keyRecovery` manualmente; a aplicação cria os documentos autorizados.

## Realtime Database

Se a instância já existir, mantenha:

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

## Firestore

A estrutura mínima usada pela 3.1 é:

```text
users/{uid}
workspaces/{uid}
workspaces/{uid}/members/{uid}
workspaces/{uid}/keyRecovery/current
```

O workspace primário da 3.1 usa o próprio Firebase UID como ID. As Rules impedem que um usuário crie o workspace primário com outro identificador.

O Firestore **não** recebe os bancos locais ou seus registros operacionais.

## Security Rules

As regras em `firebase/firestore.rules`:

- exigem autenticação;
- exigem e-mail verificado;
- limitam o perfil ao próprio UID;
- limitam leitura do workspace ao proprietário/membro;
- restringem criação do workspace primário ao próprio UID;
- impedem alteração de `ownerUid` e do `schemaVersion` pelo cliente;
- restringem gestão de membros ao proprietário;
- permitem `keyRecovery/current` somente ao proprietário;
- aplicam default deny a qualquer caminho não previsto.

### Publicação pelo console

Copie o conteúdo de `firebase/firestore.rules` para **Firestore > Regras** e clique em **Publicar**.

### Publicação pela Firebase CLI

O repositório inclui `firebase.json` e `.firebaserc`:

```powershell
firebase login
firebase use vyzium-production
firebase deploy --only firestore:rules,firestore:indexes
```

Não armazene credenciais administrativas no repositório para automatizar esse comando.

## Firebase Web config

A aplicação usa `electron/firebase-config.js`. A chave `apiKey` desse arquivo é a configuração cliente do Firebase e não é uma chave do Admin SDK.

A 3.1 usa chamadas HTTPS ao Firebase a partir do processo principal do Electron. O renderer permanece isolado com `contextIsolation`, `sandbox` e CSP sem acesso direto à rede.

## App Check

Não há enforcement de App Check nesta primeira implementação. Electron desktop exige uma estratégia específica; habilitar enforcement sem um provider validado pode bloquear clientes legítimos. Antes de escalar cadastro público, trate App Check/antiabuso como uma etapa separada e testada.
