# Vyzium 3.3.3 — auditoria e recuperação conservadora

Data: 24/09/2026. Base: ZIP 3.3.2 anexado pelo solicitante. Nenhuma Release publicada, mensagem enviada, conta real conectada ou base de cliente utilizada nesta execução.

## Parecer

**Candidato a homologação; não certificado para distribuição geral em produção.** Há correções reproduzidas por testes para falhas reais de concorrência, persistência e recuperação. O aplicativo não consegue autocorrigir universalmente políticas do Windows, indisponibilidade de rede, incompatibilidade remota do WhatsApp, falta de recursos ou bloqueio de EDR.

A causa na máquina da cliente continua **não confirmada**: o anexo descreve hipóteses e mensagens históricas, mas não contém um diagnóstico atual reproduzível daquela máquina. O pacote trata falhas verificáveis do código e melhora a capacidade de recuperar a inicialização; não comprova que o QR funcionará nesse computador.

Foram feitos inventário completo do pacote, validação sintática de todos os arquivos JS/CJS/Python/JSON de código/configuração, revisão estática transversal e leitura aprofundada dos caminhos de maior risco: WhatsApp, inicialização/encerramento, segurança, migração, bancos, importação e envio. Isso não equivale a prova formal de cada linha, cobertura de todos os ramos ou ausência de bugs. O inventário identifica os arquivos efetivamente incluídos e os hashes; testes e limites estão registrados abaixo.

## Defeitos corrigidos

| Área | Defeito e efeito | Correção |
|---|---|---|
| Inicializador oculto | Um helper que terminava tarde podia instalar um cliente após encerramento ou substituição da tentativa | Confere a geração após o lançamento assíncrono e encerra o helper obsoleto |
| Novo QR, recuperação e logout | Operações antigas podiam modificar perfil/estado depois de uma nova ação | Confere a geração após esperas de encerramento e quarentena; callbacks obsoletos perdem autoridade |
| Pausa | Inicialização pendente podia impedir a retomada; ação antiga podia desfazer a pausa | Solta a referência da inicialização cancelada e preserva a decisão mais recente |
| Autenticação | O monitor ignorava uma promessa de initialize pendente; após authenticated, o watchdog inicial já estava cancelado | Deadline independente para sincronização autenticada, preservando credenciais |
| Perfil autenticado | Uma falha de escrita do marcador de sessão podia deixar perfil conectado elegível para quarentena | Proteção em memória e marcação persistida de autenticação/ready; perfil comprometido não é reparado destrutivamente |
| Cache/Storage | Recuperação dependia de mensagem de console; exceção de initialize/pageerror não recebia o mesmo tratamento | Encaminhamento dos três tipos de evidência ao mesmo mecanismo conservador |
| Repetição | Três tentativas por inicialização não impediam novas gerações indefinidas | Após três ciclos falhos, intervalo de cinco minutos, registrado em disco; depois volta a tentar |
| Fila automática | Polling de waitReady poderia se comportar como clique manual e zerar o intervalo | Polling não reinicia orçamento de recuperação; conectar manualmente pode antecipar uma tentativa |
| auth_failure/desconexão | initialize pendente bloqueava a reconexão mesmo após um evento terminal | Retira o cliente obsoleto, libera a promessa e agenda a tentativa permitida |
| Monitor de saúde | Chamadas simultâneas contavam mais de uma falha; resposta atrasada podia sobrescrever pausa | Reutiliza a verificação em andamento e confere geração/estado ao receber resultado |
| Timers | Auditoria a cada 100 ms permanecia viva quando initialize nunca resolvia | Timer pertence ao cliente e é cancelado no dispose |
| Encerramento | Chamadores da ponte podiam esperar todo o prazo de ready após shutdown | Espera reconhece sessão encerrada e termina rapidamente |
| Migração Chromium | Cópia parcial entre volumes aparecia como perfil definitivo; próxima abertura confiava nela | Copia para diretório intermediário, publica após concluir e conserva origem; falha usa origem existente |
| Helper PowerShell | Removia sinal de cancelamento recebido enquanto compilava o helper; bootstrap não consultava stop | Preserva sinal e verifica cancelamento antes do launch e durante espera de CDP |
| Segurança de dados | Repetir finalize em workspace ativo podia substituir banco atual por legado após erro de validação | Falha fechada: banco ativo fica intacto; não refaz migração a partir de cópia antiga |
| Cache de integridade | crypto não estava importado; cálculo de fingerprint falhava silenciosamente | Importação corrigida e teste de alteração de conteúdo e WAL |
| Compras | Erro ao persistir resultado final deixava send_lock permanentemente adquirido | Libera lock em finally independente; registro anterior impede reenvio inseguro |
| SQLCipher | Conexão aberta para chave rejeitada não era fechada explicitamente | Fecha conexão ao falhar aplicação/validação da chave |
| Diagnóstico | Falha de criação da pasta podia abortar o bootstrap do aplicativo | Criação e escrita de diagnóstico não bloqueiam o caminho funcional |
| ZIP de diagnóstico | Compress-Archive usava curinga com LiteralPath, que não expande curingas | Usa diretório literal, exige arquivo de saída existente |
| Saída do aplicativo | Diagnóstico síncrono era finalizado duas vezes e antes de encerrar o Chrome | Encerramento único; diagnóstico final após parar serviços, com finalização idempotente |
| Volume dos registros | Timeline e lista de erros/etapas podiam crescer sem limite dentro da execução | Rotação da timeline/erros e limites das listas em memória |

