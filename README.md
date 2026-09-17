<p align="center">
  <img src="renderer/assets/vyzium-mark.svg" alt="Vyzium" width="118">
</p>

<h1 align="center">Vyzium</h1>

<p align="center">
  <strong>GESTÃO OPERACIONAL &amp; FOLLOW-UP</strong><br>
  Controle de ordens de compra, acompanhamento de fornecedores e follow-up em um único aplicativo desktop.
</p>

<p align="center">
  <img alt="Versão" src="https://img.shields.io/badge/VERS%C3%83O-1.2.9-007D9C?style=for-the-badge&labelColor=082F4A">
  <img alt="Windows" src="https://img.shields.io/badge/WINDOWS-10%20%7C%2011-00A7B1?style=for-the-badge&labelColor=082F4A">
  <img alt="Electron" src="https://img.shields.io/badge/ELECTRON-39-00BFA5?style=for-the-badge&labelColor=082F4A">
  <img alt="Python" src="https://img.shields.io/badge/PYTHON-MOTOR%20LOCAL-00A7B1?style=for-the-badge&labelColor=082F4A">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLITE-DADOS%20LOCAIS-007D9C?style=for-the-badge&labelColor=082F4A">
  <img alt="WhatsApp" src="https://img.shields.io/badge/WHATSAPP-FOLLOW--UP-00BFA5?style=for-the-badge&labelColor=082F4A">
</p>

<p align="center">
  <img src="build/icon.png" alt="Ícone Vyzium" width="74">
</p>

<p align="center">
  <strong>Seus pedidos. Seus fornecedores. Seu controle.</strong><br>
  Desenvolvido pela <strong>Solucionx</strong>.
</p>

---

## Visão geral

**Vyzium** é um aplicativo desktop para transformar a rotina de acompanhamento de ordens de compra em um fluxo operacional mais claro, rápido e rastreável.

A aplicação importa a base de compras, organiza os pedidos por prioridade, mantém controles manuais sem perder os dados da planilha, centraliza fornecedores e permite preparar o follow-up pelo WhatsApp diretamente no fluxo de trabalho.

O foco do Vyzium é reduzir a necessidade de procurar informações em várias telas ou planilhas e concentrar o acompanhamento diário em uma interface única.

## Principais recursos

- **Controle operacional:** visualização compacta das OCs com prazo, hotel, fornecedor, atendimento, aprovação, controle manual e próxima ação.
- **Dashboard:** indicadores operacionais e cards clicáveis para acompanhar pedidos em aberto, atrasos, situações de coleta e controles manuais.
- **Pedidos:** filtros por comprador, hotel, atendimento, prazo e controle, com detalhamento dos itens da ordem.
- **Fornecedores:** cadastro persistente de telefone e contato, reutilizado automaticamente nas ordens do mesmo fornecedor.
- **Mensagens:** prévia e revisão das cobranças antes do envio, com agrupamento por fornecedor.
- **WhatsApp integrado:** conexão por QR Code, modo de simulação e envio real com controle de sessão.
- **Histórico:** registro das ações de follow-up e acompanhamento dos envios.
- **Configurações:** regras de prazo, atraso crítico, intervalo anti-spam, comprador, remetente, assinatura e execução automática.
- **Filtros persistentes:** o aplicativo mantém as preferências operacionais salvas localmente entre as sessões.
- **Atualizações:** verificação de novas versões pelo próprio aplicativo.
- **Dados locais:** motor Python e persistência local para os dados operacionais usados pela aplicação.

## Fluxo de trabalho

```text
BASE SCI.xlsx
      │
      ▼
 Importação da base
      │
      ▼
 Consolidação das OCs
      │
      ├──► Dashboard
      ├──► Controle operacional
      ├──► Pedidos
      └──► Fornecedores
               │
               ▼
        Revisão do follow-up
               │
               ▼
        Simulação / WhatsApp
               │
               ▼
             Histórico
```

## Estrutura do aplicativo

| Área | Finalidade |
|---|---|
| **Controle operacional** | Tela principal para acompanhamento diário das ordens |
| **Dashboard** | Indicadores e visão rápida da situação da operação |
| **Pedidos** | Consulta detalhada e filtrada das OCs |
| **Fornecedores** | Contatos e telefones usados no follow-up |
| **Mensagens** | Revisão do conteúdo antes do disparo |
| **Histórico** | Registro das cobranças e conferências |
| **Configurações** | Regras operacionais, WhatsApp e automação |

