# Vyzium 3.4.4 — Progresso dos mapas ativos

Esta candidata parte exatamente da Vyzium **3.4.3 publicada**, commit:

`c523ce2d27a927be516be805d5ea55bd1cd317d8`

## Única atualização funcional

Na tela **Mapas ativos**, cada mapa em cotação passa a exibir, imediatamente antes do botão **Abrir mapa**, um indicador circular com:

- percentual de conclusão;
- texto `definido`.

A regra reutiliza exatamente o mesmo conceito já exibido dentro do mapa aberto:

`itens definidos = total de itens - itens sem cotação - empates pendentes`

Exemplos:

- 0 de 4 definidos → 0%;
- 1 de 3 definidos → 33%;
- 2 de 3 definidos → 67%;
- 4 de 4 definidos → 100%.

## Persistência

Nenhum campo novo é criado no banco.

- não existe migração;
- nenhum mapa antigo é regravado;
- nenhum percentual é persistido;
- o percentual é calculado somente ao montar o resumo da biblioteca de mapas;
- mapas concluídos continuam funcionando como antes e não recebem o indicador novo na listagem.

## Núcleo preservado

A candidata não altera em relação à 3.4.3 publicada:

- `electron/main.js`;
- `electron/whatsapp.js`;
- `electron/preload.js`;
- WhatsApp/QR/sessão/Chromium/reconexão;
- backup/restauração/merge;
- Firebase/autenticação;
- SQLCipher/segurança;
- updater;
- regras Firestore;
- importação;
- regras de cotação, saving, escolha de fornecedor e conclusão do mapa.

## Publicação

A v3.4.4 deve ser criada somente como **Draft**, aguardando validação e publicação manual.
