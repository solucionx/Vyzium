$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DistEngine = Join-Path $ProjectRoot "dist-engine"

$required = @(
  (Join-Path $DistEngine "followup-engine.exe"),
  (Join-Path $DistEngine "compras-engine.exe")
)

foreach ($file in $required) {
  if (-not (Test-Path $file -PathType Leaf)) {
    throw "Motor obrigatório ausente antes do empacotamento: $file"
  }
  $item = Get-Item $file
  if ($item.Length -lt 1MB) {
    throw "Motor gerado parece inválido ou incompleto: $file ($($item.Length) bytes)"
  }
  $hash = (Get-FileHash $file -Algorithm SHA256).Hash
  Write-Host "OK $($item.Name) | $([Math]::Round($item.Length / 1MB, 2)) MB | SHA256 $hash"
}
