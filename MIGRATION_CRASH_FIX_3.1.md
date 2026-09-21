# Correção do crash nativo de migração SQLCipher (Windows)

Esta revisão elimina o caminho de migração baseado em `ATTACH/sqlcipher_export` e usa cópia
streaming do snapshot SQLite para um banco SQLCipher temporário. O objetivo é impedir que um
crash nativo do SQLCipher durante `ATTACH` derrube o processo sem uma exceção Python tratável.

Também foram adicionados:

- marcador de etapa de migração para diagnóstico de encerramento nativo;
- saída UTF-8 explícita no processo Python;
- quarentena automática de destino parcial de uma tentativa anterior, **somente** quando o
  banco legado original ainda existe e o destino atual falha na validação com a chave correta;
- `cipher_memory_security` volta ao padrão estável do SQLCipher (OFF), evitando spam/falhas de
  `VirtualLock()` no Windows. A criptografia do banco em repouso continua ativa; o recurso pode
  ser reativado com `VYZIUM_CIPHER_MEMORY_SECURITY=1`;
- o banco legado nunca é apagado, renomeado ou sobrescrito.

O código `0xC00000FD` é um encerramento nativo de stack overflow no Windows, portanto a
correção principal é evitar o caminho nativo que estava falhando, e não apenas capturar a
mensagem depois do crash.
