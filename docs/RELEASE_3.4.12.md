# Vyzium 3.4.12 — Candidata de produção

Base: Vyzium 3.4.11 auditado, commit `f898ef06bfeb518a97ba662aec1a0d3464712dd5`.

Esta versão mantém a visualização detalhada dos mapas e a aba **Últimas compras**, com correções específicas encontradas na auditoria da 3.4.11. O objetivo é aumentar a confiabilidade sem reabrir componentes estáveis fora do escopo.

- A pesquisa por descrição agora identifica primeiro o artigo e, depois, calcula a última OC e a quantidade de OCs usando todo o histórico daquele artigo. O cartão e o detalhe passam a usar a mesma referência.
- Importações com cabeçalhos reconhecidos, mas sem nenhuma linha de dados válida, são rejeitadas antes da substituição do catálogo e do histórico. A base anterior é preservada.
- Conflitos de recebimento são mostrados explicitamente na interface. Divergência de unidade impede apresentar um preço por unidade como referência inequívoca.
- O nome do fornecedor pode usar outra coluna equivalente do próprio fornecedor quando a coluna preferencial estiver vazia naquela linha.
- O histórico importado é mantido em cache dentro do motor e as varreduras pesadas são serializadas, reduzindo desserializações simultâneas do snapshot completo durante digitação rápida.
- A referência principal para decisão continua sendo o **valor unitário da OC**. Data, quantidade e **nota fiscal da entrada** vêm dos registros de recebimento. Preço de entrada só é exibido quando a planilha possui um campo explícito correspondente.
- Nenhum campo de valor da OC é convertido silenciosamente em valor de entrada.

Não há alteração intencional na lógica de sessão, QR Code, navegador oculto ou envio do WhatsApp. Também não há mudança de schema do banco.

A publicação continua protegida pelo workflow: testes Python e Node, testes de integração em Chromium, verificação do patch do WhatsApp, compilação dos três motores, verificação dos binários empacotados, geração do instalador e portátil, hashes SHA-256 e criação da release apenas como **Draft**.

Arquivos esperados: `Vyzium-Setup.exe`, `Vyzium-3.4.12-Portable.zip`, `Vyzium-3.4.12-Source.zip`, `latest.yml`, `.blockmap` e `SHA256SUMS.txt`.

**Draft — publicação manual.**
