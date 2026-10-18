param([ValidateRange(1,65535)][int]$HttpsPort,[switch]$NoBrowser,[string]$ProjectRoot)
$ErrorActionPreference='Stop'
if(!$ProjectRoot){$ProjectRoot=Split-Path -Parent $PSScriptRoot}
Import-Module (Join-Path $PSScriptRoot 'Diary-Control.Core.psm1') -Force -DisableNameChecking
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
if($PSBoundParameters.ContainsKey('HttpsPort')){$settings=Get-DiarySettings $ProjectRoot;Update-DiarySettings $ProjectRoot $settings.port $HttpsPort}
$url=Enable-DiaryRemote $ProjectRoot
Write-Host "Phone URL: $url"
if(!$NoBrowser){Open-DiaryUrl $url}
