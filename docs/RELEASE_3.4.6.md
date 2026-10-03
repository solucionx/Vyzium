Atualização limitada às três melhorias combinadas:

- **Busca geral somente na Visão Geral**, logo abaixo da apresentação e antes do resumo. Pesquise OC, SCI, item, fornecedor ou mapa e clique no resultado para abrir o registro. A busca aceita termos sem acentos e preserva os filtros dos módulos.
- **Mapa urgente**: dentro do mapa, marque a opção ao lado do prazo e clique em **Salvar e calcular**. Mapas ativos urgentes aparecem primeiro e recebem o selo **Urgente**. A marcação não altera o prazo nem os cálculos.
- **Limpeza das fotos ao concluir**: a confirmação informa que as cópias das imagens dos itens serão removidas do mapa. Cancelar preserva as fotos. Concluir mantém valores, fornecedores, observações, decisões e histórico, e abre a aba **Concluídos**.

Os arquivos originais e as fotos já enviadas não são apagados. Backups anteriores podem conter as imagens; esta atualização não altera a retenção dos backups. A remoção libera espaço reutilizável no banco, mas o tamanho do arquivo do banco pode não diminuir imediatamente.

Validação exigida antes de anexar esta distribuição: testes Python e Node, integração da interface com os dois motores, regressão da inclusão de itens, compilação Windows, verificação dos motores e do SQLCipher empacotado, conferência integral do ZIP portátil e dos hashes dos anexos. Os testes utilizam bases sintéticas e não enviam mensagens reais.

Dependências de produção, autenticação, sessão do WhatsApp, backup/restauração, regras de cotação e esquema SQL mantidos. Mapas anteriores continuam compatíveis; sem marcação anterior, são tratados como não urgentes.

Arquivos:

- `Vyzium-Setup.exe`: instalador Windows x64.
- `Vyzium-3.4.6-Portable.zip`: extraia a pasta inteira e execute `Vyzium.exe`, sem instalar. Não execute ao mesmo tempo que a versão instalada.
- `Vyzium-3.4.6-Source.zip`: código-fonte desta versão.
- `latest.yml` e `.blockmap`: arquivos do atualizador.
- `SHA256SUMS.txt`: hashes para conferir os arquivos.

**DRAFT — publicação manual pelo usuário.** A validação automatizada não substitui a conferência no Windows de uso, com sua base e sessão reais, antes da publicação em produção.
