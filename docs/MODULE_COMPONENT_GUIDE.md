# MODULE_COMPONENT_GUIDE — internal components and the central index

> **Authority.** This document owns the component-level rules and the central
> component index. A module's own component detail lives in that module's
> `internal-components.md`, which this file links to. Module-level contracts
> live in [docs/model/](model/).

## 1. Module versus component

A **module** is a public unit: it has a directory under
[docs/model/](model/), a package directory under `src/lifegame/`, and the
eight-file contract described in
[docs/DOCUMENTATION_RULES.md](DOCUMENTATION_RULES.md) §4.

A **component** is an internal unit of one module. It has no package of its own
and no public surface.

Two consequences follow, and they are the reason this file exists:

* Splitting a source file into several files does **not** create a module. A
  component is never treated as a public module merely because it is a
  separate file.
* A component never becomes a top-level module until an accepted ADR and a
  named version promote it.

## 2. When a module needs a component file

A module whose implementation has more than one internal unit carries
`internal-components.md` in its `docs/model/<module>/` directory, or a
component diagram file linked from it. That file owns:

* the component list with the exact source paths that make up each component;
* the allowed dependency direction between components;
* the flow between them, when the visualisation triggers of
  [docs/DOCUMENTATION_RULES.md](DOCUMENTATION_RULES.md) §8 fire;
* the current-state component diagram, kept separate from any planned one.

## 3. Synchronisation duty

When an internal component boundary or location changes, all of the following
change in the **same work item**:

1. the module's component file;
2. the affected module documents (at minimum `implementation.md`, and
   `data-flow.md` when flow changed);
3. the central index in §4 of this file;
4. the phase `tasks.md`, `acceptance.md` and `risks.md` entries that name it;
5. an ADR, when the change alters authority or the public direction.

## 4. Central component index

| Module | Components | Component detail |
|---|---|---|
| [environment](model/environment/overview.md) | `env-bootstrap`, `temp-isolation`, `path-contract` | [internal-components.md](model/environment/internal-components.md) |
| [documentation](model/documentation/overview.md) | `repo-scanner`, `rule-engine`, `link-resolver`, `report-writer`, `gate-scripts` | [internal-components.md](model/documentation/internal-components.md) |
| [world](model/world/overview.md) | `rule-object`, `error-vocabulary`, `change-record`, `sparse-representation`, `tiled-representation`, `dense-oracle`, `line-protocol`, `public-facade` | [internal-components.md](model/world/internal-components.md) |
| [viewer](model/viewer/overview.md) | `process-bridge`, `http-service`, `event-hub`, `shared-values`, `shell-link`, `frame-decoding`, `locale-catalogue`, `theme-logic`, `viewport-logic`, `panel-state`, `rule-vocabulary`, `history-tree`, `pattern-library`, `representation-choice`, `focus-memory`, `snippet-library`, `edit-document`, `edit-runtime`, `edit-tools`, `browser-view`, `test-harness` | [internal-components.md](model/viewer/internal-components.md) |
| [store](model/store/overview.md) | `error-vocabulary`, `schema-authority`, `backend-adapters`, `delta-codec`, `history-core`, `archive-format`, `store-cli`, `public-facade` | [internal-components.md](model/store/internal-components.md) |

The index is a summary. When it disagrees with a module's component file, the
module file wins and the index is the defect.

## 5. Naming

* Module directory names are lower-case kebab-case and match the package name
  under `src/lifegame/`.
* Component names are lower-case kebab-case and describe a responsibility, not
  a file that happens to exist.
* Every path quoted in a component file must exist. The documentation gate does
  not check component paths automatically; the reviewer does.
