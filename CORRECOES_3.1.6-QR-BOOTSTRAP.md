# Vyzium 3.1.6 Audit — correção do bootstrap/QR do WhatsApp

## Evidência do log

O log da 3.1.5 mostra `Client.inject -> WaitTask -> Waiting failed` imediatamente após o WhatsApp Web registrar `WAWebSocketModel` com dependências ainda não resolvidas. A implementação V3 chamava `window.require("WAWebSocketModel")` dentro de `waitForFunction` sem `try/catch`. O loader interno do WhatsApp lança `ModuleError` nessa janela de bootstrap, e o Puppeteer encerra o `WaitTask` em vez de continuar aguardando.

O mesmo log também mostra `CacheStorage: Unexpected internal error` / `storage_initialization_error`. Esse sinal continua sendo auditado separadamente; ele não é tratado como causa única do QR porque o erro fatal comprovado ocorre no probe do `Client.inject`.

## Correção V4

- `WAWebSocketModel` agora é consultado por um probe tolerante a módulos ainda não resolvidos.
- Exceções transitórias do module loader retornam `false` e o Puppeteer continua esperando até `authTimeoutMs`.
- As dependências usadas para montar o QR (`WAWebSignalStoreApi`, `WAWebUserPrefsInfoStore`, `WABase64`, `WAWebUserPrefsMultiDevice`, `WAWebCompanionRegClientUtils` e `WAWebConnModel`) recebem uma segunda barreira de prontidão antes de `page.evaluate`.
- O patch recebeu marcador `VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V4`.
- A verificação de build agora falha se os guards contra `ModuleError` estiverem ausentes.
- A auditoria permanece habilitada para registrar navegação, console, `pageerror`, requests abortadas, QR/ready e ciclo do navegador sem persistir o conteúdo bruto do QR.

## Testes adicionados

1. Loader lança `ModuleError: unresolved dependencies` ao consultar `WAWebSocketModel`: o probe retorna `false`, sem exceção.
2. `WAWebSocketModel` fica disponível em `UNPAIRED`: o probe retorna `{need:true}`.
3. Dependências do QR parcialmente carregadas: o probe retorna `false`.
4. Todas as dependências do QR carregadas: o probe libera a geração.
5. Idempotência, CRLF, sintaxe do `Client.js` e reparo das versões anteriores continuam cobertos.
