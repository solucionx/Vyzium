# Vyzium 3.1.8 Audit — WhatsApp Stable Boot

## Evidência que motivou a correção

O log real da 3.1.7 mostra que a primeira navegação para `https://web.whatsapp.com/` ocorreu às `16:07:26.295`. Aproximadamente 1,7 s depois, às `16:07:28.006`, o documento já havia sido substituído por `?post_logout=1`.

A 3.1.7 também iniciava um teste ativo de `CacheStorage` 1,6 s depois de cada navegação. O primeiro teste foi executado justamente durante essa transição e terminou com `Execution context was destroyed`; os testes seguintes retornaram `CacheStorage: Unexpected internal error`.

Isso não prova que o probe sozinho criou a falha de armazenamento, mas prova que o Vyzium estava tocando no subsistema de armazenamento durante a janela mais frágil do bootstrap. Para eliminar essa interferência e corrigir o problema observado de "carregar novamente por cima", a 3.1.8 não executa nenhuma operação ativa de storage antes de QR/ready.

## Mudanças

- removido o probe ativo `caches.open/__vyzium_cache_probe__` do startup;
- nenhuma leitura/escrita em `CacheStorage` ou `IndexedDB` é feita pelo diagnóstico durante o bootstrap;
- depois do `page.goto(... waitUntil: load)`, o patch aguarda o documento principal ficar realmente estável antes do primeiro `Client.inject()`;
- uma página só é considerada estável quando permanece por 4 s no domínio principal, fora de `post_logout=1`, com `document.readyState === complete`, `body` e `window.Debug.VERSION` disponíveis;
- transições temporárias resetam o relógio de estabilidade em vez de disparar uma segunda injeção;
- o listener de recuperação de navegação só é instalado depois da primeira injeção concluir;
- o watchdog inicial foi ampliado para 120 s, evitando matar o navegador enquanto a primeira página ainda está se estabilizando;
- modo auditável continua registrando navegação, console, browser e integridade do patch, mas de forma passiva durante o startup.

## O que esta versão não assume

A 3.1.8 mantém `whatsapp-web.js 1.34.7` e sua árvore de dependências bloqueada. O log da 3.1.7 mostra Chrome 153, enquanto a dependência atual da biblioteca usa Puppeteer 24.38.0. Essa diferença será tratada como um teste A/B separado se o bootstrap ainda falhar; ela não foi misturada nesta correção para não introduzir uma segunda variável sem necessidade.

## Critério de sucesso no Windows

O resultado esperado é que a primeira janela do WhatsApp permaneça carregando sem ser reinicializada pelo Vyzium e o diagnóstico avance até `client.qr-received` e `client.qr-image-ready`. Se o próprio WhatsApp navegar para `post_logout=1`, a 3.1.8 deve apenas aguardar a página principal estabilizar, sem disparar probe de storage nem uma injeção concorrente.
