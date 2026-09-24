# Vyzium 3.2.6 — Diagnóstico local de produção

A 3.2.6 mantém a lógica funcional da 3.2.5 e incorpora diagnóstico local permanente para suporte.

## O que é registrado
- bootstrap do Electron e falhas de renderer/child process;
- restauração de autenticação e validação de segurança/bancos;
- início, saída, timeout e requisições dos motores Acompanhamento/Compras;
- detecção/lançamento do Chrome ou Edge, helper oculto, PID e CDP;
- eventos técnicos do `whatsapp-web.js`, inclusive QR/authenticated/ready;
- snapshot final dos processos relevantes.

## Privacidade
Tokens, segredos, cookies, chaves e credenciais são mascarados. O diretório pessoal do Windows é substituído por `%USERPROFILE%`. O diagnóstico não coleta conteúdo de mensagens do WhatsApp.

## Retenção
Para impedir crescimento ilimitado em produção, são mantidas no máximo 8 pastas de execução e 5 pacotes ZIP de diagnóstico. Os mais antigos são removidos automaticamente.

## Encerramento
O pacote final é criado somente depois do encerramento controlado dos serviços, para incluir eventos de shutdown e o log final do WhatsApp.

## Local
`<userData do Vyzium>/diagnostics/`

Arquivos principais: `RELATORIO.txt`, `timeline.jsonl`, `system.json`, `processes.json`, `errors.log`, `hidden-browser.log` e `whatsapp-debug.jsonl` quando disponível.
