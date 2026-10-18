$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot/../Modules/OneNote/Application/OneNoteCompleteness.psm1" -Force

$complete = '<one:Notebook xmlns:one="urn:test" ID="n"><one:Section ID="s" name="Example"><one:Page ID="a" name="Entry" pageLevel="1"/></one:Section></one:Notebook>'
$partial = $complete.Replace('name="Example"', 'name="Example" areAllPagesAvailable="false"')
function New-Mock($Snapshots, $SectionOverride = '') {
    $mock = [pscustomobject]@{ Snapshots=@($Snapshots); Reads=0; Syncs=0; SectionOverride=$SectionOverride }
    $mock | Add-Member ScriptMethod GetHierarchy {
        param($Id, $Scope, $Result)
        $raw = $this.Snapshots[[Math]::Min($this.Reads, $this.Snapshots.Count - 1)]
        if ($Id -eq 'n') { $this.Reads++; $Result.Value=$raw }
        elseif ($this.SectionOverride) { $Result.Value=$this.SectionOverride }
        else { [xml]$document=$raw; $Result.Value=$document.DocumentElement.FirstChild.OuterXml }
    }
    $mock | Add-Member ScriptMethod SyncHierarchy { param($Id) $this.Syncs++ }
    return $mock
}
function Expect-Failure($Mock, $Message) {
    $failed=$false
    try { $null=Get-OneNoteCompleteHierarchy -Application $Mock -NotebookId n -Attempts 3 -DelaySeconds 0 }
    catch { $failed=$_.Exception.Message -like "*$Message*" }
    if (!$failed) { throw "Expected acquisition failure: $Message" }
}

$mock=New-Mock @($partial,$complete,$complete)
$result=Get-OneNoteCompleteHierarchy -Application $mock -NotebookId n -Attempts 4 -DelaySeconds 0
if ($result -cne $complete -or $mock.Syncs -ne 1 -or $mock.Reads -ne 3) { throw 'Acquisition did not wait for a complete stable hierarchy' }
Expect-Failure (New-Mock @($partial)) 'incomplete'
Expect-Failure (New-Mock @($complete.Replace('name="Example"','name="Example" isLocked="true"'))) 'locked'
Expect-Failure (New-Mock @($complete.Replace('ID="n"','ID="wrong"'))) 'identity'
$extra='<one:Section xmlns:one="urn:test" ID="s" name="Example"><one:Page ID="a" name="Entry" pageLevel="1"/><one:Page ID="b" name="Extra" pageLevel="1"/></one:Section>'
Expect-Failure (New-Mock @($complete) $extra) 'incomplete'
Write-Host 'PASS complete, stable, unlocked, independently enumerated hierarchy acquisition'
