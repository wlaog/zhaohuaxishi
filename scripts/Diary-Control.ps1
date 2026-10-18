[CmdletBinding()]
param([string]$ProjectRoot,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
if(!$ProjectRoot){$ProjectRoot=Split-Path -Parent $PSScriptRoot}
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
Import-Module (Join-Path $PSScriptRoot 'Diary-Control.Core.psm1') -Force -DisableNameChecking
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
$stateDirectory=Join-Path $ProjectRoot 'local-state/controller'
$null=New-Item -ItemType Directory -Force -Path $stateDirectory
$sha=[Security.Cryptography.SHA256]::Create()
try{$key=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($ProjectRoot.ToLowerInvariant())))).Replace('-','').Substring(0,24)}finally{$sha.Dispose()}
$guiMutex=[Threading.Mutex]::new($false,('Local\ZhaoHuaXiShi.Gui.'+$key))
$guiAcquired=$false
try{$guiAcquired=$guiMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$guiAcquired=$true}
if(!$guiAcquired){[Windows.MessageBox]::Show('控制台已经打开，请查看现有窗口。','朝花夕拾') | Out-Null;$guiMutex.Dispose();exit}
$layout=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../local-diary/controller/MainWindow.xaml') -Raw -Encoding UTF8
$window=[Windows.Markup.XamlReader]::Parse($layout)
if($ProjectRoot -ne [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))){$window.Title+=' · 测试'}
$controls=@{}
foreach($name in @('ServiceStatus','Notice','NoticeText','Progress','RuntimeStatus','InstallButton','StartButton','StopButton','EnablePhoneButton','DisablePhoneButton','CopyPhoneButton','OpenPhoneButton','TailscaleHelpButton','ApplyButton','LocalPort','HttpsPort','LocalAddress','PhoneAddress','PhoneStatus','LogText','LogExpander')){$controls[$name]=$window.FindName($name)}
$script:status=$null;$script:worker=$null;$script:pending=$null;$script:dirty=$false;$script:updating=$false;$script:lastRefresh=[DateTime]::MinValue;$script:logDirectory=$null;$script:externalOperation=$null;$script:statusCleanup=@()

