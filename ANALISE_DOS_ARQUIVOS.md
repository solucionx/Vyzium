# Compatibilidade das bases e arquivos de origem

Este documento registra apenas as regras técnicas de importação. Dados, nomes, contagens e caminhos provenientes de bases reais não devem ser versionados no repositório.

## BASE SCI — Acompanhamento

O importador de Acompanhamento procura os campos pelo nome do cabeçalho, sem depender de letras fixas de coluna. Exportações do SCI que declaram uma dimensão incorreta no XLSX são corrigidas antes da leitura dos cabeçalhos.

A chave operacional de um item prioriza os identificadores estáveis do item, da ordem de compra e do fornecedor. Quando esses identificadores não existem em uma planilha legada, o importador usa os campos compatíveis previstos pelo motor.

A importação é transacional. Se o arquivo não puder ser validado, não contiver itens de OC ou apresentar uma redução suspeita em relação à base anterior, o retrato válido já armazenado é preservado.

Recebimentos ficam separados dos itens da ordem para permitir distinguir atendimento parcial de atendimento total. Controles manuais, telefones de fornecedores e histórico também ficam fora do retrato diário e sobrevivem às novas importações.

## Planilha legada de acompanhamento

Planilhas `.xlsx` e `.xlsm` compatíveis continuam sendo identificadas pelo conjunto de cabeçalhos reconhecidos. O importador procura a aba e a linha de cabeçalho automaticamente dentro do limite definido no motor.

Não existe comprador fixo no código. O comprador ativo é escolhido pelo usuário nos filtros e reutilizado nos fluxos operacionais e de follow-up.

## BASE SCI — Cotação & Mapas

O módulo de Compras aceita `.xls`, `.xlsx` e `.xlsm`. Arquivos XLS binários são lidos por `xlrd`; arquivos baseados em OOXML são lidos por `openpyxl`. O relatório alternativo de aprovação é adaptado para o mesmo modelo interno usado pela BASE SCI.

Cada importação substitui somente o catálogo atual de itens do módulo de Compras. Mapas já criados permanecem preservados e são comparados com a base atual antes de permitir novo envio de cotação.

## Regras de proteção

- Acompanhamento e Cotação & Mapas mantêm bancos separados.
- Uma falha de leitura não deve apagar a última base válida.
- Linhas exatamente duplicadas são tratadas conforme as regras de cada importador.
- Itens concluídos, cancelados ou inelegíveis não são enviados por follow-up/cotação.
- Alterações manuais e históricos não são regravados pela importação diária.
- Envios incertos nunca são repetidos automaticamente sem revisão.
- A sessão do WhatsApp é local e compartilhada pela infraestrutura do Vyzium, não pelos bancos operacionais.

## WhatsApp

O Vyzium usa `whatsapp-web.js` com sessão local persistente. O processo depende de Edge ou Chrome instalado, sessão autenticada e compatibilidade com o WhatsApp Web. O aplicativo trata falhas antes do envio como falha comprovada e respostas interrompidas depois da submissão como estado incerto, evitando reenvio automático potencialmente duplicado.
