# Análise da base diária e dos arquivos de origem

Data da validação: 16/09/2026.

## BASE SCI.xlsx — fonte diária

A nova base possui uma aba `Query`, 55 colunas e 55.608 linhas de dados. Ela é uma exportação plana: não contém fórmulas, tabelas estruturadas, conexões ou macros. O arquivo declara internamente a dimensão como `A1`, embora contenha 55 colunas; leitores que confiam nessa marcação enxergam apenas a primeira coluna. O importador corrige essa dimensão antes de procurar o cabeçalho.

Essa correção possui um teste de regressão próprio. A importação também foi executada integralmente contra a `BASE SCI.xlsx` e o arquivo antigo `.xlsm`. Caso outro arquivo sem as colunas necessárias seja selecionado, o aplicativo informa os cabeçalhos esperados em português e mantém o último retrato válido no banco.

Na validação realizada em 16/09/2026, o motor encontrou:

- 50.772 itens de OC consolidados;
- 44.958 registros distintos de recebimento/nota fiscal;
- 381 linhas exatamente duplicadas removidas;
- 3.884 linhas sem OC, mantidas fora do painel de pedidos;
- 16.173 números de OC distintos na base completa.

A chave operacional usada para um item é `IDITEMDASCI + IDORDEMDECOMPRA + FKFORNECEDOR`. Isso evita misturar o mesmo item de SCI quando ele é dividido entre fornecedores ou ordens diferentes. Na ausência desses IDs em uma planilha antiga, o motor usa SCI, código e descrição como chave de compatibilidade.

Os códigos confirmados na própria base são:

| Código do item | Significado | Tratamento |
| --- | --- | --- |
| 0 | Solicitado | Em aberto |
| 1 | Recebido parcialmente | Em aberto |
| 2 | Recebido totalmente | Concluído |
| 3 | Cancelado | Concluído sem follow-up |

Para follow-up, somente o status BPM `3 - Integrado e Aprovado` é elegível. Os estados integrado, reprovado e cancelado continuam disponíveis para consulta, mas não geram cobrança.

Com o filtro padrão `DOUGLAS TORQUATO`, o retrato validado contém 767 OCs/fornecedores para consulta, das quais 84 estão abertas. Destas, 17 estão em atraso crítico, 4 atrasadas, 8 próximas do prazo e 55 programadas. As regras de aprovação e prazo resultaram em 37 itens de 28 OCs, agrupados em 18 fornecedores potenciais para follow-up. Nenhuma mensagem fica liberada até o telefone do fornecedor ser confirmado.

## Planilha de acompanhamento antiga

O arquivo `Acompanhamento de Pedidos (Douglas).xlsm` contém três abas:

- `ACOMPANHAMENTO DE OC`: consulta manual de uma OC, com 17 colunas;
- `ACOMPANHAMENTO DE SCI - OC`: base principal, com 54 colunas e 14.258 linhas físicas;
- `Resumo`: tabela dinâmica por comprador e empresa.

Esse arquivo continua compatível para consulta, mas deixou de ser a fonte recomendada. O motor identificou automaticamente a base principal e mapeou os campos pelos nomes, sem depender de letras de coluna.

No teste realizado em 16/09/2026:

- 1.143 itens foram classificados como concluídos ou cancelados;
- 192 itens foram classificados como atraso crítico;
- 240 fornecedores distintos foram encontrados;
- nenhum desses fornecedores tinha telefone na planilha.

Como as previsões existentes são de 2025, os itens ainda abertos aparecem como atraso crítico na data do teste. Ao importar uma exportação atualizada, o painel recalcula as classificações usando a data do computador.

## GestorComprasPro

Foram reaproveitadas as ideias mais úteis do projeto anterior:

- banco SQLite para histórico;
- separação entre configuração, processamento e envio;
- agrupamento antes do disparo;
- modo simulação;
- integração com `pywhatkit` e WhatsApp Web;
- prevenção de reenvio duplicado.

O cadastro de telefones antigo não foi associado automaticamente às razões sociais da planilha. Muitos registros antigos são nomes de contatos ou lojas abreviadas, e uma associação aproximada poderia enviar uma cobrança para a pessoa errada. O novo app cria o cadastro a partir das razões sociais reais e exige que o telefone seja confirmado uma vez.

## Regras e proteções aplicadas

- uma linha representa um item, não necessariamente um pedido completo;
- itens com a mesma OC são consolidados;
- OCs do mesmo fornecedor são agrupadas em uma única mensagem;
- recebimento parcial continua no follow-up;
- recebimento total, entrega ou cancelamento encerra o follow-up;
- o mesmo item só pode ser cobrado de novo após o intervalo configurado, exceto quando muda de nível de urgência;
- cada nova importação substitui o retrato anterior dos pedidos, mas preserva fornecedores e histórico.
- a substituição é transacional: se a leitura falhar, a base anterior é preservada;
- depois de uma base com pelo menos 100 itens, uma importação com queda superior a 50% é recusada para evitar apagar o painel por causa de um arquivo incompleto;
- importações simultâneas são serializadas;
- simulações são registradas, mas não acionam o intervalo anti-spam de um envio real;
- situação e observação manuais são armazenadas fora do retrato importado e sobrevivem às atualizações diárias;
- cada alteração manual registra data, situação e texto no histórico da OC;
- o telefone é cadastrado uma única vez pela chave estável do fornecedor e aparece em todas as OCs relacionadas;
- a situação de atendimento é consolidada a partir dos itens: pendente, atendida parcialmente, atendida ou cancelada;
- a grade de OCs abre os itens na própria linha, sem perder os filtros ou sair da tela de acompanhamento;
- a execução diária relê a última planilha importada e dispara somente itens elegíveis, desde que o app esteja aberto e fora do modo simulação.

## Limite do envio gratuito

O envio com `pywhatkit` automatiza o WhatsApp Web e depende de Chrome aberto, sessão autenticada e estabilidade da interface. Para um processo corporativo sem interação com a tela, a evolução adequada é a API oficial do WhatsApp Business.
