$ErrorActionPreference = 'Stop'
$previousKey = $env:STRIPE_SECRET_KEY
try {
    if (-not $env:STRIPE_SECRET_KEY) {
        $secret = Read-Host 'Stripe Sandbox secret key (sk_test_...)' -AsSecureString
        $env:STRIPE_SECRET_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
    }
    & node (Join-Path $PSScriptRoot 'server.cjs')
    if ($LASTEXITCODE -ne 0) { throw "Sandbox exited: $LASTEXITCODE" }
} finally {
    if ($null -eq $previousKey) { Remove-Item Env:STRIPE_SECRET_KEY -ErrorAction SilentlyContinue }
    else { $env:STRIPE_SECRET_KEY = $previousKey }
}
