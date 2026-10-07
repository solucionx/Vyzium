# Vyzium 3.4.11 — Últimas compras

Base: 3.4.10, commit `9d3c4e4a51240bb40f4b021039185fb2050541c1`. Inclui a visualização detalhada dos mapas da versão anterior.

A nova aba **Últimas compras**, na barra lateral azul de Cotação & Mapas, permite pesquisar um artigo antes de comprar e abrir suas OCs e entradas presentes na BASE SCI importada.

- Busca por código ou descrição, sem exigir acentos, com filtros por hotel, fornecedor e itens com entrada registrada.
- Cada artigo abre suas OCs da mais recente para a mais antiga, com hotel, fornecedor, SCI, data, quantidade, preço unitário e total do item na OC.
- Recebimentos mostram data, nota fiscal, quantidade, unidade, preço unitário de entrada e total de entrada quando esses campos constarem na planilha.
- Preços de OC e de entrada ficam separados. O valor da OC nunca é apresentado como valor de entrada. Campos ausentes ficam como **Não informado**. Quando calculado de um total e quantidade da mesma entrada, o preço traz essa indicação.
- Artigos com unidades diferentes ficam separados; unidade da SCI não é apresentada como unidade da OC. Itens cancelados são excluídos inicialmente e podem ser consultados com identificação explícita.
- OCs com várias linhas são agrupadas, entradas idênticas repetidas no export são deduplicadas e valores divergentes ficam sem referência. Datas ausentes são sinalizadas.
- A consulta é paginada e mostra o arquivo e a data da importação. O histórico corresponde às OCs presentes nessa planilha; não recupera compras que o export não contém.

**Após instalar, importe novamente a BASE SCI** para alimentar o novo histórico. As versões anteriores guardavam somente itens elegíveis para cotação. A importação continua preservando mapas, cotações, mensagens e filtros; substitui o catálogo e o histórico da planilha em uma única transação com backup prévio.

O histórico usa o banco criptografado existente, sem alteração de schema. O merge de backups conserva o histórico junto da importação escolhida. A integração adiciona uma rota de consulta; o código de sessão, QR, navegador e envio do WhatsApp e as dependências permanecem iguais à 3.4.10.

Validações exigidas: testes Python/Node; interface com base sintética de 14 mil linhas, filtros, preços/entradas, falhas, respostas fora de ordem, navegação com edição pendente e tela menor; regressões do visualizador, busca e inclusão de itens; compilação dos três motores, SQLCipher, pacote Windows, integridade do WhatsApp, portátil e hashes dos seis anexos.

Arquivos: `Vyzium-Setup.exe`, `Vyzium-3.4.11-Portable.zip`, `Vyzium-3.4.11-Source.zip`, `latest.yml`, `.blockmap` e `SHA256SUMS.txt`.

**Draft — publicação manual por Levi.**
