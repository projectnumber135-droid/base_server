# Run this script as Administrator to create the startup task
$taskName = "FileServerStartup"
$scriptPath = "C:\FileServer\start_pm2.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Error "Could not find startup script at $scriptPath"
    exit 1
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File $scriptPath"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 0) -Compatibility Win8

# Unregister if exists
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -TaskName $taskName -Force

Write-Host "Scheduled Task '$taskName' created successfully." -ForegroundColor Green
Write-Host "The server will now start automatically at VM boot (using SYSTEM account)." -ForegroundColor Cyan
