# Vyzium 3.3.5 — Recompra de itens com OC cancelada

Base: projeto completo 3.3.4.

## Regra
No módulo Cotação & Mapas, uma OC preenchida deixa de impedir a importação quando Status do Item da OC é 3 - Cancelado. A base SCI original também aceita o código 3 em NMSTATUSITEMDAORDEMDECOMPRA.
Status ausente, desconhecido ou diferente de cancelado continua bloqueando itens com OC. As regras de status da SCI, aprovação, quantidade e conflitos de identidade permanecem. Uma OC ativa para o mesmo item continua impedindo a recompra.

Após atualizar, reimporte a planilha. Mapas concluídos permanecem no histórico e não bloqueiam uma nova cotação. Itens em mapas ainda ativos mantêm a proteção contra duplicidade; conclua o mapa anterior ou remova o item dele antes de criar outro.

## Validação desta alteração
- Arquivo fornecido: 95 itens únicos; antes 80 elegíveis e 15 excluídos por OC; depois 95 elegíveis.
- Importação e criação de mapa com os 95 itens em banco temporário: aprovadas.
- 39 testes Python de importação/regressão e módulo Compras: aprovados.
- 147 testes Node e 6 verificações de ordenação: aprovados.
- A suíte Python completa não foi repetida: na comparação da base 3.3.4, testes XLS estavam limitados pela falta de xlwt e havia testes pulados por dependências indisponíveis.
- Instalador Windows e WhatsApp real não executados neste ambiente.

A mudança funcional está apenas em backend/compras_engine.py. Inclui testes novos e atualização da identificação de versão. WhatsApp, Acompanhamento (exceto número de versão), interface e telemetria permanecem como na 3.3.4. Não inclui planilhas, bancos ou dados da validação.
