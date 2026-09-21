# Validação técnica — Vyzium 3.2.0

Escopo da revisão: somente as áreas alteradas desde a 3.1.25 estável.

## Arquivos funcionais auditados

- `backend/compras_engine.py` — conclusão/exclusão de mapas, resumos pesquisáveis e CNPJ no WhatsApp.
- `backend/excel_export.py` — exportação BIFF8 com folha preparada para impressão.
- `renderer/compras-app.js` e `renderer/compras.css` — biblioteca de mapas, busca, status e visual da cotação.
- `electron/main.js` — identidade/ícone da janela no Windows.
- testes associados aos fluxos acima.

## Verificações realizadas

- compilação sintática dos Python alterados;
- `node --check` nos JavaScript alterados;
- suíte específica de Compras;
- suíte Node do projeto;
- importação real da `BASE SCI.xlsx` usada na validação, com 56.839 linhas lidas e 1.523 itens elegíveis no módulo Compras;
- associação de CNPJ validada para os seis hotéis presentes nessa base;
- mensagem de cotação validada sem exposição de SCI;
- conclusão de mapa validada como idempotente e liberando itens;
- exclusão validada com backup automático anterior à remoção;
- consistência das referências de versão e identidade do instalador.

## Dependências do gate de Release

O ambiente final do GitHub Actions instala `xlrd`, `xlwt` e `sqlcipher3` a partir de `backend/requirements.txt` antes de executar `npm test`. Esses testes permanecem no workflow e devem ficar verdes antes da publicação da Draft.

## Resultado

Nenhuma alteração foi feita na lógica estabilizada de Acompanhamento, sessão do WhatsApp, Firebase, SQLCipher ou atualização automática. A versão foi preparada como `3.2.0`, mantendo `com.vyzium.gestaooperacional` e o mesmo canal `solucionx/Vyzium-Releases`.
