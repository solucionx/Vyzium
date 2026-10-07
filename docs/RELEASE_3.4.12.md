# Vyzium 3.4.12

Histórico de compras com **preço unitário da OC**, fornecedor e notas fiscais das entradas (data, quantidade e unidade). A NF exibida é o número importado na BASE SCI.

- Busca consolida todas as compras do mesmo artigo/unidade, mesmo quando a descrição mudou.
- Importações sem linhas são rejeitadas e preservam a base anterior. Bases completas sem itens pendentes continuam aceitas.
- Divergências nos campos de entradas são exibidas para conferência.
- Nome do fornecedor usa as alternativas compatíveis da própria linha, preservando a identificação nativa.
- Consultas reutilizam um cache temporário, com execução serializada, invalidação após mudança da base e liberação após 60 segundos de inatividade.
- Visualizador detalhado dos mapas preservado.

Instalador Windows, portátil, código-fonte, metadados de atualização e SHA256SUMS. Release exclusivamente Draft, aguardando publicação manual.

A conexão/sessão do WhatsApp, Firebase, criptografia e merge de backup não recebem alterações funcionais nesta versão. Testes automatizados não substituem a validação de QR, envio, restauração e instalação no notebook de uso.
