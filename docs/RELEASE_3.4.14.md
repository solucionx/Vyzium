# Vyzium 3.4.14 — Hotfix de produção

Base obrigatória: **Vyzium 3.4.13 publicada**, commit `78a83e9ea5800a0a024ed80fc238eaae13bc28ee`.

## Correção

Corrige a falha da aba **Cotação & Mapas → Últimas compras** que podia exibir:

`RangeError: Maximum call stack size exceeded`

A causa era um redirecionamento recursivo na ponte Electron: ao encaminhar `/purchase-history` para o motor do Acompanhamento, a função de baixo nível voltava a encaminhar a mesma rota indefinidamente.

A 3.4.14 move esse redirecionamento para a fronteira IPC, onde ele acontece **uma única vez** quando a tela de Compras solicita o histórico. O motor do Acompanhamento recebe então a requisição normalmente.

## Escopo

- Nenhuma alteração de schema ou migração de banco.
- Nenhuma alteração em sessão, QR Code, navegador oculto ou envio do WhatsApp.
- Nenhuma alteração nas regras de follow-up, anti-spam, mapas ou cotações.
- Mantém o histórico vindo exclusivamente da base operacional de OCs do Acompanhamento.
- Mantém a pesquisa por SCI e a exibição da SCI por item introduzidas na 3.4.13.

## Regressão adicionada

O teste de integração chama `/purchase-history` diretamente pelo IPC com o módulo Compras ativo e exige:
- exatamente **uma** requisição ao motor;
- destino **followup/Acompanhamento**;
- retorno válido antes da renderização da tela.

Também existe um teste estrutural que impede que `requestEngine()` volte a redirecionar `/purchase-history` para si próprio.

A Release permanece **Draft** até publicação manual.
