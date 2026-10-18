param([ValidateRange(1,65535)][int]$HttpsPort = 443, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if (-not $tailscale) { throw 'Tailscale is missing. Install and sign in on this computer and your phone.' }
$statusText = & $tailscale.Source status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale status.' }
$status = $statusText | ConvertFrom-Json
if ($status.BackendState -ne 'Running' -or -not $status.Self.Online) { throw 'Sign in to Tailscale on this computer using the same account as your phone, then try again.' }
$dnsName = ([string]$status.Self.DNSName).TrimEnd('.')
$tailnetUserProperty = $status.User.PSObject.Properties | Where-Object Name -EQ ([string]$status.Self.UserID) | Select-Object -First 1
$login = [string]$tailnetUserProperty.Value.LoginName
if ($dnsName -notmatch '^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$' -or $login -notmatch '^[\x21-\x7e]+$') { throw 'Tailscale DNS name or user identity is unavailable. Tagged devices are not supported.' }
$portSuffix = if ($HttpsPort -eq 443) { '' } else { ':' + $HttpsPort }
$remoteUrl = 'https://' + $dnsName + $portSuffix
$target = 'http://127.0.0.1:8766'
$serveText = & $tailscale.Source serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale Serve configuration.' }
$serve = $serveText | ConvertFrom-Json
$funnel = $serve.AllowFunnel.PSObject.Properties | Where-Object Value -EQ $true
if ($funnel) { throw 'Tailscale Funnel is active. Disable public sharing before enabling this private diary.' }
$existing = $serve.Web.PSObject.Properties | Where-Object Name -EQ ($dnsName + ':' + $HttpsPort)
if ($existing) {
    $handlers = @($existing.Value.Handlers.PSObject.Properties)
    if ($handlers.Count -ne 1 -or $handlers[0].Name -ne '/' -or $handlers[0].Value.Proxy -ne $target) { throw 'This HTTPS port already serves another application. Choose another -HttpsPort; existing routes were not changed.' }
}
if ($serve.TCP) {
    $tcp = $serve.TCP.PSObject.Properties | Where-Object Name -EQ ([string]$HttpsPort)
    if ($tcp -and -not $existing) { throw 'This port already has a Tailscale TCP service. Choose another -HttpsPort.' }
}
$statePath = Join-Path $projectRoot 'local-state'
New-Item -ItemType Directory -Path $statePath -Force | Out-Null
$serveText | Set-Content -LiteralPath (Join-Path $statePath 'serve-before.json') -Encoding UTF8
$config = @{ enabled = $true; origin = $remoteUrl; login = $login }
$configPath = Join-Path $statePath 'remote-access.json'
$config | ConvertTo-Json | Set-Content -LiteralPath ($configPath + '.tmp') -Encoding ASCII
Move-Item -LiteralPath ($configPath + '.tmp') -Destination $configPath -Force
Write-Host 'Starting the diary with private Tailscale access. Save any existing editor before running this launcher.'
try { $health = Invoke-RestMethod -Uri ($target + '/api/health') -TimeoutSec 2 } catch { $health = $null }
if ($health -and $health.remoteOrigin -ne $remoteUrl) { & (Join-Path $PSScriptRoot 'Stop-LocalDiary.ps1') }
& (Join-Path $PSScriptRoot 'Start-LocalDiary.ps1') -NoBrowser
$health = Invoke-RestMethod -Uri ($target + '/api/health') -TimeoutSec 2
if ($health.remoteOrigin -ne $remoteUrl) { throw 'The running diary has not loaded the remote settings. Save your drafts, stop the old diary process, and retry.' }
& $tailscale.Source serve --bg "--https=$HttpsPort" --yes $target
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve could not start. Follow any HTTPS enablement link above, then run this launcher again. Local diary remains available.' }
$remoteUrl | Set-Content -LiteralPath (Join-Path $statePath 'remote-url.txt') -Encoding ASCII
Write-Host "Phone URL: $remoteUrl"
Write-Host 'Connect Tailscale on your phone, then open this URL in its browser. Keep this computer awake and the diary service running.'
if (-not $NoBrowser) { Start-Process $remoteUrl }
