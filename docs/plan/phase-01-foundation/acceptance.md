# Phase 01 — acceptance criteria

> Criteria are stable; results are not written here. Each criterion names the
> command that decides it and the evidence section that records the observed
> result. Verification state is scoped
> ([../../AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §3.1).

| Id | Criterion | Deciding command | Evidence owner |
|---|---|---|---|
| A1 | The active Python interpreter is a uv-managed CPython 3.14.x whose payload resolves inside the repository, and `.venv/pyvenv.cfg` names a `home` under `.cache/uv-python/`. | `scripts/verify-temp-isolation.ps1` | `dev-log/<version>.md` |
| A2 | After bootstrap, package installation, bytecode compilation and a full build, no file belonging to this project exists on the system volume. | `scripts/verify-temp-isolation.ps1` | `dev-log/<version>.md` |
| A3 | Every environment variable that decides a transient location (`TEMP`, `TMP`, `TMPDIR`, `UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, `PIP_CACHE_DIR`, `PIP_CONFIG_FILE`, `PYTHONPYCACHEPREFIX`, `npm_config_cache`) points inside the repository after `scripts/env.ps1` is sourced, and the script refuses to continue when one of them points at `C:`. | `scripts/verify-temp-isolation.ps1` | `dev-log/<version>.md` |
| A4 | The documentation conformance gate exits `0` on the repository. | `tools/documentation/validate-documentation.ps1` | `dev-log/<version>.md` |
| A5 | The gate's own test suite passes, covering at least one clean fixture tree and at least one negative fixture per check code. | `tools/documentation/tests/run-tests.ps1` | `dev-log/<version>.md` |
| A6 | The gate produces byte-identical output when run twice over the same tree. | `tools/documentation/validate-documentation.ps1 --format json` run twice, outputs compared | `dev-log/<version>.md` |
| A7 | `scripts/bootstrap.ps1` is idempotent: a second run performs no download and leaves the environment unchanged. | `scripts/bootstrap.ps1` run twice | `dev-log/<version>.md` |
| A8 | Every documentation path, file name and heading is English; every text file is UTF-8 without BOM and uses LF line endings. | `tools/documentation/validate-documentation.ps1` | `dev-log/<version>.md` |
| A9 | The declared development dependencies resolve and are runnable, and the Python-side environment contract test passes. | `uv sync`, `uv run pytest`, `uv run ruff check` | `dev-log/<version>.md` |
| A10 | Node dependencies install with the store and cache inside the repository. | `pnpm install` | `dev-log/<version>.md` |
| A11 | A clean `git clone` of the repository provisions itself with one command, and the conformance gate passes inside the clone with a tool built from scratch there. This criterion exists because the first cold-clone run found two defects that every warm gate had missed. | `git clone . <dir>`, then `scripts/bootstrap.ps1` and `tools/documentation/validate-documentation.ps1` inside the clone | `dev-log/<version>.md` |
| A12 | One command runs every default gate and reports a single exit code, and a `-Full` mode adds the version-boundary gates. It sources the environment itself, so a shell that forgot the preamble cannot turn the suite red for an unrelated reason. | `scripts/verify.ps1` and `scripts/verify.ps1 -Full` | `dev-log/<version>.md` |
| A13 | The verification suite's own overhead is small relative to the work it verifies: no gate spends the majority of its time on process plumbing or on an unconditional rebuild. | `scripts/verify.ps1` summary table | `dev-log/v0.1.0fix1.md` |

A criterion without an executed command is `Unvalidated`. A gate that could not
run is reported as not run, never as passed.
