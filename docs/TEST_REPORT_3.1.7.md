# Test report — Vyzium 3.1.7 WhatsApp Storage Audit

## Suíte Node

`npm run test:node`

Resultado final: **86/86 testes aprovados**, além de **6 verificações de ordenação aprovadas**.

Foram adicionados testes específicos para:

- modo de navegador padrão = headed;
- override explícito headless/headed;
- diferenciação entre aviso tolerável de persistência e falha fatal de CacheStorage;
- reprodução do erro real `Failed to execute 'open' on 'CacheStorage': Unexpected internal error`;
- encerramento da instância headless defeituosa;
- preservação do mesmo `LocalAuth` no fallback;
- reinício automático com `headless:false`;
- continuidade dos testes anteriores de QR, `ready`, sessão persistente, logout, reconexão, watchdog e envio.

## Backend WhatsApp

Executado isoladamente a partir da pasta `backend`:

`python -m unittest test_whatsapp -v`

Resultado: **19/19 testes aprovados**.

## Suíte backend completa neste ambiente

A descoberta completa executou 97 testes. Os únicos erros ocorreram nos testes legados de importação/exportação `.xls` porque o ambiente de auditoria não possui os módulos Python `xlrd` e `xlwt`. A tentativa de instalar essas dependências não foi possível porque o ambiente não possui acesso de rede. Quatro testes SQLCipher também foram corretamente ignorados porque `sqlcipher3` não está instalado.

Esses erros de ambiente não têm relação com a alteração do WhatsApp. Os testes específicos de WhatsApp no backend passaram integralmente.

## Limite do teste local

O ambiente de auditoria não é Windows e não acessa o WhatsApp Web real. Portanto, a confirmação final de que o Chrome headed elimina o erro de CacheStorage precisa ocorrer no mesmo Windows que produziu o log original. A versão foi instrumentada para tornar esse teste conclusivo: o próximo log informa modo, versão do Chrome, resultado do probe de CacheStorage e eventos de QR.
