#Requires -Version 5.1
<#
    lifegame — the single verification entry point.

    Usage
    -----
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -Full
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipNode

    Why this exists
    ---------------
    The gates used to be eight separate commands with three different invocation
    conventions and a three-line preamble that had to be repeated in every
    shell. Forgetting the preamble does not fail loudly — the environment
    contract silently falls back to the system volume, and the suite goes red
    for a reason that has nothing to do with the change being tested. One entry
    point that sources the environment itself, runs every gate, and reports a
    single exit code removes both the repetition and the failure mode.

    Default set (routine, about seven seconds)
    ------------------------------------------
        documentation conformance, gate self-tests, tool build freshness,
        isolation static phase, Python tests, Python lint, Node install.

    -Full adds the version-boundary work
    -------------------------------------
        the isolation dynamic phase (runs a real workload, then scans the
        system-volume fallback locations) and a bootstrap idempotence run.
        Both are evidence for a delivered revision rather than feedback for an
        edit, so they are not in the default path.

    Exit codes
    ----------
        0  every gate passed
        1  at least one gate failed
        2  the runner could not complete (missing tool, unexpected error)

    Authority
    ---------
    AGENTS.md §4 — the gate table this script implements.
    docs/plan/phase-01-foundation/acceptance.md — the criteria each gate decides.
#>
[CmdletBinding()]
param(
    [switch] $Full,
    [switch] $SkipNode
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$script:Results = New-Object System.Collections.Generic.List[object]
$script:Aborted = $false

trap {
    Write-Host ''
    Write-Host "verify: could not complete: $($_.Exception.Message)"
    Write-Host $_.ScriptStackTrace
    exit 2
}

# Sourcing the environment here is the whole point of the entry point: the
# caller does not have to remember it.
. (Join-Path $PSScriptRoot 'env.ps1')

# And the working directory is fixed for the same reason. `uv run pytest` with
# no test path collects nothing when the caller happens to be in a subdirectory,
# which turns into a red gate for a reason unrelated to the change being tested
# — measured from docs/: `python tests` exited 5. The transient locations are
# unaffected either way, because scripts/env.ps1 exports absolute paths.
Set-Location -LiteralPath $projectRoot

Write-Host "[verify] project root: $projectRoot"
Write-Host "[verify] transient locations confirmed in-repo by scripts/env.ps1"
Write-Host ''

function Invoke-NativeStep {
    <#
        Runs a native command with stderr relaxed, so a tool's warning line
        cannot terminate the run, and returns its exit code.

        Output goes through Out-Host: without it the command's output would be
        part of this function's return value and the caller would compare an
        array against zero.
    #>
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments | Out-Host
        return $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-Gate {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Body,
        # A gate that cannot run on this machine is reported as not run, which is
        # a third state and not a pass. The browser probe is the reason this
        # exists: it needs a browser, and a machine without one must say so
        # rather than show a tick it did not earn.
        [switch]$NotRunIsAllowed
    )
    Write-Host "[verify] >> $Name"
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $code = 0
    try { $code = & $Body }
    catch {
        Write-Host "         error: $($_.Exception.Message)"
        $code = 2
    }
    $stopwatch.Stop()
    $ms = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 0)
    if ($code -eq 2 -and $NotRunIsAllowed) {
        $script:Results.Add([pscustomobject]@{ Gate = $Name; Ok = 'not run'; Exit = $code; Ms = $ms })
        Write-Host "         NOT RUN (exit 2; the tool could not run here) ($ms ms)"
        Write-Host ''
        return
    }
    $ok = ($code -eq 0)
    $script:Results.Add([pscustomobject]@{
            Gate  = $Name
            Ok    = $ok
            Exit  = $code
            Ms    = $ms
        })
    $mark = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Host ("         {0} ({1} ms)" -f $mark, $ms)
    Write-Host ''
}

$powershellFile = { param([string]$Script, [string[]]$Extra) @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script) + $Extra }

