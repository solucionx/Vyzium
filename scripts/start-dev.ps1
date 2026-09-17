$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    py -3 -m venv (Join-Path $ProjectRoot ".venv")
    & $Python -m pip install -r (Join-Path $ProjectRoot "backend\requirements.txt")
}
Set-Location $ProjectRoot
npm install
if ($LASTEXITCODE -ne 0) { throw "Não foi possível instalar as dependências do aplicativo." }
$env:FOLLOWUP_PYTHON = $Python
npm start
