# Vyzium 3.1.7 Audit — WhatsApp / CacheStorage

## Evidência que motivou a mudança

Nos logs reais da 3.1.6, o navegador automatizado repetiu a sequência:

1. `https://web.whatsapp.com/` inicia;
2. o console registra `Failed to execute 'open' on 'CacheStorage': Unexpected internal error`;
3. o WhatsApp Web navega para `?post_logout=1` e passa a registrar módulos internos não resolvidos;
4. o bootstrap não alcança o evento `qr`;
5. o watchdog encerra apenas o navegador da sessão e a tentativa termina em `Waiting failed`.

No mesmo computador, o Chrome normal e um Chrome com `--user-data-dir` novo conseguiram abrir o WhatsApp Web e exibir QR. Isso elimina o perfil novo como causa isolada. Esses testes, por si só, não separam Puppeteer de headless, então a 3.1.7 não assume uma causalidade maior do que a evidência permite.

## Mudança de execução

O Vyzium passa a usar `headless:false` por padrão para o WhatsApp. No Windows o Chrome recebe `--start-minimized`, mantendo o processo controlado pelo Puppeteer sem depender do caminho headless que apresentou a falha de CacheStorage.

É possível forçar um teste A/B com:

`VYZIUM_WHATSAPP_BROWSER_MODE=headless`

ou

`VYZIUM_WHATSAPP_BROWSER_MODE=headed`

## Fallback automático

Se headless for forçado e o console/probe detectar exatamente a falha fatal observada de CacheStorage, o Vyzium:

- invalida a geração defeituosa;
- encerra somente o Chrome iniciado pelo próprio Vyzium;
- preserva o `LocalAuth` da tentativa;
- reinicia a conexão em modo headed;
- registra todo o processo no diagnóstico.

O aviso tolerável `storage bucket persistence denied` não aciona fallback. A detecção exige o erro fatal de `CacheStorage`/`storage_initialization_error` observado no log real.

## Diagnóstico adicional

A 3.1.7 registra:

- `browser.launch-config`: modo efetivo, headless e flags;
- `puppeteer.browser-version`: versão real do Chrome anexado;
- `browser.storage-probe`: teste de escrita/leitura/remoção em CacheStorage;
- `browser.storage-failure-detected`: falha fatal reconhecida;
- `browser.storage-fallback-start` e `browser.storage-fallback-restart`: troca automática para headed.

O probe usa um cache temporário `__vyzium_cache_probe__`, remove-o ao terminar e não grava QR, cookies, credenciais ou mensagens no log.

## O que não foi alterado

- regras de envio;
- filtros;
- fila de mensagens;
- proteção contra envio duplicado;
- cadastro de fornecedores;
- comportamento do botão Gerar novo QR;
- rotação de perfil no novo QR;
- monitoramento/reconexão;
- segurança/Firebase/SQLCipher;
- módulos Acompanhamento e Cotação & Mapas.
