function Get-DiarySettings {
    param([string]$ProjectRoot)
    $file=Join-Path $ProjectRoot 'local-state/diary-settings.json'
    $value=if(Test-Path -LiteralPath $file){Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json}else{@{}}
    $port=if($null -ne $value.port){$value.port}else{8766}
    $httpsPort=if($null -ne $value.httpsPort){$value.httpsPort}else{443}
    foreach($number in @($port,$httpsPort)){
        if($number -is [string] -or $number -is [bool] -or [double]$number -ne [int]$number -or $number -lt 1 -or $number -gt 65535){throw 'Port must be an integer between 1 and 65535.'}
    }
    return [pscustomobject]@{version=1;port=[int]$port;httpsPort=[int]$httpsPort}
}

function Write-DiaryJson {
    param([string]$Path,$Value)
    $null=New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path)
    $temp=$Path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    [IO.File]::WriteAllText($temp,($Value | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Get-DiaryFileHash {
    param([string]$Path)
    $sha=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($Path)
    try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
}

function Set-DiarySettings {
    param([string]$ProjectRoot,[int]$Port,[int]$HttpsPort)
    if($Port -lt 1 -or $Port -gt 65535 -or $HttpsPort -lt 1 -or $HttpsPort -gt 65535){throw 'Port must be between 1 and 65535.'}
    Write-DiaryJson (Join-Path $ProjectRoot 'local-state/diary-settings.json') @{version=1;port=$Port;httpsPort=$HttpsPort}
}

function ConvertTo-DiaryArgument {
    param([string]$Value)
    $escaped=[regex]::Replace($Value,'(\\*)"','$1$1\"')
    $escaped=[regex]::Replace($escaped,'(\\+)$','$1$1')
    return '"'+$escaped+'"'
}

function Invoke-DiaryCommand {
    param([string]$File,[string[]]$Arguments=@(),[int]$TimeoutSeconds=15,[string]$WorkingDirectory,[string]$InputText)
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$File;$info.Arguments=($Arguments | ForEach-Object {ConvertTo-DiaryArgument $_}) -join ' '
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    if($PSBoundParameters.ContainsKey('InputText')){$info.RedirectStandardInput=$true}
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    if($WorkingDirectory){$info.WorkingDirectory=$WorkingDirectory}
    $process=[Diagnostics.Process]::new();$process.StartInfo=$info
    try{
        $null=$process.Start();$output=$process.StandardOutput.ReadToEndAsync();$errorOutput=$process.StandardError.ReadToEndAsync()
        if($info.RedirectStandardInput){
            $inputBytes=[Text.Encoding]::UTF8.GetBytes($InputText)
            try{$process.StandardInput.BaseStream.Write($inputBytes,0,$inputBytes.Length)}finally{[Array]::Clear($inputBytes,0,$inputBytes.Length);$process.StandardInput.Close()}
        }
        if(!$process.WaitForExit($TimeoutSeconds*1000)){$process.Kill();throw 'Command timed out. Check the connection and try again.'}
        return [pscustomobject]@{exitCode=$process.ExitCode;output=$output.GetAwaiter().GetResult();error=$errorOutput.GetAwaiter().GetResult()}
    }finally{$process.Dispose()}
}

function Get-DiaryRuntime {
    param([string]$ProjectRoot)
    $candidates=[Collections.Generic.List[string]]::new()
    $pointer=Join-Path $ProjectRoot 'local-state/runtime/current.json'
    if(Test-Path -LiteralPath $pointer){
        $saved=Get-Content -LiteralPath $pointer -Raw -Encoding UTF8 | ConvertFrom-Json
        $base=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'local-state/runtime'))+[IO.Path]::DirectorySeparatorChar
        $candidate=[IO.Path]::GetFullPath((Join-Path $base ([string]$saved.folder)))
        if(!$candidate.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid local runtime path.'}
        $candidates.Add((Join-Path $candidate 'node.exe'))
    }
    $command=Get-Command node.exe -ErrorAction SilentlyContinue
    if($command){$candidates.Add($command.Source)}
    if($env:ProgramFiles){$candidates.Add((Join-Path $env:ProgramFiles 'nodejs/node.exe'))}
    foreach($file in @($candidates | Select-Object -Unique)){
        if(!(Test-Path -LiteralPath $file)){continue}
        try{
            $result=Invoke-DiaryCommand $file @('--version') -TimeoutSeconds 4
            $version=$result.output.Trim()
            if($result.exitCode -eq 0 -and $version -match '^v(\d+)\.\d+\.\d+$' -and [int]$Matches[1] -ge 22){
                $npm=Join-Path (Split-Path -Parent $file) 'npm.cmd'
                return [pscustomobject]@{ready=(Test-Path -LiteralPath $npm);node=$file;npm=$npm;version=$version}
            }
        }catch{}
    }
    return [pscustomobject]@{ready=$false;node=$null;npm=$null;version=$null}
}

function Install-DiaryRuntime {
    param([string]$ProjectRoot)
    [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $architecture=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'){'arm64'}else{'x64'}
    Write-Host 'Downloading an official Node.js LTS runtime...'
    $releases=Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 45
    $release=$releases | Where-Object {$_.lts -and $_.version -match '^v\d+\.\d+\.\d+$' -and [int]($_.version.Split('.')[0].TrimStart('v')) -ge 22 -and "win-$architecture-zip" -in $_.files} | Sort-Object {[version]$_.version.TrimStart('v')} -Descending | Select-Object -First 1
    if(!$release){throw 'No supported Windows LTS runtime was found on nodejs.org.'}
    $folder='node-'+$release.version+'-win-'+$architecture
    $runtimeRoot=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'local-state/runtime'))
    $download=Join-Path $runtimeRoot ('download-'+[Guid]::NewGuid().ToString('N'))
    $null=New-Item -ItemType Directory -Force -Path $download
    $name=$folder+'.zip';$zip=Join-Path $download $name
    Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/'+$release.version+'/'+$name) -OutFile $zip -TimeoutSec 300
    $sums=(Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/'+$release.version+'/SHASUMS256.txt') -TimeoutSec 45).Content
    $line=@($sums -split "`n" | Where-Object {$_ -match ('^[a-f0-9]{64}\s+\*?'+[regex]::Escape($name)+'\s*$')})
    if($line.Count -ne 1 -or (Get-DiaryFileHash $zip) -ne ($line[0] -split '\s+')[0]){throw 'Node.js archive checksum mismatch. Nothing was installed.'}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($zip)
    try{foreach($entry in $archive.Entries){$resolved=[IO.Path]::GetFullPath((Join-Path $download $entry.FullName));if(!$resolved.StartsWith($download+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe runtime archive path.'}}}finally{$archive.Dispose()}
    [IO.Compression.ZipFile]::ExtractToDirectory($zip,$download)
    $extracted=Join-Path $download $folder
    $result=Invoke-DiaryCommand (Join-Path $extracted 'node.exe') @('--version')
    if($result.exitCode -ne 0 -or $result.output.Trim() -ne $release.version -or !(Test-Path -LiteralPath (Join-Path $extracted 'npm.cmd'))){throw 'The downloaded runtime did not pass its startup check.'}
    $destination=Join-Path $runtimeRoot ($folder+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
    Move-Item -LiteralPath $extracted -Destination $destination
    Write-DiaryJson (Join-Path $runtimeRoot 'current.json') @{folder=[IO.Path]::GetFileName($destination);version=$release.version}
    # Remove only the verified scratch directory created by this invocation.
    $resolvedDownload=[IO.Path]::GetFullPath($download)
    if(!$resolvedDownload.StartsWith($runtimeRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedDownload) -notmatch '^download-[a-f0-9]{32}$'){throw 'Unsafe runtime cleanup path.'}
    Remove-Item -LiteralPath $resolvedDownload -Recurse -Force
    return (Get-DiaryRuntime $ProjectRoot)
}

function Install-DiaryDependencies {
    param([string]$ProjectRoot,[switch]$UsePortableRuntime,[string]$LogDirectory)
    $settings=Get-DiarySettings $ProjectRoot
    if((Get-DiaryManagedProcess $ProjectRoot) -or (Get-DiaryHealth $settings.port)){throw 'Stop the diary service before installing dependencies. Saved diaries will be retained.'}
    $runtime=Get-DiaryRuntime $ProjectRoot
    if($UsePortableRuntime -or !$runtime.ready){$runtime=Install-DiaryRuntime $ProjectRoot}
    Write-Host ('Node.js '+$runtime.version+' ready. Installing project dependencies...')
    $null=New-Item -ItemType Directory -Force -Path $LogDirectory
    $previousPath=$env:PATH
    try{
        $env:PATH=(Split-Path -Parent $runtime.node)+';'+$previousPath
        $arguments='/d /s /c ""'+$runtime.npm+'" ci --no-audit --fund=false"'
        $process=Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $LogDirectory 'npm-output.log') -RedirectStandardError (Join-Path $LogDirectory 'npm-error.log')
        $process.WaitForExit()
        if($process.ExitCode -ne 0){throw 'npm ci failed. Check the installation log and retry; diary files were not changed.'}
    }finally{$env:PATH=$previousPath}
    $check=Invoke-DiaryCommand $runtime.node @('--input-type=module','-e',"await Promise.all(['cheerio','sharp','fast-xml-parser'].map(name=>import(name)));console.log('ready')") -WorkingDirectory $ProjectRoot
    if($check.exitCode -ne 0){throw 'Dependencies did not pass their startup check. See the installation log.'}
    Write-Host 'Installation complete. You can now open the diary.'
}

function Get-DiaryHealth {
    param([int]$Port)
    try{
        $request=[Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/health")
        $request.Proxy=$null;$request.Timeout=700;$request.ReadWriteTimeout=700
        $response=$request.GetResponse()
        try{$reader=[IO.StreamReader]::new($response.GetResponseStream());try{return ($reader.ReadToEnd() | ConvertFrom-Json)}finally{$reader.Dispose()}}finally{$response.Dispose()}
    }catch{return $null}
}

function Get-DiaryManagedProcess {
    param([string]$ProjectRoot)
    $file=Join-Path $ProjectRoot 'local-state/server.pid'
    if(!(Test-Path -LiteralPath $file)){return $null}
    $processIdValue=0
    if(![int]::TryParse(([IO.File]::ReadAllText($file).Trim()),[ref]$processIdValue)){throw 'Invalid diary process record.'}
    $process=Get-CimInstance Win32_Process -Filter "ProcessId = $processIdValue" -ErrorAction SilentlyContinue
    if(!$process){return $null}
    $script=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'local-diary/server.mjs'))
    if($process.Name -ne 'node.exe' -or $process.CommandLine.IndexOf($script,[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'Process record belongs to another application. It was not stopped.'}
    return $process
}

function Test-DiaryPort {
    param([int]$Port)
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
    try{$listener.Start()}catch{throw "Port $Port is already in use. Choose another port; the running service was not changed."}finally{$listener.Stop()}
}

function Start-DiaryService {
    param([string]$ProjectRoot)
    $settings=Get-DiarySettings $ProjectRoot
    $expectedRoot=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'exports/LIFE'))
    $health=Get-DiaryHealth $settings.port
    if($health){
        if($health.application -ne 'life-local-diary' -or $health.root -ne $expectedRoot){throw 'This port belongs to another application or diary.'}
        return "http://127.0.0.1:$($settings.port)"
    }
    if(Get-DiaryManagedProcess $ProjectRoot){throw 'Diary is running with different settings. Apply settings to restart it first.'}
    Test-DiaryPort $settings.port
    $runtime=Get-DiaryRuntime $ProjectRoot
    if(!$runtime.ready){throw 'Node.js 22 or newer is missing. Click the first-use installation button.'}
    $dependencyCheck=Invoke-DiaryCommand $runtime.node @('--input-type=module','-e',"await Promise.all(['cheerio','sharp','fast-xml-parser'].map(name=>import(name)));console.log('ready')") -WorkingDirectory $ProjectRoot
    if($dependencyCheck.exitCode -ne 0){throw 'Project dependencies are missing or broken. Stop the diary and use first-use installation.'}
    $state=Join-Path $ProjectRoot 'local-state';$null=New-Item -ItemType Directory -Force -Path $state
    $script=Join-Path $ProjectRoot 'local-diary/server.mjs'
    $oldPort=$env:DIARY_PORT;$oldRoot=$env:DIARY_ROOT
    try{
        $env:DIARY_PORT=[string]$settings.port;$env:DIARY_ROOT=$expectedRoot
        $process=Start-Process -FilePath $runtime.node -ArgumentList (ConvertTo-DiaryArgument $script) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $state 'server.log') -RedirectStandardError (Join-Path $state 'server-error.log')
    }finally{$env:DIARY_PORT=$oldPort;$env:DIARY_ROOT=$oldRoot}
    $process.Id | Set-Content -LiteralPath (Join-Path $state 'server.pid') -Encoding ASCII
    Write-DiaryJson (Join-Path $state 'server.json') @{pid=$process.Id;port=$settings.port;root=$expectedRoot}
    for($attempt=0;$attempt -lt 80;$attempt++){
        $health=Get-DiaryHealth $settings.port
        if($health -and $health.application -eq 'life-local-diary' -and $health.root -eq $expectedRoot){return "http://127.0.0.1:$($settings.port)"}
        $process.Refresh();if($process.HasExited){throw 'Diary startup failed. See the service error log in this window.'}
        Start-Sleep -Milliseconds 250
    }
    throw 'Diary startup timed out. See the service error log and retry.'
}

function Stop-DiaryService {
    param([string]$ProjectRoot)
    $process=Get-DiaryManagedProcess $ProjectRoot
    if($process){Stop-Process -Id $process.ProcessId -ErrorAction Stop}
    foreach($name in @('server.pid','server.json')){Remove-Item -LiteralPath (Join-Path $ProjectRoot "local-state/$name") -Force -ErrorAction SilentlyContinue}
}

function Get-DiaryTailscale {
    $command=Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if(!$command -and $env:ProgramFiles){$file=Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe';if(Test-Path -LiteralPath $file){$command=[pscustomobject]@{Source=$file}}}
    if(!$command){return [pscustomobject]@{installed=$false;running=$false;file=$null;dns=$null;login=$null}}
    $result=Invoke-DiaryCommand $command.Source @('status','--json') -TimeoutSeconds 8
    if($result.exitCode -ne 0){return [pscustomobject]@{installed=$true;running=$false;file=$command.Source;dns=$null;login=$null}}
    $status=$result.output | ConvertFrom-Json
    $dns=([string]$status.Self.DNSName).TrimEnd('.')
    $user=$status.User.PSObject.Properties | Where-Object Name -EQ ([string]$status.Self.UserID) | Select-Object -First 1
    $login=[string]$user.Value.LoginName
    $running=$status.BackendState -eq 'Running' -and $status.Self.Online -and $dns -match '^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$' -and $login -match '^[\x21-\x7e]+$'
    return [pscustomobject]@{installed=$true;running=$running;file=$command.Source;dns=$dns;login=$login}
}

function Get-DiaryServe {
    param($Tailscale)
    $result=Invoke-DiaryCommand $Tailscale.file @('serve','status','--json')
    if($result.exitCode -ne 0){throw 'Cannot read Tailscale Serve configuration.'}
    return ($result.output | ConvertFrom-Json)
}

function Assert-DiaryRoute {
    param($Serve,[string]$HostName,[int]$Port,[string[]]$AllowedTargets)
    if(@($Serve.AllowFunnel.PSObject.Properties | Where-Object Value -EQ $true).Count){throw 'Tailscale Funnel is active. This controller only supports private Tailscale access.'}
    $existing=$Serve.Web.PSObject.Properties | Where-Object Name -EQ ($HostName+':'+$Port)
    if($existing){
        $handlers=@($existing.Value.Handlers.PSObject.Properties)
        if($handlers.Count -ne 1 -or $handlers[0].Name -ne '/' -or $handlers[0].Value.Proxy -notin $AllowedTargets){throw 'This HTTPS port already serves another application. No route was changed.'}
    }
    $tcp=$Serve.TCP.PSObject.Properties | Where-Object Name -EQ ([string]$Port)
    if($tcp -and !$existing){throw 'This port already has another Tailscale service. No route was changed.'}
}

function Get-DiaryRemoteConfig {
    param([string]$ProjectRoot)
    $file=Join-Path $ProjectRoot 'local-state/remote-access.json'
    if(Test-Path -LiteralPath $file){return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json)}
    return [pscustomobject]@{enabled=$false}
}

function Set-DiaryServeRoute {
    param($Tailscale,[int]$Port,[string]$Target,[string[]]$AllowedTargets=@())
    Assert-DiaryRoute (Get-DiaryServe $Tailscale) $Tailscale.dns $Port (@($Target)+$AllowedTargets)
    $result=Invoke-DiaryCommand $Tailscale.file @('serve','--bg',"--https=$Port",'--yes',$Target) -TimeoutSeconds 60
    if($result.exitCode -ne 0){throw ($result.output+"`n"+$result.error).Trim()}
}

function Remove-DiaryServeRoute {
    param($Tailscale,[Uri]$Origin,[string]$Target)
    $serve=Get-DiaryServe $Tailscale
    Assert-DiaryRoute $serve $Origin.Host $Origin.Port @($Target)
    $route=$serve.Web.PSObject.Properties | Where-Object Name -EQ ($Origin.Host+':'+$Origin.Port)
    if($route){
        $result=Invoke-DiaryCommand $Tailscale.file @('serve',"--https=$($Origin.Port)",'off')
        if($result.exitCode -ne 0){throw 'Could not remove the diary route.'}
    }
}

function Enable-DiaryRemote {
    param([string]$ProjectRoot)
    $settings=Get-DiarySettings $ProjectRoot;$tailscale=Get-DiaryTailscale
    if(!$tailscale.running){throw 'Install Tailscale and sign in on this computer and your phone first.'}
    $old=Get-DiaryRemoteConfig $ProjectRoot
    $target="http://127.0.0.1:$($settings.port)"
    $oldTarget=if($old.target){[string]$old.target}else{'http://127.0.0.1:8766'}
    $suffix=if($settings.httpsPort -eq 443){''}else{':'+$settings.httpsPort}
    $origin='https://'+$tailscale.dns+$suffix
    $serve=Get-DiaryServe $tailscale
    $allowed=@($target)
    if($old.enabled -and $old.origin -eq $origin){$allowed+=$oldTarget}
    Assert-DiaryRoute $serve $tailscale.dns $settings.httpsPort $allowed
    if($old.enabled -and $old.origin -ne $origin){Assert-DiaryRoute $serve ([Uri]$old.origin).Host ([Uri]$old.origin).Port @($oldTarget)}
    $health=Get-DiaryHealth $settings.port
    $expectedRoot=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'exports/LIFE'))
    if($health -and ($health.application -ne 'life-local-diary' -or $health.root -ne $expectedRoot)){throw 'Local port belongs to another application.'}
    if($health -and $health.remoteOrigin -ne $origin -and !(Get-DiaryManagedProcess $ProjectRoot)){throw 'Stop the command-line diary first, then start it using this controller.'}
    $configPath=Join-Path $ProjectRoot 'local-state/remote-access.json'
    try{
        Write-DiaryJson $configPath @{enabled=$true;origin=$origin;login=$tailscale.login;target=$target}
        if($health -and $health.remoteOrigin -ne $origin){Stop-DiaryService $ProjectRoot}
        $null=Start-DiaryService $ProjectRoot
        $health=Get-DiaryHealth $settings.port
        if($health.remoteOrigin -ne $origin){throw 'The diary has not loaded its phone access settings. Stop it and retry.'}
        Set-DiaryServeRoute $tailscale $settings.httpsPort $target -AllowedTargets $allowed
        if($old.enabled -and $old.origin -ne $origin){Remove-DiaryServeRoute $tailscale ([Uri]$old.origin) $oldTarget}
        [IO.File]::WriteAllText((Join-Path $ProjectRoot 'local-state/remote-url.txt'),$origin,[Text.Encoding]::ASCII)
        return $origin
    }catch{
        $failure=$_
        Write-DiaryJson $configPath $old
        try{
            Stop-DiaryService $ProjectRoot
            if($old.enabled){Set-DiaryServeRoute $tailscale ([Uri]$old.origin).Port $oldTarget -AllowedTargets @($target)}
            if($origin -ne $old.origin){Remove-DiaryServeRoute $tailscale ([Uri]$origin) $target}
            $null=Start-DiaryService $ProjectRoot
        }catch{Write-Warning 'Phone access could not be fully restored. Retry enabling it after checking Tailscale.'}
        throw $failure
    }
}

function Disable-DiaryRemote {
    param([string]$ProjectRoot)
    $config=Get-DiaryRemoteConfig $ProjectRoot
    if(!$config.enabled){return}
    $tailscale=Get-DiaryTailscale
    if(!$tailscale.installed){throw 'Tailscale is required to remove the existing phone route.'}
    $target=if($config.target){[string]$config.target}else{'http://127.0.0.1:8766'}
    Remove-DiaryServeRoute $tailscale ([Uri]$config.origin) $target
    $running=$null -ne (Get-DiaryManagedProcess $ProjectRoot)
    Write-DiaryJson (Join-Path $ProjectRoot 'local-state/remote-access.json') @{enabled=$false}
    Remove-Item -LiteralPath (Join-Path $ProjectRoot 'local-state/remote-url.txt') -Force -ErrorAction SilentlyContinue
    if($running){Stop-DiaryService $ProjectRoot;$null=Start-DiaryService $ProjectRoot}
}

function Update-DiarySettings {
    param([string]$ProjectRoot,[int]$Port,[int]$HttpsPort)
    if($Port -lt 1 -or $Port -gt 65535 -or $HttpsPort -lt 1 -or $HttpsPort -gt 65535){throw 'Port must be between 1 and 65535.'}
    $old=Get-DiarySettings $ProjectRoot;$remote=Get-DiaryRemoteConfig $ProjectRoot
    $sakura=Get-DiarySakuraConfig $ProjectRoot
    if($sakura.enabled -and $Port -eq $sakura.port){throw '本地日记端口不能与 Sakura 独立入口端口相同。'}
    $managed=Get-DiaryManagedProcess $ProjectRoot;$running=Get-DiaryHealth $old.port
    if($running -and !$managed){throw 'Stop the command-line diary before changing ports.'}
    if($Port -ne $old.port){Test-DiaryPort $Port}
    if($remote.enabled){
        $tailscale=Get-DiaryTailscale
        if(!$tailscale.running){throw 'Connect Tailscale, or turn off phone access before changing ports.'}
        $oldTarget=if($remote.target){$remote.target}else{"http://127.0.0.1:$($old.port)"}
        $allowed=@("http://127.0.0.1:$Port")
        if(([Uri]$remote.origin).Port -eq $HttpsPort -and ([Uri]$remote.origin).Host -eq $tailscale.dns){$allowed+=$oldTarget}
        Assert-DiaryRoute (Get-DiaryServe $tailscale) $tailscale.dns $HttpsPort $allowed
    }
    try{
        Set-DiarySettings $ProjectRoot $Port $HttpsPort
        if($managed -and $Port -ne $old.port){Stop-DiaryService $ProjectRoot}
        if($remote.enabled){$null=Enable-DiaryRemote $ProjectRoot}
        elseif($running){$null=Start-DiaryService $ProjectRoot}
    }catch{
        $failure=$_
        Set-DiarySettings $ProjectRoot $old.port $old.httpsPort
        Write-DiaryJson (Join-Path $ProjectRoot 'local-state/remote-access.json') $remote
        try{if($managed){Stop-DiaryService $ProjectRoot;$null=Start-DiaryService $ProjectRoot};if($remote.enabled){$null=Enable-DiaryRemote $ProjectRoot}}catch{Write-Warning 'Settings were restored; check service status and retry.'}
        throw $failure
    }
}

function Get-DiaryControllerStatus {
    param([string]$ProjectRoot)
    $settings=Get-DiarySettings $ProjectRoot;$runtime=Get-DiaryRuntime $ProjectRoot
    $health=Get-DiaryHealth $settings.port
    $expected=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'exports/LIFE'))
    $running=$health -and $health.application -eq 'life-local-diary' -and $health.root -eq $expected
    $managed=$false
    try{$managed=$null -ne (Get-DiaryManagedProcess $ProjectRoot)}catch{}
    $dependencies=$runtime.ready -and (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules/cheerio')) -and (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules/sharp')) -and (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules/fast-xml-parser'))
    try{$tailscale=Get-DiaryTailscale}catch{$tailscale=[pscustomobject]@{installed=$true;running=$false}}
    $remote=Get-DiaryRemoteConfig $ProjectRoot
    $sakura=Get-DiarySakuraConfig $ProjectRoot
    $sakuraReady=$running -and $sakura.enabled -and $health.sakuraOrigin -eq $sakura.origin -and $health.sakuraPort -eq $sakura.port
    $remoteUrl=$null;$remoteRunning=$false
    if($tailscale.running){
        $suffix=if($settings.httpsPort -eq 443){''}else{':'+$settings.httpsPort}
        $remoteUrl='https://'+$tailscale.dns+$suffix
        if($remote.enabled -and $running -and $health.remoteOrigin -eq $remote.origin){
            try{
                $serve=Get-DiaryServe $tailscale
                $route=$serve.Web.PSObject.Properties | Where-Object Name -EQ (([Uri]$remote.origin).Host+':'+([Uri]$remote.origin).Port)
                $handlers=@($route.Value.Handlers.PSObject.Properties)
                $remoteRunning=$handlers.Count -eq 1 -and $handlers[0].Name -eq '/' -and $handlers[0].Value.Proxy -eq "http://127.0.0.1:$($settings.port)"
            }catch{$remoteRunning=$false}
        }
    }
    $active=$null;$activePath=Join-Path $ProjectRoot 'local-state/controller/active.json'
    if(Test-Path -LiteralPath $activePath){
        $record=Get-Content -LiteralPath $activePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $owner=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.pid)" -ErrorAction SilentlyContinue
        if($owner -and $owner.CommandLine -like '*Diary-Control.Worker.ps1*' -and $owner.CommandLine.Contains($record.operationDirectory)){$active=$record}
    }
    return [pscustomobject]@{settings=$settings;runtimeVersion=$runtime.version;environmentReady=[bool]$dependencies;running=[bool]$running;managed=$managed;localUrl="http://127.0.0.1:$($settings.port)";phoneUrl=$remoteUrl;phoneEnabled=[bool]$remote.enabled;phoneRunning=[bool]$remoteRunning;tailscaleInstalled=[bool]$tailscale.installed;tailscaleRunning=[bool]$tailscale.running;sakuraEnabled=[bool]$sakura.enabled;sakuraReady=[bool]$sakuraReady;sakuraOrigin=$sakura.origin;sakuraPort=$(if($sakura.port){$sakura.port}else{8767});busy=$active}
}

