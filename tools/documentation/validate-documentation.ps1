#Requires -Version 5.1
<#
    docguard — documentation gate entry point.

    Builds the validator when the executable is missing, then runs it against the
    repository root and forwards its exit code (0 clean, 1 violations, 2 usage/IO).

    Usage:
        powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/validate-documentation.ps1
        ... -Format json
        ... -Strict
        ... -Root tools/documentation/tests/fixtures/clean
        ... -SkipBuild
#>
[CmdletBinding()]
param(
    [string] $Root,
    [ValidateSet('text', 'json')]
    [string] $Format = 'text',
    [switch] $Strict,
    [switch] $Quiet,
    [switch] $SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolRoot = $PSScriptRoot
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $toolRoot '..\..')).ProviderPath

$envScript = Join-Path $repoRoot 'scripts\env.ps1'
if (Test-Path -LiteralPath $envScript) {
    . $envScript
}

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = $repoRoot
} elseif (-not [System.IO.Path]::IsPathRooted($Root)) {
    $Root = Join-Path $repoRoot $Root
}

$exePath = Join-Path $toolRoot 'build\docguard.exe'
if (-not $SkipBuild -and -not (Test-Path -LiteralPath $exePath)) {
    Write-Host '[docguard] executable missing, building first'
    & (Join-Path $toolRoot 'build.ps1')
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[docguard] build failed with exit code $LASTEXITCODE"
        exit 2
    }
}

if (-not (Test-Path -LiteralPath $exePath)) {
    Write-Error "[docguard] executable not found: $exePath"
    exit 2
}

$arguments = @('--root', $Root, '--format', $Format)
if ($Strict) { $arguments += '--strict' }
if ($Quiet) { $arguments += '--quiet' }

# docguard writes its summary to stderr; a native command's stderr must not be turned
# into a terminating PowerShell error, otherwise a clean tree would fail the gate.
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & $exePath @arguments
    $exitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previous
}
exit $exitCode
