# Validação de últimas compras

Base de comparação: 3.4.10 (`9d3c4e4a51240bb40f4b021039185fb2050541c1`).

## Escopo e procedência dos valores

`backend/purchase_history.py` extrai o histórico durante a leitura já existente da BASE SCI. A regra que define itens elegíveis para mapas continua independente. O snapshot de referência fica em uma chave da tabela settings existente e participa da mesma transação do catálogo. As leituras de configurações/importação são pontuais para não carregar todo o histórico ao abrir outras telas.

OCs são agrupadas por empresa, número e fornecedor; linhas preservam a SCI/item e são agrupadas por identidade do artigo e unidade. O código do artigo, quando presente, é a identidade principal. Sem código usa-se descrição normalizada exata, sem inventar equivalências de itens. A unidade da SCI, usada quando o export não contém unidade da OC, recebe identificação distinta. Não há conversão de unidades nem médias de preços entre linhas/hotéis.

Os campos conhecidos de OC são `VALORUNITARIOITEMOC` e `VALORTOTALITEMOC`. Valores de entrada somente usam colunas explicitamente identificadas como entrada/recebimento (por exemplo, `VALORUNITARIOITEMENTRADA`/`VALORTOTALITEMENTRADA`). Um export sem esses campos continua útil para preços de OC e recebimentos; o preço de entrada fica ausente. Não foi disponibilizada uma planilha real atual do usuário nesta tarefa; o suporte aos valores adicionais foi validado com fixtures sintéticas e nomes de coluna explícitos. Cabeçalhos não reconhecidos precisam ser conferidos na fonte antes de afirmar cobertura.

Um preço calculado usa exclusivamente total e quantidade da mesma origem e recebe `total_div_quantity`. Ausência, números inválidos e divergências não viram zero. Entradas de uma linha são deduplicadas por ID de entrada, quando disponível; sem ID usa-se data/NF/quantidade/unidade. Duas entradas indistinguíveis sem ID no export não podem ser separadas com certeza. A consulta não envia mensagens, salva mapas ou modifica controles.

O merge de backups inclui o conteúdo do histórico na assinatura da importação e copia/apaga a chave com o snapshot escolhido. A ordenação do export não muda o conteúdo canônico do histórico. O schema permanece 1 e os backups prévios e SQLCipher continuam ativos.

## Verificações

- 208 testes Python, incluindo novos cenários de histórico, XLS/XLSX reais, unidades, parciais/duplicatas, identidade de item, zero, ausências, conflitos, ordem cronológica, filtros, paginação, reimportação, rollback, persistência criptografada e merge de backup.
- 195 testes Node e 6 verificações de ordenação.
- 9 verificações de interface do histórico com renderer/preload/IPC/allowlist/HTTP reais, dados temporários e export sintético com 14 mil linhas.
- Regressões do visualizador detalhado (9 verificações), busca geral (7) e inclusão/remoção de itens.
- Conferência visual em Chromium por capturas da consulta ampla e da tela menor.
- Comparação de código e dependências com a base: arquivos de WhatsApp/sessão/launcher/preload inalterados; main recebe somente a rota GET e os motores não relacionados recebem somente identificação de versão.

O workflow `validate-v3.4.11-purchase-history.yml` repete os testes e integrações no Windows, compila e confere os três motores, SQLCipher, instalador, integridade do WhatsApp, conteúdo integral do portátil e hashes dos anexos. Cria somente Draft após os gates. As evidências de interface são anexadas ao run.

Os testes usam dados sintéticos e bloqueiam envio real por WhatsApp. A aprovação desses testes não representa uso real na instalação ou na planilha do usuário.