function Show-ControllerNotice([string]$Text){
 $controls.NoticeText.Text=$Text;$controls.Notice.Visibility=if($Text){'Visible'}else{'Collapsed'}
}
function Get-FriendlyError([string]$Text){
 if($Text -match 'Port .*already in use|port belongs to another|HTTPS port already|port already has') {return "端口被其他程序占用，请换一个端口。现有服务未被接管。`n$Text"}
 if($Text -match 'Install Tailscale|Connect Tailscale'){return "请先在电脑和手机登录 Tailscale，再重试。`n$Text"}
 if($Text -match 'Node.js .*missing|dependencies are missing|dependencies.*broken'){return "请先点击「一键安装」准备运行环境。`n$Text"}
 if($Text -match 'Stop the diary service before installing'){return '请先保存内容并停止日记服务，再重新安装依赖。日记文件不会被删除。'}
 if($Text -match 'integer between|Port must be between'){return '端口需填写 1–65535 之间的整数。'}
 return $Text
}
function Set-ControllerBusy([bool]$Busy){
 $controls.Progress.Visibility=if($Busy){'Visible'}else{'Collapsed'}
 foreach($name in @('InstallButton','StartButton','StopButton','EnablePhoneButton','DisablePhoneButton','ApplyButton','LocalPort','HttpsPort')){$controls[$name].IsEnabled=!$Busy}
 if(!$Busy -and $script:status){
  $controls.InstallButton.IsEnabled=!$script:status.running
  $controls.StopButton.IsEnabled=$script:status.managed
  $controls.StartButton.IsEnabled=$script:status.environmentReady
  $controls.EnablePhoneButton.IsEnabled=$script:status.environmentReady -and $script:status.tailscaleRunning
  $controls.DisablePhoneButton.IsEnabled=$script:status.phoneEnabled
 }
}
function Show-ControllerStatus($Value){
 $script:status=$Value
 $controls.ServiceStatus.Text=if($Value.running){'●  服务运行中'}elseif(!$Value.environmentReady){'○  等待初次安装'}else{'○  服务未启动'}
 $controls.RuntimeStatus.Text=if($Value.environmentReady){'已就绪 · '+$Value.runtimeVersion}else{'需要准备环境'}
 $controls.InstallButton.Content=if($Value.environmentReady){'重新检查 / 安装依赖'}else{'初次使用 · 一键安装'}
 $controls.StartButton.Content=if($Value.running){'打开日记'}else{'启动并打开日记'}
 $controls.LocalAddress.Text=$Value.localUrl
 $controls.PhoneAddress.Text=if($Value.phoneUrl){$Value.phoneUrl}else{'连接 Tailscale 后自动生成地址'}
 $controls.PhoneStatus.Text=if($Value.phoneRunning){'已开启 · 手机可通过私人网络访问'}elseif(!$Value.tailscaleInstalled){'尚未安装 Tailscale，请先查看连接指引'}elseif(!$Value.tailscaleRunning){'请先在电脑上连接 Tailscale'}else{'Tailscale 已连接，点击下方开启访问'}
 $controls.CopyPhoneButton.IsEnabled=[bool]$Value.phoneUrl;$controls.OpenPhoneButton.IsEnabled=$Value.phoneRunning
 if(!$script:dirty){$script:updating=$true;$controls.LocalPort.Text=[string]$Value.settings.port;$controls.HttpsPort.Text=[string]$Value.settings.httpsPort;$script:updating=$false}
 Set-ControllerBusy ([bool]$Value.busy)
 if($Value.busy){$script:externalOperation=$Value.busy.operationDirectory;$script:logDirectory=$Value.busy.operationDirectory;$controls.ServiceStatus.Text='操作仍在后台进行';Show-ControllerNotice '上次操作仍在继续。可以留在此处查看进度，也可以关闭控制台。'}
 elseif($script:externalOperation){
  $completedFile=Join-Path $script:externalOperation 'result.json'
  if(Test-Path -LiteralPath $completedFile){$completed=Get-Content -LiteralPath $completedFile -Raw -Encoding UTF8 | ConvertFrom-Json;if($completed.ok){Show-ControllerNotice '后台操作已完成，可以继续使用。'}else{Show-ControllerNotice ('操作未完成：'+(Get-FriendlyError $completed.error));$controls.LogExpander.IsExpanded=$true};$script:externalOperation=$null}
 }
}
function Read-ControllerLog {
 if(!$script:logDirectory){return}
 $parts=[Collections.Generic.List[string]]::new()
 foreach($name in @('output.log','error.log','npm-output.log','npm-error.log')){
  $file=Join-Path $script:logDirectory $name
  if(Test-Path -LiteralPath $file){try{$stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);$reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8);try{$value=$reader.ReadToEnd();if($value){$parts.Add($value)}}finally{$reader.Dispose()}}catch{}}
 }
 $serviceError=Join-Path $ProjectRoot 'local-state/server-error.log'
 if((Test-Path -LiteralPath $serviceError) -and !$script:worker){try{$value=Get-Content -LiteralPath $serviceError -Tail 12 -Encoding UTF8;if($value){$parts.Add(($value -join "`n"))}}catch{}}
 $text=($parts -join "`n");if($text.Length -gt 16000){$text=$text.Substring($text.Length-16000)}
 if($controls.LogText.Text -ne $text){$controls.LogText.Text=$text;$controls.LogText.ScrollToEnd()}
}
function Start-ControllerWorker([string]$Action,$InputValue){
 $directory=Join-Path $stateDirectory ('operations/'+[Guid]::NewGuid().ToString('N'))
 $null=New-Item -ItemType Directory -Force -Path $directory
 if($InputValue){Write-DiaryJson (Join-Path $directory 'input.json') $InputValue}
 $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Diary-Control.Worker.ps1'),'-ProjectRoot',$ProjectRoot,'-OperationDirectory',$directory,'-Action',$Action)
 if($NoBrowser){$arguments+='-NoBrowser'}
 $process=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList (($arguments | ForEach-Object {ConvertTo-DiaryArgument $_}) -join ' ') -WindowStyle Hidden -PassThru -WorkingDirectory $ProjectRoot -RedirectStandardOutput (Join-Path $directory 'output.log') -RedirectStandardError (Join-Path $directory 'error.log')
 $script:worker=[pscustomobject]@{process=$process;directory=$directory;action=$Action}
 if($Action -ne 'Status'){$script:logDirectory=$directory;Set-ControllerBusy $true;$controls.ServiceStatus.Text='正在处理…';Show-ControllerNotice '操作在后台执行，关闭控制台也不会中断。'}
}
function Queue-ControllerAction([string]$Action,$InputValue){
 if($script:pending -or ($script:worker -and $script:worker.action -ne 'Status')){return}
 $script:pending=[pscustomobject]@{action=$Action;inputValue=$InputValue}
 Set-ControllerBusy $true
 if(!$script:worker){$next=$script:pending;$script:pending=$null;Start-ControllerWorker $next.action $next.inputValue}
}
$controls.InstallButton.Add_Click({Queue-ControllerAction 'Install' $null})
$controls.StartButton.Add_Click({Queue-ControllerAction 'Start' $null})
$controls.StopButton.Add_Click({Queue-ControllerAction 'Stop' $null})
$controls.EnablePhoneButton.Add_Click({Queue-ControllerAction 'EnableRemote' $null})
$controls.DisablePhoneButton.Add_Click({Queue-ControllerAction 'DisableRemote' $null})
$controls.ApplyButton.Add_Click({
 $localPortValue=0;$httpsPortValue=0
 if(![int]::TryParse($controls.LocalPort.Text,[ref]$localPortValue) -or ![int]::TryParse($controls.HttpsPort.Text,[ref]$httpsPortValue) -or $localPortValue -lt 1 -or $localPortValue -gt 65535 -or $httpsPortValue -lt 1 -or $httpsPortValue -gt 65535){Show-ControllerNotice '请输入 1–65535 之间的整数端口。';return}
 Queue-ControllerAction 'Apply' @{port=$localPortValue;httpsPort=$httpsPortValue}
})
$controls.LocalPort.Add_TextChanged({if(!$script:updating){$script:dirty=$true}})
$controls.HttpsPort.Add_TextChanged({if(!$script:updating){$script:dirty=$true}})
$controls.CopyPhoneButton.Add_Click({if($script:status.phoneUrl){[Windows.Clipboard]::SetText($script:status.phoneUrl);Show-ControllerNotice '手机地址已复制。在手机连接 Tailscale 后，用浏览器打开即可。'}})
$controls.OpenPhoneButton.Add_Click({if($script:status.phoneRunning){Open-DiaryUrl $script:status.phoneUrl}})
$controls.TailscaleHelpButton.Add_Click({[Windows.MessageBox]::Show("电脑和手机都安装 Tailscale，并登录同一账号。`n`n连接后回到控制台，点击「开启手机访问」。首次使用可能需要按日志中的链接启用 HTTPS。`n`n手机域名由 Tailscale 提供；如需改名，请在 Tailscale 中修改设备名称。",'手机访问指引') | Out-Null})
$timer=[Windows.Threading.DispatcherTimer]::new();$timer.Interval=[TimeSpan]::FromMilliseconds(450)
$timer.Add_Tick({
 try{
  foreach($directory in @($script:statusCleanup)){
   try{foreach($name in @('result.json','output.log','error.log')){[IO.File]::Delete((Join-Path $directory $name))};[IO.Directory]::Delete($directory,$false);$script:statusCleanup=@($script:statusCleanup | Where-Object {$_ -ne $directory})}catch{}
  }
  Read-ControllerLog
  if($script:worker){
   $script:worker.process.Refresh()
   if(!$script:worker.process.HasExited){return}
   $finished=$script:worker;$script:worker=$null
   $file=Join-Path $finished.directory 'result.json'
   if(Test-Path -LiteralPath $file){
    $result=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if($result.ok){
     if($finished.action -eq 'Apply'){$script:dirty=$false}
     if($result.status){Show-ControllerStatus $result.status}
     if($finished.action -ne 'Status'){Show-ControllerNotice $(switch($finished.action){'Install'{'环境已准备好，点击“启动并打开日记”即可。'}'Start'{'日记已就绪。关闭控制台也会继续运行。'}'Stop'{'服务已停止，所有日记内容保留。'}'EnableRemote'{'手机访问已开启。复制地址到手机浏览器即可。'}'DisableRemote'{'手机访问已关闭，本地记录继续保留。'}'Apply'{'设置已应用，访问地址已更新。'}})}
    }else{Show-ControllerNotice ('操作未完成：'+(Get-FriendlyError $result.error));$controls.LogExpander.IsExpanded=$true;Set-ControllerBusy $false}
   }else{Show-ControllerNotice '后台操作意外结束，请展开运行日志查看原因。';$script:logDirectory=$finished.directory;$controls.LogExpander.IsExpanded=$true;Set-ControllerBusy $false}
   $finished.process.Dispose();$script:lastRefresh=[DateTime]::UtcNow
   if($finished.action -eq 'Status'){$script:statusCleanup+=,$finished.directory}
  }
  if($script:pending){$next=$script:pending;$script:pending=$null;Start-ControllerWorker $next.action $next.inputValue;return}
  if(!$script:worker -and ([DateTime]::UtcNow-$script:lastRefresh).TotalSeconds -gt 5){Start-ControllerWorker 'Status' $null;$script:lastRefresh=[DateTime]::UtcNow}
 }catch{Show-ControllerNotice $_.Exception.Message;[IO.File]::WriteAllText((Join-Path $stateDirectory 'gui-error.log'),($_ | Out-String),[Text.UTF8Encoding]::new($false))}
})
$window.Add_ContentRendered({Start-ControllerWorker 'Status' $null;$timer.Start()})
$window.Add_Closed({$timer.Stop()})
Set-ControllerBusy $true
try{$null=$window.ShowDialog()}catch{[IO.File]::WriteAllText((Join-Path $stateDirectory 'gui-error.log'),($_ | Out-String),[Text.UTF8Encoding]::new($false));throw}finally{$timer.Stop();if($guiAcquired){$guiMutex.ReleaseMutex()};$guiMutex.Dispose()}
