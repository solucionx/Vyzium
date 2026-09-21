# Vyzium 3.1.2 — correção pontual do WhatsApp QR

Base: **Vyzium 3.1.1**. Esta versão não altera regras de negócio, layout, bancos, filtros, módulos de Acompanhamento ou Compras.

## Correções

- Corrigido `scripts/patch-whatsapp-web.js` para substituir o bloco completo de `page.evaluate()` usado na geração do QR. Na 3.1.1, a expressão de substituição parava no fechamento interno de `Conn.on(...)` e deixava um `});` excedente, causando `SyntaxError: Unexpected token ')'`.
- Adicionada validação sintática do `Client.js` modificado antes de gravar/aceitar o patch. Um JavaScript inválido agora interrompe o `postinstall` em vez de ser reportado como correção aplicada.
- Adicionado reparo automático do formato quebrado produzido pela 3.1.1 caso `npm install` seja executado sobre um `node_modules` já patchado.
- `scripts/verify-whatsapp-patch.js` agora também valida a sintaxe do `Client.js`.
- `tests/whatsapp-patch.cjs` passou a compilar o resultado do patch e cobre explicitamente a regressão do fechamento extra.

## O que foi preservado

As melhorias de reconexão, rotação de perfil `LocalAuth`, watchdog de QR, recuperação de navegação e demais comportamentos do WhatsApp introduzidos anteriormente permanecem inalterados.
