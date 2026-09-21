# Correção do workflow 3.0.1

Esta correção não altera funcionalidades do Vyzium.

Ela alinha o workflow real do repositório (`.github/workflows/windows-realese.yml`)
com os testes do projeto e garante que a release do Windows:

- compile `followup-engine.exe`;
- compile `compras-engine.exe`;
- valide os dois motores antes do Electron Builder;
- valide os dois motores dentro de `win-unpacked`;
- só então publique os artefatos.

O teste de configuração agora localiza o workflow de release pelo conteúdo,
em vez de depender de um nome de arquivo específico.
