# Vyzium 3.4.3 — Tipografia unificada e refinamento visual

Esta candidata parte exatamente da Vyzium 3.4.2 publicada, correspondente ao commit validado:

`fd8b19ae2471de3f6c978836c3f58862efef87e2`

## Ajustes desta revisão

- tipografia unificada em todas as telas;
- títulos recuperam a leitura visual da linha 3.4;
- números de OC deixam de ficar grandes/pesados;
- nomes de fornecedores no Histórico usam a mesma escala de texto das demais telas;
- nomes de mapas e itens usam a mesma tipografia do restante do Vyzium;
- badges/status do Controle Operacional ficam maiores e mais legíveis sem alterar o zoom;
- botões principais usam o mesmo azul da barra lateral;
- botões continuam com formato mais quadrado;
- "Concluídos" permanece apenas dentro de Mapas ativos, ao lado de Em cotação;
- "Concluídos" foi removido do menu lateral;
- "Verificar atualizações" volta a se comportar como item normal da sidebar, sem container branco;
- a Visão Geral recupera a frase de propósito do Vyzium e mantém o resumo operacional abaixo.

## Escala tipográfica única

A interface passa a trabalhar com níveis fixos:

- título de página: 19 px;
- título de seção: 15 px;
- subtítulo: 12 px;
- texto normal/tabelas: 10 px;
- texto auxiliar: 9 px;
- badges/status: 9 px.

O zoom global não é alterado.

## Núcleo preservado

Nenhuma alteração foi feita desde a 3.4.2 publicada em:

- `electron/whatsapp.js`;
- `electron/main.js`;
- `electron/preload.js`;
- sessão do WhatsApp;
- QR/reconexão;
- Chromium/Edge;
- backup/restauração/merge;
- Firebase/autenticação;
- SQLCipher;
- updater;
- regras Firestore.

## Publicação

A v3.4.3 deve permanecer em Draft até validação manual no PC de produção.
