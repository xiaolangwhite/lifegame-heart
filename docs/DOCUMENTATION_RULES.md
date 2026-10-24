# DOCUMENTATION_RULES — structure and coupling

> **Authority.** This document owns *how documents are structured, owned and
> coupled*. It does not own what a document must contain
> ([docs/AI_DOCUMENTATION_GUIDE.md](AI_DOCUMENTATION_GUIDE.md)), nor which
> version is current ([docs/plan/VERSIONS.md](plan/VERSIONS.md)).

## 1. Layers

| Layer | Documents | Owns |
|---|---|---|
| Normative | [ENGINE_STANDARD.md](../ENGINE_STANDARD.md), [docs/plan/VERSIONS.md](plan/VERSIONS.md), [docs/adr/README.md](adr/README.md) | what the project is; which version is current; which decisions were taken |
| Policy | [AGENTS.md](../AGENTS.md), this file, [docs/AI_DOCUMENTATION_GUIDE.md](AI_DOCUMENTATION_GUIDE.md), [docs/MODULE_COMPONENT_GUIDE.md](MODULE_COMPONENT_GUIDE.md), [docs/plan/PERFORMANCE_ACCEPTANCE.md](plan/PERFORMANCE_ACCEPTANCE.md) | how to write, how to verify, how to measure |
| Scope | [docs/plan/phase-NN/](plan/), [docs/model/](model/), [docs/adr/](adr/) | the actual content: phases, plans, module contracts, decisions |
| Evidence | [dev-log/](../dev-log/), [evidence/](../evidence/) | what was actually executed and observed |
| Derived discovery | [README.md](../README.md), [docs/README.md](README.md), [docs/MODULE_FLOW_GUIDE.md](MODULE_FLOW_GUIDE.md), [docs/plan/README.md](plan/README.md), [docs/plan/ROADMAP.md](plan/ROADMAP.md) | navigation only |

Arrows point one way: Normative → Policy → Scope → Evidence. Derived discovery
links into all of them and owns nothing.

## 2. Authority by claim type

| Claim | Owner | Everyone else |
|---|---|---|
| What the project is, engineering and performance principles | [ENGINE_STANDARD.md](../ENGINE_STANDARD.md) | link |
| Which versions exist, their order and their state | [docs/plan/VERSIONS.md](plan/VERSIONS.md) | link |
| Long-lived architectural direction | [ENGINE_STANDARD.md](../ENGINE_STANDARD.md) + [docs/adr/](adr/) | link |
| Phase scope, milestones, acceptance | `docs/plan/phase-NN/` | link |
| Focused implementation boundary of one version | `docs/plan/phase-NN/plans/<version>/` | link |
| What a module promises | `docs/model/<module>/` | link |
| Internal component boundaries | [docs/MODULE_COMPONENT_GUIDE.md](MODULE_COMPONENT_GUIDE.md) + the module's component file | link |
| Behaviour that is implemented | the source, its tests and the build definitions | link |
| What was verified and observed | the exact command output plus [dev-log/](../dev-log/) | link |

**Arbitration.** When two authorities disagree, do not silently pick one.
Record the inconsistency, resolve it according to the active version's intent,
and synchronise every affected source inside the same work item.

## 3. Status vocabulary

The closed vocabulary, its required qualifiers and the prohibition on present
tense for unbuilt work are defined in
[docs/AI_DOCUMENTATION_GUIDE.md](AI_DOCUMENTATION_GUIDE.md) §3. Every
`Status:` line in this repository is checked against it by the gate.

## 4. Module document contract

Every module directory under [docs/model/](model/) contains exactly these
eight files, each with the content obligations listed in
[docs/AI_DOCUMENTATION_GUIDE.md](AI_DOCUMENTATION_GUIDE.md) §5:

```
overview.md  responsibilities.md  interfaces.md  data-flow.md
implementation.md  performance.md  testing.md  risks.md
```

