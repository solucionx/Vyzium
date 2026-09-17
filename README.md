# Vyzium — v1.2.9

Para publicar o instalador e as atualizações no GitHub, siga [PUBLICAR_NO_GITHUB.md](PUBLICAR_NO_GITHUB.md).

## v1.2.9

Esta versão foi criada a partir da 1.2.4 sem alterar a ordem das abas, o zoom inicial, a ordem das colunas/telas ou o desenho dos filtros já existentes. As correções são internas e de confiabilidade, com duas melhorias funcionais já previstas: os filtros de **Pedidos** e **Controle operacional** passam a compartilhar a mesma persistência local, e os cards do Dashboard passam a filtrar a lista exibida sem mudar de aba.

Principais correções:

- lote manual com `supplier_keys: []` agora é recusado por segurança, em vez de poder significar “todos”;
- a chave real do fornecedor é preservada ao salvar telefone/contato, incluindo CNPJ/CPF com pontuação;
- cadastros duplicados gerados por versões anteriores são reconciliados automaticamente quando houver correspondência inequívoca;
- status BPM recusado/pendente por texto também bloqueia follow-up quando o código numérico não vier preenchido;
- recebimento parcial usa quantidade recebida e saldo para não ser encerrado só porque existe uma data de entrada;
- uma falha comprovadamente anterior ao envio de um fornecedor não interrompe os demais do lote; estado **incerto** continua interrompendo por segurança;
- execução automática não marca o dia como concluído quando houve falha/incerteza e usa intervalo de uma hora antes de nova tentativa;
- a sessão do WhatsApp não é mais reiniciada só por ter ficado aberta por alguns minutos: o app verifica o estado real da conexão e só reconecta se a sessão estiver de fato indisponível;
- respostas antigas da tela **Pedidos** não conseguem mais sobrescrever uma consulta mais nova quando filtros são alterados rapidamente;
- o texto “Mais de 10 dias” do Dashboard agora acompanha a configuração real de atraso crítico;
- histórico técnico local foi adicionado e limitado; o histórico de cobranças também recebeu retenção ampla para evitar crescimento indefinido;
- versões diretas de Electron e electron-builder foram fixadas exatamente no `package.json` para reduzir variações entre instalações.

Validação desta entrega: testes Python, testes Node do fluxo WhatsApp, verificações de ordenação e checagem de sintaxe. Nenhuma conta real de WhatsApp foi utilizada no ambiente de desenvolvimento.

## Hotfix 1.2.1 — envio real do WhatsApp com confirmação

Esta versão corrige o falso positivo em que `whatsapp-web.js` podia retornar um ID de mensagem e o aplicativo registrava **Enviada ao WhatsApp**, mesmo sem o servidor do WhatsApp confirmar o envio. O problema é conhecido na linha 1.34.7 da biblioteca.

O fluxo agora:

1. verifica a saúde real da sessão antes do lote e só reconecta quando a conexão não está ativa;
2. usa `waitUntilMsgSent` com limite de tempo;
3. acompanha o evento `message_ack`;
4. só registra **Confirmada pelo servidor do WhatsApp** após ACK `>= 1`;
5. se não houver ACK em até 45 segundos, registra **Conferência necessária**, encerra a conexão suspeita e exige reconexão antes de nova tentativa;
6. deixou de fixar um cache próprio de versão do WhatsApp Web, reduzindo incompatibilidades com builds antigas.

Para testar, prefira primeiro o seu próprio número ou um contato de teste. O aviso `DEP0040` sobre `punycode` é apenas uma advertência de dependência do Node/Electron e não é a causa da falha de envio.

## Atualização 1.2 — WhatsApp integrado

1. Mantenha Microsoft Edge ou Google Chrome instalado no computador.
2. Na pasta do projeto, execute `npm install` para instalar as novas dependências e
   `npm start` para iniciar (ou use `scripts/start-dev.ps1`). Para gerar o EXE,
   execute `scripts/build-app.ps1` no Windows.
