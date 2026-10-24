#Requires -Version 5.1
<#
    browser-probe - one snapshot of every process on the machine, as JSON.

    Why a helper rather than a pipe
    -------------------------------
    This tool must work under a harness that forbids a child process from
    opening a named pipe; under that policy `child_process` with the default
    piped stdio fails with EPERM. So the snapshot is written to a file that
    `procs.mjs` reads afterwards, and nothing is ever captured through a pipe.

    Why every process, and not only the descendants
    -----------------------------------------------
    A Chromium browser may replace the process that was launched with another
    one, so the pid this tool started is not always the pid that must be
    stopped. Matching on the command line - the same technique
    `scripts/viewer.ps1` uses to recognise a world core - is what makes the
    browser attributable, and that needs the command lines, which needs the
    whole list.

    The file is written without a byte-order mark: a BOM would survive into the
    JSON text and a strict reader is entitled to reject it.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rows = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Select-Object -Property @(
            @{ Name = 'pid'; Expression = { [int]$_.ProcessId } },
            @{ Name = 'ppid'; Expression = { [int]$_.ParentProcessId } },
            @{ Name = 'name'; Expression = { [string]$_.Name } },
            @{ Name = 'commandLine'; Expression = { [string]$_.CommandLine } }
        )
)

# An empty list must serialise as `[]` rather than as nothing at all, so the
# reader never has to guess whether the scan ran.
$json = if ($rows.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $rows -Compress -Depth 3 }

$directory = Split-Path -Parent $OutPath
if ($directory -and -not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
[System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
