Vyzium 3.4.9 — retorno à base 3.4.6 com cotações somente por texto.

Esta versão foi reconstruída a partir da linha estável 3.4.6 para retirar integralmente o recurso experimental de imagens nas cotações.

Mantido:
- Busca geral exclusivamente na Visão Geral, com navegação para OC, SCI/item, fornecedor e mapa.
- Marcação de Mapa urgente dentro do mapa.
- Mapas ativos urgentes aparecem primeiro e recebem o selo Urgente.
- Progresso percentual dos mapas ativos e demais recursos estáveis já presentes na base.

Retirado:
- Seleção e processamento de fotos por item.
- Prévia de imagens na cotação.
- Envio de imagens pelo WhatsApp.
- Tratamento de MessageMedia e lotes de mídia.
- Limpeza automática de fotos ao concluir o mapa.

O envio de solicitação de cotação volta a ser somente texto. Negociações e Acompanhamento continuam somente texto como antes.

Compatibilidade:
- Mapas criados nas versões testadas que ainda possuam o campo legado reference_image continuam abrindo.
- O campo legado não aparece na interface, não participa da prévia e não é enviado ao WhatsApp.
- A atualização não apaga automaticamente bytes antigos do banco, evitando uma alteração destrutiva durante o retorno à versão estável.

Validação exigida antes dos anexos:
- testes Python e Node;
- teste explícito garantindo payload de cotação somente com phone e message;
- busca geral e navegação pela Visão Geral;
- persistência e ordenação dos mapas urgentes;
- integração real renderer/preload/IPC com backends temporários;
- regressão de inclusão e remoção de itens;
- compilação dos três motores Windows;
- verificação do SQLCipher e dos motores empacotados;
- conferência integral do ZIP portátil e hashes dos anexos.

Arquivos:
- `Vyzium-Setup.exe`: instalador Windows x64.
- `Vyzium-3.4.9-Portable.zip`: versão portátil.
- `Vyzium-3.4.9-Source.zip`: código-fonte.
- `latest.yml` e `.blockmap`: arquivos do atualizador.
- `SHA256SUMS.txt`: hashes dos anexos.

**DRAFT — publicação manual pelo usuário.**
