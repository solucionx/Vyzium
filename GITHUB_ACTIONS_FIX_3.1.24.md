# Vyzium 3.1.24 - Correção do GitHub Actions no Windows

## Causa
Os testes unitários de WhatsApp usavam `process.platform` diretamente. No runner `windows-latest`, isso fazia os testes criarem o guardião nativo Pre-Show e tentarem iniciar PowerShell/Chrome reais, embora as fixtures usem um navegador fictício (`/test/browser`). O mesmo conjunto passava no Linux, por isso a falha aparecia apenas no GitHub Actions do Windows.

## Correção
- `electron/whatsapp.js`: aceita `deps.platform` apenas como injeção de dependência; quando ausente, continua usando `process.platform`. O comportamento de produção permanece inalterado.
- `tests/whatsapp.cjs`: usa uma subclasse de teste que injeta `platform:'linux'`, evitando processos nativos em testes unitários. O teste específico do Pre-Show continua usando `forcePreShowGuard:true` e launcher falso.
- `backend/test_whatsapp.py`: mantém a correção anterior que fecha a conexão SQLite antes de remover o diretório temporário no Windows.
- `package.json` e `tests/project-config.cjs`: metadado do repositório alinhado a `solucionx/Vyzium.git`.

## Validação executada
- Node normal: 106/106 aprovados + 6 verificações de ordenação.
- Simulação de runner Windows (process.platform=win32): 106/106 aprovados + 6 verificações de ordenação.
- Sintaxe JS e compileall Python: aprovados.
- Os 5 testes Python de .xls continuam dependendo de `xlrd/xlwt`; o workflow instala ambos via `backend/requirements.txt`.

A lógica de produção do Chrome invisível/WhatsApp não foi desativada. Sem `deps.platform`, o app usa o `process.platform` real, portanto no Windows continua acionando o Pre-Show normalmente.
