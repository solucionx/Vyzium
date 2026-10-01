# Vyzium 3.4.1 — candidata operacional

Esta candidata parte exclusivamente da versão estável **Vyzium 3.4.0**, publicada em produção, usando como base o commit `79444b1b18fe6f22815843ee01b7d037dc381345` da branch `release/v3.4.0-production`.

A versão 3.3.9 gerada anteriormente não é base desta entrega e não deve ser publicada.

## Alterações desta candidata

- Home operacional, sem linguagem de landing page e usando apenas dados reais já fornecidos pelos endpoints do Vyzium.
- Sidebar em azul Vyzium mais claro e recolhível:
  - expandida na Home;
  - recolhida por padrão nos módulos;
  - alternância puramente visual, sem recarregar engine, filtros, sessão ou banco.
- Cotação & Mapas com acesso direto a:
  - Itens a comprar;
  - Mapas ativos;
  - Concluídos;
  - Fornecedores.
- Diretório de fornecedores em Compras reutiliza o mesmo cadastro do Acompanhamento.
- Edição do WhatsApp do fornecedor em Compras grava no cadastro compartilhado do Acompanhamento.
- Prazo opcional por mapa de compra, independente do prazo de 12 dias da SCI:
  - sem prazo definido;
  - vence hoje;
  - data futura;
  - mapa vencido;
  - mapa concluído nunca é marcado como vencido.

## Compatibilidade de dados

Não existe migração de schema para o prazo do mapa.

Os mapas já são persistidos como JSON dentro do banco SQLCipher. O campo opcional `due_date` foi acrescentado apenas ao objeto do mapa.

- `DB_SCHEMA_VERSION` permanece `1`;
- mapas existentes sem `due_date` continuam válidos;
- nenhum mapa antigo recebe prazo inferido;
- nenhum registro antigo é regravado em massa;
- o prazo da SCI continua controlado exclusivamente pela regra existente de 12 dias após aprovação.

## Base 3.4 preservada

A candidata mantém integralmente a arquitetura introduzida e validada na 3.4.0:

- `backend/backup_sync.py` e o terceiro motor `backup-sync-engine.exe`;
- restauração transacional e merge com conflitos;
- estado e linhagem de backup;
- backup criptografado VZB1;
- retenção e proteção contra divergência;
- recuperação após interrupção;
- Firebase/auth/security;
- SQLCipher;
- bootstrap e ciclo de vida do WhatsApp;
- atualização pelo repositório `solucionx/Vyzium-Releases`;
- identidade estável `com.vyzium.gestaooperacional` / `Vyzium`.

## Regra de publicação

O pipeline desta candidata é fail-closed. O Draft v3.4.1 só recebe arquivos após:

1. confirmar que a branch deriva exatamente da 3.4.0 estável;
2. validar escopo e arquivos protegidos;
3. executar a auditoria de segurança do repositório;
4. verificar a baseline validada do WhatsApp;
5. executar a suíte completa Python + Node, incluindo backup/restauração e os novos testes;
6. compilar os três motores;
7. verificar os motores antes e depois do empacotamento;
8. gerar instalador, pacote portátil, fonte exata e SHA-256;
9. confirmar que a Release permanece Draft e não é prerelease.

A publicação continua exclusivamente manual.
