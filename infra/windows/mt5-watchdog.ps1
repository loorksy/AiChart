# Optional: restart MetaTrader 5 if the terminal process is not running.
# Register in Task Scheduler: run every 5 minutes, highest privileges, whether user logged on or not.
$mt5 = "${env:ProgramFiles}\MetaTrader 5\terminal64.exe"
if (-not (Test-Path $mt5)) {
    Write-Host "MT5 not found at $mt5"
    exit 0
}
$proc = Get-Process -Name terminal64 -ErrorAction SilentlyContinue
if ($null -eq $proc) {
    Write-Host "Starting MT5..."
    Start-Process -FilePath $mt5 -ArgumentList "/portable"
}
