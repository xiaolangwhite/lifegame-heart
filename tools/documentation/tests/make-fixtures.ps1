#Requires -Version 5.1
<#
    Generates the docguard fixture trees under tests/fixtures.

    Every case is a complete, layout-valid repository skeleton plus exactly one defect,
    so each negative case produces exactly one check code. `clean` produces no code at
    all. Running this script again rebuilds the fixtures from scratch (idempotent).

    The script stays ASCII-only on purpose: PowerShell 5.1 would misread non-ASCII
    literals in a BOM-less script file, so the CJK path is built from code points.
    Literal line feeds are always spelled "`n"; here-strings are avoided so that a
    fixture can never inherit CRLF from the script's own encoding.

    Usage:
        powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/make-fixtures.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$testsRoot = $PSScriptRoot
$fixturesRoot = Join-Path $testsRoot 'fixtures'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$lf = "`n"

function Write-TextFile {
    param([string] $Path, [string] $Text)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Write-BytesFile {
    param([string] $Path, [byte[]] $Bytes)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    [System.IO.File]::WriteAllBytes($Path, $Bytes)
}

# A minimal repository that satisfies every check: required layout, LF, no BOM, no
# links, no status declarations, no placeholder markers, a valid version table, a
# readme-only ADR tree and an empty module catalog.
function New-Skeleton {
    param([string] $Root)
    if (Test-Path -LiteralPath $Root) {
        Remove-Item -LiteralPath $Root -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $Root | Out-Null

    Write-TextFile (Join-Path $Root 'AGENTS.md') ('# AGENTS' + $lf)
    Write-TextFile (Join-Path $Root 'ENGINE_STANDARD.md') ('# ENGINE STANDARD' + $lf)
    Write-TextFile (Join-Path $Root 'README.md') ('# Project' + $lf)
    Write-TextFile (Join-Path $Root 'docs\README.md') ('# Documentation' + $lf)
    Write-TextFile (Join-Path $Root 'docs\DOCUMENTATION_RULES.md') ('# Documentation Rules' + $lf)
    Write-TextFile (Join-Path $Root 'docs\AI_DOCUMENTATION_GUIDE.md') ('# AI Documentation Guide' + $lf)
    Write-TextFile (Join-Path $Root 'docs\MODULE_COMPONENT_GUIDE.md') ('# Module Component Guide' + $lf)
    Write-TextFile (Join-Path $Root 'docs\plan\ROADMAP.md') ('# Roadmap' + $lf)
    Write-TextFile (Join-Path $Root 'docs\plan\PERFORMANCE_ACCEPTANCE.md') ('# Performance Acceptance' + $lf)
    Write-TextFile (Join-Path $Root 'docs\adr\README.md') ('# ADR index' + $lf)
    Write-TextFile (Join-Path $Root 'docs\model\module-catalog.json') ('{"modules":[]}' + $lf)
    $versions = '# VERSIONS' + $lf + $lf +
                '| Version | State |' + $lf +
                '|---|---|' + $lf +
                '| v0.1.0 | Implemented |' + $lf
    Write-TextFile (Join-Path $Root 'docs\plan\VERSIONS.md') $versions
    Write-TextFile (Join-Path $Root 'dev-log\.gitkeep') ''
    Write-TextFile (Join-Path $Root 'evidence\.gitkeep') ''
}

function New-AdrBody {
    param([string] $Number, [string] $Title)
    return '# ADR ' + $Number + ': ' + $Title + $lf + $lf +
           '## Status' + $lf + $lf + 'Implemented.' + $lf + $lf +
           '## Context' + $lf + $lf + 'Fixture context.' + $lf + $lf +
           '## Decision' + $lf + $lf + 'Fixture decision.' + $lf + $lf +
           '## Consequences' + $lf + $lf + 'Fixture consequences.' + $lf
}

$cases = @(
    'clean',
    'lone-cr',
    'layout-missing',
    'path-not-english',
    'crlf',
    'bom',
    'md-link-broken',
    'status-vocab',
    'placeholder',
    'version-syntax',
    'version-authority-leak',
    'adr-naming',
    'adr-sections',
    'module-contract',
    'module-catalog',
    'lf-only-declared',
    'absolute-path-in-docs'
)

if (-not (Test-Path -LiteralPath $fixturesRoot)) {
    New-Item -ItemType Directory -Force -Path $fixturesRoot | Out-Null
}

foreach ($case in $cases) {
    $root = Join-Path $fixturesRoot $case
    New-Skeleton -Root $root

    switch ($case) {
        'clean' {
            # Nothing to add: the skeleton must pass every check.
        }
        'lone-cr' {
            # A CR byte that is not the CR of a CRLF pair is not a line-ending defect.
            Write-TextFile (Join-Path $root 'docs\EXTRA.md') ("# Extra`rcontinued" + $lf)
        }
        'layout-missing' {
            Remove-Item -LiteralPath (Join-Path $root 'docs\plan\ROADMAP.md') -Force
        }
        'path-not-english' {
            $cjk = [string][char]0x4E2D + [string][char]0x6587
            Write-TextFile (Join-Path $root ('docs\' + $cjk + '\note.md')) ('# Note' + $lf)
        }
        'crlf' {
            Write-TextFile (Join-Path $root 'docs\EXTRA.md') ("# Extra`r`n`r`nCRLF body.`r`n")
        }
        'bom' {
            $body = '# Extra' + $lf + $lf + 'Body.' + $lf
            $prefix = [byte[]](0xEF, 0xBB, 0xBF)
            $payload = [System.Text.Encoding]::UTF8.GetBytes($body)
            Write-BytesFile (Join-Path $root 'docs\EXTRA.md') ($prefix + $payload)
        }
        'md-link-broken' {
            Write-TextFile (Join-Path $root 'README.md') ('# Project' + $lf + $lf + 'See [the plan](docs/does-not-exist.md).' + $lf)
        }
        'status-vocab' {
            Write-TextFile (Join-Path $root 'docs\EXTRA.md') ('# Extra' + $lf + $lf + '**Status:** Done' + $lf)
        }
        'placeholder' {
            $marker = 'TO' + 'DO'
            Write-TextFile (Join-Path $root 'docs\EXTRA.md') ('# Extra' + $lf + $lf + 'Fix this: ' + $marker + $lf)
        }
        'version-syntax' {
            $body = '# VERSIONS' + $lf + $lf +
                    '| Version | State |' + $lf +
                    '|---|---|' + $lf +
                    '| v0.1.0 | Implemented |' + $lf +
                    '| v10.1.0 | Planned |' + $lf +
                    '| v0.1.2.3fix4 | Planned |' + $lf
            Write-TextFile (Join-Path $root 'docs\plan\VERSIONS.md') $body
        }
        'version-authority-leak' {
            Write-TextFile (Join-Path $root 'docs\plan\ROADMAP.md') ('# Roadmap' + $lf + $lf + 'Current version is the one in the table.' + $lf)
        }
        'adr-naming' {
            Write-TextFile (Join-Path $root 'docs\adr\governance-and-build\01-Bad_Name.md') (New-AdrBody -Number '0001' -Title 'Bad name')
            Write-TextFile (Join-Path $root 'docs\adr\governance-and-build\0007-alpha.md') (New-AdrBody -Number '0007' -Title 'Alpha')
            Write-TextFile (Join-Path $root 'docs\adr\simulation-core\0007-beta.md') (New-AdrBody -Number '0007' -Title 'Beta')
        }
        'adr-sections' {
            $body = '# ADR 0001: Missing sections' + $lf + $lf +
                    '## Status' + $lf + $lf + 'Implemented.' + $lf + $lf +
                    '## Decision' + $lf + $lf + 'Fixture decision.' + $lf
            Write-TextFile (Join-Path $root 'docs\adr\simulation-core\0001-missing-sections.md') $body
        }
        'module-contract' {
            Write-TextFile (Join-Path $root 'docs\model\alpha\overview.md') ('# Alpha overview' + $lf)
            Write-TextFile (Join-Path $root 'docs\model\module-catalog.json') ('{"modules":[{"name":"alpha","owner":"docs","language":"docs"}]}' + $lf)
        }
        'module-catalog' {
            $moduleFiles = @('overview.md', 'responsibilities.md', 'interfaces.md', 'data-flow.md',
                             'implementation.md', 'performance.md', 'testing.md', 'risks.md')
            foreach ($file in $moduleFiles) {
                Write-TextFile (Join-Path $root ('docs\model\orphan\' + $file)) ('# Orphan ' + $file + $lf)
            }
            $catalog = '{"modules":[{"name":"ghost","owner":"docs","language":"docs"},{"name":"Bad_Name","owner":"docs","language":"docs"}]}' + $lf
            Write-TextFile (Join-Path $root 'docs\model\module-catalog.json') $catalog
        }
        'lf-only-declared' {
            Write-TextFile (Join-Path $root 'docs\plan\VERSIONS.md') ('# VERSIONS' + $lf + $lf + 'No table is declared in this fixture.' + $lf)
        }
        'absolute-path-in-docs' {
            $absolute = 'C:' + '\Temp\fixture.txt'
            Write-TextFile (Join-Path $root 'docs\EXTRA.md') ('# Extra' + $lf + $lf + 'Artifacts live in ' + $absolute + '.' + $lf)
        }
        default {
            throw "unhandled fixture case: $case"
        }
    }
}

$count = (Get-ChildItem -LiteralPath $fixturesRoot -Directory).Count
Write-Host "[fixtures] generated $count case(s) under $fixturesRoot"
