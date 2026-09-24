# Auditoria final — Vyzium 3.2.7 Stable Production

Data: 2026-09-24

## Escopo da correção
A recuperação destrutiva de Storage/perfil permanece uma operação única e exclusiva da primeira conexão não estabelecida. Depois dela, falhas transitórias não marcam `requiresNewQr`, não rotacionam/quarentenam outro perfil e não encerram as retentativas normais. O mesmo perfil de compatibilidade é reutilizado com `StorageBuckets` desabilitado e com o backoff normal de reconexão.

Nenhuma regra de negócio, banco, Firebase, updater, renderer ou motor Python foi alterada nesta revisão final. Em relação à candidata 3.2.7 revisada, o único código funcional alterado foi `electron/whatsapp.js`; `tests/whatsapp.cjs` foi ampliado para cobrir a regressão. README/package/docs tiveram somente atualização de identificação/documentação.

## Gates executados
- `npm run test:node`: 114/114 testes Node aprovados.
- Ordenação: 6/6 verificações aprovadas.
- Novo teste: recuperação de Storage ocorre uma vez; stall transitório subsequente reconecta usando o mesmo clientId/perfil e mantém `disableStorageBuckets=true`.
- `node --check`: `electron/main.js`, `electron/whatsapp.js` e `electron/diagnostics.js` aprovados.
- `python -m compileall -q backend`: aprovado.
- Suite Python: 151 testes descobertos; 138 aprovados, 6 pulados e 7 não executaram por ausência de `xlrd`/`xlwt` no ambiente. A instalação dessas dependências não foi possível porque o ambiente de auditoria não possui acesso de rede. Esses 7 testes não são contabilizados como aprovados.
- Diff contra a candidata 3.2.7: nenhum arquivo funcional fora do WhatsApp foi modificado nesta revisão final.

## Gate físico antes do Latest
Validar no PC que reproduziu a falha: abertura -> CDP -> bootstrap -> QR -> authenticated -> ready -> fechar/reabrir -> restauração da sessão. Também validar uma instalação que já possua sessão estabelecida para comprovar preservação do LocalAuth.
