# Vyzium 3.3.4 — correção do QR com navegador oculto

Base: projeto completo 3.3.3 entregue anteriormente. Análise motivada pelos arquivos `timeline-1.jsonl`, `system-1.json` e `RELATORIO-1.txt` do notebook da cliente, execução de 24/09/2026. Esta entrega contém código-fonte, não um instalador Windows já homologado.

## O que os registros comprovam

| Evidência | Conclusão permitida |
| --- | --- |
| Eventos 17, 25–29: Chrome selecionado, processo iniciado, página anexada e versão Chrome/154.0.8037.57 | O inicializador alcançou o navegador externo. A versão 142 informada em system.json pertence ao Electron, não a esse navegador. |
| Eventos 50–62: falha `Cache.put: Entry already exists`, quarentena e perfil novo | A recuperação automática foi executada na primeira tentativa. Não ficou apenas configurada. |
| Eventos 83–97: aviso de persistência, navegações e `bootstrap-stable` | O perfil novo chegou à barreira de estabilidade, mas não há evento de QR nessa tentativa. O aviso de persistência isolado não comprova corrupção do perfil. |
| Evento 101 seguido de 104: novo QR solicitado e `waitForFunction failed: frame got detached` | A espera foi interrompida pelo encerramento do navegador para atender ao novo QR. Esse erro de cancelamento não demonstra uma falha nova de armazenamento. |
| Eventos 115 e 135: nova tentativa interrompida aproximadamente três segundos depois | Cliques sucessivos podiam reiniciar o processo antes de ele concluir. |
| Último evento 180: `bootstrap-stable`, sem QR ou ready posterior | O registro termina antes de comprovar o resultado da última tentativa. Ele não informa qual espera interna ficou pendente. |
| Relatório com “ERROS CAPTURADOS: 0” e erros de console na timeline | A contagem anterior cobria os erros da aplicação registrados por outra função; o resumo era insuficiente para este caso. |

Os logs demonstram falha na primeira inicialização de armazenamento e recuperação sem confirmação de QR. Não permitem atribuir tudo a antivírus, permissões, Chrome 154, rede ou defeito físico. Não houve acesso remoto ao notebook.

## Defeito reproduzido e corrigido

O patch V6 usava `waitForFunction` sem configurar `polling`. O Puppeteer instalado usa `requestAnimationFrame` por padrão. O Vyzium mantém a janela real de Chrome/Edge oculta no Windows; quando os quadros de animação deixam de ocorrer, uma condição inicialmente falsa pode nunca ser reavaliada, mesmo que os módulos do WhatsApp fiquem prontos. Os argumentos existentes que desativam limitação de temporizadores não tornam essa espera independente de animações.

A V7 mantém o mecanismo do Puppeteer que acompanha mudanças de contexto e configura intervalos de 200 ms nas quatro esperas: Debug.VERSION, estado do Socket, módulos do QR e WWebJS após autenticação. A consulta só existe enquanto a espera está ativa; não foi acrescentado monitoramento permanente de 200 ms.

Reprodução em Chromium real 153.0.8010.0, Puppeteer instalado e `Client.inject()` real da dependência corrigida: suspendemos artificialmente `requestAnimationFrame` e disponibilizamos módulos sintéticos com atraso. O controle com a espera antiga expirou apesar de o Socket ter ficado pronto. A versão corrigida emitiu e renovou o QR sintético. Outra execução restaurou uma sessão sintética já sincronizada até `ready`.

**Isso prova o defeito e a correção nessa condição controlada. Não comprova, por si só, que essa é a única causa no notebook ou que um QR real já foi gerado nele.** Os registros antigos não capturavam visibilidade nem etapas internas suficientes para essa conclusão.

Referências primárias consultadas:
- Puppeteer, configuração de polling: https://pptr.dev/api/puppeteer.framewaitforfunctionoptions
- Chromium, animações e páginas ocultas: https://developer.chrome.com/blog/timer-throttling-in-chrome-88

## Demais correções limitadas a esta falha

