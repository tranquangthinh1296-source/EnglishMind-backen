# Gửi email tổng hợp feedback tới FEEDBACK_NOTIFY_TO (owner).
# Cần: Railway đã deploy server mới + SMTP env trên Railway.
# Local test: copy SMTP_* vào server/.env hoặc set env trước khi chạy.

param(
    [int]$Hours = 24,
    [string]$BaseUrl = "",
    [string]$BetaKey = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

if (-not $BaseUrl) {
    $envFile = Join-Path $Root ".env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^BETA_OPS_BASE_URL=' } | Select-Object -First 1
        if ($line) { $BaseUrl = ($line -replace '^BETA_OPS_BASE_URL=', '').Trim() }
    }
}
if (-not $BaseUrl) { $BaseUrl = "https://englishmind-backen-production.up.railway.app" }

if (-not $BetaKey) {
    $envFile = Join-Path $Root ".env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^BETA_OPS_API_SECRET=' } | Select-Object -First 1
        if ($line) { $BetaKey = ($line -replace '^BETA_OPS_API_SECRET=', '').Trim() }
    }
}

if (-not $BetaKey -or $BetaKey.Length -lt 24) {
    Write-Error "Thiếu BETA_OPS_API_SECRET trong .env (>= 24 ký tự)."
}

$uri = "$($BaseUrl.TrimEnd('/'))/v1/admin/feedback-digest"
$body = @{ hours = $Hours } | ConvertTo-Json

Write-Host "POST $uri (window ${Hours}h)..."
$response = Invoke-RestMethod -Uri $uri -Method Post `
    -Headers @{ "X-EnglishMind-Beta-Key" = $BetaKey; "Content-Type" = "application/json" } `
    -Body $body

$response | ConvertTo-Json -Depth 4
