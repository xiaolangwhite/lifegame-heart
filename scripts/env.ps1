#Requires -Version 5.1
<#
    lifegame — project-scoped environment.

    Purpose
    -------
    Every temporary file, package cache and bytecode cache this project
    produces must land inside the project tree. The requirement is absolute:
    nothing may be written to C:. DSH hands each command a fresh C:-drive TEMP
    directory, so this script must be sourced *after* the shell starts and
    *before* any toolchain command runs.

    Usage
    -----
        powershell -NoProfile -ExecutionPolicy Bypass
        . .\scripts\env.ps1          # dot-source: it must affect the caller

    The process-scope execution policy is required because the machine policy
    is RemoteSigned and these scripts are unsigned. Per-session scope avoids
    changing any machine or user setting.

    Authority
    ---------
    docs/plan/phase-01-foundation/acceptance.md — criterion A3.
    docs/model/environment/interfaces.md — the contract this script publishes.

    Contract
    --------
    * The guard runs first: nothing is created and no variable is set until
      every location has been proven to be inside the repository. A checkout
      hosted on the system volume therefore fails without side effects.
    * It only sets environment variables and creates directories.
    * It deliberately does NOT touch $ErrorActionPreference or Set-StrictMode:
      the script is dot-sourced into a shared session and must not mutate the
      caller's error or strict-mode behaviour.
    * It is idempotent and never deletes anything.
#>

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath

# Every variable that decides where a toolchain writes transient data.
$directoryVars = [ordered]@{
    'LIFEGAME_ROOT'         = $projectRoot
    'TEMP'                  = Join-Path $projectRoot 'TEMP'
    'TMP'                   = Join-Path $projectRoot 'TEMP'
    'TMPDIR'                = Join-Path $projectRoot 'TEMP'
    'UV_CACHE_DIR'          = Join-Path $projectRoot '.cache\uv'
    'UV_PYTHON_INSTALL_DIR' = Join-Path $projectRoot '.cache\uv-python'
    'PIP_CACHE_DIR'         = Join-Path $projectRoot '.cache\pip'
    'PYTHONPYCACHEPREFIX'   = Join-Path $projectRoot '.cache\pycache'
    'npm_config_cache'      = Join-Path $projectRoot '.cache\npm'
}

# pip must not read %APPDATA%\pip\pip.ini from C:; PIP_CONFIG_FILE overrides
# every other location, so the project config becomes the only one that applies.
$pipConfig = Join-Path $projectRoot 'scripts\pip.ini'

# --- Guard. This must stay the first thing that can fail. -------------------
# The list must stay in step with the checks in
# scripts/verify-temp-isolation.ps1 and with the Python-side contract test
# tests/environment/test_isolation_contract.py.
$desired = @{}
foreach ($name in $directoryVars.Keys) { $desired[$name] = $directoryVars[$name] }
$desired['PIP_CONFIG_FILE'] = $pipConfig

foreach ($name in $desired.Keys) {
    $value = $desired[$name]
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Environment variable $name resolved to an empty value; refusing to continue."
    }
    if ($value -match '^[Cc]:') {
        throw "Environment variable $name points at C: ($value); refusing to continue."
    }
    if (-not (Test-Path -LiteralPath $pipConfig) -and $name -eq 'PIP_CONFIG_FILE') {
        throw "Missing pip configuration: $pipConfig"
    }
}

# --- Apply. Only reached once every location is proven to be in-repo. -------
foreach ($name in $directoryVars.Keys) {
    $value = $directoryVars[$name]
    if (-not (Test-Path -LiteralPath $value)) {
        New-Item -ItemType Directory -Force -Path $value | Out-Null
    }
    Set-Item -Path "Env:$name" -Value $value
}
Set-Item -Path 'Env:PIP_CONFIG_FILE' -Value $pipConfig
