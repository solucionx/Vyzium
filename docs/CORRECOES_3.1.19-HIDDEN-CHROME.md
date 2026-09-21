# Vyzium 3.1.19 — Chrome headful oculto antes da primeira janela

Esta revisão parte da 3.1.14 Stable e altera somente a forma como o navegador do WhatsApp é iniciado no Windows.

- Mantém `headless:false`.
- Mantém `LocalAuth`, `dataPath` e o perfil em `%LOCALAPPDATA%`.
- Mantém o patch V6 de bootstrap/`hasSynced`, QR, `authenticated`, `ready`, watchdog e reconexão.
- Não executa probes de CacheStorage/IndexedDB durante o bootstrap.
- O Chrome é criado com `CREATE_SUSPENDED`; o guardião Win32 é instalado antes de `ResumeThread`.
- O guardião acompanha as janelas da árvore do Chrome, aplica `WS_EX_TOOLWINDOW`, remove `WS_EX_APPWINDOW`, usa uma janela proprietária oculta e remove o HWND da taskbar.
- Depois do DevTools ficar disponível, `whatsapp-web.js` conecta pelo `browserWSEndpoint`, continuando a usar o mesmo perfil LocalAuth.
- O helper PowerShell permanece oculto e encerra somente a árvore do navegador criada para aquela sessão.

O objetivo é preservar a estabilidade do modo headful sem expor Chrome, janela ou miniatura ao usuário.
