# Vyzium 3.0.4 — Canal de Releases

## Objetivo

A 3.0.4 valida o novo canal público de distribuição sem criar uma nova GitHub Release no repositório de código `solucionx/Vyzium`.

- Código/build: `solucionx/Vyzium`
- Distribuição pública: `solucionx/Vyzium-Releases`
- Secret usado pelo workflow: `VYZIUM_RELEASE_TOKEN`
- Updater instalado: `solucionx/Vyzium-Releases`

## Segurança da transição

Durante a transição, o workflow é **somente manual (`workflow_dispatch`)**. Commits e tags no repositório de código não publicam versões automaticamente.

O workflow:

1. executa todos os testes;
2. compila `followup-engine.exe` e `compras-engine.exe`;
3. valida os dois motores antes do empacotamento;
4. gera o instalador com `--publish never`;
5. valida os dois motores dentro do pacote;
6. cria/atualiza uma **Draft Release somente em `solucionx/Vyzium-Releases`** usando `--repo` explicitamente;
7. envia `Vyzium-Setup.exe`, `.blockmap` e `latest.yml`.

A `v3.0.3` deve continuar sendo a última Release pública no repositório antigo durante a janela de transição, permitindo que instalações antigas recebam a Bridge antes de migrarem para o novo canal.

## Publicação

Após o GitHub Actions ficar 100% verde, revise a Draft criada em `Vyzium-Releases`. Só publique a Draft quando estiver pronto para que clientes 3.0.3 detectem a 3.0.4.
