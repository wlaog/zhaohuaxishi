function Get-OneNoteHierarchySignature {
    param([xml]$Document)
    $rows = foreach ($node in $Document.SelectNodes('//*[local-name()="Section" or local-name()="Page"]')) {
        @($node.LocalName, $node.GetAttribute('ID'), $node.GetAttribute('name'), $node.GetAttribute('pageLevel'), $node.GetAttribute('lastModifiedTime')) -join "`t"
    }
    return ($rows -join "`n")
}

function Get-OneNoteCompleteHierarchy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Application,
        [Parameter(Mandatory)][string]$NotebookId,
        [ValidateRange(2, 600)][int]$Attempts = 90,
        [ValidateRange(0, 60)][int]$DelaySeconds = 2
    )
    $previous = $null
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $raw = ''
        $Application.GetHierarchy($NotebookId, 4, [ref]$raw)
        [xml]$document = $raw
        if ($document.DocumentElement.LocalName -ne 'Notebook' -or $document.DocumentElement.GetAttribute('ID') -ne $NotebookId) {
            throw 'Notebook identity mismatch'
        }
        $locked = @($document.SelectNodes('//*[@isLocked="true"]'))
        if ($locked.Count) { throw 'Notebook contains locked sections; unlock them before exporting.' }
        $pending = @($document.SelectNodes('//*[@areAllPagesAvailable="false"]'))
        $signature = Get-OneNoteHierarchySignature $document
        if (!$pending.Count -and $null -ne $previous -and $signature -ceq $previous) {
            # A notebook-level response alone can hide a partially loaded section.
            foreach ($section in $document.SelectNodes('//*[local-name()="Section"]')) {
                $sectionRaw = ''
                $Application.GetHierarchy($section.GetAttribute('ID'), 4, [ref]$sectionRaw)
                [xml]$sectionDocument = $sectionRaw
                if ($sectionDocument.DocumentElement.GetAttribute('ID') -ne $section.GetAttribute('ID') -or
                    $sectionDocument.SelectNodes('//*[@areAllPagesAvailable="false" or @isLocked="true"]').Count -or
                    (Get-OneNoteHierarchySignature $sectionDocument) -cne (Get-OneNoteHierarchySignature ([xml]$section.OuterXml))) {
                    $pending += $section
                }
            }
            if (!$pending.Count) { return $raw }
        }
        $previous = if ($pending.Count) { $null } else { $signature }
        if ($attempt -eq 0 -and $pending.Count) {
            foreach ($section in $document.SelectNodes('//*[local-name()="Section" and @areAllPagesAvailable="false"]')) {
                $Application.SyncHierarchy($section.GetAttribute('ID'))
            }
        }
        if ($attempt % 10 -eq 0) { Write-Host "Waiting for complete OneNote hierarchy (attempt $($attempt + 1)/$Attempts; incomplete nodes=$($pending.Count))" }
        if ($attempt + 1 -lt $Attempts -and $DelaySeconds) { Start-Sleep -Seconds $DelaySeconds }
    }
    throw 'OneNote hierarchy is incomplete or still changing. Enable Download all files and images, finish downloading all sections, then retry. Existing archive has not been certified complete.'
}

Export-ModuleMember -Function Get-OneNoteCompleteHierarchy, Get-OneNoteHierarchySignature
