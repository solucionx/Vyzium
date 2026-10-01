# Vyzium 3.3.9 — Operational UI

Candidata de produção preparada a partir do Vyzium 3.3.8.

## Escopo validado

- Home operacional com indicadores obtidos apenas dos endpoints existentes.
- Sidebar em azul Vyzium mais claro.
- Sidebar recolhível no renderer:
  - Home expandida por padrão.
  - Acompanhamento e Cotação & Mapas recolhidos por padrão.
  - Alternância manual sem reload, sem IPC adicional e sem persistência.
- Acesso direto em Compras a:
  - Itens a comprar;
  - Mapas ativos;
  - Concluídos;
  - Fornecedores.
- Diretório de fornecedores em Compras reutiliza o cadastro do Acompanhamento.
- Cadastro/edição de WhatsApp em Compras grava no mesmo fornecedor do Acompanhamento.
- Prazo opcional do mapa de compra:
  - independente do prazo de 12 dias da SCI;
  - Vence hoje;
  - Mapa vencido;
  - data futura;
  - Sem prazo definido;
  - mapa concluído nunca é marcado como vencido.

## Persistência do prazo

Não foi criada tabela nem coluna SQL.

A tabela de mapas já persiste o conteúdo do mapa em JSON no banco SQLCipher. O campo opcional `due_date` foi acrescentado somente ao objeto JSON.

Consequências:

- `DB_SCHEMA_VERSION` permanece 1;
- mapas antigos sem `due_date` continuam válidos;
- nenhum registro antigo é regravado em massa;
- nenhum prazo antigo é inferido;
- o prazo da SCI não é alterado.

## Áreas deliberadamente preservadas

Não houve redesign/refatoração funcional de:

- WhatsApp e whatsapp-web.js;
- Firebase e autenticação;
- segurança/SQLCipher;
- backup local/remoto;
- atualizador;
- importadores;
- regras de elegibilidade de SCI;
- cálculos de preços, saving, negociação e escolha do fornecedor;
- regras de conclusão/exclusão dos mapas.

O único ajuste em `electron/main.js` é a ponte de fornecedores para permitir que Compras consulte e salve o telefone usando o endpoint já existente do Acompanhamento.

## Publicação

Esta candidata deve ser gerada como Draft em `solucionx/Vyzium-Releases`.

A publicação final permanece manual.