As regras de preços, prazos, filtros, importação, destinatários e classificação de envios permanecem as da base. Nenhum schema foi alterado. Não há novo provedor, download automático de navegador, exclusão automática de banco ou modificação de firewall/antivírus.

## Política de recuperação

- Mantém Chrome/Edge instalado, modo headed oculto, LocalAuth, caminho local por workspace e patch V6 do whatsapp-web.js 1.34.7.
- Até três tentativas de transporte para categorias já reconhecidas (CDP, contexto, rede, lock e bootstrap). O watchdog limita também inicializações pendentes.
- Até uma substituição automática de perfil pendente por ciclo. A pasta anterior é colocada em quarentena quando o Windows permite. Não reaproveita/destrói perfil autenticado para tentar resolver storage.
- Três ciclos falhos geram intervalo de cinco minutos; o contador/prazo é persistido quando o disco permite escrita. Não é bloqueio definitivo: haverá outra tentativa depois do intervalo.
- Conectar manualmente zera contador/intervalo, mas não reabre permissão para quarentena. Gerar novo QR explicitamente inicia novo ciclo de perfil. Ready zera falhas de inicialização.
- Logout real ou autorização rejeitada repetidamente exige um novo QR. Não há recuperação sem autorização do telefone.
- Envios incertos permanecem sujeitos à conferência manual. Recuperação de conexão não autoriza reenviar mensagens possivelmente já entregues.

## Matriz dos 32 itens do anexo

“Automática limitada” significa mecanismo existente/corrigido testado em condições controladas; não reprodução da máquina da cliente. “Externa” exige resolução da causa fora do aplicativo. O simples registro de erro não é comprovação de diagnóstico causal.

