#Requires -Version 5.1
<#
.SYNOPSIS
    Run the real-browser probe of the viewer interface and return its verdict.

.DESCRIPTION
    One command that starts the shipped service on a free port, drives a real
    browser against it over the DevTools Protocol, writes report.json and
    report.txt, stops everything it started, and returns an exit code a gate can
    read.

    The tool itself is Node (probe.mjs); this script is the entry point that
    makes it usable the same way as the rest of the repository's tooling: it
    sources scripts/env.ps1 so no temporary file can land outside the tree, it
    refuses to run without Node or a browser instead of pretending, and after
    the probe has finished it looks for itself at any world core (a Python
    process running lifegame.world out of this repository) that was not running
    before the probe started. That last check is the independent second opinion:
    a probe that leaked a core while reporting success would otherwise be
    believed.

    This is a tool, not part of the product. Nothing under src/ imports it and
    the viewer does not depend on it.

.PARAMETER Mode
    Which probes to run: health, geometry, interaction, or all (the default).

.PARAMETER Route
    The page the geometry and interaction probes visit. Default /.

.PARAMETER Select
    A CSS selector whose box is measured. Repeatable.

.PARAMETER Topmost
    A CSS selector that must be the topmost element at its own centre. This is
    the check that catches an overlay drawn over a label. Repeatable.

.PARAMETER Point
    An x,y viewport point to hit-test with elementFromPoint. Repeatable.

.PARAMETER Container
    A CSS selector whose scrollWidth and client metrics are reported.

.PARAMETER Click
    What to press and release: a CSS selector, or an x,y point. Default: the
    centre of the viewport.

.PARAMETER Drag
    A dx,dy offset to move the pressed mouse by before releasing it.

.PARAMETER ExpectRequest
    Text that must appear in a request URL the page issues. This is how a click
    that fails to select is caught: the selection request never appears.
    Repeatable.

.PARAMETER Script
    A file whose contents are the body of an async function evaluated in the
    page; whatever it returns is recorded under probes.script.

.PARAMETER Settle
    Milliseconds to wait after load before measuring. Default 800.

.PARAMETER Attach
    The URL of a service that is already running. Nothing is started and nothing
    is stopped. Input is disabled unless -AllowInput is also given, because a
    real press can move the world of whoever is using that service.

.PARAMETER AllowInput
    Permit real input against a service named with -Attach.

.PARAMETER Port
    The port for the service this script starts. 0 (the default) picks a free
    one.

.PARAMETER History
    Record a history at this path instead of running without one. The path must
    be inside the repository.

.PARAMETER Browser
    The browser executable. Without it the usual names on PATH and the usual
    installation directories are searched; LIFEGAME_BROWSER does the same job.

.PARAMETER Out
    Where the reports and screenshots go. Default: TEMP\browser-probe\<stamp>,
    which scripts/env.ps1 has already pointed inside the repository.

.PARAMETER Timeout
    The whole run's budget in milliseconds. Default 120000.

.PARAMETER Unknown
    A path the service must answer 404 for.

.PARAMETER NoScreenshot
    Do not write PNG evidence.

.PARAMETER Json
    Also print report.json to standard output.

.PARAMETER SelfTest
    Do not touch the viewer at all: serve two pages of the probe's own making
    and assert that the probes measure them correctly, including a page where an
    element is deliberately covered. Proves the instrument works.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1 `
        -Route /history -Topmost '.timeline-head' -Click '.timeline-row' `
        -ExpectRequest /api/select

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1 -SelfTest
#>
[CmdletBinding()]
param(
    [string]$Mode = 'all',
    [string]$Route = '/',
    [string[]]$Select = @(),
    [string[]]$Topmost = @(),
    [string[]]$Point = @(),
    [string]$Container,
    [string]$Click,
    [string]$Drag,
    [string[]]$ExpectRequest = @(),
    [string]$Script,
    [int]$Settle = 800,
    [string]$Attach,
    [switch]$AllowInput,
    [int]$Port = 0,
    [string]$History,
    [string]$Browser,
    [string]$Out,
    [int]$Timeout = 120000,
    [string]$Unknown,
    [switch]$NoScreenshot,
    [switch]$Json,
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).ProviderPath
Set-Location -LiteralPath $projectRoot
. (Join-Path $projectRoot 'scripts\env.ps1')

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '[browser-probe] node is not on PATH; this tool needs Node 22 or newer' -ForegroundColor Red
    exit 2
}

