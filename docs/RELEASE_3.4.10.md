# Vyzium 3.4.10 — Visualização detalhada dos mapas

Base: versão publicada 3.4.9 (`55b2402678bff9f3084fece888f297ed1dcd7943`).

Um novo botão **Visualização detalhada**, junto de Solicitar negociação e Solicitar cotação por WhatsApp, abre o mapa em uma área ampla de consulta.

- **Resumo:** valores iniciais e finais dos escolhidos, economia, meta, progresso, pendências, distribuição por hotel e fornecedor.
- **Itens e propostas:** quantidades, especificações, observações, propostas, preços unitários e totais, economia, entrega, menor preço e fornecedor escolhido. Inclui busca e filtros por hotel/situação.
- **Por fornecedor:** cobertura da cotação, itens ofertados, itens escolhidos e seus totais. Os totais parciais de propostas são identificados como tal.
- Empates, itens sem preço e escolhas operacionais permanecem distintos, seguindo o cálculo existente do backend.
- Mapas ativos e concluídos podem ser consultados. Voltar ao mapa ou Esc preserva a edição e retorna o foco ao botão.
- Abrir a visualização é uma consulta da última comparação salva. Alterações não salvas recebem aviso e podem ser incorporadas pelo botão explícito **Salvar e atualizar**. A consulta não salva automaticamente nem envia mensagens.

Conexão, sessão, QR, inicialização do navegador, envio por texto, backup, autenticação, banco e dependências permanecem com a lógica da 3.4.9. Os motores Python recebem somente a nova identificação de versão. Esta atualização não inclui a recuperação de navegador órfão discutida anteriormente.

Validações exigidas: testes Python/Node; integração real renderer/preload/IPC/backend do visualizador; preservação da revisão/edição em consulta; falhas de carregar/salvar; bloqueio de salvar duas vezes; mapas concluídos; 60 itens/10 fornecedores; interface menor; regressões de busca e inclusão de itens; compilação e verificação dos três motores e SQLCipher; integridade do WhatsApp empacotado; comparação integral do portátil; checksums dos anexos.

Arquivos: `Vyzium-Setup.exe`, `Vyzium-3.4.10-Portable.zip`, `Vyzium-3.4.10-Source.zip`, `latest.yml`, `.blockmap` e `SHA256SUMS.txt`.

**Draft — publicação manual por Levi após conferir o visualizador no Windows.**
