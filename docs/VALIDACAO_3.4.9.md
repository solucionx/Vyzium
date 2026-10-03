# Validação Vyzium 3.4.9

Base funcional: Vyzium 3.4.6. Objetivo: manter apenas a busca da Visão Geral e a prioridade de mapas urgentes entre as melhorias recentes, restaurando o envio de cotações para texto puro.

## Garantias de escopo

- `electron/whatsapp.js` foi restaurado ao comportamento text-only anterior ao recurso de imagens.
- `backend/compras_engine.py` não contém validação, coleta ou envio de referências de imagem.
- `renderer/compras-app.js` não contém seletor, FileReader, canvas, prévia ou controles de imagem.
- Imagens legadas já existentes em um JSON de mapa são ignoradas e não são apagadas automaticamente.
- Busca geral e mapa urgente permanecem ativos.

## Gates

1. `npm test`.
2. Integração `tests/integration/home-search.cjs`.
3. Integração `tests/integration/quotation-items.cjs`.
4. Compilação dos três motores Python no Windows.
5. Verificação dos motores e SQLCipher antes e depois do empacotamento.
6. Geração e comparação integral do portátil.
7. Checksums SHA-256.
8. Criação somente como Draft no Vyzium-Releases.

Nenhum teste automatizado envia mensagens reais a fornecedores.
