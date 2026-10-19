[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$OperationDirectory,
    [ValidateSet('Status','Install','Start','Stop','EnableRemote','DisableRemote','Apply','EnableSakura','DisableSakura')][string]$Action='Status',
    [switch]$NoBrowser,
    [switch]$UsePortableRuntime
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Import-Module (Join-Path $PSScriptRoot 'Diary-Control.Core.psm1') -Force -DisableNameChecking
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
$OperationDirectory=[IO.Path]::GetFullPath($OperationDirectory)
$operations=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'local-state/controller/operations'))+[IO.Path]::DirectorySeparatorChar
if(!$OperationDirectory.StartsWith($operations,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid operation directory.'}
$null=New-Item -ItemType Directory -Force -Path $OperationDirectory
$resultFile=Join-Path $OperationDirectory 'result.json'
$activePath=Join-Path $ProjectRoot 'local-state/controller/active.json'
$sha=[Security.Cryptography.SHA256]::Create()
try{$key=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($ProjectRoot.ToLowerInvariant())))).Replace('-','').Substring(0,24)}finally{$sha.Dispose()}
$mutex=[Threading.Mutex]::new($false,('Local\ZhaoHuaXiShi.Operation.'+$key))
$acquired=$false
try{
    if($Action -ne 'Status'){
        try{$acquired=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
        if(!$acquired){throw 'Another controller operation is still running. Wait for it to finish.'}
        Write-DiaryJson $activePath @{pid=$PID;action=$Action;operationDirectory=$OperationDirectory;startedAt=[DateTime]::UtcNow.ToString('o')}
    }
    $url=$null
    switch($Action){
        'Install' {Install-DiaryDependencies $ProjectRoot -UsePortableRuntime:$UsePortableRuntime -LogDirectory $OperationDirectory}
        'Start' {$url=Start-DiaryService $ProjectRoot;if(!$NoBrowser){Open-DiaryUrl $url}}
        'Stop' {Stop-DiaryService $ProjectRoot}
        'EnableRemote' {$url=Enable-DiaryRemote $ProjectRoot}
        'DisableRemote' {Disable-DiaryRemote $ProjectRoot}
        'DisableSakura' {Set-DiarySakuraAccess $ProjectRoot -Disable}
        'EnableSakura' {
            $inputFile=Join-Path $OperationDirectory 'input.json'
            try{
                $inputValue=Get-Content -LiteralPath $inputFile -Raw -Encoding UTF8 | ConvertFrom-Json
                if($inputValue.port -is [string] -or $inputValue.port -is [bool] -or $null -eq $inputValue.port -or [double]$inputValue.port -ne [int]$inputValue.port){throw '端口需要是整数。'}
                $password=if($inputValue.protectedPassword){Unprotect-DiaryPassword $inputValue.protectedPassword}else{$null}
                Set-DiarySakuraAccess $ProjectRoot $inputValue.origin $inputValue.port $password
            }finally{Remove-Item -LiteralPath $inputFile -Force -ErrorAction SilentlyContinue;if($password){$password.Dispose()}}
        }
        'Apply' {
            $inputValue=Get-Content -LiteralPath (Join-Path $OperationDirectory 'input.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach($value in @($inputValue.port,$inputValue.httpsPort)){if($null -eq $value -or $value -is [string] -or $value -is [bool] -or [double]$value -ne [int]$value -or $value -lt 1 -or $value -gt 65535){throw 'Port must be an integer between 1 and 65535.'}}
            Update-DiarySettings $ProjectRoot $inputValue.port $inputValue.httpsPort
        }
    }
    if($acquired){Remove-Item -LiteralPath $activePath -Force -ErrorAction SilentlyContinue}
    $status=Get-DiaryControllerStatus $ProjectRoot
    Write-DiaryJson $resultFile @{ok=$true;action=$Action;url=$url;status=$status;completedAt=[DateTime]::UtcNow.ToString('o')}
}catch{
    Write-DiaryJson $resultFile @{ok=$false;action=$Action;error=$_.Exception.Message;completedAt=[DateTime]::UtcNow.ToString('o')}
    Write-Host $_.Exception.Message
    exit 1
}finally{
    if($acquired){Remove-Item -LiteralPath $activePath -Force -ErrorAction SilentlyContinue;$mutex.ReleaseMutex()}
    $mutex.Dispose()
}
