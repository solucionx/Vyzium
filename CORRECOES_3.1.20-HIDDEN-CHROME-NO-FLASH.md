# Vyzium 3.1.20 — Chrome headful sem flash inicial

Base: Vyzium 3.1.19, cuja proteção Win32 pré-show foi validada no Windows do usuário.

## Alteração única desta revisão

O Chromium continua `headless:false`, porém deixa de abrir a janela inicial `about:blank`. O launcher passa `--no-startup-window`, switch oficial do Chromium para inicialização silenciosa sem janela automática. O guardião Win32 continua sendo iniciado enquanto o processo raiz está suspenso e somente depois ocorre `ResumeThread`.

Como defesa adicional contra qualquer corrida entre criação do HWND e o callback WinEvent, o navegador recebe `--window-position=-30000,-30000`. Isso não substitui o guardião e não muda o modo headful; serve apenas para que uma eventual primeira janela já nasça fora da área visível.

## Intocado

- `headless:false`;
- `LocalAuth`;
- `dataPath` / perfil em `%LOCALAPPDATA%`;
- bootstrap e espera antes do `inject()`;
- ausência de probe ativo de CacheStorage/IndexedDB;
- patch V6;
- `qr`, `authenticated`, `ready`, `change:hasSynced`;
- watchdog, reconexão e geração de novo QR;
- renderer, Compras, ícones e backend.