Specialist files may be **added** next to them (for example a budget or cost
model for a module whose performance contract needs more than one page). A
missing file is a gate violation; an extra file is not.

## 5. Source layout mirror

A module's source layout mirrors its documentation level. The Python form:

```
src/lifegame/<module>/__init__.py         # facade: the documented public surface only
src/lifegame/<module>/<private-category>/ # implementation, never imported across modules
tests/<module>/test_<subject>.py          # one test package per module
```

The NodeJS form:

```
src/<module>/<name>.mjs                   # the service: one file per responsibility
src/<module>/public/                      # what the browser loads, served as static files
src/<module>/tests/<subject>.test.mjs     # tests travel with the module
```

C++ tooling:

```
tools/<tool>/                             # one directory per tool
```

Constraints:

* One package directory per module. A module may not be split across two
  top-level directories.
* `__init__.py` is a facade: it re-exports the public surface named in
  `interfaces.md` and defines `__all__`. Root-level module code only wires,
  delegates or orders cross-category transactions.
* A private category is never imported from another module. Cross-module use
  goes through the facade.
* Empty categories are forbidden: a category exists when it has content, not
  when it is planned. A planned categorisation must name the milestone that
  introduces it.
* Tooling is not a library: nothing under `src/` may import from `tools/`.
* **A NodeJS module keeps its tests inside its own directory** rather than under
  the repository-level `tests/`. The reasons are mechanical: the test runner
  resolves module specifiers relative to the test file, a bundler is not part of
  the toolchain, and `public/` is served from a path that has to stay inside the
  module. The Python form stays under `tests/<module>/` because a package
  installs into `site-packages` and its tests must not ship with it.
* A module's tests are named for the module, not for the repository: a test file
  under `tests/<module>/` or `src/<module>/tests/` is that module's evidence.

## 6. Version grammar and ordering

Version identifiers have four component roles:

```
v<major>.<phase>.<milestone>[.<slice> | fix<n>]
```

* `<slice>` is only valid for a **three-component parent that is still
  `Planned`**. Every child must be named first, children are strictly
  ascending, and the parent closes only after every child is complete. The
  parent's closing may not introduce unplanned implementation.
* `fix<n>` attaches only to a **completed three-component parent**. A fix never
  substitutes for a pre-planned child.
* The combination of a slice and a fix on the same parent is invalid.
* The fourth component is an internal delivery identifier. It never propagates
  automatically into package, ABI, Mod, save, network, cache or SDK
  compatibility versions.
* Once a parent is complete, no further children may be appended to it.

Order and state live only in [docs/plan/VERSIONS.md](plan/VERSIONS.md).

## 7. User Paused

`User Paused` is set and lifted **only by explicit user instruction**. It is
not a synonym for complete, rejected, superseded or generically blocked.

* No completion dev-log, no version tag.
* A checkpoint commit must state that it is incomplete and non-versioned.
* Later milestones that step around paused work require an accepted ADR
  proving three things: no consumption of the missing behaviour, a bounded
  environment, and a defined closing trigger.
* Resuming requires an explicit user instruction and moves the item back to
  `Planned`.

## 8. Visualisation and structure-tree triggers

Provide the **minimum sufficient** visualisation or structure tree when any one
of these holds:

* three or more peer modules, components, categories, states or dependency
  milestones participate in one relationship;
* data, ownership, lifecycle, release, failure, rollback or recovery crosses
  several stages, or branches and merges;
* nested directories, public/private boundaries, root entry points, component
  owners or document indexes cannot be understood reliably from a flat list;
* a cross-module producer/consumer path or version gate would otherwise force
  the reader to reconstruct direction from several documents.

Ownership is unique: a phase `overview.md` owns milestone relationships, a
module's `data-flow.md` owns producer/consumer and runtime flow, and a
module's `internal-components.md` owns component flow. Consumers summarise and
link; they do not redraw.

`Current Implementation Diagram/Tree` and `Planned Implementation Diagram/Tree`
are always separate. One diagram never mixes current and target state. Use
exact identifiers and existing paths, and define what every arrow means.

