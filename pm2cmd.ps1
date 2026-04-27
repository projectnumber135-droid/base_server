# PM2 Command Helper - Runs PM2 as Administrator to bypass pipe permission issues
# Usage: .\pm2cmd.ps1 <pm2-args>
# Example: .\pm2cmd.ps1 list

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$PassArgs
)

if (-not $PassArgs) { $PassArgs = @("list") }

# Set environment variables for the current session
$env:PM2_HOME = 'c:/FileServer/pm2'
$env:PM2_RPC_PORT = '43554'
$env:PM2_PUB_PORT = '43555'

# Run PM2 directly using absolute paths for reliability
try {
    $nodePath = "C:\Program Files\nodejs\node.exe"
    $pm2Path = "C:\FileServer\node_modules\pm2\bin\pm2"
    
    if (Test-Path $nodePath) {
        & $nodePath $pm2Path @PassArgs
    } else {
        Write-Host "Error: Node.exe not found at $nodePath" -ForegroundColor Red
    }
} catch {
    Write-Host "Error running PM2: $($_.Exception.Message)" -ForegroundColor Red
}
