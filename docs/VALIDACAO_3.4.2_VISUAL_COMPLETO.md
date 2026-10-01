# Vyzium 3.4.2 — Visual completo

Candidata criada sobre a Vyzium 3.4.1 validada no PC real, commit:

`b84615b631a3e9c3de5f9944516cca63746aab7a`

## Objetivo

Completar nos módulos reais a linguagem visual aprovada na sandbox desktop, sem substituir a lógica estável.

### Acompanhamento
- sidebar e topbar no padrão operacional;
- Controle Operacional com máxima largura útil;
- filtros compactos;
- tabelas densas com cabeçalhos claros;
- dashboard em indicadores compactos;
- Pedidos no mesmo padrão visual;
- Fornecedores com visual unificado;
- Mensagens, Histórico e Configurações herdando a mesma linguagem de painéis, botões e tipografia.

### Cotação & Mapas
- Itens a comprar como fila operacional principal;
- filtros compactos;
- indicadores em faixa;
- Mapas ativos e Concluídos com biblioteca visual mais limpa;
- mapa aberto com comando, fornecedores, tabela comparativa e resultados mais densos;
- Fornecedores compartilhados no mesmo padrão;
- Histórico e Configurações no mesmo sistema visual.

## Estratégia de estabilidade

O redesign é uma camada de renderer:

- nova folha `renderer/operational-ui.css`;
- classes visuais adicionadas aos HTMLs dos módulos;
- pequenos marcadores de classe/texto em renderers existentes;
- nenhuma API nova;
- nenhuma migração de banco;
- nenhuma alteração de regra de filtro;
- nenhuma alteração no ciclo de vida dos engines.

## WhatsApp congelado nesta candidata

A 3.4.2 visual **não altera**:

- `electron/whatsapp.js`;
- `electron/whatsapp-hidden-browser.ps1`;
- `electron/main.js`;
- `electron/preload.js`;
- dependência `whatsapp-web.js`;
- sessão LocalAuth;
- Chromium/Edge;
- QR/reconexão;
- bridge de mensagens.

O pipeline compara esses arquivos diretamente com a 3.4.1 e bloqueia a candidata se houver qualquer diferença.

## Outros núcleos protegidos

Também permanecem idênticos à 3.4.1:

- backup/restauração/merge;
- Firebase e autenticação;
- SQLCipher e segurança;
- updater;
- regras Firestore;
- backup-sync-engine.

## Publicação

A release v3.4.2 será criada somente como **Draft**, após testes e build completos. Publicação continua manual.
