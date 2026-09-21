# Vyzium 3.0.3 — Bridge

## Objetivo

Migrar o canal de atualização dos clientes já instalados de `solucionx/Vyzium` para `solucionx/Vyzium-Releases` sem alterar a identidade da instalação nem os caminhos dos bancos em produção.

## Regras da transição

- A release **3.0.3** deve ser publicada no repositório histórico `solucionx/Vyzium`, pois é o endereço conhecido pelos clientes antigos.
- O binário da 3.0.3 consulta `solucionx/Vyzium-Releases` para versões posteriores.
- Não privatizar o repositório histórico até testar uma atualização real da 3.0.3 para uma versão posterior publicada somente no repositório de releases.
- `appId`, `productName`, caminhos de `userData`, bancos e sessão do WhatsApp permanecem inalterados.
- A Data Safety permanece ativa e pode gerar backup protegido `pre-upgrade-3.0.3` antes de abrir bancos existentes para escrita.

## Correção visual

O modal de atualização usa `renderer/assets/vyzium-mark.svg` (marca colorida), em vez da variante branca que ficava invisível sobre o fundo branco do ícone.
