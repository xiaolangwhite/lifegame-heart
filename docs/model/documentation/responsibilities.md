# documentation — responsibilities

> **Owner.** This file owns the claims of the `documentation` module, its
> boundary against each peer it touches, the behaviour required when it fails,
> and the behaviour it is forbidden to adopt. The interface itself is owned by
> [interfaces.md](interfaces.md); the rules the module enforces are owned by
> [DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) and
> [AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md).

Status: Implemented

## 1. Claims this module owns

| Claim | Stated in | Decided by |
|---|---|---|
| A repository tree either fires at least one check code or it does not, and the exit code says which | [interfaces.md](interfaces.md) §4 | `docguard` exit code `0` or `1` |
| The set and the spelling of the fifteen check codes is stable | [interfaces.md](interfaces.md) §5 | [tools/documentation/README.md](../../../tools/documentation/README.md) and the fixture suite |
| Every check code is reachable, and each fires on a tree that is otherwise valid | this file, §3 | [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) |
| A name, a spelling or an encoding defect is reported with a path and, where it applies, a line number | [interfaces.md](interfaces.md) §3 | the text and JSON reports |
| Two runs over an unchanged tree produce byte-identical output | [interfaces.md](interfaces.md) §3 | the SHA-256 comparison in [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) |
| The build produces one self-contained executable that needs no runtime library from the compiler distribution | [implementation.md](implementation.md) §2 | [build.ps1](../../../tools/documentation/build.ps1) and [CMakeLists.txt](../../../tools/documentation/CMakeLists.txt) |
| The gate entry point is one command that builds when necessary and forwards the verdict | [interfaces.md](interfaces.md) §9 | [validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1) |

The module owns the **decision procedure**, not the **rules**. A rule that is
absent from the check-code table is not a gap in the tool; it is a rule that
this module was never asked to execute.

## 2. Boundary against each peer

| Peer | This module owns | The peer owns | Crossing |
|---|---|---|---|
| [DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) | the executable form of the structural rules | which rules exist, the module contract, the coupling matrix, the gate command | The tool implements a subset; the file is the authority the codes are checked against |
| [AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) | the closed status vocabulary as a checked value set | the vocabulary's meaning, the content obligations, the evidence rules | The vocabulary is duplicated in code as a literal list; the file remains the authority |
| [MODULE_COMPONENT_GUIDE.md](../../MODULE_COMPONENT_GUIDE.md) | compliance with the eight-document module contract, and the component detail in [internal-components.md](internal-components.md) | the component rules and the central index | The tool checks that the eight files exist; it does not check component paths, which the reviewer reads |
| [VERSIONS.md](../../plan/VERSIONS.md) | the syntax of a version identifier inside that file, and the presence of its table header | version order, state and grammar as policy | The tool checks tokens; it never writes version state |
| [docs/adr/README.md](../../adr/README.md) and every ADR file | ADR naming and the four required sections | the decisions themselves | The tool checks form, never content |
| The scanned documents (`AGENTS.md`, `ENGINE_STANDARD.md`, `docs/**`, `dev-log/**`, `evidence/**`) | the report about them | their content and their claims | The tool opens them read-only; a defect is reported, never repaired |
| The `environment` module | nothing | the isolation contract and the redirect of every transient location | [build.ps1](../../../tools/documentation/build.ps1), [validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1) and [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) dot-source [scripts/env.ps1](../../../scripts/env.ps1); the isolation check invokes [build.ps1](../../../tools/documentation/build.ps1) as a workload. See [../environment/overview.md](../environment/overview.md) |
| [phase-01-foundation/acceptance.md](../../plan/phase-01-foundation/acceptance.md) | the commands A4, A5, A6 and A8 name | the criteria and their evidence owner | The module supplies the command and the exit code; the observed result is recorded in the dev-log |
| The evidence layer (`dev-log/`, `evidence/`) | the verdict and its output | persistence, the run record and the failures kept verbatim | The tool writes no evidence file |
| [ADR 0001](../../adr/governance-and-build/0001-single-authority-documentation-system.md) and [ADR 0003](../../adr/governance-and-build/0003-cpp-is-tooling-only.md) | nothing | the decision that the gate exists, its scope and its tooling-only placement | Renaming or removing a check code needs a superseding ADR |

