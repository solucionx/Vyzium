# Vyzium 3.4.16 — visualização detalhada em planilha

Esta versão parte da 3.4.15 e altera somente a experiência de **Visualização detalhada** dos mapas de compra, além dos testes e metadados necessários para validar e empacotar a versão.

## Alteração

- remove o painel de resumo e as abas do visualizador detalhado;
- apresenta diretamente uma grade no estilo planilha;
- mantém uma linha por item e uma coluna por fornecedor;
- mostra, em cada fornecedor, preço final por unidade em destaque, preço inicial, total do item e prazo/entrega;
- destaca o fornecedor escolhido e o menor preço sem recalcular decisões no frontend;
- mantém Hotel, SCI e Item fixos durante a rolagem horizontal;
- mantém busca por item, SCI e fornecedor, filtro por hotel e por situação;
- mantém a visualização somente leitura e preserva o fluxo seguro de salvar/atualizar quando existem alterações não salvas.

## Estabilidade

Não foram alterados o backend de Compras, importação da BASE SCI, histórico de compras, WhatsApp, SQLCipher, backup, restauração, autenticação ou regras de cálculo/seleção. Os valores e decisões continuam vindo do mesmo avaliador do backend.

A release deve permanecer **Draft** para publicação manual após a validação do pipeline.
