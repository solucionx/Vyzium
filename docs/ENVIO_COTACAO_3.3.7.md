# Vyzium 3.3.7 — Envio de solicitações de cotação

Base: versão completa 3.3.6.

## Mudanças limitadas ao envio de cotação
- Prévia editável por fornecedor. Trocar o fornecedor preserva o rascunho enquanto a janela permanece aberta. Fechar e reabrir a janela recria o texto padrão.
- Remover um item ou observação do texto não altera os itens, preços ou observações do mapa.
- Enviar ao selecionado usa o texto revisado. Enviar para todos usa cada texto revisado e o padrão dos fornecedores não editados.
- O lote é sequencial. Fornecedores sem telefone são identificados e não recebem envio. Mensagens vazias ou excessivas impedem o início do lote.
- A janela permanece aberta com o resultado por fornecedor. Envios já concluídos ou incertos nesta janela não são repetidos pelo botão de lote. Falha de comunicação com a aplicação interrompe o lote e exige conferência do histórico.
- Histórico registra o texto efetivamente enviado. O backend preserva a revisão e a impressão digital da prévia para impedir que apenas editar o texto permita reenviar uma solicitação já enviada ou incerta.

## Validação
156 testes Node, 6 verificações de ordenação e 42 testes Python direcionados aprovados. Novos cenários: textos distintos por fornecedor, texto padrão, envio individual seguido de lote, telefone ausente, mensagem vazia, clique duplo, falha de transporte, histórico do texto editado, integridade do mapa e bloqueio de duplicação após envio incerto. WhatsApp simulado nos testes; nenhuma mensagem real foi enviada. Testes do diálogo usam DOM simulado; instalador Windows e interface visual não foram executados neste ambiente. As limitações anteriores da suíte Python completa permanecem.

Mudanças funcionais: renderer/compras-app.js e backend/compras_engine.py. Testes, documentação e número da versão atualizados. Motor e integração WhatsApp, Acompanhamento, cadastro de contatos, regras de importação e demais funcionalidades permanecem como na 3.3.6.
