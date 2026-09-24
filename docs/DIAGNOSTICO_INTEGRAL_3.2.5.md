# Vyzium 3.2.5 — Diagnóstico integral

Build temporária derivada diretamente da 3.2.5.

Registra bootstrap do Electron, autenticação/segurança, motores, exceções, Chrome/Edge, helper PowerShell/Win32, CDP e eventos do whatsapp-web.js até QR/authenticated/ready.

O logger mascara tokens, segredos, cookies, chaves e senhas. Conteúdo de mensagens do WhatsApp não é coletado.

A execução cria `userData/diagnostics/run-*`. Ao fechar o Vyzium, tenta criar `Vyzium-Diagnostico-<boot>.zip` na pasta `diagnostics`.

Arquivos: RELATORIO.txt, timeline.jsonl, system.json, processes.json, errors.log, hidden-browser.log e whatsapp-debug.jsonl quando disponível.

Esta build é temporária para diagnóstico e não deve substituir a estável após a investigação.
