# Vyzium 3.2.7 — Stable Production

## Escopo
Correção cirúrgica do cenário observado em máquina limpa no qual Chrome/CDP iniciam, mas o WhatsApp Web entra em falha de Cache/Storage antes do primeiro QR. Mantém a arquitetura headful invisível, LocalAuth transacional, perfil em LOCALAPPDATA, bridge, envio, reconexão e regras dos módulos.

## Recuperação adicionada
- Detecta a falha real observada `Failed to execute 'put' on 'Cache': Entry already exists` e `storage_initialization_error`.
- Somente quando NÃO existe sessão estabelecida e o primeiro QR ainda está pendente: encerra o navegador, coloca o perfil provisório defeituoso em quarentena e cria um novo perfil provisório.
- A única tentativa de compatibilidade reinicia Chrome com `StorageBuckets` desativado, para forçar o site a usar o caminho de armazenamento tradicional. Essa opção nunca é aplicada a uma sessão estabelecida.
- A recuperação destrutiva de Storage/perfil ocorre no máximo uma vez. Se a tentativa seguinte sofrer falha transitória, o mesmo perfil de compatibilidade é preservado e o Vyzium continua tentando com backoff normal, sem novas quarentenas/rotações automáticas.
- `storage bucket persistence denied` isolado continua sendo apenas diagnóstico; não dispara limpeza.

## Proteções contra regressão
- Perfil LocalAuth estabelecido nunca entra na rotina de recuperação de primeira conexão.
- Nenhuma limpeza destrutiva no boot.
- Novo QR continua transacional: sessão ativa só é substituída após `ready`.
- Chrome continua headful e oculto pelo guard Win32; CDP/browserWSEndpoint permanece a arquitetura de conexão.
- Diagnóstico integral permanece ativo e sanitiza segredos conhecidos.

## Gate executado neste ambiente
- `node --check` em `electron/whatsapp.js`, `electron/main.js` e `electron/diagnostics.js`: aprovado.
- Testes WhatsApp: 52/52 aprovados, incluindo recuperação de Storage em primeira conexão.
- Gate Node completo: 113/113 aprovados + 6 verificações de ordenação.
- Python `compileall`: aprovado.
- Backend unittest: 151 executados; 138 aprovados, 6 pulados e 7 não executaram por ausência de `xlrd`/`xlwt` no ambiente de auditoria. As sete falhas são dependências de teste ausentes, não assertions/regressões do código.

## Gate físico obrigatório antes do Latest
Esta build deve ser instalada no PC limpo que reproduziu Chrome 153 + falha de Storage. Só promover para `Latest` após observar: CDP pronto -> bootstrap -> QR -> authenticated -> ready -> fechar/reabrir -> restauração da mesma sessão. Também validar um PC já autenticado para confirmar que a recuperação especial não é acionada.
