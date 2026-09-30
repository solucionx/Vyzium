# Vyzium 3.4.0 RC2 — restauração e merge

Esta candidata usa a instalação **Vyzium 3.4 RC Sandbox**, com bancos, sessão WhatsApp e identidade Windows separados da produção 3.3.8. O atualizador de produção permanece desativado na Sandbox.

## Alterações

- Restauração da conta em um PC vazio após recuperar a mesma chave de criptografia.
- Comparação dos dados locais e remotos, preservação de registros exclusivos e escolha explícita para conflitos.
- Proteção contra backup divergente substituir a versão principal; integração com Server 0.4 RC1 para manter o atual e dois anteriores.
- Backup manual em Configurações e no fechamento normal quando houver alterações; sem upload periódico durante o expediente.
- Registro persistente da restauração: bancos, WAL, ativação e linhagem local pertencem à mesma transação. Uma interrupção antes do commit recupera as cópias anteriores na próxima abertura; após o commit preserva os bancos restaurados.
- Falhas de download, troca de arquivos ou mudança do backup principal durante a revisão preservam os bancos locais. Operações simultâneas de restauração são bloqueadas.
- Todas as releases permanecem como **Draft** em `solucionx/Vyzium-Releases`, aguardando publicação manual por Levi.

## Validação automatizada

O workflow executa a suíte completa Node/Python no Windows, verifica o bootstrap do WhatsApp, compila e verifica os três motores com SQLCipher e gera instalador e pacote portátil. O Draft só recebe os arquivos após essas etapas passarem.

Os novos testes simulam falha ao remover um arquivo auxiliar, falha ao salvar a linhagem, download interrompido, mudança do backup principal, solicitações concorrentes e encerramento de outro processo no meio da transação. Também verificam preservação após commit e bloqueio quando uma cópia de recuperação está corrompida.

## Teste físico ainda necessário

Usar junto ao **Vyzium Server 0.4 RC1**, cuja instalação Android tem identidade separada da versão atual. Não desinstalar o servidor atual nem apagar seus dados.

1. Instalar a Sandbox Windows e o Server RC. No Poco, manter apenas um servidor ligado por vez quando utilizarem o mesmo túnel e porta. A RC Android exige configuração e autorização próprias.
2. Entrar na mesma conta verificada. Se já existe uma chave de recuperação da conta, usar esse código; não gerar outra chave para substituir a existente. O código não deve ser enviado em mensagens nem incluído nos diagnósticos.
3. Criar dados de teste na Sandbox e enviar um backup manual para o Server RC.
4. Abrir a Sandbox em outro Windows/perfil vazio, recuperar a chave e confirmar a restauração. Conferir itens, observações, fornecedores e cotações.
5. Alterar campos distintos nos dois computadores e verificar o merge; alterar o mesmo campo e confirmar que exige escolha explícita.
6. Enviar a partir de uma base antiga: o servidor deve preservar a versão principal e tratar o envio como divergente. Após quatro backups válidos com alterações, conferir atual + dois anteriores. Pode existir também um candidato divergente temporário.
7. Desligar o servidor, continuar usando os dados locais e confirmar que um envio que falha não apaga os bancos. Ligar novamente e repetir o backup manual.
8. Confirmar QR em perfil WhatsApp limpo e reconexão após reabrir.

A aprovação automatizada não comprova ainda o uso real no notebook corporativo e no Poco. Esta é uma candidata isolada, sem promoção da branch de restauração para produção. O usuário decide quando publicar o Draft.
