# AGENTS.md — operating rules for this repository

This file tells an agent (or a human) how to work **in** this repository. It is
policy, not content: it points at the authorities rather than restating them.

Read order for a new session:

1. this file;
2. [ENGINE_STANDARD.md](ENGINE_STANDARD.md) — what the project is and the
   principles that are not negotiable;
3. [docs/DOCUMENTATION_RULES.md](docs/DOCUMENTATION_RULES.md) — structure and
   coupling;
4. [docs/AI_DOCUMENTATION_GUIDE.md](docs/AI_DOCUMENTATION_GUIDE.md) — evidence,
   states, content contracts;
5. [docs/plan/VERSIONS.md](docs/plan/VERSIONS.md) — the only authority on
   version state.

## 1. Environment — mandatory first step

Every shell session begins with:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location '<repo>'
. .\scripts\env.ps1
```

`scripts/env.ps1` redirects `TEMP`, `TMP`, `TMPDIR`, the uv cache, the managed
interpreter payload, the pip cache, the bytecode cache and the npm cache into
this repository. The machine policy is `RemoteSigned` and these scripts are
unsigned, so the process-scope bypass is required; it changes no machine or
user setting.

**Absolute rule: no temporary file, cache or build intermediate may be written
to the `C:` drive.** DSH hands every command a fresh `C:`-drive `TEMP`
directory, so sourcing the environment script is not optional. If a tool needs
a location that is not covered yet, add it to `scripts/env.ps1` and to
[docs/model/environment/interfaces.md](docs/model/environment/interfaces.md) in
the same change.

Verification of this rule is executable, not a promise:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1
```

## 2. Toolchain

| Purpose | Tool |
|---|---|
| Python interpreter and packages | uv (managed CPython 3.14, `.venv/`) |
| Python lint and tests | `uv run ruff check`, `uv run pytest` |
| Node runtime and packages | Node.js ≥ 24, pnpm |
| Viewer (supported way to run it) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viewer.ps1` — starts the service, and on Ctrl+C reaps the whole tree and verifies nothing was left |
| Viewer internals | `node src/viewer/server.mjs`, `node --test "src/viewer/tests/*.test.mjs"` |
| Observing the viewer in a real browser | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1` — drives an installed browser over the DevTools Protocol against the shipped service; exit 0 pass, 1 mismatch, 2 could not run (including no browser). Zero npm dependencies |
| C++ tooling build | CMake + GCC 16.1.0 from `<toolchain>` |
| Documentation gate | `tools/documentation/validate-documentation.ps1` |

Tool versions are recorded per version in the corresponding `dev-log` entry.

## 3. Workflow for any non-trivial change

1. **Identify the claim.** Which claim type is this, who owns it, who consumes
   it, and which version is active? See
   [docs/DOCUMENTATION_RULES.md](docs/DOCUMENTATION_RULES.md) §2.
2. **Read before writing.** Read the owning documents and the code you are
   about to change. Prefer the existing pattern over new machinery.
3. **Find prior art.** For anything with an algorithmic core, identify the
   established algorithm and its complexity bound before implementing. This is
   [ENGINE_STANDARD.md](ENGINE_STANDARD.md) §3 and it is not optional.
4. **Implement.** Small, reviewable changes. Do not delete or weaken assigned
   version content to make a check pass.
5. **Synchronise the coupled documents** in the same work item
   ([docs/DOCUMENTATION_RULES.md](docs/DOCUMENTATION_RULES.md) §10).
6. **Verify.** Run the gate and the module's own tests. Record the exact
   commands and their observed results.
7. **Report** in the format of
   [docs/AI_DOCUMENTATION_GUIDE.md](docs/AI_DOCUMENTATION_GUIDE.md) §4.2.

## 4. Gates

