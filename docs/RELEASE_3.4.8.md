Correção do envio sequencial de várias fotos de referência pelo WhatsApp, baseada na versão publicada 3.4.7.

- Corrigido o caso observado em uso real no qual o texto e a primeira foto chegavam ao WhatsApp, mas as fotos seguintes não eram tentadas. Algumas versões do WhatsApp Web concluem uma chamada de envio de mídia sem devolver um objeto de mensagem; isso não significa falha.
- Uma chamada de mídia que conclui normalmente agora conta como foto com envio concluído, mesmo sem objeto de retorno, e o Vyzium continua para a próxima imagem.
- Para lotes grandes, cada foto recebe sua própria janela limitada de envio; foi removido o prazo global de 70 segundos que poderia interromper um fornecedor com muitas referências.
- O timeout da ponte local agora cresce conforme a quantidade de fotos (10 fotos: 590 s de margem máxima da chamada local; 20 fotos: 1090 s), enquanto cada upload individual continua limitado a 45 s.
- As fotos permanecem estritamente sequenciais, com pequena cadência entre elas; fornecedores também são processados um por vez, evitando dezenas de uploads simultâneos.
- Rejeição, timeout ou perda de conexão continuam interrompendo o lote e registrando exatamente quantas fotos concluíram antes da falha.
- Mantidas a correção de identificação interna da mídia introduzida na 3.4.7, a separação do resultado entre texto e fotos e a proteção contra reenvio duplicado.
- O histórico continua usando “envio concluído” como resultado da chamada ao WhatsApp; isso não significa leitura pelo fornecedor.

QR Code, sessão persistente, navegador invisível, banco, backup, restauração, busca geral, urgência de mapas e limpeza de fotos ao concluir permanecem inalterados.

Validações exigidas antes dos anexos: texto + três fotos com retorno de mídia vazio deve concluir 3 de 3; retorno vazio na primeira foto seguido de erro real na segunda deve registrar 1 de 3; falha antes da primeira foto deve registrar 0; estresse com 10 fotos deve concluir 10 de 10 de forma sequencial; lote com 10 fornecedores deve manter concorrência máxima igual a 1; testes Python e Node; QA da interface; compilação dos três motores; validação do WhatsApp dentro do app.asar por SHA-256; conferência integral do portátil; checksums e anexos.

Os testes automatizados usam dados sintéticos. Antes da publicação, recomenda-se repetir no Windows o envio real de uma cotação com pelo menos três fotos de referência.

Arquivos:

- `Vyzium-Setup.exe`: instalador Windows x64.
- `Vyzium-3.4.8-Portable.zip`: extraia a pasta inteira e execute `Vyzium.exe`. Não abra simultaneamente com a versão instalada.
- `Vyzium-3.4.8-Source.zip`: código-fonte.
- `latest.yml` e `.blockmap`: arquivos do atualizador.
- `SHA256SUMS.txt`: hashes dos anexos.

**DRAFT — publicação manual pelo usuário.**
