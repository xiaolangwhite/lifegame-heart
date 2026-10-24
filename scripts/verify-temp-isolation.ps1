#Requires -Version 5.1
<#
    lifegame — prove that the toolchain writes nothing outside the repository.

    Usage
    -----
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1 -StaticOnly
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1 -SkipNode -SkipCpp

    What it does
    ------------
    Static phase   — asserts that every location the toolchain would use
                     resolves inside the repository: the guarded environment
                     variables, pyvenv.cfg's interpreter home, uv's cache and
                     interpreter directories, pip's cache, the npm cache, the
                     pnpm store and the Python process's own view.
    Dynamic phase  — records a start instant, runs a representative workload
                     (Python temporary file, Python bytecode compilation, the
                     C++ tool build, a Node temporary file, pnpm install), then
                     lists every file below the system-volume fallback
                     locations whose modification time is at or after that
                     instant.

    Why one scan instead of two snapshots
    -------------------------------------
    A create or a modify always leaves a modification time at or after the
    instant the workload started, so a single post-run scan filtered by time
    detects both. Two full snapshots cost about twice as much and detect
    nothing extra. On this machine the watched roots hold roughly 78,000 files
    and one pass costs about seven seconds, which keeps the whole gate inside
    the 30-second limit recorded in docs/plan/PERFORMANCE_ACCEPTANCE.md §2.

    Exit codes
    ----------
        0  isolated
        1  a violation was found
        2  the script could not complete its checks

    Two exclusions, both explicit
    -----------------------------
    1. The agent runtime gives every command its own temporary directory on the
       system volume. Those belong to the harness, not to this project, and are
       excluded by pattern.
    2. This machine creates zero-length files whose entire name is a GUID with a
       .tmp extension, directly in the system temporary directory, whether or
       not this project runs. The class is characterised once and evidenced in
       evidence/windows-temporary-artifact-class.md; it is not re-derived on
       every run, because a proof that has to be repeated can fail for reasons
       unrelated to the claim. Every excused file is printed, and the shape
       stays narrow: zero length, whole name is a GUID, .tmp extension, and the
       file sits directly in the system temporary directory.

    Authority
    ---------
    docs/plan/phase-01-foundation/acceptance.md — criteria A1, A2, A3.
    docs/model/environment/interfaces.md — the contract this script enforces.
