# Vyzium 3.5.2 — Revisão de armazenamento

## Correções
- Download repetido reutiliza a cópia existente após verificar SHA-256 e tamanho. Cliques simultâneos compartilham a mesma operação.
- Após download válido ou reutilização, mantém até três versões verificadas e remove duplicatas reconhecidas da versão 3.5.1. O backup selecionado é sempre preservado.
- Limpeza dos temporários reconhecidos de download com mais de 24 horas, ao iniciar outro download. Arquivos recentes ou desconhecidos são preservados.
- Na inicialização, mantém as cinco execuções de diagnóstico mais recentes e cinco ZIPs, preservando também arquivos com menos de 24 horas. Só remove pastas com nomes e conteúdo reconhecidos; links simbólicos e conteúdo desconhecido são preservados.
- A retenção é conservadora: falha de limpeza não bloqueia o uso. Arquivos corrompidos ou desconhecidos não são excluídos automaticamente e podem exigir revisão manual.

## Resultado da revisão
| Área | Comportamento |
| --- | --- |
| Downloads remotos | Reutilização por hash; até três cópias válidas reconhecidas após operação bem-sucedida |
| Snapshots automáticos locais | Já possuem retenção de dez por módulo; preservada |
| Logs principais | Já possuem rotação; preservada |
| Diagnósticos por execução e ZIPs | Nova retenção de cinco, mais arquivos recentes de menos de 24h |
| Backups manuais/protegidos, migração e recuperação | Preservados: podem ser a única cópia recuperável |
| Restauração pendente e seus temporários | Não atingidos pela limpeza de downloads |
| Cache, IndexedDB, LocalAuth e quarentena do WhatsApp | Preservados para não perder sessão ou possibilidade de recuperação |
| Bancos e histórico operacional | Não sofrem exclusão ou migração nesta atualização |

A revisão não estabelece um limite global para todo o armazenamento do aplicativo. Dados operacionais, backups protegidos, perfis em quarentena e arquivos não reconhecidos podem continuar crescendo; uma política de descarte para eles requer análise própria. Não foi medido o disco da instalação do usuário.

A atualização atua exclusivamente no computador. Nenhuma mudança na retenção do servidor no celular. Versão entregue como Draft, publicação manual conforme AGENTS.md.
