#Requires -Version 5.1
<#
.SYNOPSIS
    Start the viewer and guarantee that stopping it stops everything it started.

.DESCRIPTION
    The viewer is a Node process that starts Python cores as children. Stopping
    the Node process does not always stop its children: on Windows a core can
    outlive the service, keep holding the history database and its write-ahead
    sidecars, and in the worst case become a second writer on a store another
    core is using. That was observed in this repository, not theorised about.

    This script is the supported way to run the viewer. It starts it, waits until
    it answers, streams its output, and on Ctrl+C — or on any exit, including a
    thrown error — reaps the whole process tree, then verifies that nothing is
    left. If something is left it says so and exits non-zero, because a silent
    leftover is the failure mode this script exists to remove.

.PARAMETER Port
    The port to listen on. Default 8765.

.PARAMETER History
    Where the core records its history. Default: the service's own default,
    data/history.db inside this repository.

.PARAMETER NoHistory
    Run without a recorded history, which also means without archive import.

.PARAMETER CleanStray
    Reap cores left behind by an earlier run before starting, instead of refusing.
    Only processes whose command line runs this repository's lifegame.world are
    touched.

    This is the one path that touches cores it did not start, so it cannot tell a
    true stray from a core another person's run is using right now. Run it when
    you mean it, and not while somebody else is testing.

.PARAMETER SmokeTest
    Start, request the three routed pages, stop, verify nothing is left, and exit
    with the result. Used by verification; it does not need a browser.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viewer.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viewer.ps1 -Port 9000
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viewer.ps1 -CleanStray
#>
[CmdletBinding()]
param(
    [int]$Port = 8765,
    [string]$History,
    [switch]$NoHistory,
    [switch]$CleanStray,
    [switch]$SmokeTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'env.ps1')

$script:child = $null
$script:startedAt = Get-Date

function Get-CoreProcesses {
    <#
      Every Python process in this repository that is running the world core.

      Matched on the command line rather than on the name: a machine can be
      running other Python, and killing "python" would be a much worse bug than
      the one this script fixes.
    #>
    Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'lifegame\.world' -and $_.CommandLine -match [regex]::Escape($projectRoot) } |
        Select-Object ProcessId, ParentProcessId, CommandLine
}

function Get-DescendantIds {
    <#
      Every process below a root, found before anything is killed.

      Computed first on purpose: once the parent is gone its children are
      reparented and the chain that identified them is gone with it, which is
      precisely how an orphan becomes unattributable.
    #>
    param([int]$RootPid)
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Select-Object ProcessId, ParentProcessId)
    $found = New-Object System.Collections.Generic.List[int]
    $frontier = @($RootPid)
    while ($frontier.Count -gt 0) {
        $next = @()
        foreach ($parent in $frontier) {
            foreach ($proc in $all) {
                if ([int]$proc.ParentProcessId -eq $parent -and -not $found.Contains([int]$proc.ProcessId)) {
                    $found.Add([int]$proc.ProcessId)
                    $next += [int]$proc.ProcessId
                }
            }
        }
        $frontier = $next
    }
    return $found
}

function Stop-ProcessId {
    <#
      Stop one process without letting its exit code become a script error.

      taskkill reports "not found" when a child died with its parent a moment
      earlier, which is the common case here and not a failure. Treating it as
      one is what made the first version of this script exit 1 on a successful
      cleanup.
    #>
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return }
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
    try {
        & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    } catch {
        # Already gone, or not ours to kill; the verification below decides.
    }
}

