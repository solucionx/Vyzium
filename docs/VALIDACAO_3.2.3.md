# Vyzium 3.2.3 — adicionar itens a uma cotação existente

Base: pacote completo 3.2.2 entregue anteriormente. Escopo funcional desta revisão: permitir incluir itens em mapas já existentes, mantendo os dados e fluxos atuais.

## Como usar

1. Abra um mapa em **Em cotação** e clique em **Adicionar itens**, ao lado de **Salvar e calcular**.
2. Use comprador, hotel e busca por descrição/SCI/artigo para localizar os itens disponíveis. A lista tem páginas de 50 itens e mantém as seleções ao trocar de página ou filtro; o contador informa o total selecionado.
3. Clique em **Adicionar N itens e salvar**. Os preços, fornecedores, negociações, prazos e escolhas já existentes são mantidos. Edições pendentes são salvas junto. Cada item adicionado começa sem preços e segue a ordenação por hotel já existente.

Para mover um item entre cotações existentes, use **Remover item** na origem e depois **Adicionar itens** no destino. O mapa de origem mantém a regra anterior de pelo menos um item. Mapas concluídos continuam somente para consulta/exportação.

## Preservação e validações

- O backend aceita IDs explícitos de inclusão e obtém os dados dos novos itens da base atual; descrição, quantidade, hotel, observação e tipo de compra não são copiados de dados manipulados na tela.
- Apenas itens elegíveis da base e sem mapa ativo podem ser incluídos. A disponibilidade é verificada novamente no momento do salvamento, dentro do mesmo bloqueio utilizado pelas gravações existentes.
- IDs duplicados, item já presente, item indisponível, disputa entre mapas, revisão antiga, mapa concluído ou envio em andamento são rejeitados sem inclusão parcial.
- Campos editáveis omitidos numa requisição de inclusão preservam os dados já salvos. Itens novos não herdam preços ou decisões enviados indevidamente junto à requisição.
- Validações de preço e negociação continuam sendo executadas antes de gravar. Backup automático é criado antes da inclusão; a criptografia dos backups segue o banco existente.
- Falhas de consulta/salvamento liberam os botões para nova tentativa. Falhas ao salvar mantêm a seleção e os campos preenchidos, com a mensagem do backend na janela.
- Durante o salvamento, cliques repetidos, fechamento da seleção, importação e navegação são bloqueados. O formulário impede a navegação nativa do navegador de forma síncrona antes de encaminhar o salvamento assíncrono.

## Comunicação verificada

O botão consulta `GET /items` e confirma a inclusão por `POST /maps/save`, com `add_item_ids`. Ambas as rotas já pertenciam à lista de permissões do Electron. Não foi necessário criar endpoint, canal IPC, tabela, migração ou dependência de produção.

O teste de interface executa os arquivos reais do renderer, `electron/preload.js` e `electron/main.js`. O clique passa pelo preload, pelo handler `api`, pela lista de rotas permitidas e pela chamada HTTP autenticada até o motor Python real, usando banco temporário com dados sintéticos. Chamadas e respostas são registradas para as verificações.

Os serviços de janela, inicialização e transporte nativo do Electron são substituídos por adaptadores de teste. Isso permite verificar o código de comunicação sem executar login, Firebase, atualização ou sessão real de WhatsApp, mas não equivale a testar o instalador Windows.

## Resultado dos testes

| Verificação | Resultado |
| --- | --- |
| `npm test`: Python | 151 testes aprovados, incluindo 19 novos testes de inclusão |
| `npm test`: Node | 109 testes aprovados, incluindo proteção das versões das dependências |
| Ordenação já existente | 6 verificações aprovadas |
| Interface em Chromium 153.0.8010.0 | 15 cenários de integração aprovados |
| Comunicação no teste de interface | 67 requisições HTTP e 55 chamadas pela ponte IPC; 8 salvamentos bem-sucedidos e 4 rejeições esperadas do backend |
| Exceções não tratadas no navegador | Nenhuma |
| Inspeção visual | Janela de seleção e controles verificados em 1440 × 1050 |

