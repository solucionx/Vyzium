# Vyzium 3.4.0 — produção

Esta entrega promove para produção apenas o conjunto já validado na linha 3.4 RC2, sem refatorar o ciclo de vida do WhatsApp, a criptografia SQLCipher, a política de backup ou o mecanismo de retenção nesta etapa de promoção.

## Compatibilidade e estabilidade

- mantém a identidade de instalação do Vyzium estável: `com.vyzium.gestaooperacional` / `Vyzium`;
- volta a usar o mesmo namespace de dados da versão de produção; a separação `Vyzium-3.4-RC-Sandbox` continua existindo apenas quando a versão contém `-rc.`;
- preserva o bootstrap de WhatsApp já validado, incluindo sessão existente e primeira conexão em perfil limpo;
- mantém backup criptografado VZB1 manual e no fechamento normal quando houver alteração, sem upload periódico;
- mantém restauração transacional dos dois bancos, recuperação após interrupção e bloqueio fail-closed se a cópia de recuperação estiver corrompida;
- mantém detecção de divergência, linhagem, retenção e merge com escolha explícita em conflitos;
- mantém as releases como Draft em `solucionx/Vyzium-Releases`. Publicação é manual.

## Terminologia

Toda comunicação desta versão refere-se ao equipamento Android apenas como **servidor**. A aplicação Desktop não depende de modelo ou fabricante específico de aparelho.

## Validação obrigatória do pipeline

A Draft `v3.4.0` só pode receber os binários após:

1. auditoria de segurança do repositório;
2. verificação do patch/bootstrap do WhatsApp;
3. suíte completa Python e Node;
4. compilação dos motores Acompanhamento, Cotação & Mapas e restauração/merge com SQLCipher;
5. verificação dos motores antes e depois do empacotamento;
6. geração do instalador, pacote portátil, fonte exata e SHA-256;
7. confirmação automática de que a release permanece em estado Draft.

A versão 3.3.8 publicada não é alterada nem sobrescrita por este processo.
