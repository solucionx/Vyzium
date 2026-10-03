Correção do envio de fotos de referência pelo WhatsApp, baseada na versão publicada 3.4.6.

- Corrigida a colisão do identificador interno da mídia que causava o erro “Data passed to getter must include an id property”. Foi incorporada uma correção pontual do projeto whatsapp-web.js, mantendo a versão 1.34.7 e o arquivo de conexão/autenticação original.
- Texto e fotos passam a ter o resultado registrado separadamente. Se o texto for enviado e alguma foto não concluir, o histórico informa “Texto enviado · fotos pendentes” e a quantidade concluída.
- Registros anteriores que preservaram o identificador do texto também mostram o resultado parcial conhecido, sem apagar ou reclassificar o histórico salvo.
- Uma foto sem resultado de envio não é contabilizada como concluída. Envios incompletos continuam bloqueados para repetição automática; conferir a conversa é necessário antes de liberar outra tentativa.

QR Code, sessão persistente, modo invisível do navegador, espera do envio de texto, dependências, banco, backup, restauração e as três melhorias da 3.4.6 preservados. “Enviada” indica conclusão da chamada ao WhatsApp, não leitura pelo fornecedor.

Validações exigidas antes dos anexos: reprodução do erro com o código real da dependência e módulos remotos simulados; correção de mídia, legenda e identificação; resultados parciais; persistência e bloqueio de duplicidade; testes Python e Node; integração da interface; compilação Windows; comparação por hash do bootstrap original e da mídia corrigida dentro do aplicativo; conferência integral do portátil e dos anexos.

Os testes usam dados sintéticos e não enviam mensagens reais. A entrega da imagem ao WhatsApp de um destinatário ainda precisa ser conferida no Windows de uso antes da publicação.

Arquivos:

- `Vyzium-Setup.exe`: instalador Windows x64.
- `Vyzium-3.4.7-Portable.zip`: extraia a pasta inteira e execute `Vyzium.exe`. Não abra simultaneamente com a versão instalada.
- `Vyzium-3.4.7-Source.zip`: código-fonte.
- `latest.yml` e `.blockmap`: arquivos do atualizador.
- `SHA256SUMS.txt`: hashes dos anexos.

**DRAFT — publicação manual pelo usuário.**