| # | Hipótese do anexo | Resposta e limite |
|---|---|---|
| 1 | Cache Storage inconsistente | Automática limitada: detecta erro fatal, põe somente perfil pendente em quarentena uma vez; sessão autenticada preservada |
| 2 | Persistência de Storage negada | Aviso isolado não causa limpeza; se for política/permissão, intervenção externa |
| 3 | Perfil inconsistente na primeira execução | Uma recuperação de perfil pendente; depois transporte/backoff/intervalo |
| 4 | Perfil bloqueado por Chrome anterior | Fecha cliente pertencente à sessão e tenta novamente; não remove locks às cegas nem encerra Chrome pessoal |
| 5 | Processo órfão | Dispose/helper de geração conhecida; não garante remoção de órfão de outra execução sem identificação segura |
| 6 | Chrome/helper encerra antes do CDP | Tentativas de transporte e diagnóstico, seguidas de intervalo; EDR continua externo |
| 7 | CDP responde mas WebSocket não funciona | Helper mantém validação de endpoint; transporte pode ser reiniciado |
| 8 | Corrida no launcher oculto | Proteção de geração/cancelamento corrigida; Win32 suspender/retomar ainda precisa teste Windows |
| 9 | Browser instalado incompatível | Identificação e erro; não troca o navegador automaticamente sem homologação |
| 10 | Atualização externa do Chrome | Mesmo limite do item 9; aplicativo não controla atualização do browser instalado |
| 11 | Permissão LOCALAPPDATA | Preserva perfil original quando migração falha; perfil novo sem acesso exige ajustar permissões |
| 12 | Antivírus/EDR | Externa; não desativa proteção nem cria exclusões |
| 13 | Controlled Folder Access/política | Externa; não altera política corporativa |
| 14 | PowerShell/helper bloqueado | Diagnóstico, limite de tentativas e intervalo; liberação deve vir do administrador |
| 15 | Firewall/proxy | Retentativa se transitório; bloqueio persistente é externo |
| 16 | DNS/rede instável | Transporte/reconexão conservadora; serviço indisponível não pode ser consertado localmente |
| 17 | post_logout=1 | Mantém barreira inicial e regra de logout; não presume que todo redirecionamento é defeito de storage |
| 18 | Bootstrap do whatsapp-web.js | Patch V6 preservado e verificado na dependência real; watchdog e retentativas limitadas |
| 19 | Mudança interna do WhatsApp Web | Externa; nova incompatibilidade pode requerer patch/release homologado |
| 20 | Patch incompleto | postinstall e verificador falham no build em vez de instalar silenciosamente patch inválido |
| 21 | Watchdog interrompe inicialização lenta | Prazo inicial de 120 s preservado; watchdog independente pós-auth; lentidão extrema ainda pode exceder prazo |
| 22 | Loop de recuperação | Uma rotação automática por ciclo e intervalo persistido após falhas; polling não burla intervalo |
| 23 | Recurso defeituoso não é limpo | Perfil pendente inteiro pode ser isolado uma vez; perfil autenticado não sofre limpeza automática de storage |
| 24 | Recuperação limpa demais | Protege ativo/autenticado/ready, confere geração e conserva originais na migração |
| 25 | LocalAuth desalinhado | Helper e LocalAuth apontam para o mesmo perfil; testes de contrato e migração |
| 26 | Mudança de diretório entre versões | Mantém caminhos; migração intermediária evita publicar cópia incompleta |
| 27 | Duas instâncias | Lock do Electron preservado; concorrência assíncrona interna recebe proteções adicionais |
| 28 | Encerramento incompleto | Invalida geração, encerra cliente, cancela timers, libera espera da ponte e finaliza diagnóstico uma vez |
| 29 | Pouca memória | Backoff/intervalo evita tempestade de processos; não cria memória nem impede encerramento pelo sistema |
| 30 | Backend/Electron interfere | Correções de lifecycle, locks e integridade; testes Python/Node/integração; sem promessa de cobrir todo erro futuro |
| 31 | Encoding | Logs de validação UTF-8; mojibake histórico não é tratado como causa de QR |
| 32 | Sentry | Mantém observacional/fail-open; testes de transporte/sanitização existentes; não governa recuperação |

## Evidências de validação

- `npm ci` concluído com download de Electron/Chromium desabilitado no ambiente Linux de QA; postinstall aplicou patch real.
- **153 testes Python aprovados, sem skips**: módulos, importações, backups, SQLCipher/migração, envio e novas regressões.
- **143 testes Node aprovados, sem skips**, incluindo 16 testes novos de lifecycle e testes adicionais de diagnóstico/segurança.
- **6 verificações de ordenação aprovadas**.
- **15 cenários de integração Compras aprovados**: renderer/preload/IPC reais + backend Python real; serviços de Electron/Windows simulados; navegador Chromium 153 no Linux. Foram 67 requisições HTTP, 55 chamadas IPC, 8 salvamentos bem-sucedidos, 4 rejeitados como esperado, nenhum erro não tratado.
- Verificador do patch V6 aprovado sobre dependência instalada, não apenas fixture.
- Verificação sintática de 63 arquivos JS/CJS/Python/JSON de código/configuração, sem erros. Documentos de evidência gerados depois não entram nessa contagem.
- ZIP comparado com o original: nenhum arquivo original removido; imagens, ícones e CSS preservados byte a byte. Alterações de renderer restringem-se à versão exibida.

