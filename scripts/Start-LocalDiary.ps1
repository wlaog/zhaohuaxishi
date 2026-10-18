param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $bundledNode = Join-Path $env:ProgramFiles 'nodejs/node.exe'
    if (-not (Test-Path -LiteralPath $bundledNode)) { throw 'Node.js 22 or newer is required. Install Node.js, then open this launcher again.' }
    $nodePath = $bundledNode
} else { $nodePath = $nodeCommand.Source }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/cheerio'))) { throw 'Dependencies missing. Run npm ci in the project directory first.' }
$serverUrl = 'http://127.0.0.1:8766'
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'exports/LIFE'))
function Get-DiaryHealth {
    try { Invoke-RestMethod -Uri "$serverUrl/api/health" -TimeoutSec 2 } catch { $null }
}
$health = Get-DiaryHealth
if ($health -and ($health.application -ne 'life-local-diary' -or $health.root -ne $expectedRoot)) { throw 'Port 8766 is already used by another application or diary folder.' }
if (-not $health) {
    $statePath = Join-Path $projectRoot 'local-state'
    New-Item -ItemType Directory -Path $statePath -Force | Out-Null
    $serverScript = Join-Path $projectRoot 'local-diary/server.mjs'
    $process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $statePath 'server.log') -RedirectStandardError (Join-Path $statePath 'server-error.log')
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        $health = Get-DiaryHealth
        if ($health) { break }
        if ($process.HasExited) { throw 'Local diary could not start. See local-state/server-error.log.' }
    }
    if (-not $health -or $health.application -ne 'life-local-diary' -or $health.root -ne $expectedRoot) { throw 'Local diary startup timed out or another application is using port 8766.' }
    $process.Id | Set-Content -LiteralPath (Join-Path $statePath 'server.pid') -Encoding ASCII
}
if (-not $NoBrowser) { Start-Process $serverUrl }
