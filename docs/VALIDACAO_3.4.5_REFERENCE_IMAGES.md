# Vyzium 3.4.5 — Referências por item

Base: release/v3.4.4-map-progress, commit 1186ce3. Mudanças limitadas à referência opcional por item, envio de mídia, numeração e testes.

## Comportamento

- Adicionar, trocar ou remover uma foto na célula do item, junto da tabela de preços dos fornecedores.
- Aceita JPG/JPEG, PNG e WebP até 15 MB; converte a JPEG com fundo branco, dimensão máxima de 1000 pixels e até 120 KB por imagem. Uma imagem por item, máximo 20 imagens por mapa.
- Salvar e reabrir mantém a foto. A imagem comprimida fica no registro criptografado do mapa: os backups atuais e o merge de mapas já transportam esse campo, sem pasta externa ou migração de esquema.
- Texto primeiro, depois imagens em ordem dos itens, com legenda contendo número, descrição e hotel. Itens sem foto continuam em texto.
- A prévia exibe fotos. Apagar a linha numerada exata do item da mensagem omite a imagem. Editar essa linha também omite a imagem; a prévia reflete isso. Observações podem ser editadas livremente.
- Envio individual e envio para todos usam as mesmas referências do mapa. Negociação e Acompanhamento mantêm o envio de texto.
- Valida todas as imagens antes de enviar texto; mantém uma única trava durante texto e imagens. Falha depois de iniciar o envio é incerta e exige conferência no Histórico; não reenvia automaticamente.
- Históricos registram quantidade de imagens, sem duplicar bytes das imagens.

## Validação local em 02/10/2026

`npm test`: 254 testes Python executados, 248 aprovados e 6 ignorados por requisitos do ambiente; 194 testes Node aprovados; 6 verificações de ordenação aprovadas.

Testes novos cobrem persistência/remover, imagem inválida sem alterar mapa salvo, alteração de fingerprint, envio automático, bloqueio de duplicados, exclusão da linha do item, compatibilidade com texto puro, ordem texto/foto, legenda, trava durante todo o lote e falha de mídia após texto enviada como incerta.

Verificações de sintaxe JavaScript/Python e `git diff --check` aprovadas.

## Validação pendente

Não houve envio a fornecedores reais. O instalador Windows, SQLCipher nativo no Windows e a aparência da tela precisam da validação Windows e conferência de uso. O workflow específico usa o processo de build existente, roda os testes, verifica motores empacotados e cria somente Draft em solucionx/Vyzium-Releases. Não publica automaticamente e recusa sobrescrever uma release publicada.

Levi autorizou em 02/10/2026 o envio da candidata ao GitHub e a geração de release Draft, mantendo a publicação manual. O limite total do lote de imagens se aplica apenas quando existem fotos; envios de texto preservam seu prazo anterior.
