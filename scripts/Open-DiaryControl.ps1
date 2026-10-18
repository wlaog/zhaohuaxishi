[CmdletBinding()]
param([string]$ProjectRoot,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
if(!$ProjectRoot){$ProjectRoot=Split-Path -Parent $PSScriptRoot}
try {
    Import-Module (Join-Path $PSScriptRoot 'Diary-Control.Core.psm1') -Force -DisableNameChecking
    $source=Join-Path $PSScriptRoot '../local-diary/controller/ControllerHost.cs'
    $hash=(Get-DiaryFileHash $source).Substring(0,16)
    $directory=Join-Path $ProjectRoot ('local-state/controller/app/'+$hash)
    $null=New-Item -ItemType Directory -Force -Path $directory
    $hostFile=Join-Path $directory 'Zhaohuaxishi.Controller.exe'
    if(!(Test-Path -LiteralPath $hostFile)) {
        $temporary=Join-Path $directory ([Guid]::NewGuid().ToString('N')+'.exe')
        Add-Type -TypeDefinition ([IO.File]::ReadAllText($source)) -ReferencedAssemblies @([Management.Automation.PowerShell].Assembly.Location,'System.Windows.Forms.dll') -OutputAssembly $temporary -OutputType WindowsApplication
        try { Move-Item -LiteralPath $temporary -Destination $hostFile -ErrorAction Stop } catch { if(!(Test-Path -LiteralPath $hostFile)){throw};Remove-Item -LiteralPath $temporary -Force }
    }
    $arguments=@((Join-Path $PSScriptRoot 'Diary-Control.ps1'),$ProjectRoot)
    if($NoBrowser){$arguments+='--no-browser'}
    Start-Process -FilePath $hostFile -ArgumentList (($arguments | ForEach-Object {ConvertTo-DiaryArgument $_}) -join ' ') -WorkingDirectory $ProjectRoot | Out-Null
} catch {
    Add-Type -AssemblyName PresentationFramework
    [Windows.MessageBox]::Show($_.Exception.Message,'朝花夕拾 · 启动未完成') | Out-Null
    exit 1
}