- Solicitações repetidas de novo QR durante a mesma preparação reutilizam a tentativa em andamento. O botão indica essa preparação; a primeira solicitação continua disponível durante a inicialização automática. Depois de erro, uma nova tentativa explícita continua permitida.
- Fechar a página cancela imediatamente a barreira de bootstrap, evitando a espera antiga de até 60 segundos por um navegador já encerrado.
- Uma inicialização cancelada por pausa/troca de geração não aumenta o contador de falhas da tentativa substituta.
- O timeout criado pela própria barreira e os timeouts de autenticação são reconhecidos pela política de recuperação existente.
- Eventos informam as etapas `debug-wait`, `socket-wait`, `qr-modules-wait`, `qr-build`, `qr-listener-ready` e conclusão. O watchdog inclui a etapa onde parou.
- Diagnóstico observa visibilidade, estado do documento, conectividade declarada e presença de elemento QR. Não registra conteúdo de QR ou credenciais e não faz testes ativos de CacheStorage/IndexedDB.
- O relatório inclui ocorrências do WhatsApp e a última etapa, separadas dos erros da aplicação. Mensagens de console não são automaticamente tratadas como falhas fatais.
- Instalação e verificação usam o marcador V7. Aplicar o patch em uma dependência limpa ou migrar a V6 produz o mesmo `Client.js`; repetir a aplicação não altera o arquivo.

A estrutura de pastas, bancos, regras de Cotação & Mapas/Acompanhamento, autenticação e formato de sessões foram preservados. O lançador PowerShell, os argumentos do navegador e as versões das dependências permanecem iguais à 3.3.3. As correções e o relatório de auditoria anterior continuam incluídos. Os alertas de dependências documentados naquela auditoria não foram resolvidos por este hotfix.

## Validação executada

| Validação | Resultado |
| --- | --- |
| Python, com as dependências declaradas e SQLCipher disponível | 153 aprovados, sem testes pulados |
| Node | 147 aprovados, sem testes pulados |
| Ordenação | 6 verificações aprovadas |
| Chromium + Puppeteer + inicialização corrigida | 5 aprovados: controle RAF bloqueado, QR/renovação, sessão restaurada, troca de contexto e cancelamento |
| Cotação & Mapas: renderer/preload/IPC e servidor Python real | 15 cenários aprovados; 67 HTTP, 55 IPC, 8 gravações aceitas, 4 rejeições esperadas, nenhum erro não tratado |
| Patch aplicado por npm ci, migração V6 e reaplicação | Código válido, migração igual à instalação limpa, idempotência confirmada |

Evidências em `docs/validation-3.3.4/`. Os testes de navegador usam módulos sintéticos; não conectam uma conta real nem enviam mensagens. Os testes de integração simulam os componentes de sistema operacional/Electron. Não foi executado um instalador Windows nem o lançador Win32 neste ambiente Linux.

## Gerar e validar no notebook

1. Gere a versão com o fluxo Windows já existente. Para compilação local, na raiz do projeto: `powershell -ExecutionPolicy Bypass -File .\scripts\build-app.ps1`. O fluxo GitHub existente também verifica o patch V7 antes de compilar. `npm run verify:whatsapp-patch` deve concluir com sucesso; não reutilize uma pasta `node_modules` de um instalador antigo.
2. Instale primeiro no notebook afetado. Confirme a versão 3.3.4 e mantenha os dados da instalação. Abra o painel WhatsApp e deixe a tentativa avançar por até cinco minutos, sem pedir sucessivos novos QR.
3. Se aparecer o QR, escaneie, aguarde “Conectado”, feche e reabra o Vyzium para verificar a restauração da sessão. Valide um envio de teste autorizado e a navegação dos dois módulos.
4. Faça também um teste em um computador de homologação com sessão existente antes da distribuição geral, para verificar preservação da conexão e dos dados.
5. Se continuar sem QR, feche o Vyzium normalmente para finalizar os registros e envie o ZIP de diagnóstico dessa execução inteira. A timeline deve mostrar `hasVyziumPatch: true`, `hasHiddenWindowPolling: true` e a última etapa. O aviso de persistência isolado não é motivo para apagar dados ou repetir indefinidamente a limpeza de perfis.

Para repetir o teste automatizado específico em uma máquina de desenvolvimento, configure `VYZIUM_TEST_CHROMIUM` para um executável Chromium/Chrome de teste e execute `npm run test:whatsapp-browser`.

A autocorreção continua limitada às condições implementadas e aos limites de tentativas descritos em `AUDITORIA_3.3.3.md`. A geração real do QR depende também do ambiente local e do WhatsApp Web. A 3.3.4 é uma candidata corrigida e testada, não uma certificação de estabilidade universal.
