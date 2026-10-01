# Vyzium Visual Sandbox Preview

Preview visual isolado do Vyzium, criado exclusivamente para avaliação de interface.

## Garantias deste pacote

- appId próprio: `com.vyzium.visualsandbox`
- pasta de dados própria: `%APPDATA%\Vyzium-Visual-Sandbox`
- executável portátil; não substitui a instalação de produção
- não inclui motores Python, SQLCipher, Firebase, WhatsApp, backup remoto ou atualizador
- bloqueia HTTP, HTTPS, WS e WSS no nível da sessão Electron
- usa somente dados fictícios embutidos no renderer
- não lê nem migra bancos, sessões ou configurações do Vyzium de produção

O artefato é gerado somente no GitHub Actions e não cria Release.
