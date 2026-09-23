# Vyzium 3.2.2 — ajustes pontuais em Cotação & Mapas

Base: pacote completo Vyzium 3.2.1 fornecido para esta revisão.

## Alterações

1. **Remover um item da cotação:** botão `Remover item` na coluna de especificação, em mapas em cotação. A confirmação identifica o item e informa que as demais edições serão salvas junto. Remove apenas o item e seus preços/decisões daquele mapa, recalcula os totais e mantém os fornecedores e os demais itens.
2. **Solicitação agrupada por hotel:** hotel e CNPJ aparecem uma única vez no cabeçalho de cada grupo, seguidos de descrição, quantidade, unidade e observação dos respectivos itens. A numeração dos itens é contínua. SCI e valores de concorrentes continuam fora da mensagem.
3. **Ordem automática por hotel:** a aba de preços, a mensagem e as exportações seguem a mesma sequência de hotéis. Dentro de cada hotel é mantida a ordem relativa dos itens. Aplica-se também aos mapas anteriores; apenas consultar o mapa não grava nem migra seus dados.

O vínculo entre item, preços e escolhas continua sendo o ID original do item. Não há arraste ou ordenação manual nesta revisão: foi adotada a alternativa de ordenação automática por hotel.

## Cuidados na remoção

- O item permanece na BASE SCI e volta a ficar disponível para outro mapa quando ainda for elegível. A importação de origem não é alterada.
- Mensagens já enviadas permanecem no Histórico, com o conteúdo original.
- O salvamento valida as edições dos itens restantes antes de gravar a remoção. Se a validação ou o backup falhar, o mapa salvo permanece intacto e os campos preenchidos continuam na tela.
- Um backup automático do estado já salvo é criado antes da remoção, pela camada de proteção existente; bancos criptografados mantêm backups criptografados.
- Mantidas as verificações de revisão e de mapa concluído. Prévia anterior à remoção não pode ser enviada; é necessário obter a nova prévia.
- Durante a remoção, novos cliques e saída/importação ficam bloqueados até o término.
- Um mapa deve manter ao menos um item. O botão fica desabilitado para o último; para excluir o mapa inteiro permanece disponível `Excluir mapa`.
- Mapas concluídos continuam disponíveis para consulta/exportação, sem remoção individual.

## Escopo preservado

Mudanças funcionais limitadas a `backend/compras_engine.py`, `renderer/compras-app.js` e uma regra de estilo em `renderer/compras.css`.

Não foram alterados estrutura/schema do banco, dependências, autenticação, Firebase, sincronização, sessão/ocultação/envio do WhatsApp, atualizador, instalador, ícones, importação ou regras do Acompanhamento. Todos os arquivos de `electron/` e os recursos visuais originais permanecem idênticos ao pacote recebido.

A numeração geral e os textos de versão passaram de 3.2.1 para 3.2.2, incluindo fallbacks dos motores e da interface, lockfile e teste de configuração. README atualizado e regressões específicas adicionadas em `backend/test_compras_items.py`.

## Validação executada

`npm test` aprovado:

- **132 testes Python**, incluindo 12 novas regressões para remoção, preservação dos demais dados/edições, backup recuperável, SQLCipher, hotel/CNPJ, exportações, revisões e prévias antigas.
- **108 testes Node**, sem falhas ou testes ignorados.
- **6 verificações de ordenação** já existentes.

Verificação adicional da interface com DOM JavaScript (jsdom), scripts reais do renderer, API HTTP real do motor de Compras e dados sintéticos: abertura por hotel com preços corretos; cancelamento; falha de validação sem perda; remoção com edições pendentes e descontos legados; bloqueio de cliques duplicados e navegação durante a operação; prévia agrupada; reabertura persistente; proteção do último item e consulta/exportação de concluídos. Sem erros não tratados no renderer.

Os testes foram executados em Linux, Python 3.12 e Node 24. A verificação criptográfica local usou o runtime `sqlcipher3-binary 0.6.0`; os requisitos de produção foram preservados, inclusive `sqlcipher3==0.6.2`. A validação DOM não substitui a execução visual do aplicativo Windows.

Não foram executados instalador/auto-update no Windows nem envio real a fornecedores. O pacote contém o código-fonte completo, não um novo instalador compilado. Antes de publicar a release `v3.2.2`, executar o workflow Windows Release existente e conferir o aplicativo instalado no Windows, como previsto nos gates da versão base.