Two consequences are worth stating because they are easy to get wrong:

* The module is not the authority for the **status vocabulary**, the **version
  grammar** or the **check-code table**. If the tool and a policy document
  disagree, [DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §2 applies:
  the inconsistency is recorded and resolved inside one work item, not silently
  picked.
* The module reads `dev-log/` and `evidence/` as trees to validate, not as
  inputs to its own behaviour. It has no dependency on their contents.

## 3. Behaviour required when it fails

Failure is a first-class outcome, and it is never silent.

| Situation | Required behaviour | Observed as |
|---|---|---|
| At least one check code fired | Report every violation, then exit `1`, whatever the severity | The violation list plus the summary line |
| A command-line argument is unknown, missing its value or malformed | Print the message and the usage text to stderr and exit `2`; run no check | `docguard: <message>` |
| The scan root is not an existing directory, or cannot be enumerated | Print the reason to stderr and exit `2`; run no check | `docguard: scan root is not an existing directory: <root>` |
| A file that exists cannot be read | Retry five times with a 20 ms pause, then record an IO failure; print the violations found so far and exit `2` | `docguard: io error: <relative path>: <error>` |
| A path named by a rule does not exist | Report it as a violation of the rule, not as an IO failure | A violation whose check code is the rule's |
| The executable is missing and the build fails | The wrapper exits `2` and prints the build failure | `[docguard] build failed with exit code <code>` |
| The executable is missing and `-SkipBuild` is set | The wrapper exits `2` and names the missing path | `[docguard] executable not found: <path>` |

Two invariants hold across all of them:

* **`1` and `2` are different answers.** `1` means the tree was judged and
  failed; `2` means the tree was not fully judged. A consumer that collapses the
  two has lost the distinction the contract exists to preserve.
* **A check that did not run is never reported as passed.** The tool has no
  "skipped" outcome for a check: either a code fires, or the run did not
  complete and says so.

## 4. What the module must never do

Even though it technically could:

* **Never write to the scanned tree.** No rewrite, no rename, no deletion, no
  creation, no formatting fix, no cache file inside `docs/`.
* **Never suppress or downgrade a finding to make a run pass.** There is no
  option that hides a code, no allowlist of paths and no ignore comment in the
  checked documents.
* **Never rename, remove or re-scope a check code silently.** The code set is an
  interface ([ADR 0001](../../adr/governance-and-build/0001-single-authority-documentation-system.md));
  a rename needs a superseding ADR and a synchronised update of the README, the
  rules and the fixtures.
* **Never report a verdict without an exit code**, and never report a verdict
  from a run that did not read the whole tree.
* **Never verify by content hash**, and never emit a manifest, an index or a
  receipt. That mechanism is out of scope by decision, not by omission.
* **Never become a library.** No Python or Node code may import the tool, and no
  module may depend on its source; only its executable and its exit code are a
  surface ([ADR 0003](../../adr/governance-and-build/0003-cpp-is-tooling-only.md)).
* **Never judge what is not mechanically decidable**: diagram triggers, claim
  ownership, whether a number is a target, whether a status was earned.
* **Never write outside the repository tree**, including its build directory,
  which stays under `tools/documentation/build/`
  ([ADR 0002](../../adr/governance-and-build/0002-confine-transient-artifacts-to-repository.md)).
* **Never let the ignore list grow silently.** Every ignored prefix changes the
  verdict for a tree, so it is part of the interface
  ([interfaces.md](interfaces.md) §6) and not an implementation detail.
* **Never treat an unreadable file as an absent file.** Absence is the layout
  rule's business; unreadability is an IO failure and forces exit `2`.

## 5. What the module answers to

| Question | Owner of the answer |
|---|---|
| Which rules exist and who may change them | [DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §2 |
| What each check code means | [tools/documentation/README.md](../../../tools/documentation/README.md) |
| Whether the repository passes | The version dev-log entry named by [phase-01-foundation/acceptance.md](../../plan/phase-01-foundation/acceptance.md) |
| How fast the gate must be | [performance.md](performance.md) and [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5 |
| Which failures are known and who closes them | [risks.md](risks.md) |
