# docs/plan — phase index

> **Derived discovery surface.** Navigation only. Version state is owned by
> [VERSIONS.md](VERSIONS.md); this file never restates it.

| Document | Owns |
|---|---|
| [VERSIONS.md](VERSIONS.md) | version order and state — the only authority |
| [ROADMAP.md](ROADMAP.md) | direction and phase order |
| [PERFORMANCE_ACCEPTANCE.md](PERFORMANCE_ACCEPTANCE.md) | machine profiles, measurement workflow, admission floors |

## Phases

| Phase | Directory | Started |
|---|---|---|
| 01 foundation | [phase-01-foundation/](phase-01-foundation/overview.md) | yes |
| 02 simulation core | [phase-02-simulation-core/](phase-02-simulation-core/overview.md) | yes |
| 03 service and interface | [phase-03-service-and-ui/](phase-03-service-and-ui/overview.md) | yes |
| 04 editing mode | [phase-04-editing-mode/](phase-04-editing-mode/overview.md) | design record; version states in [VERSIONS.md](VERSIONS.md) |

Each phase directory contains `overview.md` (which owns the milestone
relationship), `milestones.md`, `tasks.md`, `acceptance.md`, `risks.md` and a
`plans/` directory holding one focused plan per version.

## Reading order for a reviewer

1. [../DOCUMENTATION_RULES.md](../DOCUMENTATION_RULES.md) — how the system is
   structured;
2. [VERSIONS.md](VERSIONS.md) — which versions exist and what state they are in;
3. the phase documents of the phase you are reviewing;
4. `dev-log/<version>.md` — what was actually executed and observed.
