# Correções 3.1.21 — persistência WhatsApp

- Mantém `headless:false`, `--no-startup-window` e o guardião Win32 pre-show da 3.1.20.
- Corrige a rotação de `clientId` em **Gerar novo QR Code**: o novo perfil fica provisório até `ready`, quando `auth-profile.json` e `session-established.json` são gravados juntos.
- `ready` sempre reconcilia os metadados com o perfil LocalAuth realmente conectado.
- Repara automaticamente a inconsistência específica da 3.1.20 em que `auth-profile.json` podia apontar para o QR recém-conectado e `session-established.json` continuar apontando para o perfil anterior.
- No desligamento, `browser.close()` recebe uma janela de encerramento natural antes do helper usar o stop flag/`taskkill`, evitando interromper a gravação final de IndexedDB/cookies do perfil.
- Não altera patch V6, bootstrap, CacheStorage policy, eventos `qr/authenticated/ready/hasSynced`, watchdog, reconexão, UI, Compras ou backend.
