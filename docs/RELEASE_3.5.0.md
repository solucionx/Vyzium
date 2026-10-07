# Vyzium 3.5.0 — versão estável consolidada

Esta versão parte diretamente do commit aprovado da **3.4.16** e consolida a linha anterior em uma release 3.5 estável, mantendo o comportamento já validado e corrigindo a última ambiguidade encontrada no visualizador detalhado.

## Correção final

- o rodapé da planilha informa explicitamente **Totais do mapa completo**;
- a interface informa que esses totais não mudam quando busca, hotel ou situação filtram as linhas visíveis;
- o teste de integração verifica de fato essa indicação para impedir regressão futura;
- o fallback visual de versão foi sincronizado com a versão real do aplicativo, evitando exibição de número antigo caso a consulta da versão não responda.

## Preservação de estabilidade

Não foram alterados:
- backend de Compras ou Acompanhamento;
- regras de cálculo, seleção de fornecedor ou economia;
- importação da BASE SCI;
- histórico e fonte das Últimas compras;
- WhatsApp e seu ciclo de sessão;
- SQLCipher, backup, restauração ou sincronização;
- autenticação, Firebase ou permissões;
- fluxo de inclusão, remoção, conclusão ou envio dos mapas.

A 3.5.0 usa como base o commit 26694d8be99670e937f7edd901ffefae086eda23, cujo pipeline da 3.4.16 foi aprovado integralmente.

## Publicação

A release deve ser criada apenas como **Draft** em solucionx/Vyzium-Releases. A publicação continua exclusivamente manual.
