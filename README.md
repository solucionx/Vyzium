<p align="center">
  <img src="docs/readme/vyzium-banner.svg" alt="Vyzium — Gestão Operacional & Follow-up" width="100%">
</p>

<p align="center">
  <a href="https://github.com/solucionx/Vyzium/releases/latest"><img alt="Download para Windows" src="https://img.shields.io/badge/BAIXAR_PARA_WINDOWS-00A7B1?style=for-the-badge&logo=windows11&logoColor=white"></a>
  <a href="https://github.com/solucionx/Vyzium/releases"><img alt="Releases" src="https://img.shields.io/badge/RELEASES-0B3554?style=for-the-badge&logo=github&logoColor=white"></a>
  <img alt="Windows 10 e 11" src="https://img.shields.io/badge/WINDOWS-10_%7C_11-007D9C?style=for-the-badge&logo=windows11&logoColor=white">
  <img alt="Dados locais" src="https://img.shields.io/badge/DADOS-LOCAIS-003B73?style=for-the-badge&logo=sqlite&logoColor=white">
</p>

<p align="center">
  <strong>Transforme a rotina de compras em uma operação visual, organizada e acompanhável.</strong><br>
  O Vyzium centraliza ordens de compra, fornecedores, prazos, entregas e follow-up em uma experiência desktop criada para o dia a dia operacional.
</p>

---

## ✦ Uma visão clara do que precisa de atenção

O **Vyzium** foi criado para reduzir a dependência de controles espalhados e dar contexto ao acompanhamento de compras. A base importada vira uma visão operacional com prioridade, prazo, fornecedor, atendimento, aprovação, observações e próxima ação.

<p align="center">
  <img src="docs/readme/controle-operacional.png" alt="Controle operacional do Vyzium" width="96%">
</p>

> **Foco operacional:** identificar rapidamente o que está atrasado, o que está próximo do prazo e quais fornecedores ainda precisam de acompanhamento.

---

## ✦ O que o Vyzium reúne

<table>
<tr>
<td width="33%" valign="top">

### ◈ Controle operacional
Acompanhamento das OCs em uma tabela única, com prioridade visual, filtros persistentes, observações e próxima ação.

</td>
<td width="33%" valign="top">

### ◫ Dashboard
Indicadores para enxergar o cenário da operação sem precisar percorrer toda a base manualmente.

</td>
<td width="33%" valign="top">

### ✓ Pedidos
Consulta das ordens e itens com previsão, atendimento, aprovação e contexto do fornecedor.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### ◎ Fornecedores
Telefones e contatos ficam associados ao fornecedor e podem ser reutilizados nas próximas importações.

</td>
<td width="33%" valign="top">

### ↗ Follow-up
Mensagens organizadas por fornecedor, prévia antes do envio e execução em lote pelo WhatsApp Web.

</td>
<td width="33%" valign="top">

### ◷ Histórico
Registro local das tentativas e envios para manter rastreabilidade da rotina de acompanhamento.

</td>
</tr>
</table>

---

## ✦ Dashboard operacional

O painel resume os pontos que precisam de atenção e mantém a operação ligada aos pedidos que originaram cada indicador.

<p align="center">
  <img src="docs/readme/dashboard.png" alt="Dashboard operacional do Vyzium" width="96%">
</p>

---

## ✦ Da planilha ao follow-up

```text
BASE DE COMPRAS
      │
      ▼
IMPORTAÇÃO E CONSOLIDAÇÃO
      │
      ├──────────────► Dashboard
      ├──────────────► Controle operacional
      ├──────────────► Pedidos
      └──────────────► Fornecedores
      │
      ▼
IDENTIFICAÇÃO DE PENDÊNCIAS
      │
      ▼
FOLLOW-UP POR FORNECEDOR
      │
      ▼
ENVIO EM LOTE + HISTÓRICO LOCAL
```

O Vyzium preserva o contexto criado dentro do próprio aplicativo — como contatos, observações, controles e histórico — mesmo quando uma nova base é importada.

---

## ✦ Follow-up com menos trabalho repetitivo

Em vez de tratar cada OC como uma tarefa isolada, o Vyzium organiza o acompanhamento por fornecedor.

- agrupa ordens relacionadas ao mesmo fornecedor;
- prepara uma prévia da mensagem antes do envio;
- executa o lote de forma sequencial;
- mantém a conexão acompanhada em segundo plano;
- registra o resultado localmente;
- evita que um problema em um fornecedor impeça o restante do lote.

> A integração atual utiliza **WhatsApp Web**. O objetivo é apoiar o fluxo operacional dentro do aplicativo sem substituir a API oficial do WhatsApp Business.

---

## ✦ Continuidade dos dados

Os dados de acompanhamento ficam separados da planilha importada. Assim, o Vyzium consegue manter informações que pertencem à operação e não à base original.

<table>
<tr>
<td width="50%" valign="top">

**Permanece no Vyzium**

- observações manuais;
- controles operacionais;
- telefones dos fornecedores;
- configurações;
- histórico de follow-up;
- fila de mensagens;
- sessão local do WhatsApp.

</td>
<td width="50%" valign="top">

**A nova importação atualiza**

- ordens de compra;
- itens;
- quantidades;
- recebimentos;
- previsões;
- situação operacional vinda da base.

</td>
</tr>
</table>

---

## ✦ Construído para desktop

<p align="center">
  <img src="docs/readme/vyzium-mark.svg" alt="Símbolo Vyzium" width="110">
</p>

<table>
<tr><td><strong>Desktop</strong></td><td>Electron</td></tr>
<tr><td><strong>Interface</strong></td><td>HTML · CSS · JavaScript</td></tr>
<tr><td><strong>Motor local</strong></td><td>Python</td></tr>
<tr><td><strong>Persistência</strong></td><td>SQLite</td></tr>
<tr><td><strong>Base de compras</strong></td><td>Excel (.xlsx / .xlsm)</td></tr>
<tr><td><strong>Follow-up</strong></td><td>WhatsApp Web</td></tr>
<tr><td><strong>Distribuição</strong></td><td>Instalador para Windows</td></tr>
</table>

---

## ✦ Estrutura do projeto

```text
Vyzium/
├── backend/        # regras, importação, persistência e processamento
├── electron/       # aplicação desktop e integrações do sistema
├── renderer/       # interface e experiência visual
├── build/          # identidade e recursos de empacotamento
├── scripts/        # build e execução
├── tests/          # testes automatizados
└── docs/           # documentação e recursos do projeto
```

---

## ✦ Download

<p align="center">
  <a href="https://github.com/solucionx/Vyzium/releases/latest">
    <img alt="Baixar Vyzium" src="https://img.shields.io/badge/↓_BAIXAR_VYZIUM_PARA_WINDOWS-00A7B1?style=for-the-badge&logo=windows11&logoColor=white">
  </a>
</p>

<p align="center">
  <sub>Aplicativo desktop para Windows 10 e Windows 11 · 64 bits</sub>
</p>

---

<p align="center">
  <img src="docs/readme/vyzium-mark.svg" alt="Vyzium" width="72"><br><br>
  <strong>Vyzium</strong><br>
  Gestão Operacional & Follow-up<br><br>
  <sub>Desenvolvido pela <strong>Solucionx</strong></sub>
</p>
