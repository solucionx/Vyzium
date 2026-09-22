# Validação técnica — Vyzium 3.2.1

Escopo: consolidação da evolução de Cotação & Mapas sobre a base 3.2.0 estável, sem alteração deliberada das regras estabilizadas de Acompanhamento, autenticação, Firebase, SQLCipher, auto-update ou sessão do WhatsApp.

## Funcionalidades consolidadas

- negociação assistida com meta de saving configurável por mapa;
- preço-alvo calculado por item a partir da melhor proposta inicial válida;
- cálculo individual da redução necessária de cada fornecedor em valor unitário e percentual;
- mensagem de negociação curta, editável e adaptada para um ou vários itens;
- prazo de entrega por fornecedor e item;
- escolha manual do fornecedor com motivo, observação e impacto financeiro quando a decisão não acompanha a menor proposta;
- conclusão e exclusão de mapas preservadas;
- allowlist do Electron cobrindo conclusão, exclusão, prévia e envio de negociação;
- exportação XLS e impressão preservadas.

## Compatibilidade preservada

- `appId`: `com.vyzium.gestaooperacional`;
- canal de release: `solucionx/Vyzium-Releases`;
- `whatsapp-web.js` mantido em `1.34.7` com o patch de bootstrap já estabilizado;
- bancos locais e migração SQLCipher preservados;
- arquivos `.gitignore`, `.firebaserc` e `firebase.json` mantidos na raiz para os gates de segurança e Firebase do workflow.

## Gate obrigatório

A publicação da release `v3.2.1` deve ocorrer somente depois de o workflow Windows Release concluir todos os testes Python, Node, verificação dos dois motores empacotados e criação do instalador sem falhas.
