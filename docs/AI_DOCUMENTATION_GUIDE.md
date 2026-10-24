# AI_DOCUMENTATION_GUIDE — evidence, states and content contracts

> **Authority.** This document owns *what each document must contain* and *how
> evidence is recorded and scoped*. Structure and coupling rules live in
> [docs/DOCUMENTATION_RULES.md](DOCUMENTATION_RULES.md); version state lives in
> [docs/plan/VERSIONS.md](plan/VERSIONS.md).

## 1. Who this guide is for

It is written for a reader who did not watch the work happen: a reviewer, a
future agent, or the author three months later. Such a reader must be able to
tell, without guessing, **what exists**, **what was actually run**, **what
failed**, and **what is still only planned**.

Three failure modes are treated as defects, not as style:

1. present-tense description of something that was never built;
2. a verification claim with no command, no configuration and no observed
   result;
3. a removed failure — a run that was skipped, excluded or timed out and then
   quietly disappeared from the record.

## 2. Evidence rules

* The strongest evidence is the exact command plus its exact output, including
  the exit code. Summarising is allowed; replacing is not.
* Evidence is tied to a revision. When the revision changes, the evidence is
  stale until re-run — say so rather than reusing it.
* A negative result is evidence. Record what was excluded and why, with the
  same care as what succeeded.
* Measurements record the environment: machine profile, toolchain versions,
  worker counts, scale, and whether the run was cold, warm or reused.
* Never write a number that was not observed. If a number is a target, label
  it as a target and keep it out of evidence tables.

## 3. Status vocabulary

The vocabulary is closed. Every `Status:` line is checked by the gate.

| State | Obligation |
|---|---|
| `Implemented` | The code entry point can be named. Correctness, build or runtime success also requires verification evidence. |
| `Partially Implemented` | Must list what exists **and** what is still missing. |
| `Planned` | Not built. No present-tense implementation language anywhere in the document. |
| `User Paused` | Set only by explicit user instruction. Must carry: pause date, reason, retained scope, resume trigger, checkpoint reference, and any ADR exception. |
| `Future Goal` | Direction without a delivering version. Must name the version that will own it. |
| `Proposed` | Under discussion. Not approved. |
| `Deprecated` | Still present, no longer to be used. Must name the replacement or the removal version. |
| `Rejected` | Considered and declined. Must state why. |
| `Superseded` | Replaced. Must link to the replacement. |

### 3.1 Validation qualifiers

| Qualifier | Obligation |
|---|---|
| `Validated` | Exact documented command + declared configuration + declared result. Validation is **scoped**: a compile does not prove runtime; a smoke run does not prove full correctness; one platform does not prove portability. State the scope. |
| `Unvalidated` | Everything else. Permitted, but must never be written as if it were validated. |

### 3.2 Prohibited language

* No present tense, imperative or completion language for `Planned`,
  `User Paused`, `Future Goal` or `Proposed` items.
* No forbidden marker word may appear in a document that is presented as
  complete. The closed list is:

```
TODO   TBD   FIXME   PLACEHOLDER   XXX
```

* No "temporarily", "for now" or "will be cleaned up later" as a substitute
  for a scheduled item. If it is deferred, name the version.

## 4. Evidence layers

| Layer | Location | Owns |
|---|---|---|
| Version log | `dev-log/<version>.md` | everything executed for one version: commands, exit codes, observed output, failures kept verbatim, environment |
| Focused evidence | `evidence/<topic>.md` | a measurement, a reproduction, a spike — anything not tied to a version boundary |
| Source of truth for behaviour | the source, its tests, the build definitions | what the system actually does |

A `dev-log` entry is written when a version's work is delivered, and it is what
`Validated` statuses point at.

### 4.1 dev-log required sections

```
# <version> — <title>
## Scope                which version, which phase, what it was meant to deliver
## Environment          machine profile, interpreter/runtime/toolchain versions
## Commands             exact commands, in order
## Results              observed output and exit codes per command
## Failures             failures, skips and timeouts preserved verbatim
## Deviations           anything delivered differently from the plan, and why
## Follow-ups            items handed to a named future version
```

### 4.2 Verification report format

Any completion report — human or agent — states, in this order:

1. the claim type, its owner and the active version;
2. what changed, as file paths;
3. how it was verified: exact commands and observed results;
4. what remains unverified, and the scope of what *was* verified;
5. what is now scheduled into which future version;
6. whether a commit and tag exist.

## 5. Module document content contracts

Every module directory under `docs/model/` carries the eight files named in
[docs/DOCUMENTATION_RULES.md](DOCUMENTATION_RULES.md) §4. Their obligations:

### 5.1 `overview.md`

Purpose in one paragraph; where the module sits in the system; current status
using the vocabulary in §3; the owner; dependencies in and out; what the module
deliberately does **not** do; links to the ADRs that shaped it. When the
visualisation triggers fire, this file carries the minimal current-state
diagram.

### 5.2 `responsibilities.md`

The claims this module owns; the boundary against each peer it touches; the
behaviour required when it fails; and the things it must never do even though
it technically could.

### 5.3 `interfaces.md`

The complete public surface and its contract. For a Python module this means:
the names exported through `__all__`; every public callable with its signature;
raised exception types and when; ownership and lifetime of returned objects;
the exact inputs and outputs that cross a module boundary; structured error
behaviour; statistics and diagnostics; the entry points used for smoke runs;
and the compatibility policy. **Implemented API and planned types are listed
separately.** For a NodeJS module the same obligations apply to exported
functions and to protocol schemas. For a command-line tool the "interface" is
its arguments, output format and exit codes.

### 5.4 `data-flow.md`

Producer and consumer paths; the runtime flow; who owns each piece of data and
for how long; the failure, rollback and recovery paths. This file owns the flow
diagrams for the module.

### 5.5 `implementation.md`

How the module is built: file and directory layout, the algorithms that
matter, their complexity bounds, the environment it requires, how it is
configured and relocated, and **why** the structural choices were made.
Alternative designs that were rejected belong here or in an ADR, not in
`overview.md`.

### 5.6 `performance.md`

The budget as an admission floor; the oracle used to judge it; the measurement
method; the candidate set; the scale matrix; the noise policy; and an explicit
list of what has not been measured. If the module has no performance contract,
say so and say why that is safe.

### 5.7 `testing.md`

What is tested and what is deliberately not; how to run it; the fixture layout;
which failure modes are covered; and the exact command that produced the last
recorded result.

### 5.8 `risks.md`

Known risks and open questions, each with: trigger, impact, mitigation, and the
**version that owns it**. An unresolved risk without an owning version is a
defect.

## 6. Phase document content contracts

`docs/plan/phase-NN/` contains:

| File | Obligation |
|---|---|
| `overview.md` | Phase purpose, scope in and out, and the milestone relationship. This file owns the milestone diagram. |
| `milestones.md` | Ordered milestones, each naming the version that delivers it. |
| `tasks.md` | The concrete work items and their state. |
| `acceptance.md` | Measurable acceptance criteria. "It works" is not a criterion. |
| `risks.md` | Phase-level risks, each with an owning version. |
| `plans/<version>/` | The focused plan for one version: exact implementation boundary, files touched, gates to run, and what is explicitly out of scope. |

## 7. Writing rules

* English for every path, file name, code identifier and heading.
* UTF-8, LF line endings, no BOM. The gate enforces this.
* Relative links only, and they must resolve. The gate enforces this.
* Use exact identifiers and existing paths. Never invent a name that the code
  does not use.
* Separate current state from target state — in prose and in diagrams.
* Summarise and link across ownership boundaries; never copy an authoritative
  statement into a second file.
