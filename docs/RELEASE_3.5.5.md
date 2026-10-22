# Vyzium 3.5.5 — Correção e desempenho da última compra

- Corrige o mapa sem código de artigo: descrição exata normalizada e unidade podem encontrar um artigo com código no histórico.
- Mantém a ordenação e os preços da aba Últimas compras. Descrições antigas do mesmo artigo também resolvem sua OC mais recente.
- Descrições iguais em artigos diferentes são identificadas como referência ambígua. Códigos diferentes, unidades diferentes e descrições apenas parecidas não são misturados.
- Substitui pesquisas individuais paginadas por consultas em lotes limitados. O mapa é exibido antes da consulta; itens repetidos são deduplicados e respostas de telas já fechadas são ignoradas.
- Reutiliza um índice em memória por versão da base. Reimportação ou restauração invalidam o índice; a expiração existente também libera sua memória. Não persiste preços na cotação e não escreve na base consultada.
- Mantém a coluna de 250 px, os cálculos, os envios, as sessões e a lógica de backup.

Validação: regressão do caso reportado, ambiguidades, código/unidade, datas, cancelamento, dados ausentes, cache/invalidação, consultas em lote, integração real renderer/IPC/backend e verificações Windows do fluxo de release.

Draft para conferência manual. Publicação exclusivamente pelo responsável.
