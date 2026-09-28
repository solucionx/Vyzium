# Vyzium 3.3.6 — Contatos do Acompanhamento nos mapas

Base: 3.3.5, incluindo a recompra de itens com OC cancelada.

Ao clicar em Adicionar fornecedor, pesquise nome, contato ou telefone no cadastro do Acompanhamento. Selecione o resultado desejado para preencher nome e WhatsApp; ambos continuam editáveis. Fornecedores sem telefone podem ser selecionados e ter seu número preenchido manualmente. Também é possível preencher um fornecedor novo sem selecionar resultados.

A consulta lê os fornecedores ativos do usuário atual pelo motor autenticado do Acompanhamento. Não copia bancos, não grava nesse cadastro e não aplica filtros de pedidos. Nome e telefone são copiados para o mapa ao confirmar e persistidos pelo comando Salvar e calcular já existente. Alterar o contato no mapa não altera o cadastro original ou mapas antigos.

Falha de consulta não impede preenchimento manual. Resultados são limitados a 30 por busca, com orientação para refinar. Fornecedores com nomes iguais são selecionados explicitamente, com telefone e contato visíveis.

Validação: 152 testes Node e 6 verificações de ordenação aprovados; 39 testes Python de Compras e OC cancelada aprovados. Cinco testes novos exercitam a função real do diálogo e a rota real de consulta, com DOM e motor simulados (busca com acentos, nomes iguais, edição, falha, telefone vazio, resposta tardia, troca de mapa e acesso restrito). Sintaxe JS validada. Não foi possível executar teste visual com navegador neste ambiente, nem instalador Windows. A suíte Python completa permanece sujeita às limitações de dependências registradas na versão anterior.
