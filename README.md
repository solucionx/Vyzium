<p align="center">
  <img src="docs/readme/vyzium-banner.jpg" alt="Vyzium — Gestão Operacional & Follow-up" width="100%">
</p>

<p align="center">
  <img alt="Windows" src="https://img.shields.io/badge/WINDOWS-10%20%7C%2011-0A7FA1?style=for-the-badge&labelColor=0B3554">
  <img alt="Desktop" src="https://img.shields.io/badge/APLICATIVO-DESKTOP-00A7B1?style=for-the-badge&labelColor=0B3554">
  <img alt="Gestão operacional" src="https://img.shields.io/badge/GEST%C3%83O-OPERACIONAL-00BFA5?style=for-the-badge&labelColor=0B3554">
  <img alt="Dados locais" src="https://img.shields.io/badge/DADOS-LOCAIS-007D9C?style=for-the-badge&labelColor=0B3554">
  <img alt="WhatsApp" src="https://img.shields.io/badge/WHATSAPP-FOLLOW--UP-00BFA5?style=for-the-badge&labelColor=0B3554">
</p>

<p align="center">
  <strong>Controle de ordens de compra, acompanhamento de fornecedores e follow-up em uma única operação.</strong><br>
  Uma solução desktop criada para transformar planilhas de compras em uma rotina visual, organizada e rastreável.
</p>

<p align="center">
  <a href="https://github.com/solucionx/Vyzium/releases/latest"><strong>Baixar Vyzium para Windows</strong></a>
  &nbsp;&nbsp;•&nbsp;&nbsp;
  <a href="https://github.com/solucionx/Vyzium"><strong>Repositório oficial</strong></a>
</p>

Vyzium

O Vyzium é uma plataforma desktop de gestão operacional e follow-up de compras criada para centralizar o acompanhamento diário de ordens de compra.

A aplicação organiza prazos, fornecedores, atendimento, aprovações, observações e próximas ações em uma interface única. A partir da base de compras importada, o Vyzium transforma dados dispersos em uma visão operacional clara para que a equipe consiga identificar rapidamente o que precisa de atenção.

O objetivo é simples: reduzir controles manuais, dar visibilidade à operação e tornar o acompanhamento com fornecedores mais consistente.

Principais recursos

Controle operacional

Visualização central das ordens de compra com informações essenciais para o acompanhamento diário:

prazo e nível de urgência;

hotel ou unidade;

número da OC;

fornecedor;

previsão de entrega;

situação de atendimento;

aprovação;

controle e observação manual;

próxima ação sugerida.

Dashboard

Indicadores operacionais para acompanhar rapidamente a situação da base, com cards interativos e acesso direto aos pedidos que exigem atenção.

Pedidos

Consulta detalhada das ordens, com filtros persistentes e visão dos itens, quantidades, recebimentos, saldo e previsão de entrega.

Fornecedores

Cadastro local de contatos e telefones, associado ao fornecedor para reutilização automática nas ordens futuras.

Follow-up por WhatsApp

O Vyzium prepara e organiza as mensagens de acompanhamento por fornecedor, permitindo revisão antes do envio e execução em lote.

O fluxo inclui:

agrupamento de ordens do mesmo fornecedor;

prévia das mensagens;

envio em lote;

acompanhamento da conexão em segundo plano;

fila persistente de processamento;

histórico local das tentativas e envios;

proteção contra reenvios indevidos.

A integração utiliza WhatsApp Web. Ela não substitui a API oficial do WhatsApp Business e pode depender de mudanças feitas pelo próprio serviço.

Fluxo operacional

Base de compras
      │
      ▼
Importação e consolidação
      │
      ├────► Dashboard
      │
      ├────► Controle operacional
      │
      ├────► Pedidos
      │
      └────► Fornecedores
                  │
                  ▼
           Preparação do follow-up
                  │
                  ▼
             Envio em lote
                  │
                  ▼
               Histórico

Áreas do sistema

Área

Finalidade

Controle operacional

Acompanhamento diário das ordens e prioridades

Dashboard

Indicadores e visão rápida da operação

Pedidos

Consulta detalhada e filtrada das OCs

Fornecedores

Telefones e contatos utilizados no follow-up

Mensagens

Revisão e execução dos lotes de acompanhamento

Histórico

Registro local das cobranças e tentativas

Configurações

Regras operacionais, automação e conexão do WhatsApp

Dados locais e continuidade da operação

O Vyzium mantém os dados próprios do acompanhamento separados da planilha importada.

Isso permite preservar informações como:

controles manuais;

observações;

telefones dos fornecedores;

configurações;

histórico de follow-up;

fila de mensagens;

sessão local do WhatsApp.

Novas importações atualizam o retrato operacional das ordens sem substituir os dados que pertencem ao acompanhamento realizado dentro do Vyzium.

Privacidade e segurança local

O núcleo da aplicação roda no próprio computador do usuário.

motor de processamento local;

persistência em SQLite;

comunicação interna restrita ao aplicativo;

arquivos de sessão e banco local fora do repositório;

atualização do aplicativo sem substituir os dados operacionais do usuário.

Arquivos reais de operação, banco de dados, sessões do WhatsApp e informações persistentes não devem ser publicados no GitHub.

Tecnologia

<p align="center">
  <img src="build/icon.png" alt="Ícone do aplicativo Vyzium" width="88">
</p>

Camada

Tecnologia

Aplicativo desktop

Electron

Interface

HTML, CSS e JavaScript

Motor local

Python

Persistência

SQLite

Planilhas

Excel .xlsx / .xlsm

Follow-up

WhatsApp Web

Distribuição

Instalador para Windows

Arquitetura

Vyzium/
├── electron/      Aplicativo desktop e integração do sistema
├── renderer/      Interface e experiência visual
├── backend/       Motor de regras, importação e persistência
├── build/         Recursos de empacotamento e identidade
├── scripts/       Inicialização e build
└── tests/         Testes automatizados

Windows

O Vyzium é distribuído como aplicativo desktop para Windows 10 e Windows 11, 64 bits.

A versão disponível para instalação pode ser encontrada na área oficial de Releases:

<p align="center">
  <a href="https://github.com/solucionx/Vyzium/releases/latest"><strong>→ Acessar download para Windows</strong></a>
</p>

<p align="center">
  <img src="docs/readme/vyzium-symbol.jpg" alt="Símbolo Vyzium" width="180">
</p>

<p align="center">
  <strong>Vyzium</strong><br>
  Gestão Operacional &amp; Follow-up<br><br>
  Desenvolvido pela <strong>Solucionx</strong>
</p>
