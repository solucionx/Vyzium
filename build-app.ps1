$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "build-engine.ps1")
Set-Location $ProjectRoot
npm ci
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar as dependências do WhatsApp." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o aplicativo." }
Write-Host "Instalador e arquivos de atualização criados na pasta dist."