3. Abra **Configurações → WhatsApp → Conectar / reconectar**. Escaneie o QR Code
   usando **WhatsApp no celular → Aparelhos conectados → Conectar aparelho**.
4. Aguarde **Conectado**. A sessão fica no diretório de dados do aplicativo,
   em `whatsapp-session`, e é reutilizada após reiniciar. Ela é própria da Vyzium:
   a conexão antiga do navegador pessoal precisa ser vinculada uma vez ao app.
5. Em **Mensagens**, revise a prévia, os fornecedores selecionados e o modo simulação.
   No envio real, o lote aguarda até dois minutos pela conexão; o QR também aparece
   nesta tela. Se o prazo terminar, nenhuma mensagem é disparada por essa espera:
   conecte e solicite novamente o envio.

O navegador trabalha sem janela visível. Não é necessário deixar uma aba aberta
nem evitar o teclado/mouse. O aplicativo deve continuar aberto e o computador
ligado, sem suspensão e com internet. Um logout no celular, expiração ou revogação
da sessão pelo WhatsApp exige novo QR. **Pausar conexão** cancela a espera por login
e fecha a conexão preservando os dados. Para trocar de conta, revogue a Vyzium
em Aparelhos conectados no celular e reconecte no app.

"Confirmada pelo servidor do WhatsApp" significa que a biblioteca retornou a mensagem e o WhatsApp emitiu ACK de servidor (`ACK >= 1`). Ainda não é confirmação de leitura e pode não significar entrega ao aparelho quando o destinatário está offline. Em caso de resposta
incerta, o lote para e a ordem fica bloqueada para reenvio automático. Confira a
conversa e use **Histórico → Conferi: liberar reenvio** somente se a mensagem não
foi enviada. Fechar o app encerra os lotes; não há retomada silenciosa de um lote manual.