## Acompanhamento das ordens

O Vyzium organiza os pedidos em estados operacionais para facilitar a priorização do trabalho, incluindo situações como:

- programado;
- próximo do prazo;
- atrasado;
- atraso crítico;
- concluído ou cancelado.

Além dos dados importados, cada OC pode receber um **controle manual** e uma **observação própria**. Essas informações fazem parte do acompanhamento do usuário e permanecem disponíveis mesmo após novas importações da base.

## Importação da base

O aplicativo trabalha com planilhas Excel e consolida os registros necessários para a operação.

Durante a importação, o motor identifica as informações utilizadas pelo Vyzium, organiza as ordens e preserva os dados locais que pertencem ao acompanhamento, como telefones de fornecedores, controles manuais e histórico.

A base importada funciona como o retrato operacional mais recente; os dados próprios do Vyzium continuam persistidos localmente.

## Follow-up pelo WhatsApp

O Vyzium possui integração com o WhatsApp Web para apoiar o contato com fornecedores.

Antes do envio, o usuário pode revisar as mensagens, verificar os fornecedores incluídos e utilizar o **modo de simulação**. No envio real, a sessão é conectada por QR Code dentro do fluxo do aplicativo.

O sistema também possui mecanismos de controle para reduzir reenvios indevidos e registrar o resultado das tentativas no histórico.

> A integração utiliza automação do WhatsApp Web e não representa uma API oficial do WhatsApp Business. Mudanças no serviço podem exigir ajustes futuros na integração.

## Privacidade e armazenamento

O Vyzium foi projetado para manter o núcleo da operação no computador do usuário.

- O motor da aplicação roda localmente.
- Os dados operacionais persistidos pelo sistema ficam no armazenamento local do aplicativo.
- Telefones, controles e histórico não precisam ser publicados em repositórios ou serviços externos.
- Arquivos de sessão, banco local, dados persistentes e informações reais da operação **não devem ser incluídos em commits públicos**.

## Arquitetura

```text
Vyzium/
├── electron/      # Aplicativo desktop, ponte segura e atualizações
├── renderer/      # Interface, telas e identidade visual
├── backend/       # Motor Python, regras, importação e persistência
├── build/         # Ícones e recursos de empacotamento
├── scripts/       # Inicialização, testes e build
└── tests/         # Testes automatizados
```

### Tecnologias

| Camada | Tecnologia |
|---|---|
| Desktop | Electron |
| Interface | HTML, CSS e JavaScript |
| Motor local | Python |
| Persistência | SQLite |
| Planilhas | Excel `.xlsx` / `.xlsm` |
| Follow-up | WhatsApp Web |
| Empacotamento | electron-builder / NSIS |

## Executar em desenvolvimento

### Requisitos

- Windows 10 ou Windows 11;
- Node.js LTS;
- Python 3.11 ou 3.12;
- Google Chrome ou Microsoft Edge para a integração com WhatsApp Web.

No PowerShell, dentro da pasta do projeto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\start-dev.ps1
```

Também é possível iniciar a camada Electron com:

```powershell
npm install
npm start
```

## Testes

Backend:

```powershell
npm run test:backend
```

Node/Electron:

```powershell
npm run test:node
```

Todos os testes disponíveis:

```powershell
npm test
```

## Gerar o instalador do Windows

```powershell
npm run build
```

O empacotamento utiliza **electron-builder** com instalador NSIS para Windows x64.

## Identidade Vyzium

<p align="center">
  <img src="renderer/assets/vyzium-mark.svg" alt="Marca Vyzium" width="92">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="build/icon.png" alt="Ícone Vyzium" width="92">
</p>

A identidade visual do Vyzium utiliza azul profundo, azul operacional, ciano e turquesa para manter a interface limpa, técnica e confortável durante o acompanhamento diário.

---

<p align="center">
  <strong>Vyzium</strong><br>
  Gestão Operacional &amp; Follow-up<br><br>
  Desenvolvido pela <strong>Solucionx</strong>
</p>
