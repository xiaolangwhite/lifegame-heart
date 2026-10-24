#Requires -Version 5.1
<#
    docguard — idempotent Release build.

    Configures tools/documentation/build on first use (or when the cache is stale) and
    then builds the executable with CMake + GCC from <toolchain>.
    The script sources scripts/env.ps1 so that no temporary file or cache entry can
    land outside the repository tree.

    Usage:
        powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/build.ps1
        ... -Configuration Debug
        ... -Clean          # remove the build directory first
        ... -Quiet          # progress narration only, no tool output
#>
[CmdletBinding()]
param(
    [ValidateSet('Release', 'Debug', 'RelWithDebInfo')]
    [string] $Configuration = 'Release',
    [switch] $Clean,
    [switch] $Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolRoot = $PSScriptRoot
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $toolRoot '..\..')).ProviderPath

$envScript = Join-Path $repoRoot 'scripts\env.ps1'
if (Test-Path -LiteralPath $envScript) {
    . $envScript
}

$cmake = 'cmake'
$toolchainBin = '<toolchain>\bin'
$gxx = Join-Path $toolchainBin 'g++.exe'
$ninja = Join-Path $toolchainBin 'ninja.exe'
$mingwMake = Join-Path $toolchainBin 'mingw32-make.exe'

foreach ($required in @($cmake, $gxx)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing required tool: $required"
    }
}

$buildDir = Join-Path $toolRoot 'build'
$exePath = Join-Path $buildDir 'docguard.exe'

if ($Clean -and (Test-Path -LiteralPath $buildDir)) {
    Remove-Item -LiteralPath $buildDir -Recurse -Force
}

# Freshness check. `cmake --build` costs about 4.3 s on this machine even when
# there is provably nothing to do, because the build driver re-checks the cache
# and regenerates before deciding. Skipping it when every input is older than
# the artifact is what "idempotent build" has to mean for the gate to be usable
# in an edit loop; callers that genuinely want a rebuild pass -Clean.
if (-not $Clean -and (Test-Path -LiteralPath $exePath)) {
    $inputs = @()
    $inputs += Get-ChildItem -LiteralPath (Join-Path $toolRoot 'src') -Recurse -File -ErrorAction SilentlyContinue
    $inputs += Get-Item -LiteralPath (Join-Path $toolRoot 'CMakeLists.txt') -ErrorAction SilentlyContinue
    $newestInput = ($inputs | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
    if ($null -ne $newestInput -and (Get-Item -LiteralPath $exePath).LastWriteTimeUtc -ge $newestInput) {
        if (-not $Quiet) {
            Write-Host "[docguard] up to date, nothing to build"
            Write-Host "[docguard] artifact : $exePath"
        }
        exit 0
    }
}

# The w64devkit bin directory must be visible to the generator and the compiler.
$env:PATH = "$toolchainBin;$env:PATH"

$generator = @()
if (Test-Path -LiteralPath $ninja) {
    $generator = @('-G', 'Ninja', "-DCMAKE_MAKE_PROGRAM=$ninja")
} else {
    $generator = @('-G', 'MinGW Makefiles', "-DCMAKE_MAKE_PROGRAM=$mingwMake")
}

function Invoke-Native {
    param([string] $FilePath, [string[]] $Arguments)
    # Native tools write progress and warnings to stderr; that must not become a
    # terminating PowerShell error, so the preference is relaxed around the call and
    # the exit code is checked explicitly instead.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($Quiet) {
            & $FilePath @Arguments 2>&1 | Out-Null
        } else {
            & $FilePath @Arguments
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) {
        throw "command failed with exit code $code : $FilePath $($Arguments -join ' ')"
    }
}

$cacheFile = Join-Path $buildDir 'CMakeCache.txt'
if (-not (Test-Path -LiteralPath $cacheFile)) {
    if (-not $Quiet) { Write-Host "[docguard] configuring ($Configuration) -> $buildDir" }
    Invoke-Native $cmake (@(
        '-S', $toolRoot,
        '-B', $buildDir
    ) + $generator + @(
        "-DCMAKE_BUILD_TYPE=$Configuration",
        "-DCMAKE_CXX_COMPILER=$gxx"
    ))
}

if (-not $Quiet) { Write-Host "[docguard] building ($Configuration)" }
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-Native $cmake @('--build', $buildDir, '--config', $Configuration)
$stopwatch.Stop()

if (-not (Test-Path -LiteralPath $exePath)) {
    throw "Build finished but $exePath does not exist."
}

$compilerVersion = (& $gxx --version | Select-Object -First 1)
if (-not $Quiet) {
    Write-Host "[docguard] compiler : $compilerVersion"
    Write-Host ("[docguard] elapsed  : {0:N2} s" -f $stopwatch.Elapsed.TotalSeconds)
    Write-Host "[docguard] artifact : $exePath"
}
