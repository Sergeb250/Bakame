$ErrorActionPreference = 'Stop'
$serviceName = 'BakameDesktopService'
$appPath = Join-Path $env:ProgramFiles 'bakame\bakame.exe'
$ownerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Wait-Condition([scriptblock]$Condition, [string]$Description, [int]$Seconds = 20) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out: $Description"
}
function Main-Processes {
    @(Get-CimInstance Win32_Process -Filter "Name = 'bakame.exe'" | Where-Object {
        $_.ExecutablePath -eq $appPath -and $_.CommandLine -notmatch '--type='
    })
}
function Start-App { Start-Process -FilePath $appPath -WindowStyle Hidden | Out-Null }
function Wait-App {
    Wait-Condition { (Get-Service $serviceName).Status -eq 'Running' -and @(Main-Processes).Count -eq 1 } 'one running service and desktop app'
    Start-Sleep -Seconds 2
}
function Quit-App {
    $pipe = [IO.Pipes.NamedPipeClientStream]::new('.', "bakame-ui-$ownerSid", [IO.Pipes.PipeDirection]::Out)
    try {
        $pipe.Connect(5000)
        $writer = [IO.StreamWriter]::new($pipe, [Text.UTF8Encoding]::new($false))
        $writer.WriteLine('quit')
        $writer.Flush()
    } finally { $pipe.Dispose() }
}
function Wait-Stopped {
    Wait-Condition {
        (Get-Service $serviceName).Status -eq 'Stopped' -and
        @(Get-CimInstance Win32_Process -Filter "Name = 'bakame.exe'" | Where-Object { $_.ExecutablePath -eq $appPath }).Count -eq 0
    } 'service stopped with no owned desktop processes' 15
}
$registered = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\BakameDesktopService'
if ($registered.Start -ne 3) { throw 'Service must use Manual startup' }
if (Get-Service 'OpenCluelyDesktopService' -ErrorAction SilentlyContinue) { throw 'Legacy service still registered' }
Start-App
Wait-App
$originalPid = @(Main-Processes)[0].ProcessId
1..4 | ForEach-Object { Start-App }
Start-Sleep -Seconds 6
if (@(Main-Processes).Count -ne 1 -or @(Main-Processes)[0].ProcessId -ne $originalPid) { throw 'Repeated launches did not reuse the primary app' }
Write-Output 'PASS: one registered manual service; repeated launches reuse one desktop instance'
Quit-App
Wait-Stopped
Start-Sleep -Seconds 3
if ((Get-Service $serviceName).Status -ne 'Stopped') { throw 'Quit unexpectedly restarted the service' }
Write-Output 'PASS: Quit stops the service and every owned desktop process; it stays stopped'
Start-App
Wait-App
$crashedPid = @(Main-Processes)[0].ProcessId
Stop-Process -Id $crashedPid -Force
Wait-Condition { $running = @(Main-Processes); $running.Count -eq 1 -and $running[0].ProcessId -ne $crashedPid } 'bounded crash recovery' 20
Write-Output 'PASS: reopening works and a genuine crash restarts the desktop once'
Stop-Service $serviceName
Wait-Stopped
Write-Output 'PASS: owner can stop the service without elevation; owned processes are cleaned up'
Start-App
Wait-App
Write-Output 'bakame is running and ready to use.'