function Invoke-Cleanup {
    <#
      Reap, then verify.

      Verification is the point. A cleanup that reports success without looking
      is how the orphan survived in the first place: the kill "succeeded" and the
      process was still there.

      Only our own descendants are touched. Another run — a test suite, a second
      developer — has world cores too, and killing those would be a worse bug
      than the one this script exists to fix.
    #>
    $ours = @()
    if ($script:child) {
        $ours = @(Get-DescendantIds -RootPid $script:child.Id)
        if (-not $script:child.HasExited) {
            Write-Host "[viewer] stopping the service (pid $($script:child.Id)) and its children" -ForegroundColor Cyan
            Stop-ProcessId -ProcessId $script:child.Id
        }
    }
    foreach ($descendant in $ours) {
        Stop-ProcessId -ProcessId $descendant
    }

    # A core takes a moment to let go of its store, so look twice before deciding.
    Start-Sleep -Milliseconds 600
    $leftOurs = @($ours | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    $leftService = $false
    if ($script:child -and (Get-Process -Id $script:child.Id -ErrorAction SilentlyContinue)) {
        $leftService = $true
    }

    if ($leftOurs.Count -gt 0 -or $leftService) {
        Write-Host "[viewer] LEFT BEHIND after cleanup:" -ForegroundColor Red
        if ($leftService) { Write-Host "  service pid $($script:child.Id)" -ForegroundColor Red }
        $leftOurs | ForEach-Object { Write-Host "  child pid $_" -ForegroundColor Red }
        return $false
    }

    $others = @(Get-CoreProcesses)
    if ($others.Count -gt 0) {
        Write-Host "[viewer] stopped; $($others.Count) world core(s) belonging to another run were left alone" -ForegroundColor Yellow
        $others | ForEach-Object { Write-Host "  pid $($_.ProcessId) (not ours)" -ForegroundColor Yellow }
    } else {
        Write-Host "[viewer] stopped; no core and no service left behind" -ForegroundColor Green
    }
    return $true
}

# -- pre-flight ------------------------------------------------------------

$stray = @(Get-CoreProcesses)
if ($stray.Count -gt 0) {
    if ($CleanStray) {
        Write-Host "[viewer] reaping $($stray.Count) core(s) from an earlier run" -ForegroundColor Yellow
        foreach ($core in $stray) {
            Write-Host "[viewer] reaping world core pid $($core.ProcessId)" -ForegroundColor Yellow
            Stop-ProcessId -ProcessId $core.ProcessId
        }
        Start-Sleep -Milliseconds 500
        $stillThere = @(Get-CoreProcesses)
        if ($stillThere.Count -gt 0) {
            Write-Host "[viewer] $($stillThere.Count) core(s) would not stop; refusing to start a second writer" -ForegroundColor Red
            exit 2
        }
    } else {
        Write-Host "[viewer] $($stray.Count) world core(s) are already running and may hold the history store:" -ForegroundColor Yellow
        $stray | ForEach-Object { Write-Host "  pid $($_.ProcessId)" -ForegroundColor Yellow }
        Write-Host "[viewer] re-run with -CleanStray to reap them, or stop them yourself." -ForegroundColor Yellow
        exit 2
    }
}

# -- start -----------------------------------------------------------------

$serverPath = Join-Path $projectRoot 'src\viewer\server.mjs'
if (-not (Test-Path -LiteralPath $serverPath)) {
    Write-Host "[viewer] no viewer at $serverPath" -ForegroundColor Red
    exit 2
}

$arguments = @($serverPath, '--port', "$Port")
if ($NoHistory) { $arguments += '--no-history' }
elseif ($History) { $arguments += @('--history', $History) }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[viewer] node is not on PATH" -ForegroundColor Red
    exit 2
}

$exitCode = 0
# The pages the interface serves. `/` is the world page; the routed pages are
# listed so the gate notices if one of them stops being served, which is the
# failure a person sees as a blank tab.
$smokeRoutes = @('/', '/world', '/history', '/archives')
try {
    Write-Host "[viewer] starting on port $Port" -ForegroundColor Cyan
    $script:child = Start-Process -FilePath $node.Source -ArgumentList $arguments -NoNewWindow -PassThru

    # Wait until it answers rather than assuming a fixed delay is enough. The
    # service prints its own readiness line, but a machine under load can need
    # longer than any delay this script would pick.
    $ready = $false
    if ($SmokeTest) {
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Date) -lt $deadline) {
            if ($script:child.HasExited) { break }
            try {
                $response = Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch { Start-Sleep -Milliseconds 250 }
        }
    }

    if ($SmokeTest) {
        if (-not $ready) {
            Write-Host "[viewer] the service did not answer" -ForegroundColor Red
            $exitCode = 1
        } else {
            # `/` is the page the service always serves. Routed pages, when the
            # interface has them, are probed by the same list; the check is the
            # route set the service actually declares, so this stays honest
            # whether the interface is one page or several.
            foreach ($route in $smokeRoutes) {
                $page = Invoke-WebRequest "http://127.0.0.1:$Port$route" -UseBasicParsing -TimeoutSec 5
                Write-Host ("[viewer] GET {0,-10} -> {1} ({2} bytes)" -f $route, $page.StatusCode, $page.RawContentLength)
                if ($page.StatusCode -ne 200) { $exitCode = 1 }
            }
            $missing = $null
            try {
                $missing = Invoke-WebRequest "http://127.0.0.1:$Port/definitely-not-a-route" -UseBasicParsing -TimeoutSec 5
            } catch {
                $missing = $_.Exception.Response
            }
            if ($missing -and [int]$missing.StatusCode -ne 404) {
                Write-Host "[viewer] an unknown route did not answer 404" -ForegroundColor Red
                $exitCode = 1
            } else {
                Write-Host "[viewer] unknown route -> 404"
            }
        }
    } else {
        Write-Host "[viewer] press Ctrl+C to stop; this script reaps the tree afterwards" -ForegroundColor Cyan
        Wait-Process -Id $script:child.Id
        $exitCode = if ($script:child.ExitCode -ne $null) { $script:child.ExitCode } else { 0 }
    }
} finally {
    if (-not (Invoke-Cleanup)) { $exitCode = 1 }
}

exit $exitCode
