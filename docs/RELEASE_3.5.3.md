# Vyzium 3.5.3 — Status das cotações nos mapas ativos

Os cartões de Mapas ativos exibem o estado do envio e a quantidade de fornecedores com envio confirmado:
- Cotações aguardando envio;
- Cotações parcialmente enviadas;
- Cotações enviadas;
- Cotações em envio;
- Envio sem confirmação;
- Falha no envio das cotações.

A informação vem do histórico de mensagens do Vyzium. Envio confirmado não significa que o fornecedor leu ou respondeu. Mensagens enviadas por fora do aplicativo não podem ser detectadas automaticamente.

O cálculo considera os fornecedores atuais e o fingerprint da solicitação atual. Alterar apenas os preços recebidos não invalida o envio; mudar itens, observações, destinatário ou texto gerado exige envio correspondente. Negociações não contam como solicitação inicial de cotação. Envios antigos continuam reconhecidos se houver registro compatível. Sem histórico, o aplicativo não presume envio.

Mudança somente de leitura: sem schema novo ou alteração nos bancos existentes, mapas, histórico de mensagens ou regras de envio. Indicador separado da porcentagem de itens definidos e do estado Concluído/Em cotação.

Testes cobrem confirmação parcial/completa, falha, incerteza, envio em andamento, mensagens legadas, revisão manual, fornecedores novos, alterações de conteúdo, preços e persistência original. O workflow Windows verifica também a renderização dos cartões e prepara somente Draft.
