# lifegame

A large-world Game of Life simulation platform.

The subject is not a small grid. It is a world large enough that the
implementation strategy itself — memory layout, update scheduling, persistence
and transport — decides whether the world can exist at all. The project
definition and the principles that follow from it are owned by
[ENGINE_STANDARD.md](ENGINE_STANDARD.md).

## Language split

| Layer | Language |
|---|---|
| Simulation core | Python 3.14 |
| Service and interface | NodeJS 24 |
| Tooling | C++20 |

C++ is tooling only and never enters the runtime path without a superseding
ADR. See [ENGINE_STANDARD.md](ENGINE_STANDARD.md) §1.1.

## Requirements

* Windows with PowerShell 5.1 or newer
* [uv](https://docs.astral.sh/uv/) (manages CPython 3.14)
* Node.js ≥ 24 with pnpm
* CMake and a C++20 compiler for the documentation gate
* git

## Quick start

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location <repo>
. .\scripts\env.ps1          # required: redirects every transient location in-repo
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
```

`scripts/env.ps1` must be sourced in **every** shell that runs a toolchain
command. It redirects `TEMP`, `TMP`, `TMPDIR`, the uv cache, the managed
interpreter payload, the pip cache, the bytecode cache and the npm cache into
this repository, and it refuses to continue when one of them points at the
system volume. The process-scope execution policy is required because the
machine policy is `RemoteSigned` and these scripts are unsigned.

## Run the world

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viewer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/viewer.ps1 -Port 9000
```

Then open the address the script prints and use the tabs:

| Route | What it is for |
|---|---|
| `/world` | the canvas: click a cell to bring it to life, drag to pan, scroll or pinch to zoom, and run, pause, step or clear |
| `/history` | the recorded generations as a tree: select one to look at it, and editing from there adds a branch |
| `/archives` | export the history to a named file, list, rename, delete, and import one back |

**Use the script rather than starting the service by hand.** The viewer starts
Python cores as children, and a core that outlives its service keeps holding the
history database — observed here, not theorised about. The script starts the
service, streams its output, and on Ctrl+C reaps the whole process tree, then
verifies that nothing was left and exits non-zero if something was. It also
refuses to start while a core from an earlier run is still alive, because that
would make two writers on one store; `-CleanStray` reaps them first.

The browser is only a surface: the rule is evaluated by the Python core in
`src/lifegame/world/`, which the service drives over a line protocol. See
[src/viewer/README.md](src/viewer/README.md) for the HTTP surface and
[docs/model/world/interfaces.md](docs/model/world/interfaces.md) for the
protocol itself.

## Gates

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -Full
```

The default set runs the documentation gate, its self-tests, the tool build,
the static isolation phase, the Python tests and lint, and the Node install,
and takes about five seconds. `-Full` adds the isolation dynamic phase and a
bootstrap idempotence run for a delivered revision. The runner sources
`scripts/env.ps1` itself, so it does not depend on the preamble above.

A gate that cannot run is reported as not run, never as passed.

## Repository layout

| Path | Contents |
|---|---|
| `src/lifegame/` | Python packages — one directory per module |
| `tests/` | one test package per module |
| `tools/` | C++ tooling, one directory per tool |
| `docs/` | the documentation system |
| `dev-log/` | executed verification evidence, one file per version |
| `evidence/` | focused evidence that is not tied to a version |
| `scripts/` | environment, bootstrap, the single verification entry point and the isolation check |
| `.cache/`, `TEMP/`, `data/` | in-repository transient, cache and data locations |
| `AGENTS.md` | operating rules for agents and humans working here |

## Documentation map

| Question | Document |
|---|---|
| What is this project and what are its principles? | [ENGINE_STANDARD.md](ENGINE_STANDARD.md) |
| How do I work in this repository? | [AGENTS.md](AGENTS.md) |
| How are documents structured and coupled? | [docs/DOCUMENTATION_RULES.md](docs/DOCUMENTATION_RULES.md) |
| What must each document contain, and what counts as evidence? | [docs/AI_DOCUMENTATION_GUIDE.md](docs/AI_DOCUMENTATION_GUIDE.md) |
| Where is the documentation entry point? | [docs/README.md](docs/README.md) |
| Which version is which? | [docs/plan/VERSIONS.md](docs/plan/VERSIONS.md) |
| What are the modules? | [docs/model/module-catalog.json](docs/model/module-catalog.json) |
| Which decisions were taken, and why? | [docs/adr/README.md](docs/adr/README.md) |
| What are the machine profiles and the measurement workflow? | [docs/plan/PERFORMANCE_ACCEPTANCE.md](docs/plan/PERFORMANCE_ACCEPTANCE.md) |

## Licence

Not yet decided. Until an ADR records a licence, this repository is
all-rights-reserved by its author.

## Heart assignment

The Game of Life heart assignment built with this project is in [`heart/`](heart/).
It contains the evolution code (`heart.py`, `heart.html`), the initial and final
images, the video, and the editing-mode record.

**Live demo:** [xiaolangwhite.github.io/lifegame-heart/heart/heart.html](https://xiaolangwhite.github.io/lifegame-heart/heart/heart.html)