## 9. ADR rules

* One decision per file, numbered with four digits, globally unique.
* Stored under `docs/adr/<category>/`, by primary ownership. Categories:
  `governance-and-build`, `simulation-core`, `service-and-api`,
  `ui-and-visualization`, `data-and-formats`.
* Every ADR has `Status`, `Context`, `Decision` and `Consequences`, plus a
  `Superseding` section when it replaces another decision.
* Adding, moving, renaming, superseding or recategorising an ADR updates
  [docs/adr/README.md](adr/README.md) and every affected link **in the same
  work item**.
* Accepting an ADR records a decision. It never claims that implementation is
  complete.

## 10. Coupling matrix

| Change | Must be synchronised in the same work item |
|---|---|
| Public API or lifecycle | module `interfaces.md`, `data-flow.md`, `implementation.md`, `testing.md` + phase `tasks.md`, `acceptance.md` + `dev-log/` at delivery |
| Module boundary or dependency | affected modules' `responsibilities.md` + [docs/MODULE_FLOW_GUIDE.md](MODULE_FLOW_GUIDE.md) + related `interfaces.md`/`data-flow.md` + ADR when meaningful |
| Internal component boundary or location | the component file + affected module documents + [docs/MODULE_COMPONENT_GUIDE.md](MODULE_COMPONENT_GUIDE.md) index + phase evidence + ADR when authority or public direction changes |
| Persistent or wire format | owning module + the format document + migration strategy + test fixtures + phase plan + ADR when compatibility changes |
| Build or packaging | [README.md](../README.md) build section + module/tool documents + tests + phase `acceptance.md` + `dev-log/` |
| Verification or benchmark surface | module `testing.md`/`performance.md` + phase `acceptance.md` + `dev-log/` + sample or tool documents |
| Milestone state | [docs/plan/VERSIONS.md](plan/VERSIONS.md) + the phase core + `dev-log/`; discovery documents stay as links |
| Future architectural target | [ENGINE_STANDARD.md](../ENGINE_STANDARD.md) + [docs/plan/ROADMAP.md](plan/ROADMAP.md) + owning module + ADR when the direction constrains future implementation |

## 11. Derived discovery surfaces

[README.md](../README.md), [docs/README.md](README.md),
[docs/MODULE_FLOW_GUIDE.md](MODULE_FLOW_GUIDE.md),
[docs/plan/README.md](plan/README.md) and
[docs/plan/ROADMAP.md](plan/ROADMAP.md) are navigation. They may link to
versions and modules; they may not carry precise version state. The gate
enforces this with `DOC_VERSION_AUTHORITY_LEAK`.

## 12. Conformance gate

The single gate command is:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/validate-documentation.ps1
```

Exit code `0` means conformant. Any non-zero exit is a failure and must be
reported as such. The checks and their codes are listed in
[tools/documentation/README.md](../tools/documentation/README.md).

## 13. System inventory

```
ENGINE_STANDARD.md          project definition, engineering and performance principles
AGENTS.md                   operating rules for agents working in this repository
docs/
  DOCUMENTATION_RULES.md    this file
  AI_DOCUMENTATION_GUIDE.md evidence, states, per-document content contracts
  MODULE_COMPONENT_GUIDE.md internal component rules and central index
  MODULE_FLOW_GUIDE.md      derived: cross-module entry and dependency map
  README.md                 derived: documentation entry point
  adr/                      decisions, five categories
  model/                    module contracts, module catalog
  plan/
    VERSIONS.md             the only authority on version order and state
    ROADMAP.md              derived: direction
    PERFORMANCE_ACCEPTANCE.md  machine numbers and the measurement workflow
    README.md               derived: phase index
    phase-NN/               overview, milestones, tasks, acceptance, risks, plans/
dev-log/                    executed verification evidence, one file per version
evidence/                   focused evidence that is not a version log
tools/documentation/        the conformance gate and its tests
```
