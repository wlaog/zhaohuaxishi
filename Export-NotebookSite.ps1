[CmdletBinding()]
param(
    [string]$NotebookId,
    [string]$NotebookName = 'LIFE',
    [string]$DisplayName = 'LIFE',
    [string]$OutputPath = "$PSScriptRoot/exports/LIFE",
    [switch]$IncludeSectionBackup,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
# OneNote's COM interop is reliable in Windows PowerShell's STA runtime.
if ($PSVersionTable.PSEdition -eq 'Core') {
    $desktopArgs=@('-NoProfile','-STA','-File',$PSCommandPath)
    foreach($parameter in $PSBoundParameters.GetEnumerator()) {
        if($parameter.Value -is [Management.Automation.SwitchParameter]) { if($parameter.Value.IsPresent){$desktopArgs+='-'+$parameter.Key} }
        else { $desktopArgs+='-'+$parameter.Key; $desktopArgs+=[string]$parameter.Value }
    }
    & "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" @desktopArgs
    if($LASTEXITCODE -ne 0){throw 'OneNote export failed in Windows PowerShell.'}
    return
}
Import-Module "$PSScriptRoot/Modules/OneNote/Application/OneNotePublish.psm1" -Force
Import-Module "$PSScriptRoot/Modules/OneNote/Application/OneNoteCompleteness.psm1" -Force
$root = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$null = New-Item -ItemType Directory -Force -Path "$root/_source", "$root/_audit", "$root/pages", "$root/backups"
$utf8 = New-Object Text.UTF8Encoding($false)
$excludedIds=@()
$exclusionsPath=Join-Path $PSScriptRoot 'Config/archive-exclusions.json'
if(Test-Path -LiteralPath $exclusionsPath){
    $exclusions=Get-Content $exclusionsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $excludedIds=@($exclusions.pages | ForEach-Object {$_.id})
}
$existingPages=@{}
if(Test-Path -LiteralPath "$root/manifest.json"){
    $previous=Get-Content "$root/manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach($entry in $previous.pages){$existingPages[$entry.id]=$entry}
}
function Write-Utf8($Path, $Content) { [IO.File]::WriteAllText($Path, $Content, $utf8) }
function Get-Key([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($Value)))).Replace('-','').Substring(0,20).ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Save-Json($Path,$Value) { Write-Utf8 $Path (ConvertTo-Json -InputObject $Value -Depth 30) }
$one = New-Object -ComObject OneNote.Application
try {
    if(!$NotebookId){
        $available='';$one.GetHierarchy('',1,[ref]$available)
        [xml]$availableDoc=$available
        $matches=@($availableDoc.SelectNodes('//*[local-name()="Notebook"]') | Where-Object { $_.GetAttribute('name') -eq $NotebookName -or $_.GetAttribute('nickname') -eq $NotebookName })
        if($matches.Count -ne 1){throw "Expected exactly one notebook matching '$NotebookName', found $($matches.Count). Use -NotebookId to disambiguate."}
        $NotebookId=$matches[0].ID
    }
    $hierarchy = Get-OneNoteCompleteHierarchy -Application $one -NotebookId $NotebookId
    [xml]$doc = $hierarchy
    $notebook = $doc.DocumentElement
    if ($notebook.LocalName -ne 'Notebook' -or $notebook.ID -ne $NotebookId) { throw 'Notebook identity mismatch' }
    Write-Utf8 "$root/_source/hierarchy.xml" $hierarchy
    $pages = New-Object Collections.ArrayList
    $sections = New-Object Collections.ArrayList
    $errors = New-Object Collections.ArrayList
    foreach ($section in $notebook.SelectNodes('.//*[local-name()="Section"]')) {
        $recycle = $null -ne $section.SelectSingleNode('ancestor::*[@isRecycleBin="true"]')
        $groups = @($section.SelectNodes('ancestor::*[local-name()="SectionGroup"]') | ForEach-Object { $_.GetAttribute('name') })
        $sk = Get-Key $section.ID
        $sectionRecord = [ordered]@{id=$section.ID;key=$sk;name=$section.GetAttribute('name');groups=$groups;recycle=$recycle;pageCount=@($section.SelectNodes('./*[local-name()="Page"]') | Where-Object {$_.ID -notin $excludedIds}).Count;backup=$null}
        if ($section.GetAttribute('isLocked') -eq 'true') { $null=$errors.Add(@{id=$section.ID;stage='section';message='Locked section'}) }
        if ($IncludeSectionBackup -and !$recycle) {
            $backup = "backups/$sk.one"
            try {
                if (!(Test-Path -LiteralPath "$root/$backup")) { Invoke-OneNotePublish -Id $section.ID -Path "$root/$backup" -PublishFormat one -Overwrite $false }
                $sectionRecord.backup=$backup
            } catch { $null=$errors.Add(@{id=$section.ID;stage='backup';message=$_.Exception.Message}) }
        }
        $null=$sections.Add($sectionRecord)
        $order=0
        foreach ($page in $section.SelectNodes('./*[local-name()="Page"]')) {
            if($page.ID -in $excludedIds){continue}
            $order++
            $key=Get-Key $page.ID
            $dir="$root/pages/$sk/$key"
            $record=[ordered]@{id=$page.ID;key=$key;sectionKey=$sk;title=$page.GetAttribute('name');level=[int]$page.GetAttribute('pageLevel');order=$order;created=$page.GetAttribute('dateTime');modified=$page.GetAttribute('lastModifiedTime');recycle=$recycle;url="pages/$sk/$key/index.html";source="_source/$key.xml";images=@();attachments=@();status='pending'}
            $prior=$existingPages[$page.ID]
            if($prior -and $prior.checkpoint){
                $record.url=$prior.url;$record.source=$prior.source;$record.checkpoint=$prior.checkpoint
                $dir=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath((Join-Path $root $prior.url)))
                if(!$dir.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive path escapes root'}
                foreach($relative in @($prior.source,$prior.checkpoint)){
                    $resolved=[IO.Path]::GetFullPath((Join-Path $root $relative))
                    if(!$resolved.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Source/checkpoint path escapes root'}
                }
            }
            $null=New-Item -ItemType Directory -Force -Path $dir
            try {
                $checkpoint=if($record.checkpoint){Join-Path $root $record.checkpoint}else{"$root/_source/$key.json"}
                $cached=$null
                if(Test-Path -LiteralPath $checkpoint){$cached=Get-Content -LiteralPath $checkpoint -Raw -Encoding UTF8 | ConvertFrom-Json}
                # Modification time does not indicate that page objects are hydrated.
                # Always fetch fresh binary content before considering the cache.
                $content=''
                for($attempt=0;$attempt -lt 4;$attempt++){
                    $one.GetPageContent($page.ID,[ref]$content,7)
                    [xml]$px=$content
                    $empty=$px.SelectNodes('//*[local-name()="OE" and not(*)]').Count
                    $missing=$px.SelectNodes('//*[local-name()="Image" and not(*[local-name()="Data" and normalize-space(.)!=""])]').Count
                    if(!$empty -and !$missing){break}
                    $one.NavigateTo($page.ID,'',$false)
                    Start-Sleep -Seconds 2
                }
                if($empty -or $missing){throw "Incomplete OneNote content: $empty empty objects, $missing missing image binaries"}
                $sha=[Security.Cryptography.SHA256]::Create()
                try{$digest=([BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($content)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
                $record.sourceHash=$digest
                $record.acquisitionVersion=2
                $cacheValid=$false
                if(!$Force -and $cached -and $cached.acquisitionVersion -eq 2 -and $cached.sourceHash -eq $digest -and (Test-Path -LiteralPath "$dir/native.htm") -and (Test-Path -LiteralPath "$root/$($record.source)")){
                    $cacheValid=(Get-FileHash -LiteralPath "$root/$($record.source)").Hash.ToLowerInvariant() -eq $digest
                    foreach($asset in @($cached.images)+@($cached.attachments)){
                        if(!(Test-Path -LiteralPath "$dir/$($asset.file)")){$cacheValid=$false;break}
                        if((Get-FileHash -LiteralPath "$dir/$($asset.file)").Hash.ToLowerInvariant() -ne $asset.sha256){$cacheValid=$false;break}
                    }
                }
                if($cacheValid){
                    $record.images=@($cached.images);$record.attachments=@($cached.attachments);$record.status='exported'
                } else {
                    Write-Utf8 "$root/$($record.source)" $content
                    Invoke-OneNotePublish -Id $page.ID -Path "$dir/native.htm" -PublishFormat htm -Overwrite $true
                    $imageRecords=New-Object Collections.ArrayList
                    $n=0
                    foreach($img in $px.SelectNodes('//*[local-name()="Image"]')) {
                        $n++
                        $data=$img.SelectSingleNode('./*[local-name()="Data"]')
                        if(!$data -or !$data.InnerText.Trim()){throw "Image $n has no binary data"}
                        $ext=$img.GetAttribute('format').ToLowerInvariant()
                        if($ext -notmatch '^(png|jpg|jpeg|gif|bmp|tif|tiff|emf|wmf)$'){throw "Unexpected image format: $ext"}
                        $rel="original-$n.$ext"
                        $bytes=[Convert]::FromBase64String($data.InnerText)
                        [IO.File]::WriteAllBytes("$dir/$rel",$bytes)
                        $size=$img.SelectSingleNode('./*[local-name()="Size"]')
                        $null=$imageRecords.Add(@{file=$rel;bytes=$bytes.Length;sha256=(Get-FileHash -LiteralPath "$dir/$rel" -Algorithm SHA256).Hash.ToLowerInvariant();width=$size.GetAttribute('width');height=$size.GetAttribute('height')})
                    }
                    $record.images=@($imageRecords)
                    $attachmentRecords=New-Object Collections.ArrayList
                    $n=0
                    foreach($attachment in $px.SelectNodes('//*[local-name()="InsertedFile"]')) {
                        $n++
                        $name=$attachment.GetAttribute('preferredName')
                        $safe=($name -replace '[<>:"/\\|?*\x00-\x1F]','_').TrimEnd('.',' ')
                        if(!$safe){$safe='attachment'}
                        if($safe.Length -gt 100){$safe=$safe.Substring(0,80)+[IO.Path]::GetExtension($safe)}
                        $file="attachment-$n-$safe"
                        $cache=$attachment.GetAttribute('pathCache')
                        if(!(Test-Path -LiteralPath $cache)){throw "Missing attachment cache: $name"}
                        Copy-Item -LiteralPath $cache -Destination "$dir/$file" -Force
                        $null=$attachmentRecords.Add(@{name=$name;file=$file;sha256=(Get-FileHash -LiteralPath "$dir/$file").Hash.ToLowerInvariant()})
                    }
                    $record.attachments=@($attachmentRecords)
                    $record.status='exported'
                    Save-Json $checkpoint $record
                }
            } catch { $record.status='failed';$null=$errors.Add(@{id=$page.ID;stage='page';message=$_.Exception.Message}); Write-Warning "Failed page $key : $($_.Exception.Message)" }
            $null=$pages.Add($record)
            if($pages.Count % 20 -eq 0){Write-Host "PROGRESS $($pages.Count) pages; errors=$($errors.Count)"}
        }
    }
    $final=Get-OneNoteCompleteHierarchy -Application $one -NotebookId $NotebookId
    Write-Utf8 "$root/_audit/hierarchy-after.xml" $final
    if((Get-OneNoteHierarchySignature $doc) -cne (Get-OneNoteHierarchySignature ([xml]$final))){$null=$errors.Add(@{stage='hierarchy';message='Notebook hierarchy changed during export; repeat acquisition.'})}
    $manifest=[ordered]@{schemaVersion=1;hierarchyComplete=$true;displayName=$DisplayName;sourceName=$notebook.GetAttribute('name');notebookId=$NotebookId;exportedAt=[DateTime]::UtcNow.ToString('o');sections=@($sections);pages=@($pages);excludedPages=@($exclusions.pages);errors=@($errors)}
    Save-Json "$root/manifest.json" $manifest
    Write-Host "DONE pages=$($pages.Count) errors=$($errors.Count)"
    if($errors.Count){throw "Export incomplete; inspect manifest.json"}
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($one) }