Arquivos: `validation-3.3.3/tests.log`, `validation-3.3.3/compras-integration.log`, `validation-3.3.3/whatsapp-patch.log`, `validation-3.3.3/inventory.json` e `ALTERACOES_3.3.3.patch`.

Os testes novos foram executados contra a base antes das respectivas correções para reproduzir os defeitos centrais (lifecycle, migração ativa, fingerprint, locks e fechamento SQLCipher). Os testes de mecanismos adicionais também executam comportamentos, não apenas buscam texto. Os testes históricos que verificam código-fonte permanecem e não são considerados equivalentes a teste real de Windows.

## Dependências: ressalva material

`npm audit --json` retornou **18 pacotes com alertas: 17 high, 1 critical**. Contagens de pacotes incluem propagação transitiva e não representam 18 explorações independentes comprovadas no produto. Resultado integral preservado em `npm-audit-3.3.3.json`.

Electron 39.0.0, electron-builder 26.0.0, tar e cadeia Puppeteer/extract-zip aparecem nos alertas. O relatório sugere atualizações para parte deles, mas também sugere downgrade de whatsapp-web.js para 1.34.2 para parte da árvore — incompatível com o patch fixado em 1.34.7. **Não foi aplicado npm audit fix --force.**

Este hotfix preserva o grafo de dependências recebido. Corrigir esses alertas requer uma atualização de dependências com teste do instalador, bridge, isolamento, updater e QR no Windows. Não confundir “aprovou testes funcionais” com “livre de vulnerabilidades”. Os alertas impedem um parecer irrestrito de segurança corporativa nesta entrega.

## Homologação antes da publicação geral

1. Compilar no Windows pelo workflow existente, que cria draft e verifica os dois motores e o instalador. Este ambiente não produziu nem executou o instalador Windows.
2. Atualizar primeiro uma instalação de teste que já conecta: conferir reuso da sessão, filtros, observações, entregas, mapas e backups. Não apagar AppData, perfis ou bancos.
3. Na máquina afetada, registrar versão de Chrome/Edge e executar a tentativa de QR; verificar se atinge QR, authenticated e ready, depois fechar e reabrir. Se falhar, coletar o diagnóstico dessa execução.
4. Validar pausa/retomada, novo QR, fechamento durante bootstrap, falta de rede e recuperação sem tempestade de processos. Testar envio apenas com destinatário de teste e autorização.
5. Resolver/homologar alertas de dependências antes de declarar padrão corporativo. Só promover draft para latest após aceitar os resultados de Windows e da máquina afetada.

Para rollback funcional, manter o instalador anterior e os backups criptografados com o mesmo cofre/chave. O atualizador continua sem downgrade automático; colocar uma versão menor como latest não é mecanismo de rollback. Não substituir bancos recentes por cópia legada nem distribuir diretório de dados de outro usuário.

## Onde ficam os registros

Raiz de dados do Electron: `diagnostics/run-<data>-<boot>/RELATORIO.txt`, `timeline.jsonl`, `system.json`, `errors.log` e cópia de `whatsapp-debug.jsonl` ao encerrar os serviços. O ZIP `Vyzium-Diagnostico-<boot>.zip` é criado na pasta `diagnostics` durante saída normal se PowerShell permitir compactar. A origem é `app.getPath('userData')`, que pode variar conforme instalação. Log da sessão também fica no workspace `whatsapp-session` já existente.

O parâmetro histórico `hiddenBrowserDiagnosticLog` não é implementado pelo helper recebido; não presumir que `hidden-browser.log` existe. A instrumentação principal é a timeline e o log da sessão. Fechamento forçado/queda de energia pode impedir cópia final/compactação, mas registros já gravados permanecem. Retenção entre várias execuções e remoção de quarentenas antigas ainda devem ser administradas; a rotação adicionada limita arquivos da execução, não todo o histórico do usuário.

Referência técnica consultada para a correção de compactação: [Microsoft — Compress-Archive / LiteralPath](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.archive/compress-archive?view=powershell-5.1). Para lifecycle de browser: [Puppeteer — Browser](https://pptr.dev/api/puppeteer.browser). Essas referências não comprovam a causa na cliente.
