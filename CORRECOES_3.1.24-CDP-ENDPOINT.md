# Vyzium 3.1.24 — correção do endpoint CDP

## Sintoma corrigido

A v3.1.23 podia mostrar na interface:

```text
Invalid URL: [object Object],ws://127.0.0.1:<porta>/devtools/browser/<id>
```

O Chrome invisível era iniciado corretamente, mas a função PowerShell que validava o WebSocket CDP deixava o valor retornado por `ConnectAsync(...).GetResult()` escapar para o pipeline do PowerShell. Em algumas combinações de Windows PowerShell/.NET, a função retornava dois valores: um objeto interno e a URL WebSocket. O `ConvertTo-Json` serializava isso como array e o Node convertia o array para a string `[object Object],ws://...`. O Puppeteer então recusava a URL.

## Correções

- O retorno de `ConnectAsync(...).GetResult()` é agora descartado explicitamente com `$null = ...`.
- O helper só aceita exatamente um valor de endpoint após a validação.
- O endpoint precisa ser `ws://` ou `wss://`, local (`127.0.0.1`, `localhost` ou `::1`) e usar `/devtools/browser/<id>`.
- A camada Node rejeita arrays, objetos ou URLs malformadas antes de criar o cliente do WhatsApp.
- Foram adicionados testes de regressão para o caso `[object Object],ws://...`.

## O que não mudou

- `headless:false`;
- criação suspensa + guardião Win32 Pre-Show;
- LocalAuth e perfil persistente;
- patch V6 do `whatsapp-web.js`;
- lógica transacional `active/pending/previous`;
- QR, `authenticated`, `ready`, `hasSynced`, watchdog e reconexão.
