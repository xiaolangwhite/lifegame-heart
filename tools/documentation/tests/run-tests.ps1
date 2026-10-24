#Requires -Version 5.1
<#
    docguard — fixture test runner.

    Runs every fixture tree under tests/fixtures and asserts the exit code plus
    the exact set of check codes in the JSON report. Additional cases cover
    determinism, --strict promotion and the usage/IO exit codes.

    Usage:
        powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/run-tests.ps1
        ... -SkipBuild

    Why the executable is called directly instead of through Start-Process
    ---------------------------------------------------------------------
    Start-Process with redirected stdio costs about one second per launch on
    this machine, while `docguard` itself finishes in about 60 ms. With 27
    launches that plumbing was 28 s of a 28.3 s suite — roughly 98% of the run
    time, spent on process objects and scratch files that no assertion reads.
    A direct call returns the exit code through $LASTEXITCODE and the report
    through the output stream, so the suite needs neither.
#>
[CmdletBinding()]
param(
    [switch] $SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $toolRoot '..\..')).ProviderPath

$envScript = Join-Path $repoRoot 'scripts\env.ps1'
if (Test-Path -LiteralPath $envScript) {
    . $envScript
}

$exePath = Join-Path $toolRoot 'build\docguard.exe'
if (-not $SkipBuild -and -not (Test-Path -LiteralPath $exePath)) {
    Write-Host '[docguard-tests] building the validator first'
    & (Join-Path $toolRoot 'build.ps1')
}

if (-not (Test-Path -LiteralPath $exePath)) {
    Write-Error "[docguard-tests] executable not found: $exePath"
    exit 2
}

$fixturesRoot = Join-Path $toolRoot 'tests\fixtures'
if (-not (Test-Path -LiteralPath $fixturesRoot)) {
    Write-Error "[docguard-tests] fixtures are missing; run make-fixtures.ps1 first"
    exit 2
}

$script:passed = 0
$script:failed = 0
$script:failures = New-Object System.Collections.Generic.List[string]

function Get-TextSha256 {
    param([string] $Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally { $sha.Dispose() }
}

function Invoke-Docguard {
    <#
        Runs the validator and returns its exit code plus its stdout. docguard
        writes its summary line to stderr, and a native stderr line becomes a
        terminating error under $ErrorActionPreference = 'Stop', so the
        preference is relaxed around the call.
    #>
    param([string] $Root, [string[]] $Extra = @())
    $cliArguments = @('--root', $Root, '--format', 'json') + $Extra
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = ((& $exePath @cliArguments 2>$null) -join "`n")
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ ExitCode = $code; Raw = $raw }
}

function Assert-Equal {
    param([string] $Case, [string] $What, [string] $Expected, [string] $Actual)
    if ($Expected -eq $Actual) {
        $script:passed++
        Write-Host ("  PASS  {0,-22} {1} = {2}" -f $Case, $What, $Actual)
        return
    }
    $script:failed++
    $message = "{0}: {1} expected [{2}] but got [{3}]" -f $Case, $What, $Expected, $Actual
    $script:failures.Add($message)
    Write-Host ("  FAIL  {0,-22} {1} expected [{2}] got [{3}]" -f $Case, $What, $Expected, $Actual)
}

$cases = @(
    @{ Name = 'clean';                  Exit = 0; Codes = @() },
    @{ Name = 'lone-cr';                Exit = 0; Codes = @() },
    @{ Name = 'layout-missing';         Exit = 1; Codes = @('DOC_LAYOUT_MISSING') },
    @{ Name = 'path-not-english';       Exit = 1; Codes = @('DOC_PATH_NOT_ENGLISH') },
    @{ Name = 'crlf';                   Exit = 1; Codes = @('DOC_CRLF') },
    @{ Name = 'bom';                    Exit = 1; Codes = @('DOC_BOM') },
    @{ Name = 'md-link-broken';         Exit = 1; Codes = @('DOC_MD_LINK_BROKEN') },
    @{ Name = 'status-vocab';           Exit = 1; Codes = @('DOC_STATUS_VOCAB') },
    @{ Name = 'placeholder';            Exit = 1; Codes = @('DOC_PLACEHOLDER') },
    @{ Name = 'version-syntax';         Exit = 1; Codes = @('DOC_VERSION_SYNTAX') },
    @{ Name = 'version-authority-leak'; Exit = 1; Codes = @('DOC_VERSION_AUTHORITY_LEAK') },
    @{ Name = 'adr-naming';             Exit = 1; Codes = @('DOC_ADR_NAMING') },
    @{ Name = 'adr-sections';           Exit = 1; Codes = @('DOC_ADR_SECTIONS') },
    @{ Name = 'module-contract';        Exit = 1; Codes = @('DOC_MODULE_CONTRACT') },
    @{ Name = 'module-catalog';         Exit = 1; Codes = @('DOC_MODULE_CATALOG') },
    @{ Name = 'lf-only-declared';       Exit = 1; Codes = @('DOC_LF_ONLY_DECLARED') },
    @{ Name = 'absolute-path-in-docs';  Exit = 1; Codes = @('DOC_ABSOLUTE_PATH_IN_DOCS') }
)

