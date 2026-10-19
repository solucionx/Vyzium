# Vyzium 3.5.1 — Download seguro do backup principal

Base: release/v3.5.0-production, commit 9b2f624. Servidor: contrato da release/v0.5.1-android-updates.

## Uso
Em Configurações → Segurança dos dados, nos dois módulos, clique em **Baixar backup mais recente**. A pasta da cópia criptografada .vzb será aberta após a verificação. A cópia fica em backups/remote-downloads no workspace da conta.

O download não restaura, mescla ou substitui bancos. Para restaurar, continua existindo o fluxo de restauração e comparação do aplicativo. A chave do cofre da conta é necessária para validar o conteúdo; o arquivo baixado não contém essa chave.

## Preservação dos dados
- Seleciona HEAD/current do catálogo; um candidato divergente mais novo não é escolhido.
- Retenção do servidor intacta: principal + dois anteriores, com candidato divergente separado quando necessário.
- Catálogo moderno sem HEAD válido bloqueia a operação; servidor legado sem catálogo mantém compatibilidade de leitura por data.
- Valida tamanho, SHA-256, autenticação AES-GCM, identidade do workspace, manifesto e hashes dos arquivos internos.
- Cada download tem diretório exclusivo e só é apresentado como concluído após validação e sincronização do arquivo.
- Falhas removem somente o diretório temporário daquela operação; cópias anteriores e bancos ativos não são alterados.
- Não atualiza o parent de sincronização por apenas baixar um arquivo e não modifica o envio manual/ao fechar.
- Sem migrações de schema, alterações de chaves, identidade do aplicativo ou dados de produção.

## Validação
Testes de download cobrem HEAD versus divergente, HEAD ausente, downloads repetidos, corrupção, truncamento, chave errada, falha de rede, acesso negado e preservação de arquivo preexistente. A suíte de restauração cobre rollback e recuperação após interrupção.

O workflow Windows executa sintaxe, testes Node/Python, testes de interface existentes, compilação e verificação do portátil antes de criar uma **Draft**. Publicação permanece manual conforme AGENTS.md. Validação em dispositivo de produção não foi realizada nesta alteração.

Validação local em 19/10/2026: sintaxe aprovada; 229 testes Python, 206 testes Node e 6 verificações de ordenação aprovados. Ambiente Linux com sqlcipher3-binary 0.6.0; o workflow Windows usa sqlcipher3 0.6.2 conforme requirements.txt.
