$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    py -3 -m venv (Join-Path $ProjectRoot ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar ambiente Python." }
}
& $Python -m pip install -r (Join-Path $ProjectRoot "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar dependências Python." }

$Dist = Join-Path $ProjectRoot "dist-engine"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

& $Python -m PyInstaller --noconfirm --clean --onefile --name followup-engine --collect-all openpyxl `
    --workpath (Join-Path $ProjectRoot "build\pyinstaller-followup") `
    --distpath $Dist `
    (Join-Path $ProjectRoot "backend\engine.py")
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar motor de Acompanhamento." }

& $Python -m PyInstaller --noconfirm --clean --onefile --name compras-engine --collect-all openpyxl --hidden-import xlrd --hidden-import xlwt `
    --workpath (Join-Path $ProjectRoot "build\pyinstaller-compras") `
    --distpath $Dist `
    (Join-Path $ProjectRoot "backend\compras_engine.py")
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar motor de Cotação & Mapas." }

Write-Host "Motores criados em dist-engine\followup-engine.exe e dist-engine\compras-engine.exe"