function Get-WorldCoreIds {
    <#
      The world cores of this repository, by pid.

      Matched on the command line rather than on the process name, exactly as
      scripts/viewer.ps1 does: a machine runs other Python, and killing or
      reporting on "python" would be a much worse bug than the one this looks
      for. The point of the list here is the difference between the state before
      the probe and the state after it.
    #>
    Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match 'lifegame\.world' -and
            $_.CommandLine -match [regex]::Escape($projectRoot)
        } |
        Select-Object -ExpandProperty ProcessId
}

$coresBefore = @(Get-WorldCoreIds)

$arguments = @()
if ($SelfTest) {
    $scriptPath = Join-Path $PSScriptRoot 'selftest.mjs'
    if ($Out) { $arguments += @('--out', $Out) }
    if ($Browser) { $arguments += @('--browser', $Browser) }
    if ($NoScreenshot) { $arguments += '--no-screenshot' }
} else {
    $scriptPath = Join-Path $PSScriptRoot 'probe.mjs'
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        Write-Host "[browser-probe] the probe is missing: $scriptPath" -ForegroundColor Red
        exit 2
    }
    $arguments += @('--mode', $Mode, '--route', $Route, '--settle', "$Settle", '--timeout', "$Timeout")
    if ($Attach) { $arguments += @('--service', $Attach) }
    if ($Port -ne 0) { $arguments += @('--port', "$Port") }
    if ($History) { $arguments += @('--history', $History) }
    if ($Unknown) { $arguments += @('--unknown', $Unknown) }
    if ($Container) { $arguments += @('--container', $Container) }
    if ($Click) { $arguments += @('--click', $Click) }
    if ($Drag) { $arguments += @('--drag', $Drag) }
    if ($Script) { $arguments += @('--script', $Script) }
    if ($Browser) { $arguments += @('--browser', $Browser) }
    if ($Out) { $arguments += @('--out', $Out) }
    if ($AllowInput) { $arguments += '--allow-input' }
    if ($NoScreenshot) { $arguments += '--no-screenshot' }
    if ($Json) { $arguments += '--json' }
    foreach ($selector in $Select) { $arguments += @('--select', $selector) }
    foreach ($selector in $Topmost) { $arguments += @('--topmost', $selector) }
    foreach ($point in $Point) { $arguments += @('--point', $point) }
    foreach ($needle in $ExpectRequest) { $arguments += @('--expect-request', $needle) }
}

& $node.Source $scriptPath @arguments
$code = $LASTEXITCODE

# -- independent second opinion -------------------------------------------
# The probe verifies its own cleanup; this looks for a core that was not
# running before the probe and is running after it. A run that reported success
# while leaving one behind exits 2, because a silent leftover is the failure
# mode this repository has already paid for once.
$coresAfter = @(Get-WorldCoreIds)
$newCores = @($coresAfter | Where-Object { $coresBefore -notcontains $_ })
if ($newCores.Count -gt 0) {
    Write-Host '[browser-probe] a world core outlived the probe:' -ForegroundColor Red
    foreach ($core in $newCores) { Write-Host "  pid $core" -ForegroundColor Red }
    Write-Host '[browser-probe] stop it before starting another run' -ForegroundColor Red
    exit 2
}
Write-Host "[browser-probe] no world core was left behind (checked $($coresAfter.Count) running, $($coresBefore.Count) before)" -ForegroundColor DarkGray

switch ($code) {
    0 { Write-Host '[browser-probe] exit 0 - every check passed' -ForegroundColor Green }
    1 { Write-Host '[browser-probe] exit 1 - at least one declared expectation did not hold' -ForegroundColor Yellow }
    2 { Write-Host '[browser-probe] exit 2 - the tool could not run, or could not clean up' -ForegroundColor Red }
    default { Write-Host "[browser-probe] exit $code" -ForegroundColor Red }
}
exit $code
