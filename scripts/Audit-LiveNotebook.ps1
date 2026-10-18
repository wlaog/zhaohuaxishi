[CmdletBinding()]
param([string]$Root)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -eq 'Core'){
 $desktopArgs=@('-NoProfile','-STA','-File',$PSCommandPath)
 if($Root){$desktopArgs+=@('-Root',$Root)}
 & "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" @desktopArgs
 if($LASTEXITCODE -ne 0){throw 'OneNote audit failed in Windows PowerShell.'}
 return
}
Import-Module "$PSScriptRoot/../Modules/OneNote/Application/OneNoteCompleteness.psm1" -Force
if(!$Root){$Root=Join-Path $PSScriptRoot '../exports/LIFE'}
$root=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Root)
$m=Get-Content "$root/manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$out="$root/_audit/live-recheck"
$null=New-Item -ItemType Directory -Force $out
$one=New-Object -ComObject OneNote.Application
$rows=New-Object Collections.ArrayList
$startedAt=[DateTime]::UtcNow.ToString('o')
function Counts([xml]$d){
 return [ordered]@{images=$d.SelectNodes('//*[local-name()="Image"]').Count;attachments=$d.SelectNodes('//*[local-name()="InsertedFile"]').Count;emptyObjects=$d.SelectNodes('//*[local-name()="OE" and not(*)]').Count;texts=$d.SelectNodes('//*[local-name()="T"]').Count}
}
try{
 $before=Get-OneNoteCompleteHierarchy -Application $one -NotebookId $m.notebookId
 [xml]$hierarchy=$before
 [IO.File]::WriteAllText("$out/hierarchy-before.xml",$before)
 $excluded=@($m.excludedPages | ForEach-Object {$_.id})
 $liveIds=@($hierarchy.SelectNodes('//*[local-name()="Page"]') | ForEach-Object {$_.GetAttribute('ID')} | Where-Object {$_ -notin $excluded})
 $savedIds=@($m.pages | ForEach-Object {$_.id})
 if($liveIds.Count -ne $savedIds.Count -or @($liveIds | Where-Object {$_ -notin $savedIds}).Count -or @($savedIds | Where-Object {$_ -notin $liveIds}).Count){throw 'Live notebook contains a different page inventory; re-export the whole notebook before auditing.'}
 $n=0
 foreach($p in $m.pages){
  $row=[ordered]@{key=$p.key;sectionKey=$p.sectionKey;order=$p.order;old=$null;live=$null;error=$null}
  try{
   [xml]$old=Get-Content "$root/$($p.source)" -Raw -Encoding UTF8
   # Use the same complete PageInfo flags as acquisition; piBasic omits
   # image format and selected empty text/outline objects by design.
   $raw='';$one.GetPageContent($p.id,[ref]$raw,7)
   [xml]$live=$raw
   [IO.File]::WriteAllText("$out/$($p.key).xml",$raw)
   $row.old=Counts $old;$row.live=Counts $live
  }catch{$row.error=$_.Exception.Message}
  [void]$rows.Add($row);$n++
  if($n%50 -eq 0){Write-Host "AUDIT $n/$($m.pages.Count)"}
 }
 $after=Get-OneNoteCompleteHierarchy -Application $one -NotebookId $m.notebookId
 [IO.File]::WriteAllText("$out/hierarchy-after.xml",$after)
 if((Get-OneNoteHierarchySignature $hierarchy) -cne (Get-OneNoteHierarchySignature ([xml]$after))){throw 'Live hierarchy changed during audit; repeat acquisition and verification.'}
 $report=[ordered]@{startedAt=$startedAt;completedAt=[DateTime]::UtcNow.ToString('o');notebookId=$m.notebookId;hierarchyComplete=$true;pages=@($rows)}
 [IO.File]::WriteAllText("$out/report.json",(ConvertTo-Json -InputObject $report -Depth 8))
 $changed=@($rows | Where-Object { $_.old.images -ne $_.live.images -or $_.old.attachments -ne $_.live.attachments })
 [pscustomobject]@{pages=$rows.Count;changedPages=$changed.Count;oldImages=($rows.old.images | Measure-Object -Sum).Sum;liveImages=($rows.live.images | Measure-Object -Sum).Sum;oldAttachments=($rows.old.attachments | Measure-Object -Sum).Sum;liveAttachments=($rows.live.attachments | Measure-Object -Sum).Sum;oldEmptyObjects=($rows.old.emptyObjects | Measure-Object -Sum).Sum;liveEmptyObjects=($rows.live.emptyObjects | Measure-Object -Sum).Sum;errors=@($rows | Where-Object error).Count} | ConvertTo-Json
 if(@($rows | Where-Object error).Count){throw 'Live source audit failed'}
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($one)}
