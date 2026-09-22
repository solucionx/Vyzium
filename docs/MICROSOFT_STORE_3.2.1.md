# Microsoft Store — Vyzium 3.2.1

Este projeto inclui uma build separada para Microsoft Store sem alterar o canal NSIS/GitHub existente.

## Identidade oficial

- Package/Identity/Name: `Solucionx.Vyzium`
- Package/Identity/Publisher: `CN=B0BDB428-BDCB-4054-A750-186A5394F35E`
- PublisherDisplayName: `Solucionx`
- Store ID: `9N67HQZVC7VJ`
- Arquitetura inicial: `x64`
- Familia de dispositivo: `Windows.Desktop`

## Por que AppX nesta primeira submissao

A versao atual do projeto fixa `electron-builder` em 26.0.0, que ja possui suporte consolidado ao alvo `appx`. O Partner Center aceita `.appx` diretamente. Isso evita atualizar dependencias do empacotador apenas para obter `.msix`, reduzindo risco de regressao na versao estavel.

A Microsoft Store re-assina pacotes AppX/MSIX aprovados. O pacote gerado por este workflow e destinado ao upload na Store; nao e para distribuicao direta/sideload sem assinatura confiavel.

## Gerar

No GitHub: **Actions -> Microsoft Store Package -> Run workflow**.

Ao terminar, baixe o artefato `Vyzium-Store-3.2.1-x64`. Dentro dele estara o `.appx` que deve ser enviado em **Partner Center -> Pacotes**.

## Atualizacoes

Quando executado como pacote Store, Electron define `process.windowsStore === true`. O Vyzium detecta esse modo e nao consulta o GitHub para atualizar; a Store passa a gerenciar as atualizacoes. A build NSIS normal continua usando o atualizador existente.
