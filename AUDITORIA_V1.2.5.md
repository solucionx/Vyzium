# Auditoria de estabilização — Vyzium 1.2.5

## Escopo preservado

- ordem das abas;
- zoom inicial de 89%;
- ordem das colunas e critérios de ordenação;
- estrutura visual dos filtros;
- paleta e identidade visual;
- edição manual da mensagem;
- confirmação por ACK do WhatsApp e fallback por recarga da mensagem.

## Falhas corrigidas

1. seleção vazia de fornecedores não dispara lote global;
2. `supplier_key` com pontuação não é normalizado ao salvar telefone;
3. aliases criados por versões antigas são reconciliados quando a correspondência é única;
4. BPM recusado/pendente em texto bloqueia follow-up mesmo sem código;
5. recebimento parcial considera saldo/quantidade;
6. falha pré-envio não cancela o restante do lote; envio incerto continua interrompendo o lote;
7. agendador só conclui o dia após execução limpa e usa backoff de uma hora após falha;
8. sessão WhatsApp usa verificação de saúde em vez de reciclagem por idade;
9. tela Pedidos ignora respostas assíncronas antigas;
10. filtros de Pedidos e Controle operacional compartilham a mesma persistência local;
11. cards do Dashboard filtram a tabela exibida;
12. limite de atraso crítico exibido acompanha a configuração;
13. logs técnicos locais e retenção ampla do histórico evitam crescimento ilimitado;
14. dependências diretas do Electron foram fixadas em versões exatas.

## Testes de regressão adicionados

- seleção vazia;
- continuidade após falha pré-envio;
- chave de fornecedor com CNPJ pontuado;
- compatibilidade com alias antigo;
- BPM recusado apenas por texto;
- recebimento parcial sem código numérico;
- backoff do agendador;
- reutilização de sessão WhatsApp saudável de longa duração.
