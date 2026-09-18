$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    py -3 -m venv (Join-Path $ProjectRoot ".venv")
}
# Reconcile requirements on every development start. pip is idempotent when the
# pinned packages are already installed and this prevents an old venv from
# missing dependencies introduced by a newer Vyzium version (for example XLS).
& $Python -m pip install -r (Join-Path $ProjectRoot "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Não foi possível instalar as dependências do motor Python." }
Set-Location $ProjectRoot
npm install
if ($LASTEXITCODE -ne 0) { throw "Não foi possível instalar as dependências do aplicativo." }
$env:FOLLOWUP_PYTHON = $Python
npm start
