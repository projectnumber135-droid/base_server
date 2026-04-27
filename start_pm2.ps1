$env:PM2_HOME = "C:\FileServer\pm2"
$env:PM2_RPC_PORT = "43554"
$env:PM2_PUB_PORT = "43555"

$logFile = "C:\FileServer\pm2\startup.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Ensure the log directory exists
if (-not (Test-Path "C:\FileServer\pm2")) {
    New-Item -ItemType Directory -Path "C:\FileServer\pm2" -Force | Out-Null
}

"[$timestamp] Starting PM2 boot sequence..." | Out-File -FilePath $logFile -Append

# Network check removed to allow immediate startup. Network-dependent tasks (like Telegram) will handle their own retries.

try {
    $nodePath = "C:\Program Files\nodejs\node.exe"
    $pm2Path = "C:\FileServer\node_modules\pm2\bin\pm2"
    
    if (Test-Path $nodePath) {
        "[$timestamp] Using Node at: $nodePath" | Out-File -FilePath $logFile -Append
        "[$timestamp] Using PM2 at: $pm2Path" | Out-File -FilePath $logFile -Append
        
        # Kill any existing PM2 daemon or node processes
        "[$timestamp] Force killing all existing node processes..." | Out-File -FilePath $logFile -Append
        Stop-Process -Name node -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        
        # Start processes explicitly with absolute CWD
        "[$timestamp] Executing pm2 start for server and health_check..." | Out-File -FilePath $logFile -Append
        & $nodePath $pm2Path start C:\FileServer\server.js --name "FileServer" --cwd "C:\FileServer" 2>&1 | Out-File -FilePath $logFile -Append
        & $nodePath $pm2Path start C:\FileServer\js\health_check.js --name "HealthMonitor" --cwd "C:\FileServer" 2>&1 | Out-File -FilePath $logFile -Append
        
        "[$timestamp] Saving PM2 state..." | Out-File -FilePath $logFile -Append
        & $nodePath $pm2Path save 2>&1 | Out-File -FilePath $logFile -Append
        
        "[$timestamp] PM2 sequence completed." | Out-File -FilePath $logFile -Append
    } else {
        "[$timestamp] ERROR: Node.exe not found at $nodePath" | Out-File -FilePath $logFile -Append
    }
} catch {
    "[$timestamp] EXCEPTION: $($_.Exception.Message)" | Out-File -FilePath $logFile -Append
}

