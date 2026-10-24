# docs/model — module contracts

> **Derived discovery surface.** Navigation and schema only. A module's
> contract is owned by that module's own directory; version state is owned by
> [../plan/VERSIONS.md](../plan/VERSIONS.md).

## Modules

| Module | Primary language | Contract |
|---|---|---|
| environment | PowerShell | [environment/overview.md](environment/overview.md) |
| documentation | C++ | [documentation/overview.md](documentation/overview.md) |

Each module directory carries the eight files required by
[../DOCUMENTATION_RULES.md](../DOCUMENTATION_RULES.md) §4, optionally plus
specialist files such as `internal-components.md`.

## Module catalog schema

[module-catalog.json](module-catalog.json) is the editable list of modules.
It is the single place where a module is declared; the gate checks that the
declared names and the directories under this folder agree.

```json
{
  "modules": [
    {
      "name": "<directory name under docs/model/, lower-case kebab-case>",
      "owner": "<the phase that owns the module>",
      "language": "<free text: the primary implementation language>"
    }
  ]
}
```

Rules:

* `name` must match `^[a-z][a-z0-9-]*$` and must equal the directory name.
* `owner` names a phase directory that exists under `docs/plan/`.
* `language` is descriptive free text, not a closed enumeration, because a
  module may be implemented in a language that is not part of the runtime
  split (for example the PowerShell implementation of `environment`).
* Adding or removing a module is a boundary change and follows the coupling
  matrix in [../DOCUMENTATION_RULES.md](../DOCUMENTATION_RULES.md) §10.
