$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    py -3 -m venv (Join-Path $ProjectRoot ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar ambiente Python." }
}
& $Python -m pip install -r (Join-Path $ProjectRoot "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar dependências Python." }
& $Python -m PyInstaller --noconfirm --clean --onefile --name followup-engine `
    --workpath (Join-Path $ProjectRoot "build\pyinstaller") `
    --distpath (Join-Path $ProjectRoot "dist-engine") `
    (Join-Path $ProjectRoot "backend\engine.py")
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar motor Python." }
Write-Host "Motor criado em dist-engine\followup-engine.exe"
