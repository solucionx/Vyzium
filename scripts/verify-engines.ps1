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

# Critical Vyzium 3.1 gate: SQLCipher must really be bundled inside the one-file
# engine. Merely having the package in requirements is not enough.
$securityJson = & (Join-Path $DistEngine "followup-engine.exe") security-check
if ($LASTEXITCODE -ne 0) {
  throw "O followup-engine não conseguiu executar o diagnóstico do SQLCipher."
}
$security = $securityJson | ConvertFrom-Json
if (-not $security.available -or -not $security.cipher_version) {
  throw "SQLCipher não foi incorporado ao motor do Vyzium. Build bloqueado."
}
Write-Host "SQLCIPHER OK | versão $($security.cipher_version)"
