$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'local-state/remote-access.json'
if (-not (Test-Path -LiteralPath $configPath)) { Write-Host 'No remote diary configuration.'; exit 0 }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $config.enabled) { Write-Host 'Remote diary is already disabled.'; exit 0 }
$uri = [Uri]$config.origin
$tailscale = Get-Command tailscale.exe -ErrorAction Stop
$serveText = & $tailscale.Source serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Serve. No settings were changed.' }
$serve = $serveText | ConvertFrom-Json
$route = $serve.Web.PSObject.Properties | Where-Object Name -EQ $uri.Authority
if (-not $route -and $uri.Port -eq 443) { $route = $serve.Web.PSObject.Properties | Where-Object Name -EQ ($uri.Host + ':443') }
if ($route) {
    $handlers = @($route.Value.Handlers.PSObject.Properties)
    if ($handlers.Count -ne 1 -or $handlers[0].Name -ne '/' -or $handlers[0].Value.Proxy -ne 'http://127.0.0.1:8766') { throw 'Serve now contains another application. No routes were removed.' }
    & $tailscale.Source serve "--https=$($uri.Port)" off
    if ($LASTEXITCODE -ne 0) { throw 'Could not disable the diary route.' }
}
@{ enabled = $false } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding ASCII
Remove-Item -LiteralPath (Join-Path $projectRoot 'local-state/remote-url.txt') -Force -ErrorAction SilentlyContinue
& (Join-Path $PSScriptRoot 'Stop-LocalDiary.ps1')
& (Join-Path $PSScriptRoot 'Start-LocalDiary.ps1') -NoBrowser
Write-Host 'Remote diary disabled. Local diary and saved files retained.'
