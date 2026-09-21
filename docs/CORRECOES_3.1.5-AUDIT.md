# Vyzium 3.1.5 Audit — WhatsApp

Esta edição existe para validar o bootstrap e a geração do QR com rastreabilidade completa antes da versão final enxuta.

## Correções aplicadas

- o primeiro `Client.inject()` termina antes do listener de navegação ser registrado;
- somente uma recuperação de navegação pode executar `inject()` por vez;
- o `Client.js` não remove mais o perfil `LocalAuth` enquanto o Chromium está usando seus arquivos;
- `LOGOUT` é tratado pelo Vyzium: primeiro o navegador é encerrado, depois o perfil é removido e só então uma sessão limpa é iniciada;
- **Gerar novo QR Code** invalida a geração antiga, encerra o navegador, aguarda a Promise antiga e remove o perfil antes de iniciar a nova geração;
- o marcador e a verificação do patch foram atualizados para `VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V3`;
- o log registra navegador, página, navegações, falhas de rede, eventos do cliente, QR, autenticação, watchdog, descarte e limpeza de perfil;
- QR bruto, imagem base64, cookies, tokens, credenciais e conteúdo de mensagens não são gravados.

## Arquivo de diagnóstico

O painel de WhatsApp permite atualizar, copiar, abrir a pasta e limpar `whatsapp-debug.jsonl`.

Para validar a instalação sem abrir o Electron:

```powershell
npm install
npm run verify:whatsapp-patch
npm run diagnose:whatsapp
```
