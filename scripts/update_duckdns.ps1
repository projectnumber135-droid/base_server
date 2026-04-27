$DOMAIN = "ubstudioz"
$TOKEN = "YOUR_TOKEN_HERE" # Replace with your DuckDNS token

Write-Host "🌐 Updating DuckDNS for $DOMAIN..."
$url = "https://www.duckdns.org/update?domains=$DOMAIN&token=$TOKEN"

try {
    $result = Invoke-RestMethod -Uri $url
    if ($result -eq "OK") {
        Write-Host "✅ DuckDNS update successful!" -ForegroundColor Green
    } else {
        Write-Host "❌ DuckDNS update failed: $result" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}