Write-Host '[docguard-tests] fixture cases'
foreach ($case in $cases) {
    $run = Invoke-Docguard -Root (Join-Path $fixturesRoot $case.Name)
    $report = $run.Raw | ConvertFrom-Json
    $codes = @($report.violations | ForEach-Object { $_.code } | Sort-Object -Unique)
    $codeText = if ($codes.Count -eq 0) { '<none>' } else { ($codes -join ',') }
    $expectedCodeText = if ($case.Codes.Count -eq 0) { '<none>' } else { ($case.Codes -join ',') }
    Assert-Equal -Case $case.Name -What 'exit' -Expected ([string]$case.Exit) -Actual ([string]$run.ExitCode)
    Assert-Equal -Case $case.Name -What 'codes' -Expected $expectedCodeText -Actual $codeText
    $severityCodes = @($report.violations | Where-Object { $_.severity -ne 'ERROR' -and $_.severity -ne 'WARN' })
    Assert-Equal -Case $case.Name -What 'severity-domain' -Expected '0' -Actual ([string]$severityCodes.Count)
}

Write-Host '[docguard-tests] determinism (two runs, byte comparison of the reported text)'
foreach ($name in @('clean', 'md-link-broken', 'version-syntax')) {
    $root = Join-Path $fixturesRoot $name
    $first = Invoke-Docguard -Root $root
    $second = Invoke-Docguard -Root $root
    $hashOne = Get-TextSha256 -Text $first.Raw
    $hashTwo = Get-TextSha256 -Text $second.Raw
    Assert-Equal -Case $name -What 'sha256-stable' -Expected 'identical' -Actual $(if ($hashOne -eq $hashTwo) { 'identical' } else { "$hashOne vs $hashTwo" })
}

Write-Host '[docguard-tests] --strict promotes warnings to errors'
$strictRun = Invoke-Docguard -Root (Join-Path $fixturesRoot 'lf-only-declared') -Extra @('--strict')
$strictReport = $strictRun.Raw | ConvertFrom-Json
Assert-Equal -Case 'strict' -What 'exit' -Expected '1' -Actual ([string]$strictRun.ExitCode)
Assert-Equal -Case 'strict' -What 'error-count' -Expected '1' -Actual ([string]$strictReport.counts.error)
Assert-Equal -Case 'strict' -What 'warn-count' -Expected '0' -Actual ([string]$strictReport.counts.warn)
Assert-Equal -Case 'strict' -What 'severity' -Expected 'ERROR' -Actual ([string]$strictReport.violations[0].severity)

Write-Host '[docguard-tests] usage and IO exit codes'
$unknown = Invoke-Docguard -Root $fixturesRoot -Extra @('--not-an-option')
Assert-Equal -Case 'usage' -What 'unknown-option' -Expected '2' -Actual ([string]$unknown.ExitCode)
$noFormat = Invoke-Docguard -Root $fixturesRoot -Extra @('--format', 'xml')
Assert-Equal -Case 'usage' -What 'bad-format' -Expected '2' -Actual ([string]$noFormat.ExitCode)
$badRoot = Invoke-Docguard -Root (Join-Path $fixturesRoot 'no-such-tree')
Assert-Equal -Case 'io' -What 'missing-root' -Expected '2' -Actual ([string]$badRoot.ExitCode)

Write-Host ''
if ($script:failed -eq 0) {
    Write-Host "[docguard-tests] ALL PASSED ($($script:passed) assertion(s))"
    exit 0
}
Write-Host "[docguard-tests] FAILED ($($script:failed) of $($script:passed + $script:failed) assertion(s))"
foreach ($message in $script:failures) {
    Write-Host "  - $message"
}
exit 1
