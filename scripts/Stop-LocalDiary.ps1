$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot 'local-state/server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No launcher-managed diary service is running.'; exit 0 }
$diaryProcessId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
$diaryProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $diaryProcessId" -ErrorAction SilentlyContinue
$serverScript = Join-Path $projectRoot 'local-diary/server.mjs'
if ($diaryProcess -and $diaryProcess.Name -eq 'node.exe' -and $diaryProcess.CommandLine.Contains($serverScript)) {
    Stop-Process -Id $diaryProcessId
    Write-Host 'LIFE local diary service stopped. Saved files are retained.'
} elseif ($diaryProcess) { throw 'The recorded process no longer belongs to this diary. It was not stopped.' }
Remove-Item -LiteralPath $pidFile -Force
