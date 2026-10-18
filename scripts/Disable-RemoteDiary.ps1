param([string]$ProjectRoot)
$ErrorActionPreference='Stop'
if(!$ProjectRoot){$ProjectRoot=Split-Path -Parent $PSScriptRoot}
Import-Module (Join-Path $PSScriptRoot 'Diary-Control.Core.psm1') -Force -DisableNameChecking
Disable-DiaryRemote ([IO.Path]::GetFullPath($ProjectRoot))
Write-Host 'Phone access disabled. Local diary and saved files are retained.'
