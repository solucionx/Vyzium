# Test report — Vyzium 3.1.8 WhatsApp Stable Boot

## Escopo

Validação focada na corrida observada durante a primeira carga do WhatsApp, sem alterar regras de pedidos, filtros, segurança, envio ou persistência já existentes.

## Casos adicionados/fortalecidos

- patch V5 permanece JavaScript válido e idempotente;
- barreira de estabilidade aparece antes da primeira injeção;
- `post_logout=1` nunca conta como documento estável;
- o documento precisa permanecer estável por 4 s;
- a barreira inicial não pode chamar `CacheStorage`, `caches`, `IndexedDB`, `window.require` ou módulos internos do WhatsApp;
- auditoria do host não executa probe ativo de storage;
- watchdog de primeira carga usa 120 s;
- geração de QR, sessão persistente, novo QR, pausa, reconexão e envio continuam cobertos.

## Resultado automatizado

A suíte Node completa da árvore de testes do projeto foi executada após a correção: 90 testes aprovados, 0 falhas, além de 6 verificações de ordenação aprovadas. A validação focada do WhatsApp/patch também passou integralmente.

## Limite do teste automatizado

O evento `client.qr-received` depende do WhatsApp Web real, do Chrome instalado e do Windows do usuário. Portanto, a confirmação final desta falha específica precisa do teste integrado na máquina onde o log foi produzido. A versão auditável foi mantida justamente para que o próximo resultado mostre a transição exata sem inferência.
