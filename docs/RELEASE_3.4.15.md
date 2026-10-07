# Vyzium 3.4.15 — Hotfix de produção e auditoria reforçada

Base obrigatória: **Vyzium 3.4.14 publicada**, commit `a2c36e1565d23926bbd841d5820c2338e499a6c3`.

## Correção principal

Corrige definitivamente a falha da aba **Cotação & Mapas → Últimas compras**:

`RangeError: Maximum call stack size exceeded`

Na 3.4.14 o redirecionamento ainda permanecia dentro de `requestEngine()` e dependia de `activeModule`. Como a tela continuava em Compras mesmo quando o motor solicitado passava a ser Follow-up, a função voltava a chamar a si própria.

Na 3.4.15:
- `requestEngine()` não contém mais qualquer lógica de redirecionamento de `/purchase-history`;
- o redirecionamento ocorre uma única vez em `apiRequest()`, na fronteira IPC;
- a rota é somente GET/read-only;
- o motor de Compras não possui `/purchase-history` na allowlist;
- o motor Follow-up é o único destino autorizado.

Isso elimina a recursão por construção, em vez de depender apenas de uma condição.

## Falha de QA identificada e corrigida

A 3.4.14 teve um falso positivo de integração. O fixture Python de Últimas compras continha um `\n` literal dentro de uma lista, causando `SyntaxError`. O processo encerrava antes da prontidão; o teste Node ficava aguardando uma Promise sem handles ativos e terminava com código 0.

Na 3.4.15:
- o fixture Python foi corrigido;
- o teste falha explicitamente se o backend encerrar antes de ficar pronto;
- existe timeout de prontidão;
- stderr do backend é incorporado ao erro;
- o pipeline executa `python -m compileall` em backend e fixtures antes dos testes de interface.

## Auditoria de importação operacional

Foram adicionados testes de produção para provar:
- arquivo inválido não substitui OCs, recebimentos, import_batches nem histórico;
- redução anormal abaixo de 50% da base anterior é rejeitada sem alteração;
- falha forçada durante a transação, depois de DELETE/INSERT, restaura integralmente OCs, recebimentos e batch por rollback;
- `last_workbook_path` só permanece apontando para importação efetivamente aceita;
- uma importação válida fica imediatamente visível em Últimas compras;
- Últimas compras continua independente de comprador/filtros operacionais e usa somente o banco do Acompanhamento.

## Escopo preservado

- Sem mudança de schema.
- Sem mudança em `electron/whatsapp.js` ou `electron/whatsapp-hidden-browser.ps1`.
- Sem mudança em QR Code, sessão, envio, anti-spam, mapas ou regras de cotação.
- Mantém pesquisa por SCI e SCI por item.
- Mantém a 3.4.14 como base; somente hotfix de roteamento, testes, versionamento e documentação.

A release deve permanecer **Draft** até validação manual.
