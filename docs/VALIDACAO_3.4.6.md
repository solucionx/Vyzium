# Validação 3.4.6

Base funcional: 3.4.5, incluindo imagens opcionais por item. Escopo: busca na Visão Geral, marcação de urgência e remoção de referências de imagem ao concluir um mapa. Sem atualização de dependências de produção ou migração de esquema SQL.

## Cobertura

- Busca somente de leitura nos dois motores autenticados; no máximo 15 resultados por categoria, com aviso para refinar. Respostas não contêm imagens. Termos com acentos, HTML e caracteres SQL são tratados como texto.
- Navegação por identificadores exatos, inclusive OC associada ao fornecedor. Destinos são validados no processo principal; não se aceita URL ou caminho de arquivo vindo do resultado.
- Respostas atrasadas não substituem a pesquisa atual. Falha de um módulo é apresentada como busca parcial. A contagem de requisições é liberada também em falhas.
- Filtros dos módulos preservados ao abrir registros; detalhes do item localizado são mostrados em modal mesmo quando ele não corresponde ao filtro salvo.
- Urgência booleana opcional, persistente e independente de prazo e cotações. Somente mapas ativos urgentes ganham prioridade de ordenação; mapas antigos funcionam sem o campo.
- Conclusão remove apenas `reference_image` dos itens na mesma gravação que conclui o mapa. Cancelamento, falha de gravação e envio em andamento preservam os dados. Repetir a conclusão não altera novamente a revisão.
- Ao testar a conclusão foi encontrada uma inconsistência existente: a seleção de Concluídos era sobrescrita pela navegação a Mapas ativos. A chamada final agora navega diretamente para Concluídos.

## Gates da distribuição

1. `npm test`: sintaxe, testes Python, testes Node e ordenação.
2. `tests/integration/home-search.cjs`: sete cenários com renderer, preload e IPC reais e dois servidores Python em bases temporárias.
3. `tests/integration/quotation-items.cjs`: regressão da inclusão/remoção de itens, cancelamento, falhas e cotações existentes.
4. Compilar os três motores em Windows e verificar presença e funcionamento de SQLCipher e backup-sync.
5. Empacotar o instalador e conferir novamente os motores embarcados.
6. Extrair o ZIP portátil e comparar o hash de cada arquivo com o aplicativo empacotado.
7. Criar a release exclusivamente como Draft e verificar quantidade, estado e digest de cada anexo.

Logs de execução e capturas da interface ficam nos artefatos do workflow `Vyzium 3.4.6 Search Priority Draft`.

## Limites

Os testes de interface usam doubles da janela Electron, autenticação e serviços de inicialização; executam os handlers reais de IPC. Não são uma instalação interativa do aplicativo nem um envio real a fornecedor. Nenhuma instalação, base ou sessão de produção foi usada nos testes. Os seis testes de SQLCipher indisponíveis no ambiente Linux são executados no pipeline Windows com a dependência instalada.

A limpeza não reescreve backups anteriores, não compacta o banco com VACUUM e não faz exclusão retroativa em mapas já concluídos. O espaço das fotos removidas fica reutilizável pelo banco; não se promete redução imediata do arquivo físico nem exclusão segura de todas as cópias históricas.