function Get-DiarySakuraConfig {
    param([string]$ProjectRoot)
    $file=Join-Path $ProjectRoot 'local-state/sakura-access.json'
    if(Test-Path -LiteralPath $file){return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json)}
    return [pscustomobject]@{enabled=$false;port=8767;origin=''}
}

function Protect-DiaryPassword {
    param([Security.SecureString]$Password)
    Add-Type -AssemblyName System.Security
    $pointer=[IntPtr]::Zero;$bytes=$null
    try{
        $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
        $bytes=[Text.Encoding]::UTF8.GetBytes([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
        return [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
    }finally{if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}}
}

function Unprotect-DiaryPassword {
    param([string]$ProtectedPassword)
    Add-Type -AssemblyName System.Security
    $bytes=$null;$characters=$null;$secure=[Security.SecureString]::new()
    try{
        $bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($ProtectedPassword),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $characters=[Text.Encoding]::UTF8.GetChars($bytes)
        foreach($character in $characters){$secure.AppendChar($character)}
        $secure.MakeReadOnly();return $secure
    }catch{$secure.Dispose();throw '无法读取访问密码，请在当前 Windows 账号下重新输入。'}
    finally{if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};if($characters){[Array]::Clear($characters,0,$characters.Length)}}
}

function Set-DiarySakuraAccess {
    param([string]$ProjectRoot,[string]$Origin,[int]$Port,[Security.SecureString]$Password,[switch]$Disable)
    $settings=Get-DiarySettings $ProjectRoot;$old=Get-DiarySakuraConfig $ProjectRoot
    $health=Get-DiaryHealth $settings.port;$managed=Get-DiaryManagedProcess $ProjectRoot
    if($health -and !$managed){throw '请先停止命令行启动的日记，再使用控制台应用 Sakura 设置。'}
    if($health -and ($health.application -ne 'life-local-diary' -or $health.root -ne [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'exports/LIFE')))){throw 'Local port belongs to another application.'}
    if($Disable){$new=$old;$new.enabled=$false}
    else{
        if($Port -eq $settings.port){throw 'Sakura 独立入口不能使用本地日记端口。请选择另一个端口，例如 8767。'}
        if($Port -lt 1 -or $Port -gt 65535){throw 'Port must be an integer between 1 and 65535.'}
        if(!$old.enabled -or !$health -or $health.sakuraPort -ne $Port){Test-DiaryPort $Port}
        $runtime=Get-DiaryRuntime $ProjectRoot
        if(!$runtime.ready){throw 'Node.js 22 or newer is missing. Click the first-use installation button.'}
        $plain='';$pointer=[IntPtr]::Zero
        try{
            if($Password){$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}
            $inputText=@{origin=$Origin;port=$Port;password=$plain;previous=$old} | ConvertTo-Json -Depth 5 -Compress
            $result=Invoke-DiaryCommand $runtime.node @((Join-Path $ProjectRoot 'local-diary/sakura-auth.mjs')) -InputText $inputText -WorkingDirectory $ProjectRoot
            if($result.exitCode -ne 0){throw $result.error}
            $new=$result.output | ConvertFrom-Json
        }finally{if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)};$plain=$null;$inputText=$null}
    }
    $file=Join-Path $ProjectRoot 'local-state/sakura-access.json'
    # Keep an independent copy because the disable operation must also roll back.
    $previous=Get-DiarySakuraConfig $ProjectRoot
    try{
        if($managed){Stop-DiaryService $ProjectRoot}
        Write-DiaryJson $file $new
        if(!$Disable -or $managed){$null=Start-DiaryService $ProjectRoot}
        if(!$Disable){$check=Get-DiaryHealth $settings.port;if($check.sakuraOrigin -ne $new.origin -or $check.sakuraPort -ne $Port){throw 'Sakura 入口未成功加载，请检查服务日志。'}}
    }catch{
        $failure=$_
        Write-DiaryJson $file $previous
        try{Stop-DiaryService $ProjectRoot;if($managed){$null=Start-DiaryService $ProjectRoot}}catch{Write-Warning '配置已恢复，请检查服务状态。'}
        throw $failure
    }
}

function Open-DiarySakuraUrl {
    param([string]$ProjectRoot)
    $config=Get-DiarySakuraConfig $ProjectRoot
    $uri=[Uri]$config.origin
    if(!$config.enabled -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment){throw '请先配置并开启 Sakura 入口。'}
    Start-Process $uri.AbsoluteUri
}

function Open-DiaryUrl {
    param([string]$Url)
    $uri=[Uri]$Url
    if(!(($uri.Scheme -eq 'http' -and $uri.Host -eq '127.0.0.1') -or ($uri.Scheme -eq 'https' -and $uri.Host -match '^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$')) -or $uri.UserInfo){throw 'Invalid diary address.'}
    Start-Process $uri.AbsoluteUri
}

Export-ModuleMember -Function *-Diary*
