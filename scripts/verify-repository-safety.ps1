$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$forbiddenExtensions = @('.db', '.sqlite3', '.pem', '.pfx', '.p12', '.xls', '.xlsx', '.xlsm', '.csv', '.ods')
$forbiddenExactNames = @('.env', 'service-account.json', 'serviceAccount.json', 'auth-profile.json', 'session-established.json', 'session-state.json', 'connection-preference.json', 'whatsapp-debug.jsonl')
$ignoredDirectories = @('node_modules', 'dist', 'dist-engine', '.git')

$files = Get-ChildItem -Path $root -Recurse -File -Force | Where-Object {
    $full = $_.FullName
    -not ($ignoredDirectories | Where-Object { $full -match "[\\/]$([regex]::Escape($_))[\\/]" })
}

$badFiles = @()
foreach ($file in $files) {
    if ($forbiddenExtensions -contains $file.Extension.ToLowerInvariant()) { $badFiles += $file.FullName; continue }
    if ($forbiddenExactNames -contains $file.Name) { $badFiles += $file.FullName; continue }
    if ($file.Name -like '.env.*') { $badFiles += $file.FullName; continue }
}
if ($badFiles.Count -gt 0) {
    throw "Arquivos sensíveis/operacionais não podem entrar no repositório:`n$($badFiles -join "`n")"
}

$patterns = @(
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    '"type"\s*:\s*"service_account"',
    '"private_key_id"\s*:',
    'github_pat_[A-Za-z0-9_]{20,}',
    'ghp_[A-Za-z0-9]{20,}'
)
$textExtensions = @('.js','.cjs','.mjs','.json','.yml','.yaml','.py','.ps1','.md','.html','.css','.txt','.rules')
$matches = @()
foreach ($file in $files) {
    if (-not ($textExtensions -contains $file.Extension.ToLowerInvariant()) -and $file.Name -ne '.firebaserc') { continue }
    $content = Get-Content -Raw -LiteralPath $file.FullName -ErrorAction SilentlyContinue
    if ($null -eq $content) { continue }
    foreach ($pattern in $patterns) {
        if ($content -match $pattern) {
            $matches += "$($file.FullName) -> $pattern"
        }
    }
}
if ($matches.Count -gt 0) {
    throw "Possível credencial privada encontrada:`n$($matches -join "`n")"
}

Write-Host 'Repository safety check OK: nenhum banco, .env, chave privada, service account ou token GitHub encontrado.'
