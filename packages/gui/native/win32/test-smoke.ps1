#!/usr/bin/env pwsh
# test-smoke.ps1 — Non-destructive smoke tests for understudy-win32-helper.exe
# Safe to run in headless CI (no mouse/keyboard injection, no WGC capture).
#
# Usage: pwsh test-smoke.ps1 [-BinaryPath <path>]
#   Defaults to .\build\Release\understudy-win32-helper.exe

param(
    [string]$BinaryPath = ".\build\Release\understudy-win32-helper.exe"
)

$ErrorActionPreference = "Stop"
$passed = 0
$failed = 0

function Test-Case {
    param([string]$Name, [scriptblock]$Block)
    Write-Host -NoNewline "  $Name ... "
    try {
        & $Block
        Write-Host "PASS" -ForegroundColor Green
        $script:passed++
    } catch {
        Write-Host "FAIL: $_" -ForegroundColor Red
        $script:failed++
    }
}

# ── Prerequisite: binary exists ──────────────────────────────────────────────
if (-not (Test-Path $BinaryPath)) {
    Write-Host "ERROR: Binary not found at $BinaryPath" -ForegroundColor Red
    exit 1
}
Write-Host "Using binary: $BinaryPath"
Write-Host ""

# ── 1. No-args usage error ───────────────────────────────────────────────────
Write-Host "Suite: basic"
Test-Case "no-args returns usage error" {
    $out = & $BinaryPath 2>&1 | Out-String
    $json = $out | ConvertFrom-Json
    if ($json.status -ne "error") { throw "expected status=error, got $($json.status)" }
}

# ── 2. Unknown subcommand ────────────────────────────────────────────────────
Test-Case "unknown subcommand returns error" {
    $out = & $BinaryPath "bogus-command" 2>&1 | Out-String
    $json = $out | ConvertFrom-Json
    if ($json.status -ne "error") { throw "expected status=error" }
    if ($json.message -notmatch "Unknown subcommand") { throw "unexpected message: $($json.message)" }
}

# ── 3. check-readiness ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "Suite: check-readiness"
Test-Case "check-readiness returns ok JSON" {
    $out = & $BinaryPath check-readiness 2>$null | Out-String
    $json = $out | ConvertFrom-Json
    if ($json.status -ne "ok") { throw "expected status=ok, got $($json.status)" }
    if ($null -eq $json.data.gdiCapture) { throw "missing gdiCapture field" }
}

# ── 4. enumerate-windows ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "Suite: enumerate-windows"
Test-Case "enumerate-windows returns ok JSON" {
    $out = & $BinaryPath enumerate-windows 2>$null | Out-String
    $json = $out | ConvertFrom-Json
    if ($json.status -ne "ok") { throw "expected status=ok, got $($json.status)" }
    # In headless CI, the windows array may be empty — that's fine
    if ($null -eq $json.data.windows) { throw "missing windows array" }
}

# ── 5. record-events with --stop-after-ms ────────────────────────────────────
Write-Host ""
Write-Host "Suite: record-events"
Test-Case "record-events --stop-after-ms exits cleanly with valid JSON" {
    $tmpFile = Join-Path $env:TEMP "understudy-smoke-events-$(Get-Random).json"
    try {
        $proc = Start-Process -FilePath $BinaryPath `
            -ArgumentList "record-events", $tmpFile, "--stop-after-ms", "1500" `
            -NoNewWindow -PassThru -RedirectStandardError ([System.IO.Path]::GetTempFileName())
        $exited = $proc.WaitForExit(10000)  # 10s safety timeout
        if (-not $exited) {
            $proc.Kill()
            throw "process did not exit within 10s"
        }
        if ($proc.ExitCode -ne 0) { throw "exit code $($proc.ExitCode)" }
        if (-not (Test-Path $tmpFile)) { throw "event file not created" }
        $content = Get-Content $tmpFile -Raw
        $events = $content | ConvertFrom-Json
        # Valid JSON array (may be empty [] if no input events in 1.5s)
        if ($events -isnot [array]) { throw "expected JSON array" }
    } finally {
        Remove-Item $tmpFile -ErrorAction SilentlyContinue
    }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
exit $failed
