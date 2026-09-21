# Correções 3.1.22 — CDP confiável em Chrome oculto

- Mantém `headless:false` e o guardião Win32 pre-show.
- Remove `--no-startup-window` e volta a criar `about:blank` em `--new-window`, já em `--window-position=-30000,-30000`.
- Apaga `DevToolsActivePort` obsoleto antes de iniciar o Chrome com um perfil LocalAuth persistente.
- Só entrega `browserWSEndpoint` ao `whatsapp-web.js` depois de confirmar que a nova porta TCP do DevTools está realmente aceitando conexões.
- Preserva integralmente as correções de persistência da 3.1.21 e não altera o patch V6/CacheStorage/bootstrap/eventos do WhatsApp.
