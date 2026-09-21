# Auditoria local — Vyzium 3.1.0

Data da revisão: 2026-09-19

## Escopo

Revisão estática e testes locais da integração Firebase + proteção SQLCipher, mantendo como regra principal que os bancos legados de produção não sejam sobrescritos, renomeados nem apagados durante a migração.

## Controles verificados

- identidade da instalação preservada (`com.vyzium.gestaooperacional`);
- canal de atualização continua em `solucionx/Vyzium-Releases`;
- Firebase Web config sem credenciais do Admin SDK;
- renderer isolado (`contextIsolation`, `sandbox`, sem Node) e CSP sem rede direta;
- refresh token protegido por `safeStorage`;
- chave raiz aleatória de 256 bits e chaves distintas por módulo via HKDF-SHA-256;
- envelope de recuperação com scrypt + AES-256-GCM;
- código de recuperação não armazenado;
- bancos novos protegidos por SQLCipher;
- migração feita para novo arquivo, sem alteração do banco legado;
- comparação de contagem de registros e assinatura de schema na migração;
- banco SQLCipher validado novamente antes da ativação e antes de iniciar serviços operacionais;
- Data Safety permanece ativo para integridade, backup e rollback;
- backups em modo protegido continuam criptografados;
- Firestore com default deny e escopo por UID/workspace;
- workflow bloqueia banco, `.env`, chave privada, Service Account e token GitHub no repositório.

## Resultado local

- Node/Electron/segurança/updater/WhatsApp: **61/61 aprovados**.
- Ordenação: **6/6 aprovada**.
- Python: **94 testes descobertos**; **85 aprovados**, **5 não executáveis localmente por ausência de `xlrd`/`xlwt`** e **4 testes SQLCipher ignorados porque `sqlcipher3` não está instalado neste ambiente**.
- Sintaxe JavaScript: aprovada.
- Compilação Python: aprovada.

As dependências ausentes neste ambiente estão fixadas em `backend/requirements.txt`. O workflow Windows usa Python 3.12, instala essas dependências e deve executar toda a suíte antes do build. A release 3.1 não deve ser publicada até o GitHub Actions ficar totalmente verde.

## Gate adicional

Antes de testar a 3.1 contra o Firebase real, publique **exatamente** `firebase/firestore.rules` deste pacote. Esta versão das regras inclui `keyRecovery/current` e as restrições finais do workspace primário.
