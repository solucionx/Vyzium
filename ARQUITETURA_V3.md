# Arquitetura Vyzium 3.0

## Módulos

### Acompanhamento
- Controle operacional
- Dashboard
- Pedidos
- Fornecedores
- Mensagens
- Histórico
- Configurações do módulo

Base persistente: `followup.db` no diretório `userData` do Vyzium.

### Cotação & Mapas
- Dashboard
- Itens a comprar
- Mapas de compra
- Histórico de cotações
- Configurações do módulo

Base persistente: `compras.sqlite3` no diretório histórico `Vyzium-Compras`.

## Visão geral

A tela inicial exibe apenas métricas resumidas dos dois módulos. As tabelas completas não são carregadas nesse momento.

## Processos

- 1 processo Electron / Chromium para a interface.
- 1 motor Python de Acompanhamento, mantido ativo para preservar o agendador automático.
- 1 motor Python de Cotação & Mapas iniciado sob demanda e liberado ao sair do módulo.
- 1 sessão de WhatsApp e 1 bridge local compartilhados como infraestrutura, sem compartilhar as bases operacionais.

## Isolamento de dados

Não existe memória operacional compartilhada nesta versão. Fornecedores, observações, cotações e demais registros continuam pertencendo à base de seu módulo.

Importar uma planilha de Acompanhamento não altera a base de Cotação & Mapas e vice-versa.