Sessão, QR e credenciais não são incluídos neste ZIP, nem gravados nos logs.
Não compartilhe a pasta `whatsapp-session` em backups públicos. A integração é
não oficial e pode quebrar com mudanças do WhatsApp Web ou ter a conta bloqueada.
Não há garantia de sessão permanente. Referência: [LocalAuth e persistência](https://wwebjs.dev/guide/creating-your-bot/authentication.html).

Verificação desta entrega: testes locais com cliente WhatsApp simulado; não houve
conexão de uma conta real, envio a fornecedores ou validação do EXE no Windows.
Execute `node --test tests/whatsapp.cjs` e os testes Python antes de compilar.

## Ajuste visual 1.1.1

Zoom inicial de 89%, menu padrão do Electron removido e margens externas superiores
e laterais do Controle operacional eliminadas. O painel ocupa a área disponível
abaixo do cabeçalho, preservando o espaçamento interno dos controles e a identidade visual.
Reinicie o aplicativo após atualizar os arquivos. Para usar no executável, recompile.

## Atualização 1.1 — Controle operacional

A tela inicial agora é **Controle operacional**, com Prazo, Hotel, OC, Fornecedor,
Controle / observação, Previsão, Atendimento, Aprovação e Próxima ação.

- Clique no título de qualquer coluna para ordenar; clique novamente para inverter.
  Previsão usa a data real, OC usa ordenação natural numérica e Hotel usa ordem alfabética.
  Datas vazias permanecem no final. Filtros e ordenação desta tela são lembrados localmente.
- Clique em “Sem marcação” ou na bolha existente, escolha uma recomendação, escreva uma
  observação e clique em **Salvar controle**. As sugestões de ação são recalculadas.
- Em **Configurações → Recomendações de controle**, adicione, edite, recolora ou remova
  sugestões. Remover oculta a sugestão para novas seleções, preservando marcações existentes.
  A regra da próxima ação é independente do nome, permitindo renomear sem perder a lógica.
- A aprovação vem de STATUSBPMOC / NMSTATUSBPMOC: aprovado (3), recusado (4) ou texto
  explícito de espera. Valores ausentes ou não reconhecidos aparecem como **Não informada**,
  nunca como uma aprovação presumida. Em uma OC com estados diferentes, recusa e espera
  têm prioridade sobre aprovação.
- “Próxima ação” é orientação: não envia mensagens, não aprova e não cancela ordens.
  Atendimento concluído/cancelado encerra a sugestão; cancelamento solicitado, recusa e
  aprovação pendente têm prioridade sobre cobrança de entrega.

A paleta, logotipos e ícones Vyzium foram preservados. Esta entrega contém o código-fonte;
use o processo de compilação abaixo para gerar o executável no Windows.

Testes: `python -m unittest discover -s backend -p "test_*.py" -v` e `node tests/sort.cjs`.

Aplicativo desktop para acompanhamento de ordens de compra, controle operacional e follow-up com fornecedores. A interface utiliza a identidade visual oficial da Vyzium, com azul profundo, ciano e turquesa.

Aplicativo desktop para transformar a exportação diária `BASE SCI.xlsx` em um painel operacional de ordens de compra e cobrar fornecedores pelo WhatsApp quando a entrega estiver perto do prazo ou atrasada.

## Como funciona na prática

Você não precisa cadastrar uma OC manualmente. Ao importar a base diária, o motor:

1. lê a aba `Query` e encontra as colunas pelo nome;
2. remove linhas exatamente duplicadas;
3. consolida cada item pela combinação `IDITEMDASCI + IDORDEMDECOMPRA + FKFORNECEDOR`;
4. associa notas e entradas de mercadoria ao item;
5. substitui o retrato anterior dos pedidos em uma transação segura;
6. preserva o cadastro de telefones e o histórico de follow-ups;
7. recalcula prazos e separa pedidos em aberto, programados, próximos, atrasados e concluídos.

Na tela **Pedidos**, a visualização inicial mostra somente OCs em aberto. O filtro permite consultar também todo o histórico de concluídos e cancelados. Ao abrir uma OC, o app mostra os itens, quantidade pedida, recebida, saldo, previsão, valor e notas fiscais registradas.

### Controle manual da OC

O campo de controle é independente dos status vindos do ERP. As opções são:

- sem marcação;
- pedido enviado;
- aguardando pagamento no cartão;
- aguardando retorno do fornecedor;
- entrega programada;
- pendência.

Além da situação, cada OC possui uma observação livre. Ao marcar `Pedido enviado`, o app registra automaticamente a data e a hora. Cada alteração entra em um histórico. Esses dados ficam no banco local e não são apagados quando uma nova `BASE SCI.xlsx` substitui o retrato diário dos pedidos.

## O que a versão 0.5 faz

- importa `.xlsx` e `.xlsm` sem executar macros;
- encontra a aba e as colunas pelos nomes, sem depender de letras fixas;
- apresenta uma linha por OC e fornecedor, com detalhamento dos itens;
- mostra quantidade pedida, recebida, saldo, prazo, valor e entradas/NFs;
- permite filtrar por comprador, empresa, situação e texto livre;
- mantém um controle manual por OC com situação, observação, data de envio e histórico de alterações;
- usa uma interface operacional inspirada na planilha: tabela central, cabeçalho marrom, situações coloridas e visão compacta;
- corrige automaticamente arquivos do Excel cuja dimensão interna informa apenas `A1`, como ocorre na `BASE SCI.xlsx` recebida;
- mostra erros de importação em português e preserva o último retrato válido quando o arquivo selecionado estiver incompleto;
- apresenta a grade principal nas colunas Hotel, Ordem, Fornecedor, Observação, Data prevista, Atendimento e WhatsApp;
- consolida o atendimento da OC em pendente, atendida parcialmente, atendida ou cancelada;
- expande os itens da ordem logo abaixo da linha clicada, com quantidades, saldo, previsão e notas fiscais;
- permite cadastrar ou corrigir o WhatsApp diretamente na linha; o número fica associado ao fornecedor e é reutilizado em todas as suas ordens;
- agrupa várias OCs em uma mensagem por fornecedor;
- classifica itens em programado, próximo do prazo, atrasado, atraso crítico e concluído;
- mantém OCs recusadas visíveis para consulta, mas fora do follow-up;
- cria automaticamente o cadastro de fornecedores encontrados;
- guarda histórico em SQLite e aplica intervalo anti-spam;
- oferece modo simulação e envio real pelo WhatsApp Web com sessão própria e QR no app;
- pode reler a última planilha e executar o lote diariamente no horário configurado;
- mantém o motor restrito ao computador local e autenticado pelo Electron.

## Estrutura

```text
electron/   processo principal e ponte segura com a interface
renderer/   telas HTML, CSS e JavaScript
backend/    motor Python, importação, regras, SQLite e WhatsApp
scripts/    inicialização e empacotamento no Windows
```

## Rodar no Windows para desenvolvimento

Instale Python 3.11 ou 3.12, Node.js LTS e Google Chrome. No PowerShell, dentro da pasta do projeto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\start-dev.ps1
```

O script cria o ambiente Python, instala as dependências, instala o Electron e abre o aplicativo.

## Primeiro uso

1. Mantenha o modo **Simulação** ativo.
2. Clique em **Importar planilha** e selecione a `BASE SCI.xlsx` atualizada.
3. Confira as OCs e os itens na tela **Pedidos**.
4. Abra **Fornecedores** e complete o nome do contato e o WhatsApp.
5. Confira **Mensagens** e execute uma simulação.
6. Verifique o histórico.
7. Em **Configurações**, desative a simulação somente quando a prévia estiver correta.
8. Se quiser operação diária, escolha o horário e ative o envio automático.

No envio real, o computador deve ficar ligado, Edge ou Chrome deve estar instalado e o WhatsApp integrado precisa estar conectado. O envio funciona em segundo plano.

Na execução automática, o aplicativo precisa permanecer aberto e o computador ligado, sem suspensão. Antes do horário configurado, mantenha a planilha importada salva no mesmo caminho; o motor relê esse arquivo para usar os dados mais recentes.

Os dados locais ficam na pasta de dados do aplicativo criada pelo Electron. A planilha original não é copiada para o projeto; somente os campos necessários são gravados no SQLite.

## Gerar executáveis

No PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\build-app.ps1
```

O script gera primeiro `dist-engine\followup-engine.exe` e depois cria o instalador e a versão portátil do Electron na pasta `dist`.

## Regras padrão

- próximo do prazo: faltam de 0 a 3 dias;
- atrasado: venceu há até 10 dias;
- atraso crítico: venceu há mais de 10 dias;
- concluído: o status informa recebimento total, entrega ou cancelamento; recebimento parcial continua no acompanhamento;
- uma OC só entra no follow-up quando o BPM está `3 - Integrado e Aprovado` (quando esse campo existe);
- uma OC recusada ou cancelada permanece pesquisável, mas nunca é cobrada;
- reenvio: permitido após 72 horas ou imediatamente quando a urgência muda.

O status oficial da base prevalece sobre o saldo calculado. Assim, um item marcado como parcial continua aberto mesmo que a soma das entradas pareça cobrir a quantidade pedida; o detalhe da OC sinaliza inconsistências desse tipo para conferência.

Esses valores podem ser alterados na tela **Configurações**.

A análise técnica dos dois arquivos recebidos está em `docs/ANALISE_DOS_ARQUIVOS.md`.

## Limitação importante do WhatsApp Web

A integração com whatsapp-web.js automatiza o WhatsApp Web e não é oficial. Mudanças do serviço, bloqueios ou revogação da sessão podem impedir o envio. A API oficial do WhatsApp Business é uma alternativa para uma integração suportada pelo provedor.

### v1.2.3 — edição manual da mensagem antes do envio
Na tela **Mensagens**, cada fornecedor agora possui um campo de texto editável. O conteúdo exibido é exatamente o conteúdo enviado naquele lote. É possível restaurar o texto automático antes do disparo. A edição manual é validada pelo backend, registrada no histórico e vale somente para o lote atual; o modelo automático permanece preservado.
