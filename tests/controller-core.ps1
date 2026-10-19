param([Parameter(Mandatory)][string]$Fixture)
$ErrorActionPreference='Stop'
Import-Module "$PSScriptRoot/../scripts/Diary-Control.Core.psm1" -Force -DisableNameChecking
function Assert($Condition,[string]$Message){if(!$Condition){throw $Message}}
function Free-Port {$socket=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$socket.Start();try{return $socket.LocalEndpoint.Port}finally{$socket.Stop()}}
function Must-Fail([scriptblock]$Action){$failed=$false;try{& $Action}catch{$failed=$true};Assert $failed 'Expected the operation to fail'}
$first=Free-Port;$second=Free-Port
while($second -eq $first){$second=Free-Port}
Set-DiarySettings $Fixture $first 443
try{
 $url=Start-DiaryService $Fixture
 Assert ($url -eq "http://127.0.0.1:$first") 'Configured port was ignored'
 $boot=Invoke-RestMethod ($url+'/api/bootstrap')
 $entry=@{revision=0;title='Controller fixture';date='2024-01-02';blocks=@(@{id='text-one';type='text';html='<p>Retained across restarts</p>'})} | ConvertTo-Json -Depth 5
 $null=Invoke-RestMethod ($url+'/api/entries/n-1234567890abcdef12345678') -Method Put -Headers @{'X-Diary-Token'=$boot.token} -ContentType 'application/json' -Body $entry
 $entryFile=Join-Path $Fixture 'exports/LIFE/source/24/01/02/entry-n-1234567890abcdef12345678.json'
 $hash=Get-DiaryFileHash $entryFile
 Update-DiarySettings $Fixture $second 8443
 Assert ($null -eq (Get-DiaryHealth $first)) 'Old port remained active after port change'
 Assert ((Get-DiaryHealth $second).application -eq 'life-local-diary') 'New port did not start'
 Assert ((Get-DiaryFileHash $entryFile) -eq $hash) 'Journal content changed on restart'
 $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start()
 try{Must-Fail {Update-DiarySettings $Fixture $listener.LocalEndpoint.Port 443};Assert ((Get-DiarySettings $Fixture).port -eq $second) 'Busy port changed saved settings';Assert ($null -ne (Get-DiaryHealth $second)) 'Busy port stopped the running service'}finally{$listener.Stop()}
 $pidFile=Join-Path $Fixture 'local-state/server.pid';$correctPid=Get-Content -LiteralPath $pidFile -Raw
 try{$PID | Set-Content -LiteralPath $pidFile;Must-Fail {Stop-DiaryService $Fixture}}finally{$correctPid | Set-Content -LiteralPath $pidFile}

 # The actual worker passes a DPAPI-protected password to the Node KDF over stdin.
 $sakuraPort=Free-Port
 $operation=Join-Path $Fixture 'local-state/controller/operations/sakura-fixture'
 $fixturePassword='Controller-'+[char]0x65e5+[char]0x8bb0+'-fixture-2026'
 $secure=[Security.SecureString]::new();foreach($character in $fixturePassword.ToCharArray()){$secure.AppendChar($character)}
 try{$protected=Protect-DiaryPassword $secure}finally{$secure.Dispose()}
 Write-DiaryJson (Join-Path $operation 'input.json') @{origin='https://diary.example.invalid:23456';port=$sakuraPort;protectedPassword=$protected}
 & "$PSScriptRoot/../scripts/Diary-Control.Worker.ps1" -ProjectRoot $Fixture -OperationDirectory $operation -Action EnableSakura -NoBrowser
 $operationResult=Get-Content (Join-Path $operation 'result.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 Assert $operationResult.ok ('Sakura worker failed: '+$operationResult.error)
 Assert (!(Test-Path (Join-Path $operation 'input.json'))) 'Protected input was retained'
 Assert ((Get-DiaryHealth $second).sakuraPort -eq $sakuraPort) 'Separate Sakura listener did not start'
 $loginRequest=[Net.HttpWebRequest]::Create("http://127.0.0.1:$sakuraPort/auth/login")
 $loginRequest.Proxy=$null;$loginRequest.Method='POST';$loginRequest.Host='diary.example.invalid:23456';$loginRequest.ContentType='application/json'
 $loginRequest.Headers.Add('Origin','https://diary.example.invalid:23456');$loginRequest.Headers.Add('X-Forwarded-Proto','https')
 $loginBytes=[Text.Encoding]::UTF8.GetBytes((@{password=$fixturePassword} | ConvertTo-Json -Compress));$loginRequest.ContentLength=$loginBytes.Length
 $loginStream=$loginRequest.GetRequestStream();try{$loginStream.Write($loginBytes,0,$loginBytes.Length)}finally{$loginStream.Dispose()}
 $loginResponse=$loginRequest.GetResponse();try{Assert ([int]$loginResponse.StatusCode -eq 200) 'Unicode password failed across DPAPI and stdin'}finally{$loginResponse.Dispose()}
 Assert ((Get-DiaryFileHash $entryFile) -eq $hash) 'Journal changed during Sakura setup'
 $savedPassword=(Get-DiarySakuraConfig $Fixture).password.hash
 Must-Fail {Set-DiarySakuraAccess $Fixture 'http://invalid.example' $sakuraPort}
 Assert ((Get-DiaryHealth $second).sakuraPort -eq $sakuraPort) 'Invalid HTTPS address stopped the running service'
 Must-Fail {Update-DiarySettings $Fixture $sakuraPort 443}
 Set-DiarySakuraAccess $Fixture 'https://changed.example.invalid:23456' $sakuraPort
 Assert ((Get-DiarySakuraConfig $Fixture).password.hash -eq $savedPassword) 'Blank password replaced existing password'
 Assert ((Get-DiaryHealth $second).sakuraOrigin -eq 'https://changed.example.invalid:23456') 'Sakura origin was not updated'
 $occupied=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$occupied.Start()
 try{Must-Fail {Set-DiarySakuraAccess $Fixture 'https://changed.example.invalid:23456' $occupied.LocalEndpoint.Port};Assert ((Get-DiaryHealth $second).sakuraPort -eq $sakuraPort) 'Occupied Sakura port stopped the current service'}finally{$occupied.Stop()}

 # Model only the Tailscale CLI; the journal server and disk persistence are real.
 $module=Get-Module Diary-Control.Core
 & $module {
  $script:fakeServe=@{Web=@{'diary.fixture.ts.net:443'=@{Handlers=@{'/'=@{Proxy='http://127.0.0.1:8766'}}};'diary.fixture.ts.net:10000'=@{Handlers=@{'/'=@{Proxy='http://127.0.0.1:45678'}}}};TCP=@{'443'=@{HTTPS=$true};'10000'=@{HTTPS=$true}};AllowFunnel=@{}}
  $script:failNextServe=$false
  $script:realInvoke=(Get-Command Invoke-DiaryCommand).ScriptBlock
  function script:Get-DiaryTailscale {return [pscustomobject]@{installed=$true;running=$true;file='fixture-tailscale';dns='diary.fixture.ts.net';login='owner@example.invalid'}}
  function script:Invoke-DiaryCommand {
   param([string]$File,[string[]]$Arguments=@(),[int]$TimeoutSeconds=15,[string]$WorkingDirectory,[string]$InputText)
   if($File -ne 'fixture-tailscale'){return (& $script:realInvoke @PSBoundParameters)}
   if($Arguments[1] -eq 'status'){return [pscustomobject]@{exitCode=0;output=($script:fakeServe | ConvertTo-Json -Depth 10);error=''}}
   $port=[int](($Arguments | Where-Object {$_ -match '^--https='}) -replace '^--https=','');$key='diary.fixture.ts.net:'+$port
   if($Arguments[-1] -eq 'off'){$script:fakeServe.Web.Remove($key);$script:fakeServe.TCP.Remove([string]$port)}
   else{
    if($script:failNextServe){$script:failNextServe=$false;return [pscustomobject]@{exitCode=1;output='Simulated Serve failure';error=''}}
    $script:fakeServe.Web[$key]=@{Handlers=@{'/'=@{Proxy=$Arguments[-1]}}};$script:fakeServe.TCP[[string]$port]=@{HTTPS=$true}
   }
   return [pscustomobject]@{exitCode=0;output='';error=''}
  }
 }
 # A fresh installation must not claim another project's legacy/default target.
 Set-DiarySettings $Fixture $second 443
 Must-Fail {Enable-DiaryRemote $Fixture}
 Assert (!(Get-DiaryRemoteConfig $Fixture).enabled) 'Conflicting route enabled remote access'
 Assert ($null -ne (Get-DiaryHealth $second)) 'Conflicting route stopped local service'
 & $module {$script:fakeServe.Web.Remove('diary.fixture.ts.net:443');$script:fakeServe.TCP.Remove('443')}
 $remoteUrl=Enable-DiaryRemote $Fixture
 Assert ($remoteUrl -eq 'https://diary.fixture.ts.net') 'Remote origin mismatch'
 $third=Free-Port
 Update-DiarySettings $Fixture $third 8443
 Assert ((Get-DiaryHealth $third).remoteOrigin -eq 'https://diary.fixture.ts.net:8443') 'Remote origin did not follow new HTTPS port'
 Assert ((Get-DiaryHealth $third).sakuraPort -eq $sakuraPort) 'Tailscale migration lost Sakura access'
 $state=& $module {Get-DiaryServe (Get-DiaryTailscale)}
 Assert ($null -eq $state.Web.'diary.fixture.ts.net:443') 'Old diary route remained after migration'
 Assert ($state.Web.'diary.fixture.ts.net:8443'.Handlers.'/'.Proxy -eq "http://127.0.0.1:$third") 'Proxy target did not follow local port'
 Assert ($state.Web.'diary.fixture.ts.net:10000'.Handlers.'/'.Proxy -eq 'http://127.0.0.1:45678') 'Unrelated route was modified'
 & $module {$script:failNextServe=$true}
 $fourth=Free-Port
 Must-Fail {Update-DiarySettings $Fixture $fourth 8444}
 Assert ((Get-DiarySettings $Fixture).port -eq $third) 'Failed Serve change did not restore settings'
 Assert ((Get-DiaryHealth $third).remoteOrigin -eq 'https://diary.fixture.ts.net:8443') 'Failed Serve change did not restore service'
 Disable-DiaryRemote $Fixture
 Assert ($null -eq (Get-DiaryHealth $third).remoteOrigin) 'Disabling phone access left server enabled'
 Assert ((Get-DiaryHealth $third).sakuraPort -eq $sakuraPort) 'Disabling Tailscale disabled Sakura'
 & $module {$script:realTailscale=(Get-Command Get-DiaryTailscale).ScriptBlock;function script:Get-DiaryTailscale {throw 'Simulated CLI failure'}}
 try{Assert (Get-DiaryControllerStatus $Fixture).sakuraReady 'Broken Tailscale CLI blocked Sakura status'}finally{& $module {Set-Item Function:script:Get-DiaryTailscale $script:realTailscale}}
 Set-DiarySakuraAccess $Fixture -Disable
 Assert ($null -eq (Get-DiaryHealth $third).sakuraOrigin) 'Disabling Sakura left server enabled'
 Assert ((Get-DiarySakuraConfig $Fixture).password.hash -eq $savedPassword) 'Disabling Sakura discarded configuration'
 Assert ((Get-DiaryFileHash $entryFile) -eq $hash) 'Journal changed during remote operations'
 $state=& $module {Get-DiaryServe (Get-DiaryTailscale)}
 Assert ($null -eq $state.Web.'diary.fixture.ts.net:8443') 'Disabled route remained'
 Assert ($null -ne $state.Web.'diary.fixture.ts.net:10000') 'Unrelated route was removed'
 Write-Host 'PASS controller lifecycle, saved content, occupied ports, process ownership, remote migration and rollback, Sakura secure worker and coexistence'
}finally{Stop-DiaryService $Fixture}
