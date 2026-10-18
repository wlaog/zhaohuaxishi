[CmdletBinding()]
param([string]$ProjectRoot,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
if(!$ProjectRoot){$ProjectRoot=Split-Path -Parent $PSScriptRoot}
try {
    Import-Module (Join-Path $PSScriptRoot 'Diary-Control.Core.psm1') -Force -DisableNameChecking
    $source=Join-Path $PSScriptRoot '../local-diary/controller/ControllerHost.cs'
    $icon=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../local-diary/controller/icon.ico'))
    $hash=(Get-DiaryFileHash $source).Substring(0,16)+'-'+(Get-DiaryFileHash $icon).Substring(0,8)
    $directory=Join-Path $ProjectRoot ('local-state/controller/app/'+$hash)
    $null=New-Item -ItemType Directory -Force -Path $directory
    $hostFile=Join-Path $directory 'Zhaohuaxishi.Controller.exe'
    if(!(Test-Path -LiteralPath $hostFile)) {
        $temporary=Join-Path $directory ([Guid]::NewGuid().ToString('N')+'.exe')
        $compiler=[CodeDom.Compiler.CompilerParameters]::new()
        $compiler.GenerateExecutable=$true;$compiler.OutputAssembly=$temporary
        $compiler.CompilerOptions='/target:winexe /win32icon:"'+$icon+'"'
        foreach($reference in @([Management.Automation.PowerShell].Assembly.Location,'System.dll','System.Core.dll','System.Windows.Forms.dll')){[void]$compiler.ReferencedAssemblies.Add($reference)}
        $provider=[Microsoft.CSharp.CSharpCodeProvider]::new()
        try {
            $compiled=$provider.CompileAssemblyFromSource($compiler,[IO.File]::ReadAllText($source))
            if($compiled.Errors.HasErrors){throw (($compiled.Errors | Where-Object {!$_.IsWarning} | ForEach-Object {$_.ErrorText}) -join "`n")}
        } finally {$provider.Dispose()}
        try { Move-Item -LiteralPath $temporary -Destination $hostFile -ErrorAction Stop } catch { if(!(Test-Path -LiteralPath $hostFile)){throw};Remove-Item -LiteralPath $temporary -Force }
    }
    # Shortcuts contain machine-local paths and stay outside Git.
    $shell=New-Object -ComObject WScript.Shell
    try {
        $shortcut=$shell.CreateShortcut((Join-Path $ProjectRoot '朝花夕拾.lnk'))
        try {
            $shortcut.TargetPath=Join-Path $PSHOME 'powershell.exe'
            $shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File '+(ConvertTo-DiaryArgument $PSCommandPath)+' -ProjectRoot '+(ConvertTo-DiaryArgument $ProjectRoot)
            $shortcut.WorkingDirectory=$ProjectRoot
            $shortcut.IconLocation=$icon+',0'
            $shortcut.Description='朝花夕拾 · 日记控制台'
            $shortcut.Save()
        } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut)}
    } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
    $arguments=@((Join-Path $PSScriptRoot 'Diary-Control.ps1'),$ProjectRoot)
    if($NoBrowser){$arguments+='--no-browser'}
    Start-Process -FilePath $hostFile -ArgumentList (($arguments | ForEach-Object {ConvertTo-DiaryArgument $_}) -join ' ') -WorkingDirectory $ProjectRoot | Out-Null
} catch {
    $errorDirectory=Join-Path $ProjectRoot 'local-state/controller'
    $null=New-Item -ItemType Directory -Force -Path $errorDirectory
    [IO.File]::WriteAllText((Join-Path $errorDirectory 'launch-error.log'),($_ | Out-String),[Text.UTF8Encoding]::new($false))
    Add-Type -AssemblyName PresentationFramework
    [Windows.MessageBox]::Show($_.Exception.Message,'朝花夕拾 · 启动未完成') | Out-Null
    exit 1
}
