param([string]$ProjectRoot)
$ErrorActionPreference='Stop'
if(!$ProjectRoot){$ProjectRoot=Split-Path -Parent $PSScriptRoot}
Import-Module (Join-Path $PSScriptRoot 'Diary-Control.Core.psm1') -Force -DisableNameChecking
Stop-DiaryService ([IO.Path]::GetFullPath($ProjectRoot))
Write-Host 'Diary stopped. Saved files are retained.'
