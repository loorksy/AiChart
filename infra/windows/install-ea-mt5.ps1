# Install AiChartBridge EA into MetaTrader 5 data folder.
# Run on Windows VPS after cloning AiChart or copying ea/mt5/AiChartBridge.mq5.
param(
    [string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
    [string]$ApiBase = "https://aichart.lork.cloud",
    [string]$EaToken = "",
    [string]$StreamSymbol = "EURUSD",
    [int]$HeartbeatSeconds = 1
)

$ErrorActionPreference = "Stop"
$src = Join-Path $RepoRoot "ea\mt5\AiChartBridge.mq5"
if (-not (Test-Path $src)) {
    Write-Error "EA source not found: $src`nClone AiChart or pass -RepoRoot."
}

$termRoot = Join-Path $env:APPDATA "MetaQuotes\Terminal"
$terminals = Get-ChildItem $termRoot -Directory -ErrorAction SilentlyContinue
if (-not $terminals) {
    Write-Error "No MT5 terminals under $termRoot. Install MT5 and log in once."
}

$destDirs = @()
foreach ($t in $terminals) {
    $experts = Join-Path $t.FullName "MQL5\Experts"
    if (Test-Path (Join-Path $t.FullName "origin.txt")) {
        New-Item -ItemType Directory -Force -Path $experts | Out-Null
        $dest = Join-Path $experts "AiChartBridge.mq5"
        Copy-Item $src $dest -Force
        $destDirs += $dest
        Write-Host "Copied EA -> $dest"
    }
}

if ($destDirs.Count -eq 0) {
    $fallback = Join-Path ($terminals | Select-Object -First 1).FullName "MQL5\Experts"
    New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    $dest = Join-Path $fallback "AiChartBridge.mq5"
    Copy-Item $src $dest -Force
    Write-Host "Copied EA -> $dest (first terminal)"
}

Write-Host ""
Write-Host "Next steps (MetaEditor / MT5):"
Write-Host "  1. Open MetaEditor, compile AiChartBridge.mq5 (F7)"
Write-Host "  2. Drag AiChartBridge onto a chart"
Write-Host "  3. Inputs:"
Write-Host "       ApiBase          = $ApiBase"
Write-Host "       EaToken          = <from AiChart Settings -> Integrations>"
Write-Host "       StreamSymbol     = $StreamSymbol"
Write-Host "       HeartbeatSeconds = $HeartbeatSeconds"
Write-Host "  4. Enable AutoTrading (green button)"
Write-Host "  5. Verify AiChart Settings shows EA online"
if ($EaToken) {
    Write-Host ""
    Write-Host "EaToken provided - set it in EA inputs after attach."
}