One command runs every gate, sources the environment itself, and reports a
single exit code:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -Full
```

The default set is feedback for an edit and takes about five seconds. `-Full`
adds the two version-boundary gates and takes about twenty. Exit codes: `0`
every gate passed, `1` at least one failed, `2` the runner could not complete.

| Gate | Decided by | Fails when | In default set |
|---|---|---|---|
| Documentation conformance | `tools/documentation/validate-documentation.ps1` | any check code fires; see [tools/documentation/README.md](tools/documentation/README.md) | yes |
| Gate self-tests | `tools/documentation/tests/run-tests.ps1` | a fixture tree disagrees with its expected codes or exit code | yes |
| Tool build | `tools/documentation/build.ps1` | the tool cannot be built | yes |
| Environment isolation, static phase | `scripts/verify-temp-isolation.ps1 -StaticOnly` | a resolved location is not inside the repository | yes |
| Python tests | `uv run pytest` | a test fails | yes |
| Python lint | `uv run ruff check` | a lint rule fires | yes |
| Node install | `pnpm install` | the store or cache resolves outside the repository | yes |
| Viewer service and page | `node --test "src/viewer/tests/*.test.mjs"` | a protocol, routing, decoding or admission test fails | yes |
| Viewer launcher | `scripts/viewer.ps1 -SmokeTest -NoHistory` | the service does not answer a routed page, an unknown route does not answer 404, or anything it started is still running afterwards | yes |
| Viewer in a browser | `tools/browser-probe/run.ps1` | a routed path stops being served, the geometry check finds an element covered by another, or an interaction does not produce the request the caller declared. Reports **not run** when no browser is installed | yes |
| Environment isolation, dynamic phase | `scripts/verify-temp-isolation.ps1` | the workload creates a file outside the repository | `-Full` only |
| Bootstrap idempotence | `scripts/bootstrap.ps1` | a second run downloads or changes anything | `-Full` only |
| Whitespace and leftovers | `git diff --check` plus a search for the forbidden marker words listed in [docs/AI_DOCUMENTATION_GUIDE.md](docs/AI_DOCUMENTATION_GUIDE.md) §3.2 | trailing whitespace, conflict markers or forbidden marker words | run by hand |
| Unrelated files untouched | `git status --porcelain` | a file outside the declared scope changed | run by hand |

A gate that cannot run is reported as not run. It is never reported as passed.

The browser probe is why that needed saying twice: it needs a browser, so on a
machine without one the runner records a third state and says so, rather than
showing a tick it did not earn.

The whitespace view has one deliberate blind spot: the gate fixtures under
`tools/documentation/tests/fixtures/` contain CRLF pairs, a BOM and a lone CR
because those bytes are what they test. `.gitattributes` marks that subtree
`-text` so git cannot normalise it, and `git diff --check` therefore reports
those files as trailing whitespace. That subtree is excluded from the
whitespace gate; everything else must be clean.

## 5. Documentation rules an agent must not get wrong

* Version state lives **only** in
  [docs/plan/VERSIONS.md](docs/plan/VERSIONS.md). Never restate a current or
  next version anywhere else — link to it.
* Status words come from the closed vocabulary in
  [docs/AI_DOCUMENTATION_GUIDE.md](docs/AI_DOCUMENTATION_GUIDE.md) §3. No
  present-tense language for unbuilt work.
* `Validated` requires the exact command, the declared configuration and the
  observed result, and it is scoped.
* Failed, skipped and timed-out runs stay in the record.
* Every path, file name and heading is English. Line endings are LF. Encoding
  is UTF-8 without BOM.
* Visualisation triggers and ownership are defined in
  [docs/DOCUMENTATION_RULES.md](docs/DOCUMENTATION_RULES.md) §8. Current and
  planned state are never mixed in one diagram.
* `README.md`, `docs/README.md`, `docs/MODULE_FLOW_GUIDE.md`,
  `docs/plan/README.md` and `docs/plan/ROADMAP.md` are navigation only.

## 6. C++ is tooling only

No C++ may enter the runtime path of the simulation, the service or the UI
without a superseding ADR that names the native boundary, the build integration
and the portable fallback
([ENGINE_STANDARD.md](ENGINE_STANDARD.md) §1.1). C++ tooling lives under
`tools/<tool>/`, is built by CMake, and never becomes an importable Python or
Node dependency.

## 7. When blocked

* Do not silently drop work. Either keep the item open, or assign it to a named
  future version in [docs/plan/VERSIONS.md](docs/plan/VERSIONS.md) and record
  it in the dev-log's `Follow-ups` section.
* Do not delete or reinterpret assigned version content to make a gate pass.
* If a requirement is ambiguous, ask rather than inventing an authority.
* A performance gap is never closed by argument. Difficulty is not evidence.
* A future surface has a design record before it has code: the editing mode is
  the current example, with its requirements, decisions and planned work in
  [docs/plan/phase-04-editing-mode/overview.md](docs/plan/phase-04-editing-mode/overview.md).

## 8. Commits

* One work item, one coherent change; the documentation coupling of §3.5 lands
  in the same commit as the code it describes.
* A commit message names the version and the claim type it advances.
* Version tags are created only for a version that reaches a complete state in
  [docs/plan/VERSIONS.md](docs/plan/VERSIONS.md).
* A `User Paused` checkpoint commit states explicitly that it is incomplete and
  non-versioned.
