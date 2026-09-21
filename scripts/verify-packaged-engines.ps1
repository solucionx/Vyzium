$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Resources = Join-Path $ProjectRoot "dist\win-unpacked\resources\backend"

$required = @(
  (Join-Path $Resources "followup-engine.exe"),
  (Join-Path $Resources "compras-engine.exe")
)

foreach ($file in $required) {
  if (-not (Test-Path $file -PathType Leaf)) {
    throw "O instalador seria publicado sem um motor obrigatório: $file"
  }
  $item = Get-Item $file
  if ($item.Length -lt 1MB) {
    throw "Motor empacotado parece inválido ou incompleto: $file ($($item.Length) bytes)"
  }
  Write-Host "EMPACOTADO OK: $($item.Name) | $([Math]::Round($item.Length / 1MB, 2)) MB"
}

$securityJson = & (Join-Path $Resources "followup-engine.exe") security-check
if ($LASTEXITCODE -ne 0) {
  throw "O motor empacotado não conseguiu executar o diagnóstico do SQLCipher."
}
$security = $securityJson | ConvertFrom-Json
if (-not $security.available -or -not $security.cipher_version) {
  throw "O pacote Windows foi gerado sem SQLCipher funcional."
}
Write-Host "SQLCIPHER EMPACOTADO OK | versão $($security.cipher_version)"
