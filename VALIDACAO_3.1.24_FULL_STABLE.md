# Validação técnica — Vyzium 3.1.24 Full Stable

## Escopo

Correção focada no endpoint CDP do Chrome invisível, preservando a arquitetura de sessão e o guardião Pre-Show da 3.1.23.

## Diagnóstico do erro observado

A mensagem `Invalid URL: [object Object],ws://127.0.0.1:...` demonstra que `browserWSEndpoint` chegou ao Node como uma coleção com um objeto extra mais a URL real. O helper PowerShell tinha uma chamada assíncrona cujo resultado não era explicitamente suprimido. Em PowerShell, saídas acidentais de uma função entram no pipeline e podem transformar um retorno escalar em array.

## Correções de defesa em profundidade

1. Saída da chamada `ClientWebSocket.ConnectAsync` descartada com `$null =`.
2. O helper exige exatamente um valor retornado por `Get-ValidatedDevToolsEndpoint`.
3. O helper valida formato local `ws(s)://.../devtools/browser/...`.
4. O Node valida novamente tipo, protocolo, host e path antes de usar `browserWSEndpoint`.
5. Arrays/objetos passam a falhar cedo com erro controlado, nunca chegando ao Puppeteer.

## Testes executados neste ambiente

- Node: **106/106 aprovados**, mais **6 verificações de ordenação**.
- Python: `compileall` aprovado.
- Backend: **96 testes executados com sucesso**, **4 ignorados** por ausência de `sqlcipher3`; **5 testes de `.xls` não executaram** porque `xlrd/xlwt` não estão instalados neste ambiente. Essas dependências continuam declaradas em `backend/requirements.txt`.

## Limitação de validação

O helper Pre-Show é Win32/PowerShell e não pode ser executado integralmente neste ambiente Linux. O mecanismo visual é o mesmo que já foi validado manualmente no Windows; a alteração desta revisão é especificamente o saneamento do retorno CDP.

## Gate manual recomendado no Windows

1. Abrir o Vyzium e confirmar que o Chrome não aparece.
2. Clicar **Gerar novo QR Code** se a sessão anterior estiver inconsistente.
3. Confirmar que o QR aparece.
4. Escanear e aguardar `Conectado`.
5. Fechar normalmente o Vyzium.
6. Abrir novamente e confirmar restauração sem novo QR.
7. Clicar `Conectar / reconectar` e confirmar que não surge `Invalid URL` nem `ECONNREFUSED`.