### Cenários críticos cobertos

- consulta dos itens pelo botão, permissões de rota e exclusão de itens já vinculados;
- filtros, busca, texto escapado, paginação, seleção de página e limpeza;
- cancelamento preservando preços ainda não salvos;
- falha de conexão ao consultar e ao salvar, com nova tentativa;
- preço inválido retornado pelo backend sem alterar o mapa;
- cliques repetidos, Escape, importação e troca de módulo durante o salvamento;
- inclusão preservando preços antigos, descontos legados, fornecedores e escolhas;
- reabertura do mapa com os itens e preços persistidos;
- cotação, salvamento, prévia e exportação do item recém-incluído;
- item ocupado em outra cotação depois de a seleção ter sido aberta;
- remoção na origem e inclusão no destino pelos botões reais;
- vários itens selecionados em filtros diferentes e enviados em uma única gravação;
- revisão desatualizada e resposta HTTP de conflito;
- resposta de consulta atrasada após troca de tela;
- mapas concluídos e lista sem itens disponíveis;
- backend: concorrência entre dois mapas, base alterada, IDs inválidos, ausência de fornecedores, backup, erro de gravação, SQLCipher e prévia antiga invalidada.

## Arquivos de teste e reprodução

- `backend/test_compras_add_items.py`: regressões incluídas automaticamente em `npm test`.
- `tests/integration/quotation-items.cjs`: integração do navegador com o código de comunicação e o backend.
- `tests/integration/quotation_items_server.py`: servidor temporário com dados sintéticos; envio real de WhatsApp bloqueado.

Para repetir os testes de interface no Windows, com Python e os requisitos de `backend/requirements.txt` já instalados, é possível usar um ambiente de QA separado do aplicativo:

```powershell
npm install --prefix ..\vyzium-ui-qa --ignore-scripts --no-audit --no-fund playwright
node ..\vyzium-ui-qa\node_modules\playwright\cli.js install chromium
$env:NODE_PATH = (Resolve-Path ..\vyzium-ui-qa\node_modules).Path
node tests/integration/quotation-items.cjs
```

O teste usa a API Playwright; `VYZIUM_TEST_PYTHON` permite indicar outro executável Python e `VYZIUM_TEST_OUTPUT_DIR` permite salvar relatório JSON e capturas de tela. Nenhuma dessas bibliotecas foi adicionada às dependências do app.

## Escopo e limites

Mudanças funcionais restritas a `backend/compras_engine.py`, `renderer/compras-app.js` e duas regras de estilo em `renderer/compras.css`. Atualizados os textos/fallbacks de versão para 3.2.3, README e testes de consistência da versão. Os arquivos do Electron, ícones, instalador, autenticação, Firebase, sessão/ocultação/envio de WhatsApp e workflows permanecem idênticos à versão 3.2.2.

O `package-lock.json` também foi corrigido: a substituição de numeração feita na 3.2.2 havia alcançado versões de dependências transitivas. Foram restauradas exatamente as entradas do pacote original 3.2.1; apenas a versão do aplicativo foi alterada para 3.2.3. As dependências declaradas no `package.json` foram preservadas. A instalação com `npm ci` foi validada, e um teste de regressão verifica as versões e URLs dos pacotes afetados.

A validação foi executada em Linux com Python 3.12, Node 24 e Chromium headless. O teste criptográfico local usou `sqlcipher3-binary 0.6.0`; o requisito de produção `sqlcipher3==0.6.2` foi preservado.

O pacote contém o código-fonte completo. O executável/instalador Windows não foi compilado ou executado nesta sessão, e não houve envio real a fornecedores. Antes de publicar `v3.2.3`, devem continuar sendo executados o workflow Windows Release e os testes do aplicativo instalado previstos na versão base.
