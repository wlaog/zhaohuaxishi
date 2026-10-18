param([switch]$NoBrowser,[string]$ProjectRoot)
$ErrorActionPreference='Stop'
if(!$ProjectRoot){$ProjectRoot=Split-Path -Parent $PSScriptRoot}
Import-Module (Join-Path $PSScriptRoot 'Diary-Control.Core.psm1') -Force -DisableNameChecking
$url=Start-DiaryService ([IO.Path]::GetFullPath($ProjectRoot))
Write-Host "Diary URL: $url"
if(!$NoBrowser){Open-DiaryUrl $url}
