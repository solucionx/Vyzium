# Vyzium 3.1.3 — primeira conexão limpa do WhatsApp

Esta versão altera somente o ciclo de sessão do WhatsApp.

- Na primeira execução desta versão, qualquer perfil LocalAuth antigo do workspace é descartado em vez de ser restaurado.
- Um novo `clientId` é usado em memória para gerar um QR limpo.
- `auth-profile.json` e o marcador de sessão reutilizável só são gravados depois que o WhatsApp emite `ready`.
- Se o aplicativo for fechado antes de concluir a primeira conexão, a tentativa provisória é descartada na próxima abertura.
- Depois da primeira conexão concluída, a sessão volta a ser reutilizada normalmente nas próximas aberturas.
- Preferências que não são credenciais de sessão, como pausa manual, não são apagadas.

Nenhuma regra de compras, acompanhamento, banco de dados, filtros ou envio foi alterada.
