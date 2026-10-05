# Validação da visualização detalhada

Base imutável de comparação: 3.4.9, commit `55b2402678bff9f3084fece888f297ed1dcd7943`.

## Escopo

Implementação isolada em `renderer/quotation-viewer.js` e `.css`, carregada somente no módulo Compras. A tela existente recebe um botão e consulta a rota GET `/map` já disponível. O visualizador reutiliza integralmente os valores/decisões de `evaluate()`; agrupamentos somam valores monetários em centavos. Não há uma segunda fórmula de seleção ou desconto no frontend.

A consulta não captura, substitui ou salva a edição. Se houver alterações pendentes, exibe a última versão salva com aviso; somente o clique explícito em Salvar e atualizar usa a função existente `saveMap()`.

Arquivos de WhatsApp, ciclo de vida, launcher, preload, main, backup, segurança e dependências devem permanecer idênticos à base. As três alterações Python são somente identificação da versão.

## Verificação local

- 187 testes Python aprovados, incluindo SQLCipher.
- 195 testes Node aprovados, mais 6 verificações de ordenação.
- Bootstrap upstream do whatsapp-web.js 1.34.7 conferido por SHA-256.
- 9 verificações integradas do visualizador em Chromium: consulta sem POST/envio, decisões/empates/sem cotação/desconto legado, busca/filtros, cobertura/totais, Esc/foco/edição preservados, falha/dupla submissão de save, falha de GET, mapas concluídos, 60 itens/10 fornecedores e largura reduzida.
- QA visual por capturas do resumo, itens, fornecedores, mapa grande e tela menor.
- Regressões integradas da busca geral e da inclusão/remoção de itens devem passar no mesmo pipeline.

## Windows e entrega

O workflow `validate-v3.4.10-quotation-viewer.yml` exige os mesmos testes e regressões, compila os três motores, valida SQLCipher e motores empacotados, gera o instalador e compara todos os arquivos do portátil. Cria a release somente como Draft depois de todos os gates e verifica hashes dos seis anexos.

Os testes integrados usam banco temporário e envio real de WhatsApp explicitamente desabilitado. Esta validação não substitui a conferência visual no Windows do usuário.
