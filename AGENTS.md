# Instruções do projeto

## Releases

- Regra definida por Levi em 29/09/2026: toda nova release deve ficar como **Draft** em `solucionx/Vyzium-Releases`, com os arquivos anexados e aguardando publicação manual pelo usuário.
- Isso vale para versões estáveis, candidatas e de teste. Pedidos para gerar, finalizar ou entregar uma versão não autorizam publicá-la.
- Use `draft: true`, `gh release create --draft` ou `releaseType: "draft"`, conforme a ferramenta. Não publique a release, não remova o estado Draft e não altere o canal público de atualização.
- A etapa final de publicação é do usuário, pelo botão **Publish release**, salvo instrução posterior explícita dele para publicar uma versão específica.
- Nunca sobrescreva os arquivos de uma release já publicada. Gere uma nova versão.
- Não modifique os dados ou as sessões da instalação de produção ao preparar candidatos isolados.
