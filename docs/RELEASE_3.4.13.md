# Vyzium 3.4.13 — Candidata de produção

Base obrigatória: **Vyzium 3.4.12 publicada**, commit `2d40d673edfcc038fc01c361e7d361268480dba1`.

Esta candidata consolida o trabalho iniciado na auditoria da 3.4.11 sem trocar a linhagem da versão publicada. As alterações ficam restritas às consultas de compras e à pesquisa/visualização de ordens no Acompanhamento.

## Últimas compras
- A aba **Últimas compras** lê exclusivamente as ordens e entradas já existentes no banco do **Acompanhamento**.
- A planilha usada em **Cotação & Mapas** não alimenta nem substitui esse histórico.
- A consulta considera todos os compradores e não herda comprador, prazo, atendimento, hotel ou outros filtros das telas operacionais. Somente os filtros próprios da aba são aplicados.
- Mantém preço unitário da OC como referência, fornecedor, comprador e notas fiscais/quantidades/unidades das entradas registradas.
- A tela foi compactada para mostrar mais itens sem aumentar o zoom.
- A leitura usa conexão separada somente leitura e cache temporário; não modifica OCs, mapas, filtros ou controles.

## Pesquisa por SCI no Acompanhamento
- O campo de pesquisa do **Controle operacional** e da tela **Pedidos** também aceita o número da SCI.
- Uma SCI é tratada como identificador: a correspondência é exata após normalização, evitando que SCI `123` retorne apenas por ser prefixo de `1234`.
- Se uma mesma SCI gerou mais de uma OC, todas as OCs que continuam dentro dos filtros escolhidos aparecem normalmente.
- Ao expandir uma OC e também no modal completo de detalhes, cada item mostra sua própria SCI.
- A pesquisa anterior por OC, fornecedor, hotel, comprador, observação e descrição permanece inalterada.

## Limites de mudança
- **Sem alteração de schema do banco.**
- **Sem alteração em `electron/whatsapp.js`, sessão, QR Code, navegador oculto ou lógica de envio.**
- Nenhuma mudança nas regras de elegibilidade/anti-spam do follow-up.
- Nenhuma mudança na estrutura dos mapas e cotações.

O pipeline valida testes Python/Node, integração real da consulta de últimas compras em Chromium, patch do WhatsApp, compilação dos três motores, integridade dos binários empacotados, instalador, portátil e hashes SHA-256.

A Release permanece exclusivamente **Draft**. A publicação é manual após a validação final.
