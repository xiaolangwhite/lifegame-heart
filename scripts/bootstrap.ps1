#Requires -Version 5.1
<#
    lifegame — provision the environment from a clean checkout.

    Usage
    -----
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1 -SkipNode

    Contract
    --------
    * Idempotent: running it twice performs no download and changes nothing.
    * It sources scripts/env.ps1 itself, so it is safe to run from a fresh
      shell that has no environment set up. That script refuses to continue
      when a transient location points at C:.
    * It never deletes anything.
    * It works on a clean checkout, where no interpreter and no virtual
      environment exist yet.

    Why every native call goes through a helper
    -------------------------------------------
    A tool that has nothing to report writes to stderr, and under
    $ErrorActionPreference = 'Stop' PowerShell 5.1 turns a native stderr line
    into a terminating error even when stderr is redirected. On a clean
    checkout, `uv python find 3.14` writes "No interpreter found" to stderr and
    the script aborted before it could install anything — while the same script
    passed on a warm checkout, where the probe succeeds and prints nothing to
    stderr. Both helpers below keep stderr from terminating the script and
    report the exit code explicitly instead.

    Authority
    ---------
    docs/plan/phase-01-foundation/acceptance.md — criteria A1, A7.
    docs/model/environment/implementation.md — provisioning sequence.
#>
[CmdletBinding()]
param(
    [switch]$SkipNode,
    [switch]$SkipPythonPackages
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$envScript = Join-Path $PSScriptRoot 'env.ps1'

Write-Host "[bootstrap] project root: $projectRoot"

# Step 0 — the isolation contract. This throws when anything points at C:.
. $envScript
Write-Host '[bootstrap] isolation contract satisfied (TEMP, uv, pip, npm caches are in-repo)'

function Invoke-NativeStream {
    <#
        Runs a native tool, lets its output reach the console, and returns its
        exit code. stderr cannot terminate the script.
    #>
    param(
        [Parameter(Mandatory)][string]$Exe,
        [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # Out-Host sends the tool's output to the console only, so the
        # function's return value is the exit code and nothing else.
        & $Exe @Arguments | Out-Host
        return $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-NativeCapture {
    <#
        Runs a native tool for its first stdout line. stderr is dropped: probes
        such as "is an interpreter present" answer through the exit code, and
        their stderr is an expected part of answering "no".
    #>
    param(
        [Parameter(Mandatory)][string]$Exe,
        [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Exe @Arguments 2>$null
        $script:LastCaptureExitCode = $LASTEXITCODE
        return ($output | Select-Object -First 1)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-Step {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Body
    )
    Write-Host "[bootstrap] >> $Name"
    $code = & $Body
    if ($null -ne $code -and $code -ne 0) {
        throw "Step failed: $Name (exit code $code)"
    }
}

# Step 1 — directory skeleton. Created here and nowhere else, so every
# directory inherits the session's access rules.
Invoke-Step 'ensure directory skeleton' {
    $dirs = @(
        'TEMP', 'data', 'dev-log', 'evidence', 'scripts',
        '.cache\uv', '.cache\uv-python', '.cache\pip', '.cache\npm',
        '.cache\pnpm-store', '.cache\pnpm-cache', '.cache\pycache',
        'docs\adr', 'docs\model', 'docs\plan',
        'src\lifegame', 'tests', 'tools\documentation'
    )
    foreach ($d in $dirs) {
        $p = Join-Path $projectRoot $d
        if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
    }
    return 0
}

# Step 2 — managed interpreter payload, inside the repository.
Invoke-Step 'install uv-managed CPython 3.14 into .cache/uv-python' {
    $found = Invoke-NativeCapture -Exe 'uv' -Arguments @('python', 'find', '3.14')
    $probeExit = $script:LastCaptureExitCode
    if ($probeExit -eq 0 -and $found -and $found.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "[bootstrap]    already present: $found"
        return 0
    }
    return (Invoke-NativeStream -Exe 'uv' -Arguments @(
            'python', 'install', '3.14', '--no-bin',
            '--install-dir', (Join-Path $projectRoot '.cache\uv-python')
        ))
}

# Step 3 — virtual environment.
Invoke-Step 'create .venv when missing' {
    $venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $venvPython) {
        $version = Invoke-NativeCapture -Exe $venvPython -Arguments @('-V')
        Write-Host "[bootstrap]    already present: $version"
        return 0
    }
    return (Invoke-NativeStream -Exe 'uv' -Arguments @('venv', '--python', '3.14', (Join-Path $projectRoot '.venv')))
}

# Step 4 — Python packages.
if (-not $SkipPythonPackages) {
    Invoke-Step 'sync Python packages (project + dev group)' {
        Push-Location $projectRoot
        try { return (Invoke-NativeStream -Exe 'uv' -Arguments @('sync')) }
        finally { Pop-Location }
    }
}
else {
    Write-Host '[bootstrap] -- skipped: Python package sync'
}

# Step 5 — Node packages.
if (-not $SkipNode) {
    Invoke-Step 'install Node packages (pnpm, in-repo store)' {
        $packageJson = Join-Path $projectRoot 'package.json'
        if (-not (Test-Path -LiteralPath $packageJson)) {
            Write-Host '[bootstrap]    no package.json; nothing to do'
            return 0
        }
        Push-Location $projectRoot
        try { return (Invoke-NativeStream -Exe 'pnpm' -Arguments @('install')) }
        finally { Pop-Location }
    }
}
else {
    Write-Host '[bootstrap] -- skipped: Node package install'
}

# Step 6 — self-check.
Invoke-Step 'verify isolation' {
    return (Invoke-NativeStream -Exe 'powershell' -Arguments @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', (Join-Path $PSScriptRoot 'verify-temp-isolation.ps1'),
            '-StaticOnly'
        ))
}

Write-Host '[bootstrap] done.'
exit 0
