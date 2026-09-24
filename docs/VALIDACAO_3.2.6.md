# Vyzium 3.2.6 — Gate de produção

## Base
A 3.2.6 foi derivada diretamente da 3.2.5. Fora da atualização de versão, as mudanças funcionais estão limitadas à instrumentação de diagnóstico em `electron/main.js`, `electron/whatsapp.js`, `electron/whatsapp-hidden-browser.ps1` e ao novo `electron/diagnostics.js`.

## Correções feitas durante a auditoria
1. O primeiro protótipo de diagnóstico empacotava o relatório antes do encerramento dos serviços. Isso podia perder eventos finais do WhatsApp. Na 3.2.6, o pacote é consolidado depois do shutdown controlado.
2. Foi adicionada finalização idempotente para impedir pacotes duplicados no segundo evento `before-quit`.
3. Foi adicionada retenção automática: máximo de 8 execuções e 5 ZIPs.
4. O diretório pessoal do Windows é redigido como `%USERPROFILE%` e campos sensíveis são mascarados.
5. Foram incluídos timeout/exit/error dos motores e operações do security tool na timeline.

## Gates executados neste ambiente
- `node --check` nos arquivos Electron alterados: aprovado.
- suíte Node: 115/115 aprovada.
- verificações de ordenação: 6/6 aprovadas.
- `python -m compileall backend`: aprovado.
- suíte Python: 151 testes descobertos; 7 não puderam executar neste ambiente exclusivamente porque `xlrd`/`xlwt` não estão instalados aqui. As dependências continuam pinadas em `backend/requirements.txt` e o workflow Windows as instala antes de executar `npm test`.

## Gate obrigatório antes de publicar
A Release só deve ser publicada se o workflow `Windows Release` concluir integralmente em `windows-latest`, incluindo `npm ci`, instalação de `backend/requirements.txt`, `npm test`, compilação dos dois motores, validação dos motores empacotados e geração do instalador.

A aprovação local não substitui o teste real em Windows do fluxo Chrome/Edge + PowerShell + CDP. Antes de promover a 3.2.6 para todos os usuários, validar pelo menos: PC com sessão existente e PC limpo sem sessão do WhatsApp.
