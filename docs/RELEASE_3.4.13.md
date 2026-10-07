# Vyzium 3.4.13

Corrige a origem da aba **Últimas compras**: a consulta usa as ordens de compra e entradas da **BASE SCI importada no Acompanhamento**. A planilha de Cotação & Mapas é outra base e não alimenta essa consulta.

- Todas as compras do item disponíveis na base de OCs, de todos os compradores, inclusive OCs atendidas e antigas. Itens cancelados aparecem identificados; o filtro da própria aba permite ocultá-los.
- A pesquisa não herda comprador, hotel, status, prazo ou qualquer filtro salvo nas outras telas. Os filtros desta aba só afetam sua própria consulta.
- Preço unitário da OC, fornecedor, comprador e número da NF de entrada, com data, quantidade e unidade recebida.
- Usa os dados de OCs já importados; não exige reimportação para começar a consultar. Novas importações no Acompanhamento atualizam as referências.
- Tela compacta, com títulos e cartões menores, espaçamentos reduzidos e rolagem própria da lista de itens.
- O botão de importação dos mapas fica oculto nesta aba. Para atualizar as OCs, use **Acompanhamento → Importar BASE SCI**.

A consulta abre o banco do Acompanhamento somente para leitura, sem modificar tabelas, filtros, mapas, cotações, sessões do WhatsApp ou regras de envio. O histórico corresponde às OCs presentes na base importada, não a pedidos ausentes do arquivo.

Instalador Windows, portátil, código-fonte, metadados de atualização e SHA256SUMS. Release exclusivamente **Draft**, aguardando publicação manual. A versão publicada 3.4.12 permanece preservada.