$isolationStaticArgs = @('-StaticOnly')
$isolationFullArgs = @()
if ($SkipNode) {
    $isolationStaticArgs += '-SkipNode'
    $isolationFullArgs += '-SkipNode'
}

Invoke-Gate 'documentation conformance' {
    Invoke-NativeStep 'powershell' (& $powershellFile (Join-Path $projectRoot 'tools\documentation\validate-documentation.ps1') @('-Quiet'))
}
Invoke-Gate 'gate self-tests' {
    Invoke-NativeStep 'powershell' (& $powershellFile (Join-Path $projectRoot 'tools\documentation\tests\run-tests.ps1') @())
}
Invoke-Gate 'tool build (incremental)' {
    Invoke-NativeStep 'powershell' (& $powershellFile (Join-Path $projectRoot 'tools\documentation\build.ps1') @('-Quiet'))
}
Invoke-Gate 'isolation (static)' {
    Invoke-NativeStep 'powershell' (& $powershellFile (Join-Path $projectRoot 'scripts\verify-temp-isolation.ps1') $isolationStaticArgs)
}
Invoke-Gate 'python tests' {
    Invoke-NativeStep 'uv' @('run', 'pytest', '-q')
}
Invoke-Gate 'python lint' {
    Invoke-NativeStep 'uv' @('run', 'ruff', 'check')
}
if (-not $SkipNode) {
    Invoke-Gate 'node install' {
        Invoke-NativeStep 'pnpm' @('install', '--silent')
    }
    Invoke-Gate 'viewer service and page' {
        # The glob is passed through to Node rather than expanded by
        # PowerShell: Node's own runner resolves it, and Node 24 does not
        # accept the directory form.
        Invoke-NativeStep 'node' @('--test', 'src/viewer/tests/*.test.mjs')
    }
    Invoke-Gate 'viewer launcher' {
        # Starts the viewer, asks it for each routed page, stops it, and fails if
        # anything it started is still running. The last part is the point: an
        # orphaned core keeps holding the history store, which was observed here
        # rather than theorised about. Run without a history so it cannot contend
        # with the store an operator is using.
        Invoke-NativeStep 'powershell' (& $powershellFile (Join-Path $projectRoot 'scripts\viewer.ps1') @('-Port', '8901', '-SmokeTest', '-NoHistory'))
    }
    Invoke-Gate 'viewer in a browser' -NotRunIsAllowed {
        # The only gate that observes what the stylesheet does rather than what
        # it says. It drives a real browser over the DevTools Protocol against
        # the shipped service, and it is the instrument that found the four
        # defects the suite was green through. Exit 2 means it could not run
        # here, usually because no browser is installed: that is reported as not
        # run, because a tick it did not earn is worse than a known gap.
        Invoke-NativeStep 'powershell' (& $powershellFile (Join-Path $projectRoot 'tools\browser-probe\run.ps1') @())
    }
}

if ($Full) {
    Invoke-Gate 'isolation (full, version-boundary)' {
        Invoke-NativeStep 'powershell' (& $powershellFile (Join-Path $projectRoot 'scripts\verify-temp-isolation.ps1') $isolationFullArgs)
    }
    Invoke-Gate 'bootstrap idempotence' {
        Invoke-NativeStep 'powershell' (& $powershellFile (Join-Path $projectRoot 'scripts\bootstrap.ps1') @())
    }
}

Write-Host '[verify] summary'
$script:Results | Format-Table -AutoSize | Out-String | Write-Host

$failed = @($script:Results | Where-Object { -not $_.Ok })
$totalSeconds = [math]::Round((($script:Results | Measure-Object Ms -Sum).Sum) / 1000, 1)
if ($failed.Count -gt 0) {
    Write-Host ("[verify] {0} of {1} gate(s) failed in {2} s" -f $failed.Count, $script:Results.Count, $totalSeconds)
    $failed | ForEach-Object { Write-Host ("  - {0} (exit {1})" -f $_.Gate, $_.Exit) }
    exit 1
}
Write-Host ("[verify] all {0} gate(s) passed in {1} s" -f $script:Results.Count, $totalSeconds)
exit 0
