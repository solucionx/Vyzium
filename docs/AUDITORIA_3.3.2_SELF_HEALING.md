# Vyzium 3.3.2 — auditoria do WhatsApp Self-Healing

## Objetivo
Preservar o comportamento estável do Vyzium e adicionar recuperação automática apenas onde a correção pode ser feita sem apagar uma sessão autenticada, sem burlar controles do Windows e sem transformar uma falha transitória em loop destrutivo.

## Regras de segurança
- Perfil LocalAuth já comprometido/ativo nunca é apagado automaticamente.
- Perfil pendente, ainda não autenticado, pode ser colocado em quarentena uma única vez por ciclo de recuperação.
- Após uma recuperação destrutiva, novas falhas usam reconexão/backoff; não há rotação infinita de perfis.
- Gerar novo QR explicitamente inicia um novo ciclo de recuperação.
- Sentry e diagnóstico são observacionais/fail-open e não controlam Chrome, sessão, watchdog ou recuperação.
- Não há probe ativo de CacheStorage/IndexedDB antes de QR/ready.
- O Chrome continua headed e invisível via helper Win32/CDP.

## Matriz de falhas e resposta
1. CacheStorage `open` internal error: detecta; perfil pendente é quarentenado e recriado uma vez.
2. Cache `put` Entry already exists / storage_initialization_error: mesma recuperação transacional.
3. Persistence denied isolado: registra diagnóstico, mas não destrói perfil porque pode ser apenas aviso do navegador.
4. Perfil Chromium pendente inconsistente: watchdog pode recriar uma vez; perfil ativo é preservado.
5. Lock/perfil em uso: fecha transporte e repete Chrome/CDP com backoff, sem apagar credenciais.
6. Processo Chrome/helper órfão da geração atual: dispose + helper stop + árvore de processo no fallback existente.
7. Chrome encerra antes do CDP: repetição limitada do transporte.
8. DevToolsActivePort/CDP/WebSocket inválido: repetição limitada; helper valida /json/version e WebSocket antes de entregar endpoint.
9. Corrida de bootstrap/execution context/frame detached: até três tentativas do transporte com o mesmo perfil.
10. Timeout/Waiting failed/bootstrap: repetição segura e watchdog; perfil pendente pode receber uma única recuperação.
11. Rede/DNS/proxy transitório detectável: reconexão/backoff sem mexer na sessão.
12. LOGOUT real: não reutiliza indefinidamente credenciais invalidadas; exige novo QR preservando a lógica transacional.
13. Auth failure: uma recuperação normal; depois solicita novo QR em vez de destruir sessão repetidamente.
14. QR obsoleto: watchdog renova a conexão conforme regra existente.
15. Ready perde saúde: três falhas consecutivas antes de derrubar a sessão; reconexão automática.
16. Duas instâncias do Vyzium: bloqueadas pelo single-instance lock do Electron.
17. Diretórios/metadados divergentes: migração e session-state transacional preservam perfis existentes.
18. Falha ao gravar telemetria/Sentry: ignorada pelo caminho funcional (fail-open).
19. Falha de permissão/antivírus/política corporativa: não tenta burlar segurança do Windows; mantém erro diagnosticável.
20. Firewall/proxy bloqueando WhatsApp: não tenta burlar a rede; mantém reconexão/backoff e diagnóstico.
21. WhatsApp Web incompatível/mudança externa: integridade do patch é auditada; não inventa correção destrutiva para API externa desconhecida.
22. Pouca memória/encerramento externo do Chrome: transporte pode reiniciar; não altera dados persistidos.

## Limite técnico
Nenhum aplicativo pode garantir autocorreção de bloqueio imposto por antivírus/EDR, política corporativa, firewall, proxy, indisponibilidade do WhatsApp ou mudança incompatível no serviço remoto. Nesses casos a estratégia segura é detectar, preservar dados, tentar novamente quando apropriado e registrar a causa — nunca desativar a proteção do cliente.
