param([string]$PageKey,[switch]$Navigate)
$ErrorActionPreference='Stop'
$root=Join-Path $PSScriptRoot '../exports/LIFE'
$m=Get-Content "$root/manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$p=$m.pages | Where-Object key -eq $PageKey
if(!$p){throw 'Page key not found'}
$null=New-Item -ItemType Directory -Force "$root/_audit/recheck"
$one=New-Object -ComObject OneNote.Application
try{
 foreach($mode in @(0,5,7)){
  $raw='';$one.GetPageContent($p.id,[ref]$raw,$mode)
  [IO.File]::WriteAllText("$root/_audit/recheck/$PageKey-mode$mode.xml",$raw)
  [xml]$d=$raw
  [pscustomobject]@{mode=$mode;characters=$raw.Length;images=$d.SelectNodes('//*[local-name()="Image"]').Count;tags=($d.SelectNodes('//*') | Group-Object LocalName | ForEach-Object {"$($_.Name):$($_.Count)"}) -join ','} | ConvertTo-Json -Compress
 }
 [xml]$old=Get-Content "$root/$($p.source)" -Raw -Encoding UTF8
 [pscustomobject]@{mode='old';characters=$old.OuterXml.Length;images=$old.SelectNodes('//*[local-name()="Image"]').Count;tags=($old.SelectNodes('//*') | Group-Object LocalName | ForEach-Object {"$($_.Name):$($_.Count)"}) -join ','} | ConvertTo-Json -Compress
 if($Navigate){$one.NavigateTo($p.id,'',$false)}
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($one)}
