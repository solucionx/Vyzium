# Vyzium 3.5.6 — Transmissão para fornecedores

Base: versão 3.5.5 publicada, commit 627b48c. Mantém os recursos de mapas, últimas compras, backup e restauração dessa versão.

## Nova função

Acompanhamento → Transmissão permite pesquisar fornecedores por nome, contato ou telefone, selecionar todos os cadastrados e incluir contatos manuais. Cada destinatário recebe a mensagem individualmente. Até 500 entradas por lote; números repetidos são eliminados após normalização, e inválidos/desativados são informados na revisão. Contatos manuais não alteram o cadastro.

O modo Simulação/Envio real é destacado antes da confirmação. A fila e os resultados ficam no banco criptografado existente e no Histórico. O aplicativo precisa estar aberto e conectado para concluir envios reais. Fechar durante um envio deixa o item incerto, sem repetição automática; pendências seguras retomam na próxima abertura. Lotes encerrados com erro não retomam silenciosamente.

## Auditoria e correções

- Corrigida a ausência das rotas de transmissão na allowlist do Electron.
- Função portada da base antiga do PR para a versão 3.5.5 publicada.
- Confirmação vinculada à lista, texto e modo revisados; alterações exigem nova revisão.
- Resposta perdida mantém a mesma solicitação, bloqueando edição até resolução. O backend rejeita reutilizar um identificador com outro conteúdo.
- Mensagem idêntica ao mesmo número com envio incerto exige conferência no WhatsApp e revisão no Histórico.
- Consulta específica da transmissão recupera resultados após reabrir a tela sem confundir com lotes de cobranças.
- Erros finais mostram resultados por contato e não retomam envios silenciosamente na próxima abertura.
- Sem mudança de schema, dependências de produção, sessão WhatsApp ou regras de cálculo dos mapas.

## Validação obrigatória antes da criação deste Draft

Testes Python e Node; integração real da tela com preload, IPC, allowlist e servidor Python em dados sintéticos; busca, seleção total com filtro, contatos manuais, deduplicação, XSS, resposta perdida após persistência, idempotência e histórico após recarregar. Regressão das telas de histórico de compras, referências no mapa, status de cotações, busca e inclusão de itens. Compilação e verificação dos motores SQLCipher, pacote Windows, arquivos do portátil e hashes dos anexos.

Nenhuma mensagem real para fornecedores é enviada pelos testes. Não substitui teste manual com a conta WhatsApp do usuário. Distribuição somente em Draft; publicação manual pelo usuário.