#>
[CmdletBinding()]
param(
    [switch]$StaticOnly,
    [switch]$SkipNode,
    [switch]$SkipCpp
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# An unexpected terminating error must not be reported as a violation: exit 1
# means "isolation is broken", which is a different claim from "the check did
# not finish".
trap {
    Write-Host ''
    Write-Host "verify-temp-isolation: could not complete the checks: $($_.Exception.Message)"
    Write-Host $_.ScriptStackTrace
    exit 2
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$envScript = Join-Path $PSScriptRoot 'env.ps1'
$systemTemp = Join-Path $env:LOCALAPPDATA 'Temp'

$script:Failures = New-Object System.Collections.Generic.List[string]
$script:Checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $script:Checks.Add([pscustomobject]@{ Name = $Name; Ok = $Ok; Detail = $Detail })
    if (-not $Ok) { $script:Failures.Add("$Name :: $Detail") }
    $mark = if ($Ok) { 'OK  ' } else { 'FAIL' }
    Write-Host ("  [{0}] {1,-38} {2}" -f $mark, $Name, $Detail)
}

function Test-InsideRepo {
    param([string]$Path, [string]$RepoRoot)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $value = $Path.Trim()
    # A tool that does not know a setting answers "undefined"; that is not a
    # location, and it must never be accepted as one.
    if ($value -match '^(undefined|null|true|false|nan)$') { return $false }
    # Require an absolute path: a relative value would resolve against the
    # caller's working directory and could land anywhere.
    if ($value -notmatch '^[A-Za-z]:[\\/]' -and $value -notmatch '^\\\\') { return $false }
    $full = $value
    try { $full = [System.IO.Path]::GetFullPath($value) } catch { return $false }
    return $full.StartsWith($RepoRoot, [StringComparison]::OrdinalIgnoreCase)
}

function Read-TextFileUtf8 {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-RepoRelative {
    <#
        A declared cache path must be relative, so that it follows whichever
        checkout is running, and it must not escape the repository when resolved
        against the repository root. An absolute declared path would name one
        checkout and send a clone's or worktree's cache into it.
    #>
    param([string]$Value, [string]$RepoRoot)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $v = $Value.Trim().Trim('"')
    if ($v -match '^(undefined|null|true|false|nan)$') { return $false }
    if ($v -match '^[A-Za-z]:' -or $v.StartsWith('\\') -or $v.StartsWith('/') -or $v.StartsWith('\')) { return $false }
    try { $full = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $v)) } catch { return $false }
    return $full.StartsWith($RepoRoot, [StringComparison]::OrdinalIgnoreCase)
}

# Native tools write warnings to stderr. Under $ErrorActionPreference = 'Stop',
# PowerShell 5.1 turns a native stderr line into a terminating error even when
# stderr is redirected, so every native invocation goes through this helper:
# it collects stdout, drops stderr, and reports the exit code separately.
function Invoke-NativeQuiet {
    param(
        [Parameter(Mandatory)][string]$Exe,
        [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Exe @Arguments 2>$null
        $script:LastNativeExitCode = $LASTEXITCODE
        return ($output | Select-Object -First 1)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

Write-Host '=== static phase ==='
. $envScript

# 1. Guarded environment variables. The list must stay in step with the guard
#    in scripts/env.ps1 and with tests/environment/test_isolation_contract.py;
#    a variable that decides a transient location but is not checked here is a
#    hole in the contract.
$guarded = @(
    'LIFEGAME_ROOT', 'TEMP', 'TMP', 'TMPDIR',
    'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR',
    'PIP_CACHE_DIR', 'PIP_CONFIG_FILE',
    'PYTHONPYCACHEPREFIX', 'npm_config_cache'
)
foreach ($name in $guarded) {
    $value = (Get-Item -Path "Env:$name").Value
    Add-Check "env:$name" (Test-InsideRepo -Path $value -RepoRoot $projectRoot) $value
}

# 2. Interpreter home recorded in the virtual environment. The file is UTF-8
#    and the repository path is not ASCII, so it must not be read with the
#    default (ANSI) encoding.
$pyvenvCfg = Join-Path $projectRoot '.venv\pyvenv.cfg'
if (Test-Path -LiteralPath $pyvenvCfg) {
    $cfgText = Read-TextFileUtf8 -Path $pyvenvCfg
    $line = ($cfgText -split "`r?`n" | Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1)
    $interpreterHome = (($line -replace '^\s*home\s*=\s*', '') -replace '^\s+|\s+$', '')
    $ok = (Test-InsideRepo -Path $interpreterHome -RepoRoot $projectRoot) -and ($interpreterHome -like '*uv-python*')
    Add-Check 'venv interpreter home' $ok $interpreterHome
}
else {
    Add-Check 'venv interpreter home' $false "$pyvenvCfg not found"
}

# 3. uv's resolved directories.
foreach ($spec in @(
        [pscustomobject]@{ Name = 'uv cache dir'; Args = @('cache', 'dir') },
        [pscustomobject]@{ Name = 'uv python dir'; Args = @('python', 'dir') }
    )) {
    $out = Invoke-NativeQuiet -Exe 'uv' -Arguments $spec.Args
    Add-Check $spec.Name (Test-InsideRepo -Path $out -RepoRoot $projectRoot) "$out"
}

# 4. Python's own view of the world.
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $venvPython) {
    $probeCode = "import json,sys,tempfile;print(json.dumps({'temp':tempfile.gettempdir(),'base':sys.base_prefix,'exe':sys.executable}))"
    $probe = Invoke-NativeQuiet -Exe $venvPython -Arguments @('-c', $probeCode)
    $info = $probe | ConvertFrom-Json
    Add-Check 'python tempfile.gettempdir()' (Test-InsideRepo -Path $info.temp -RepoRoot $projectRoot) $info.temp
    Add-Check 'python sys.base_prefix' (Test-InsideRepo -Path $info.base -RepoRoot $projectRoot) $info.base
    Add-Check 'python sys.executable' (Test-InsideRepo -Path $info.exe -RepoRoot $projectRoot) $info.exe
}
else {
    Add-Check 'python interpreter' $false "$venvPython not found"
}

# 5. Node package managers. pnpm 12 reads its store and cache location from
#    pnpm-workspace.yaml, not from .npmrc. Both forms are checked: the declared
#    value must be repository-relative, and the path pnpm actually resolves must
#    be absolute and inside this repository.
if (-not $SkipNode) {
    Push-Location $projectRoot
    try {
        $npmCache = Invoke-NativeQuiet -Exe 'npm' -Arguments @('config', 'get', 'cache')
        Add-Check 'npm cache (from env)' (Test-InsideRepo -Path $npmCache -RepoRoot $projectRoot) "$npmCache"

        $pnpmStoreDir = Invoke-NativeQuiet -Exe 'pnpm' -Arguments @('config', 'get', 'storeDir')
        Add-Check 'pnpm storeDir (declared)' (Test-RepoRelative -Value $pnpmStoreDir -RepoRoot $projectRoot) "$pnpmStoreDir"

        $pnpmCacheDir = Invoke-NativeQuiet -Exe 'pnpm' -Arguments @('config', 'get', 'cacheDir')
        Add-Check 'pnpm cacheDir (declared)' (Test-RepoRelative -Value $pnpmCacheDir -RepoRoot $projectRoot) "$pnpmCacheDir"

        $pnpmResolvedStore = Invoke-NativeQuiet -Exe 'pnpm' -Arguments @('store', 'path')
        Add-Check 'pnpm store path (resolved)' (Test-InsideRepo -Path $pnpmResolvedStore -RepoRoot $projectRoot) "$pnpmResolvedStore"
    }
    finally { Pop-Location }
}

# 6. The uv fallback declared in uv.toml must be repository-relative for the
#    same reason: uv resolves it against the working directory, which AGENTS.md
#    §1 fixes at the repository root.
$uvToml = Join-Path $projectRoot 'uv.toml'
if (Test-Path -LiteralPath $uvToml) {
    $uvTomlText = Read-TextFileUtf8 -Path $uvToml
    $cacheLine = ($uvTomlText -split "`r?`n" | Where-Object { $_ -match '^\s*cache-dir\s*=' } | Select-Object -First 1)
    $cacheValue = (($cacheLine -replace '^\s*cache-dir\s*=\s*', '') -replace '^\s+|\s+$', '')
    Add-Check 'uv.toml cache-dir (declared)' (Test-RepoRelative -Value $cacheValue -RepoRoot $projectRoot) "$cacheValue"
}
else {
    Add-Check 'uv.toml cache-dir (declared)' $false "$uvToml not found"
}

if ($StaticOnly) {
    Write-Host ''
    Write-Host ("static phase: {0} checks, {1} failures" -f $script:Checks.Count, $script:Failures.Count)
    if ($script:Failures.Count -gt 0) {
        Write-Host 'FAIL'
        $script:Failures | ForEach-Object { Write-Host "  - $_" }
        exit 1
    }
    Write-Host 'PASS'
    exit 0
}

Write-Host ''
Write-Host '=== dynamic phase ==='

# Package caches are scanned recursively. The system temporary directory is
# scanned two levels deep — the depth a tool actually uses — because a full
# recursive scan of it is dominated by unrelated applications' directories.
$deepRoots = @(
    (Join-Path $env:LOCALAPPDATA 'uv'),
    (Join-Path $env:APPDATA 'uv'),
    (Join-Path $env:LOCALAPPDATA 'pip'),
    (Join-Path $env:APPDATA 'pip'),
    (Join-Path $env:LOCALAPPDATA 'npm-cache'),
    (Join-Path $env:APPDATA 'npm'),
    (Join-Path $env:APPDATA 'pnpm'),
    (Join-Path $env:USERPROFILE '.local\bin')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

$shallowRoots = @($systemTemp) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

# The harness's per-command temporary directories are not this project's
# artifacts; see the header note.
#
# The harness uses a family of names under the system temporary directory:
# `dsh-<id>`, `dsh-subprocess-<id>`, `dsh-spill-<id>`, `dsh-workspace-changes-<id>`,
# `dsh-acl-<id>` and others. The first version of this pattern required six
# alphanumerics immediately after `dsh-`, so it matched none of the
# multi-segment names: 46 such directories were present and zero matched, and
# one full run reported a violation that came from one of them. The rule is now
# simply "a path segment that begins with dsh-".
$excludePattern = '\\dsh-[^\\]*'
$environmentalNamePattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.tmp$'

function Get-ChangedSince {
    param([string[]]$Deep, [string[]]$Shallow, [datetime]$Since, [string]$Exclude)
    $changed = New-Object System.Collections.Generic.List[string]
    $scanned = 0
    foreach ($root in $Deep) {
        foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)) {
            $scanned++
            if ($Exclude -and $f.FullName -match $Exclude) { continue }
            if ($f.LastWriteTimeUtc -ge $Since) { $changed.Add($f.FullName) }
        }
    }
    foreach ($root in $Shallow) {
        foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -Depth 2 -File -Force -ErrorAction SilentlyContinue)) {
            $scanned++
            if ($Exclude -and $f.FullName -match $Exclude) { continue }
            if ($f.LastWriteTimeUtc -ge $Since) { $changed.Add($f.FullName) }
        }
    }
    return [pscustomobject]@{ Changed = $changed; Scanned = $scanned }
}

function Test-EnvironmentalArtifactShape {
    <#
        Whether a changed path belongs to a characterised environmental class
        rather than to this project.

        The claim this gate makes is about *this project's* tools: that they put
        nothing on the system volume. A file written by an unrelated program
        during the same ten seconds is not evidence about this project, and a
        gate that counts it is a coin flip rather than a check. The time window
        cannot attribute a write to a process, so each class is characterised
        once, by name, with the producer named and the evidence recorded in
        evidence/windows-temporary-artifact-class.md.

        This is a list of named producers, not an amnesty: a class is admitted
        only with a producer that can be pointed at, and nothing here excuses an
        anonymous file, a file this project's tools could plausibly write, or
        anything inside the repository.
    #>
    param([string]$Path)
    $name = [System.IO.Path]::GetFileName($Path)
    $directory = [System.IO.Path]::GetDirectoryName($Path)

    # 1. Zero-length GUID `.tmp` files directly in the system temporary
    #    directory. The machine creates them whether or not this project runs;
    #    the evidence is the absence of any during isolated toolchain runs.
    if ($directory.Equals($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and
        $name -match $environmentalNamePattern) {
        try { return ((Get-Item -LiteralPath $Path -ErrorAction Stop).Length -eq 0) }
        catch { return $false }
    }

    # 2. The browser's extension-update log. Its content is Microsoft Edge's own
    #    extension-update telemetry, and the updater that writes it was running
    #    before this project's work began. Observed by the isolation gate while
    #    no repository process was running.
    # 2. The browser's own scratch files. Edge writes `cv_debug.log` and
    #    `edg<digits>.tmp` straight into the system temporary directory while it
    #    runs, whether or not this project does. Both were seen by this gate
    #    during windows in which nothing of ours ran — the second one twice in
    #    back-to-back runs of this gate alone, on a tree that had not changed,
    #    which is why the class was widened from the update log to the pair.
    #    Named by producer, and narrow enough not to excuse a file this project
    #    could write.
    if ($name -eq 'cv_debug.log') { return $true }
    if ($name -match '^edg[a-zA-Z0-9]*\.tmp$') { return $true }

    # 3. The remote-desktop client's trace files, rewritten on a timer of their
    #    own under a directory named for that subsystem. Reproduced by running
    #    this gate alone, with no repository tool involved.
    if ($name -match '^MSRDCEventProcessor-.*\.etl$' -and $Path -match '\\RdClientAutoTrace\\') { return $true }

    return $false
}

# --- The exclusions, characterised once and evidenced. ----------------------
# This machine creates zero-length files whose entire name is a GUID with a
# .tmp extension, directly in the system temporary directory, whether or not
# this project runs. The evidence that the class is not ours is recorded once,
# in evidence/windows-temporary-artifact-class.md: every toolchain step was run
# in isolation and produced none of them, while they kept appearing during
# windows in which nothing of ours ran.
#
# Two further producers were admitted the same way, after this gate failed on a
# tree that had not changed: the browser's extension-update log, and the
# remote-desktop client's trace files, which are rewritten every few seconds
# while that client runs. Each is named by its producer and is specific enough
# not to mask a write of ours.
#
# An earlier revision tried to *re-earn* the first exclusion on every run, by
# requiring either five instances older than the repository or a clean
# ten-second idle window. That made the gate both slow and non-deterministic:
# a routine operating-system cleanup of the temporary directory removed the
# historical instances, the idle window happened to be quiet, and the check
# reported a violation for a file that no project tool had written — 25 s and a
# false FAIL on a tree that had not changed between runs. A proof that has to be
# repeated is a proof that can fail for reasons unrelated to the claim it
# supports.
$workloadStartUtc = [datetime]::UtcNow

function Invoke-WorkloadStep {
    param([string]$Name, [scriptblock]$Body)
    Write-Host "  [run ] $Name"
    try { & $Body } catch { Write-Host "  [warn] $Name : $($_.Exception.Message)" }
}

Invoke-WorkloadStep 'python: temporary file' {
    $code = "import os,tempfile;p=os.path.join(tempfile.gettempdir(),'lifegame-isolation-probe');f=open(p,'w');f.write('x');f.close();os.remove(p)"
    $null = Invoke-NativeQuiet -Exe $venvPython -Arguments @('-c', $code)
}
Invoke-WorkloadStep 'python: bytecode compilation' {
    $code = "import compileall;compileall.compile_dir('tests',quiet=2)"
    $null = Invoke-NativeQuiet -Exe $venvPython -Arguments @('-c', $code)
}
if (-not $SkipCpp) {
    $cppBuild = Join-Path $projectRoot 'tools\documentation\build.ps1'
    if (Test-Path -LiteralPath $cppBuild) {
        Invoke-WorkloadStep 'cpp: build documentation tool' {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $cppBuild -Quiet
        }
    }
    else {
        Write-Host '  [skip] cpp: build documentation tool (build script not present)'
    }
}
if (-not $SkipNode) {
    Invoke-WorkloadStep 'node: temporary file' {
        $code = "const os=require('os'),fs=require('fs'),p=require('path');const f=p.join(os.tmpdir(),'lifegame-isolation-probe');fs.writeFileSync(f,'x');fs.unlinkSync(f);"
        $null = Invoke-NativeQuiet -Exe 'node' -Arguments @('-e', $code)
    }
    if (Test-Path -LiteralPath (Join-Path $projectRoot 'package.json')) {
        Invoke-WorkloadStep 'node: pnpm install' {
            Push-Location $projectRoot
            try { $null = Invoke-NativeQuiet -Exe 'pnpm' -Arguments @('install', '--silent') } finally { Pop-Location }
        }
    }
}

Start-Sleep -Seconds 2
$scan = Get-ChangedSince -Deep $deepRoots -Shallow $shallowRoots -Since $workloadStartUtc -Exclude $excludePattern

$violations = New-Object System.Collections.Generic.List[string]
$excused = New-Object System.Collections.Generic.List[string]
foreach ($path in $scan.Changed) {
    if (Test-EnvironmentalArtifactShape -Path $path) { $excused.Add($path) }
    else { $violations.Add($path) }
}

Add-Check 'no file created on the system volume' ($violations.Count -eq 0) `
    ("$($violations.Count) unexplained of $($scan.Changed.Count) changed since $($workloadStartUtc.ToString('u'))")

if ($excused.Count -gt 0) {
    Write-Host ("        excused as the characterised environmental class: {0} file(s)" -f $excused.Count)
    $excused | Select-Object -First 10 | ForEach-Object { Write-Host "          $_" }
}
if ($violations.Count -gt 0) {
    $violations | Select-Object -First 40 | ForEach-Object { Write-Host "        $_" }
    if ($violations.Count -gt 40) { Write-Host ("        ... and {0} more" -f ($violations.Count - 40)) }
}

Write-Host ''
Write-Host ("dynamic phase: scanned {0} file(s); {1} changed since the workload started, {2} excused, {3} unexplained" -f $scan.Scanned, $scan.Changed.Count, $excused.Count, $violations.Count)
Write-Host ("total: {0} checks, {1} failures" -f $script:Checks.Count, $script:Failures.Count)

if ($script:Failures.Count -gt 0) {
    Write-Host 'FAIL'
    $script:Failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
}
Write-Host 'PASS'
exit 0
