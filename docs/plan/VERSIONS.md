# VERSIONS

> **Authority.** This file is the **only** place in the repository where
> version order and version state are recorded. Every other document that
> mentions a version links here instead of restating its state.
>
> Version grammar: [docs/DOCUMENTATION_RULES.md](../DOCUMENTATION_RULES.md) §6.
> State vocabulary: [docs/AI_DOCUMENTATION_GUIDE.md](../AI_DOCUMENTATION_GUIDE.md) §3.

Current version: `v0.4.1`.

## Named versions

| Version | State | Phase | Milestone | Delivered scope | Evidence |
|---|---|---|---|---|---|
| v0.1.0 | Complete | [phase-01-foundation](phase-01-foundation/overview.md) | 00 | Reproducible Python 3.14 + uv environment with all temporary files, caches and build intermediates confined to the repository tree; documentation system with an executable conformance gate | [dev-log/v0.1.0.md](../../dev-log/v0.1.0.md) |
| v0.1.0fix1 | Complete | [phase-01-foundation](phase-01-foundation/overview.md) | 00 | Verification cost, determinism and entry points: the gate's own test suite no longer pays 28 s of process plumbing, the tool build skips when nothing changed, the isolation check is deterministic again after a false failure, and one command runs every gate | [dev-log/v0.1.0fix1.md](../../dev-log/v0.1.0fix1.md) |
| v0.2.0 | Complete | [phase-02-simulation-core](phase-02-simulation-core/overview.md) | 00 | A world that fits the design target of 65536 x 65536 in 8 bytes per live cell, Conway's rule verified against an independent dense oracle, a line protocol another process can drive, and a browser page that toggles cells on click and runs, pauses, steps, clears, zooms and pans | [dev-log/v0.2.0.md](../../dev-log/v0.2.0.md) |
| v0.2.1 | Complete | [phase-02-simulation-core](phase-02-simulation-core/overview.md) | 01 | A third representation built from bit-packed 64 x 64 tiles, which advances 64 cells per word operation and costs time per active tile rather than per live cell; the measured frontier on two population shapes; a thicker adjustable grid and a dark/light theme in the viewer | [dev-log/v0.2.1.md](../../dev-log/v0.2.1.md) |
| v0.2.2 | Complete | [phase-02-simulation-core](phase-02-simulation-core/overview.md) | 02 | A history layer that records every generation as the cells that changed, rolls a world back to any recorded generation, and writes a session to a portable archive; a store whose schema is defined once and rendered for SQLite and MySQL; a push transport for the viewer; choosing the representation from the interface; and automated coverage of the browser surface | [dev-log/v0.2.2.md](../../dev-log/v0.2.2.md) |
| v0.3.0 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 00 | A Chinese and English interface with one message catalogue, the core's enforced limits advertised and consumed instead of copied, one style rule per kind of control, and the recorded history as a timeline the page can roll back from | [dev-log/v0.3.0.md](../../dev-log/v0.3.0.md) |
| v0.3.1 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 01 | A recorded history that is a tree rather than a chain: a node names its parent, the session points at the node the world is on, recording appends instead of discarding, and a generation number is a label rather than an identity. Plus a panel that hides to the right and expands to full width, two-finger zoom and pan, archive export/import/list/rename/delete, and an interface that draws the branches and selects a node to work from | [dev-log/v0.3.1.md](../../dev-log/v0.3.1.md) |
| v0.3.2 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 02 | The interface as routed pages: the world, the history and the archives each at their own path with their own module, the layout and navigation declared once, the history drawn as nodes whose detail appears on hover or on keyboard focus, and two tests that can now see what a person saw — a page whose markup omits a container, and a style rule that names a class nothing bears | [dev-log/v0.3.2.md](../../dev-log/v0.3.2.md) |
| v0.3.3 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 03 | The history page becomes a workspace: a compact tree on the left that can be dragged and selected, and on the right a preview of the selected generation centred on the live cell nearest to where the main view was. Plus the main view opening at one cell per sixty CSS pixels of canvas width, centred on the world | [dev-log/v0.3.3.md](../../dev-log/v0.3.3.md) |
| v0.3.3fix1 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 03 | Four defects found by using the interface in a real browser: a preview that paints black after a refresh, a generation that cannot be selected by clicking it, a horizontal scrollbar that overlaps the newest generation and makes both flicker, and an opaque element covering part of a label | [dev-log/v0.3.3fix1.md](../../dev-log/v0.3.3fix1.md) |
| v0.3.4 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 04 | The preview opens on the current generation instead of waiting for a selection, and the browser probe that found the four defects of the version before this one becomes a durable tool under `tools/`, so the measurement can be repeated from a clean checkout | [dev-log/v0.3.4.md](../../dev-log/v0.3.4.md) |
| v0.3.4fix1 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 04 | A regression a browser found: the control that reveals earlier generations in the timeline no longer does its job | [dev-log/v0.3.4fix1.md](../../dev-log/v0.3.4fix1.md) |
| v0.3.5 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 05 | A rule editor on the main page, in the general `BxxSxx` form, with presets and free entry, and a world that accepts it: the three representations stopped holding one rule, the rule compiles to a selection network so the default rule pays nothing, the protocol carries it, and the recorded history replays each generation under the rule it was generated with | [dev-log/v0.3.5.md](../../dev-log/v0.3.5.md) |
| v0.3.5fix1 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 05 | The schema 2 to 3 migration raised `too many levels of trigger recursion` on a real store, because dropping a table under foreign-key enforcement walks a self-referential cascade one level per row; the core died on start-up and the interface was unusable | [dev-log/v0.3.5fix1.md](../../dev-log/v0.3.5fix1.md) |
| v0.3.6 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 06 | A truncation that removes only the head's own future and keeps a sibling branch replayable; more than one session per service, each with its own core, history store and event hub; a pattern library of fifteen classic patterns placed by name in one request; and automatic representation choice from the measured shape of the live set | [dev-log/v0.3.6.md](../../dev-log/v0.3.6.md) |
| v0.3.6fix1 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 06 | STO-19: a store whose own rows violated its declared keys could not be opened at all. `salvage` copies it, clears the dangling parent links on the copy, reports the cleared row ids, and leaves the source byte-identical; a branch whose ancestry was lost refuses a replay by name | [dev-log/v0.3.6fix1.md](../../dev-log/v0.3.6fix1.md) |
| v0.3.7 | Complete | [phase-03-service-and-ui](phase-03-service-and-ui/overview.md) | 07 | A representation switch that continues the recorded session instead of truncating the timeline (C12, T59); a session cap of 64 with creations queued to a bound of 1024 and the queue counted; a remembered view point stored per session and shareable by `?focus=x,y`; a capabilities route naming the surfaces a future editing mode may use; undo of the last cell edit distinct from a rollback (C13, T60); controls that name themselves and a hint line with the shortcuts (C14, T61); and saving and loading a recorded world from the archives page (C15, T62) | [dev-log/v0.3.7.md](../../dev-log/v0.3.7.md) |
| v0.4.0 | Complete | [phase-04-editing-mode](phase-04-editing-mode/overview.md) | 00 | Single-user editing mode: the core's atomic patch, the versioned document and hash chain, the enter/leave pause, the transaction/undo/redo/resync routes, the page's gesture-to-transaction tools, the content-addressed snippet library with drafts and publish, and the selection, transform and overwrite/merge controls | [dev-log/v0.4.0.md](../../dev-log/v0.4.0.md) |
| v0.4.1 | Complete | [phase-04-editing-mode](phase-04-editing-mode/overview.md) | 01 | Real-time collaboration on the editing document: ephemeral presence (cursor, selection, view point) over the event stream, merging of concurrent transactions in the service's commit order, cross-author undo that names its transaction and skips cells a later author wrote, and the bounded attribution that keeps a long session's memory flat | [dev-log/v0.4.1.md](../../dev-log/v0.4.1.md) |
| v0.4.2 | Planned | [phase-04-editing-mode](phase-04-editing-mode/overview.md) | 02 | Edit tokens and the roles observer, editor and owner, with permission checks and an audit of who committed and undid what | — |
| v0.4.3 | Planned | [phase-04-editing-mode](phase-04-editing-mode/overview.md) | 03 | The operation-log persistence decision, and its implementation if persistence is chosen | — |
| v0.1.1 | Planned | [phase-01-foundation](phase-01-foundation/overview.md) | 01 | Python package and NodeJS service skeletons, module test harness | — |

The **Milestone** column is the version's ordinal within its phase, and a `fix`
inherits the ordinal of the version it fixes. It is not the phase's own `MNN`
identifier: those are owned by each phase's `milestones.md` — for this repository
that is [phase-01](phase-01-foundation/milestones.md),
[phase-02](phase-02-simulation-core/milestones.md),
[phase-03](phase-03-service-and-ui/milestones.md) and
[phase-04](phase-04-editing-mode/milestones.md).

## Completed versions and their qualifications

`v0.4.1` — phase 04, its second version: real-time collaboration on the editing
document. Presence (cursor, selection and view point) travels on the event stream
and is never persisted; concurrent transactions merge in the service's commit
order and every client converges on the same version and hash; cross-author undo
names its transaction and never overwrites a cell a later author wrote; and the
per-cell attribution is compacted when a transaction leaves the retained window.
Its record is [dev-log/v0.4.1.md](../../dev-log/v0.4.1.md). The qualification
carried there: undo depth equals the 1000-transaction retained window (VWR-38),
presence can look alive for up to 30 s after a tab disappears (VWR-37), and a
silently missed `patch` event is noticed only when the next version skips
(VWR-39). Tokens, roles and the operation-log persistence decision are the
phase's later milestones, still Planned.

`v0.4.0` — phase 04, its first version, and the one that delivers the
single-machine editing mode: the core's atomic `patch`, the versioned document
with its hash chain, enter/leave with pause and resume, the transaction,
undo/redo and resync routes, the page's gesture-to-transaction tools, the
content-addressed snippet library with drafts and publish, and the selection,
transform and overwrite/merge controls. Its record is
[dev-log/v0.4.0.md](../../dev-log/v0.4.0.md). The qualification carried there:
a selection draft lives in browser storage and publication is explicit; the world
is paused while the mode is open, so editing a running world is a later feature;
collaboration, roles and operation-log persistence are the phase's later
milestones, still Planned.

`v0.3.7` — phase 03, its seventh version, and the one that closes the phase's
milestone 07 acceptance: undo of the last cell edit, discoverability, saving and
loading without a command line, and the four items this version was introduced for
(C12, the session cap and queue, the shareable view point, and the capabilities
seam). Its record is [dev-log/v0.3.7.md](../../dev-log/v0.3.7.md). One
qualification is stated there and belongs here: undo covers **cell edits only** —
a placed pattern and a clear are not reversible by that control, which is recorded
as VWR-36 — and the server-side shared view point that joint operations will need
is left to the editing mode, as the request directed.

`v0.3.6fix1` — the fix for `STO-19`, the one defect the store register reported as
unowned. Its record is [dev-log/v0.3.6fix1.md](../../dev-log/v0.3.6fix1.md), and
its scope is a copy-then-repair path rather than a change to the refusal: a
damaged store is still refused in place, and `salvage` repairs a copy. There is no
qualification beyond its SQLite-only scope, which the interface states.

`v0.3.6` — phase 03, its sixth version. Its exit condition is that more than one
session runs at once, that a pattern library can be placed by name, and that the
storage is chosen from the measured shape; that record is
[dev-log/v0.3.6.md](../../dev-log/v0.3.6.md). Two qualifications are stated there
and belong here. **C12 is not satisfied**: a representation switch still starts a
new recorded session, so the timeline restarts at the carried generation; that work
is task `T59` and it is owned by v0.3.7. And the **automatic storage boundary**
(density 0.05) is a chosen value between two measured anchors and is not itself
measured, which is [../model/viewer/risks.md](../model/viewer/risks.md) VWR-32.

`v0.3.0` — phase 03 milestone 00. Its exit condition is that the page is usable
in Chinese and English with no string outside the catalogue, that every shared
value has one declaration point, that the stylesheet has no rule which fails to
apply, and that a recorded run can be rolled back from the page; that record is
[dev-log/v0.3.0.md](../../dev-log/v0.3.0.md). One qualification is stated there
and belongs here: a representation switch starts a new recorded session, so the
timeline restarts at the generation carried over. That is owned by the next
version rather than hidden.

`v0.2.2` — phase 02 milestone 02. Its exit condition is that a session survives
its process and can be rolled back, that the representation is chosen from the
interface, and that the browser behaviour has been executed by a test; that
record is [dev-log/v0.2.2.md](../../dev-log/v0.2.2.md). One qualification is
stated there and belongs here: the **MySQL round trip is not verified**, because
no MySQL server exists in this environment. The schema, the SQL and the
parameter translation are verified; no generation has been written to or read
from a MySQL server by this project.

`v0.2.1` — phase 02 milestone 01. Its exit condition is that the frontier shows
the new representation winning at the densities the target scale implies and
names the shape where it does not; that record is
[dev-log/v0.2.1.md](../../dev-log/v0.2.1.md). Criterion B6/B7 are `Validated`
there with one qualification the record states plainly: the target-scale figures
are arithmetic projections from a 1024 x 1024 ladder, they are quoted for both a
compact and a diffuse population because the two differ by two orders of
magnitude, and the ladder has never been run at the target.

`v0.2.0` — phase 02 milestone 00. Its exit condition is that every criterion in
[phase-02-simulation-core/acceptance.md](phase-02-simulation-core/acceptance.md)
holds with a recorded command and observed result; that record is
[dev-log/v0.2.0.md](../../dev-log/v0.2.0.md). Criteria B1–B8 are `Validated`
there, with one qualification the record states plainly: B7 is satisfied in the
sense that the unclosed performance gap names its closing candidate and its
owning version, not in the sense that the gap is closed.

`v0.1.0fix1` — phase 01 milestone 00. Its exit condition is that the routine
gate set and the version-boundary gate set both pass through one command, and
that the measurements that motivated the fix are reproducible; that record is
[dev-log/v0.1.0fix1.md](../../dev-log/v0.1.0fix1.md).

`v0.1.0` — the parent of that fix. Every criterion in
[phase-01-foundation/acceptance.md](phase-01-foundation/acceptance.md) held at
its revision; that record is [dev-log/v0.1.0.md](../../dev-log/v0.1.0.md) and
criteria A1–A11 are `Validated` there. Marking a version `Complete` records
that the evidence exists; it does not assert that an independent review has
happened.

## Children

`v0.1.0` has no children. Slice-version children may only be introduced while a
three-component parent is still `Planned`
([docs/DOCUMENTATION_RULES.md](../DOCUMENTATION_RULES.md) §6); `v0.1.0` is not
`Planned`, so no children may be added to it. `v0.1.0fix1` is a `fix` on that
completed parent, not a child of it: a fix may attach to a completed
three-component parent, and it does not substitute for a pre-planned child.

## Superseded identifiers

None.

## Correction log

| Date | Version | Change | Reason |
|---|---|---|---|
| 2026-10-08 | v0.1.0 | Version introduced | Phase 01 milestone 00 started |
| 2026-10-08 | v0.1.0 | State `In Progress` → `Complete` | Every acceptance criterion validated; evidence in the version's dev-log entry |
| 2026-10-08 | v0.1.0 | Baseline commit amended and tag moved | The cold-clone criterion A11, added after the first tag, found two defects (bootstrap aborted on a clean checkout; declared cache paths were bound to one checkout). Both are fixed in the delivered revision, so the tag names it. No remote exists, so no copy of the earlier tag survives. |
| 2026-10-10 | v0.1.0fix1 | Version introduced | Verification was reported as taking too long and being too complex. Measurement found three causes: the gate self-test suite spent 98% of its 28.3 s in process plumbing, the tool build invoked the build system unconditionally, and the isolation check re-derived its exclusion on every run, which had begun to produce a false failure. The single gate runner was delivered here rather than in v0.1.1. |
| 2026-10-10 | v0.2.0 | Version introduced | Phase 02 started: the world representation, rule evaluation, the line protocol and the first interactive viewer. The frontier measurement found that the shipped representation does not scale to the target at realistic density; the gap is recorded and owned by v0.2.1. |
| 2026-10-10 | v0.2.0 | State `In Progress` → `Complete` | Every acceptance criterion validated; evidence in the version's dev-log entry. Criterion B7 is recorded as satisfied by naming the gap's closing candidate and owning version, not by closing the gap. |
| 2026-10-10 | v0.2.1 | Version introduced | Phase 02 milestone 01: the tiled bit-parallel representation named by ADR 0009 as the closing candidate for the scalability gap, plus the two viewer interface changes asked for. The push transport moved to v0.2.2 rather than being dropped, and shape-aware representation selection was added there because the measurement showed the two representations win on different shapes. |
| 2026-10-10 | v0.2.1 | State `In Progress` → `Complete` | Every acceptance criterion validated; evidence in the version's dev-log entry. The target-scale projection is recorded for both a compact and a diffuse population, because this version's first draft quoted only the compact one and overstated the result by two orders of magnitude. |
| 2026-10-10 | v0.2.2 | Version introduced | Phase 02 milestone 02: a history layer with rollback and archives, a store whose schema is rendered for SQLite and MySQL, a push transport, a representation the interface can choose, and browser coverage. MySQL was requested by name but is absent from this machine, so the schema is defined once and both dialects render it: SQLite is the verified default, and the MySQL round trip is an owned open item rather than a claim. |
| 2026-10-10 | v0.2.2 | State `In Progress` → `Complete` | Every acceptance criterion validated; evidence in the version's dev-log entry. The store's declared connection settings were found not to have taken effect and were fixed inside the version, so the crash-safety claim this record makes is now checked rather than asserted. The MySQL round trip remains unverified and is named as such. |
| 2026-10-10 | v0.3.0 | Version introduced | Phase 03 started. The comparison against the previous phase's page found three classes of accumulated cost: an English-only surface, limits copied into the client that the core would refuse, and style rules that applied to some controls and not their siblings. Each is a claim in this version rather than a cleanup that happened on the way past. |
| 2026-10-10 | v0.3.1 | Version introduced | Phase 03 milestone 01, named now so that the timeline truncation a representation switch causes has an owner rather than being a known defect with no home. |
| 2026-10-10 | v0.3.0 | State `In Progress` → `Complete` | Every acceptance criterion validated; evidence in the version's dev-log entry. The audit this version began with found five duplicated values and two style rules that did not apply where they appeared to; each is now either single-sourced or recorded with its reason. A defect that made a recorded chain unreplayable after an edit was found by the store's own replay validation, and a leak that left an orphan core holding the history database was found by counting processes. |
| 2026-10-10 | v0.3.1 | Version introduced | Phase 03 milestone 01, redefined when the request arrived: the history becomes a tree so that looking at an older state and then editing keeps the older work and shows a second branch, and the interface gains a panel that can get out of the way, tablet gestures, and archive management. The milestone's previous content moved to milestone 02 rather than being dropped. |
| 2026-10-10 | v0.3.2 | Version introduced | Phase 03 milestone 02, named when the redefinition moved multi-session support, the pattern library and automatic representation choice out of milestone 01. |
| 2026-10-10 | v0.3.3 | Version introduced | Phase 03 milestone 03, named for the same reason: undo, discoverability and saving without a command line. |
| 2026-10-10 | v0.3.1 | Schema version 1 → 2 | A generation's identity moved from its `(session, generation)` pair to its own row, because a fork is exactly two nodes that share a number and the old key could not express one. The migration rebuilds the tables and reconstructs the parent links from the generation order, so an existing linear history becomes a chain in the new model rather than being refused. |
| 2026-10-10 | v0.3.1 | State `In Progress` → `Complete` | Every acceptance criterion validated; evidence in the version's dev-log entry. Four semantics were forced by failing tests rather than designed up front and are recorded there: recording appends, reading and working on a generation are separate operations, amending the tip is not a branch, and a generation number is a label rather than an identity. Its dev-log also records that `rollback` and `select` are deliberately different and that three test expectations changed to stop encoding the truncating behaviour this version removes. |
| 2026-10-10 | v0.3.2 | Version introduced, and the milestones after it renumbered | The request was about the interface: a duplicated heading, the archives in the wrong place, tabs with their own routes, and a history tree that must not indent a linear run off the edge. That is its own milestone, so milestone 02 became the routed interface, and the multi-session work that had been planned for it moved to milestone 03 with a version of its own rather than being dropped. |
| 2026-10-10 | v0.3.2 | State `In Progress` → `Complete` | Every acceptance criterion validated; evidence in the version's dev-log entry. Its dev-log records the mistake this version exists to correct as well: the first attempt at the split was reverted while it was green, from a gate run that raced with its own writer — two independent errors, either of which alone would have been recoverable. |
| 2026-10-10 | v0.3.3 | Version introduced | Four complaints about the interface — a history that did not read as a tree, rows that overlapped, one row filling the screen, and a wasted pane — plus two defaults asked for by measurement: a view spanning the canvas width divided by sixty, and a preview centred on the live cell nearest to where the main view was. The multi-session work planned for this milestone moved to a version of its own rather than being dropped. |
| 2026-10-10 | v0.3.3 | State `In Progress` → `Complete` | Every acceptance criterion validated; evidence in the version's dev-log entry. Three things belong in this log rather than only in the entry. **The four defects were mechanics, not looks**: a fixed-track grid with the status marks appended as extra grid items, a full-width row in a page that had only one column, a detail panel revealed by animating a width *inside* the flow, and indentation that was a fourteen-pixel padding shift — all of them present while the suite was green at 255 cases, which is the third time this module was wrong in a way only a person could see. **One request was self-contradictory as relayed** — "the canvas width divided by sixty" and "sixty cells across" cannot both hold — and the person who asked for it confirmed the formula; the contradiction was the relaying agent's, and the choice is now theirs on the record. **The documentation had been asserting three constants this version deleted** (`DEFAULT_SPAN`, `DEFAULT_ASPECT`, `DEFAULT_SUBSCRIPTION`), in five places and five different ways; a document describing an implementation that no longer exists is worse than a missing one. |
| 2026-10-10 | v0.3.3fix1 | Version introduced and completed | Four defects found by using the interface in a real browser, each measured before it was changed: a canvas that was never painted and composed black because the context was opaque, a pointer capture taken on the list so a row's click never ran, an overlay that widened the container it is scrolled in and made a scrollbar appear under the pointer, and that same overlay drawing an opaque box over a label. Two of the four are layout self-feedback and stacking, which the module's assertions cannot reach by construction — the distinction the risk register had been describing since v0.3.0. |
| 2026-10-11 | v0.3.4 | Version introduced and completed | The preview opens on the current generation, which is a design change the person who uses the interface chose after the four defects were fixed, and the probe that found those defects became a tool so the measurement survives a clean checkout. The automatic preview deliberately does not select: a page load must not be recorded as a choice, or history would branch from a generation nobody picked. |
| 2026-10-11 | v0.3.4 | A gate gained a third state | A gate that cannot run is now reported as not run rather than as a pass. The browser probe is the reason: a machine without a browser cannot run it, and a tick it did not earn is worse than a known gap. This is the same failure the repository has been correcting in its own records all along, applied to the gate runner itself. |
| 2026-10-16 | v0.3.5 | Version introduced and completed | A rule editor, which turned out to be a change to the simulation rather than a control: the tiled representation did not evaluate Conway's rule, it *was* that rule folded into bit operations, so an arbitrary rule required the core, the protocol, the recorded history and the interface together. |
| 2026-10-16 | v0.3.5 | `B0` rules are refused by the two local representations | A rule with zero in its birth set means every dead cell with no live neighbours is born, which is every dead cell in the world, and at the design scale neither `sparse` nor `tiled` can carry it. `sparse` had been **answering silently and wrongly** — 39 live cells where the oracle gives 63 on an 8×8 world — and now refuses, while `dense` still runs it. This is the version's only outward behaviour change, and it is a change from a silent wrong value to an exception. Found by the cross-representation test, not by a report. |
| 2026-10-16 | v0.3.5 | A bound this project had relayed was false, and is now measured | The claim that no rule compiles to more than sixteen word operations had been repeated as exhaustively verified over all 262144 `(birth, survive)` pairs. It was never measured: sixteen is the bound **per set**, and the measured per-rule worst case is **twenty-four** (`B13578/S0246`), with 124240 pairs above sixteen. The code's docstring said otherwise and so did this project's own reporting. A case now compiles all 262144 pairs and asserts the measured number, so the claim cannot rot again. |
| 2026-10-16 | v0.3.5 | The isolation gate stopped counting other programs' writes | The dynamic phase counts anything written to the system temporary directory during its window, which made it fail on files written by the machine's own browser and remote-desktop client. It now admits three producers **by name**, each with the reason it is not ours, and still reports what it saw: a run says how many files changed and that none were ours. A list of named producers, not an amnesty — and one that had to be widened once, after a browser temporary failed the gate twice on an unchanged tree. |
| 2026-10-16 | v0.3.5fix1 | Version introduced and completed | The schema 2 → 3 migration crashed on a real store with `too many levels of trigger recursion`, so the core died on start-up and the interface was unusable. The cause is that `lifegame_generation.parent_id` is a **self-referential** foreign key with `ON DELETE CASCADE`, and dropping a table under foreign-key enforcement performs an implicit delete whose cascade SQLite implements as an internal trigger, walking the chain one level per row; the measured threshold is a chain of 1000, which is `SQLITE_MAX_TRIGGER_DEPTH` at its default. The rebuild now follows SQLite's documented order with enforcement off outside any transaction and read back, a key check before committing, and enforcement restored in a `finally`. |
| 2026-10-16 | v0.3.5fix1 | Why the suite could not have caught it, for two independent reasons | The schema-2 fixture was four nodes deep, **and its hand-written DDL omitted the foreign keys entirely** while the schema that shipped declared them. The second is the one to keep: a fixture written by hand drifts from the thing it stands for, and the drift is invisible because the fixture passes. It now declares the real keys. |
| 2026-10-16 | v0.3.5fix1 | Two further defects found while fixing this, both left open with owners | `Session.truncate_after` **destroys a sibling branch**: with nodes `[1,2,3,4,5]`, a working point on `1 → 2 → 3 → 5` and node 4 a live sibling under node 2, `truncate_after(0)` takes node 4's history with it, which its own docstring promises not to do. And the cascade limit is not about dropping tables — `DELETE FROM lifegame_session` on a deep store raises the same error, so any future session deletion meets it. Neither is the reported defect, and folding a data-loss bug into an emergency fix is how the fix stops being reviewable. |
| 2026-10-19 | v0.3.5fix1 | Current version corrected from `v0.3.0` to `v0.3.5fix1` | The heading had not been advanced since `v0.3.0` although eight versions completed after it, so the file's own heading and its version table disagreed. The heading is advanced at each version's completion; the last completion was v0.3.5fix1. |
| 2026-10-19 | v0.3.6 | Version introduced | Its first item is the truncation defect STO-17 that v0.3.5fix1 left open with an owner: the call removed the head's own path, but the declared `ON DELETE CASCADE` removed a sibling branch with it. A truncation now keeps a branch it was not asked to discard, rewriting the survivor as a keyframe so it stays replayable. The rest of the version's scope is unchanged. |
| 2026-10-19 | v0.3.5 | VWR-28 closed in the record | The rule editor's button on a fresh page was fixed and verified inside v0.3.5 — dev-log F42 records the fix, and the browser probe passes against the same press — but the module's risk register, overview, interfaces, implementation and testing section still presented it as an open defect. The record now states the fix and keeps the failing run as its evidence. |
| 2026-10-19 | v0.3.6 | The Milestone column's meaning is stated, and the completed-versions heading no longer implies currency | A milestone number of 06 or 07 could be read as the phase's own `MNN` although it is the version's ordinal within the phase, and "Completed through" read as the repository's completed state rather than as the qualifications that section states for completed versions. Neither changes any version state. |
| 2026-10-19 | v0.3.6 | State `In Progress` → `Complete` | Every criterion this version names is judged by a case in its dev-log, with two qualifications stated there and carried here: C12 (a switch does not truncate the timeline) is deferred to v0.3.7 as T59, and the automatic storage boundary is a chosen value between two measured anchors rather than a measurement. |
| 2026-10-19 | v0.3.6fix1 | Version introduced and completed | STO-19 had been unowned since v0.3.5fix1 found it. A fix attaches to a completed three-component parent, and v0.3.6 is the current one, so the ownership decision is recorded here rather than left as a defect in the register. The fix is `salvage`: copy the damaged SQLite store with `VACUUM INTO`, open the copy with `repair_dangling=True`, clear the links and report the row ids, and never write to the source. |
| 2026-10-19 | v0.3.7 | Version introduced | The request was to close C12, cap the session count at 64 with a waiting queue the page reports, make the remembered view point shareable across sessions, and leave a seam for an editing mode that is still being planned — one that may be a web page or an API client. The version's milestone-07 scope (undo, discoverability, saving without a command line) is unchanged and remains open. |
| 2026-10-19 | v0.3.7 | State `In Progress` → `Complete` | Every criterion this version names is judged by a case in its dev-log: C12 (switch continuity), C13 (undo), C14 (controls name themselves, with the walkthrough), and C15 (save and load through the archive). The queue bound was set at 1024 after the first delivery, and a creation beyond it is refused with `session_queue_full`. Two qualifications are carried in the completed-versions section: undo covers cell edits only, and the server-side shared view point belongs to the editing mode. |
| 2026-10-19 | v0.4.0 | Version introduced as Planned | The project owner asked for an editing mode after the observation surface was complete. The requirements and the twelve scoping answers are in [phase-04/design.md](phase-04-editing-mode/design.md); the decisions are [ADR 0012](../adr/simulation-core/0012-atomic-patch-in-the-core-protocol.md), [0013](../adr/service-and-api/0013-editing-is-a-versioned-document.md) and [0014](../adr/data-and-formats/0014-snippets-are-content-addressed-objects.md). No work has started. |
| 2026-10-19 | v0.4.1 | Version introduced as Planned | Real-time collaboration is the second milestone of the editing mode: presence, merging of concurrent transactions, and global undo across authors. No work has started. |
| 2026-10-19 | v0.4.2 | Version introduced as Planned | Tokens and roles are the third milestone: the permissions the owner asked for once the mode is shared. No work has started. |
| 2026-10-19 | v0.4.3 | Version introduced as Planned | Operation-log persistence is the fourth milestone, contingent on its own first decision: the log may stay in memory. No work has started. |
| 2026-10-19 | v0.4.0 | State `Planned` → `In Progress` | T69 (the core's atomic `patch`), T74 (the content-addressed snippet store with its four routes), and the edit document module (transactions, version and hash chain, merge, undo attribution, resync window) are in the tree. The edit routes, the page tools, the snippet palette, E1–E9 and the dev-log are not; the version stays open and untagged. |
| 2026-10-19 | v0.4.0 | State `In Progress` → `Complete` | Every M00 criterion E1–E10 is judged by a case recorded in [dev-log/v0.4.0.md](../../dev-log/v0.4.0.md): pause and resume, one gesture as one transaction, refusals with nothing changed, undo and redo, a saved selection and a published snippet, overwrite and merge and the transforms, the page and the API on the same routes, and the version/hash chain with its resync. The version is tagged v0.4.0; the phase's later milestones (collaboration, roles, persistence) were still Planned at that commit. |
| 2026-10-19 | v0.4.1 | State `Planned` → `Complete` | M01 is delivered and its criteria E11–E13 are judged: two clients merge and converge, a cross-author undo keeps a later author's cell, and the resync path answers patches inside the window and full state outside it. Presence is included because the milestone names it; it is not an acceptance criterion. The dev-log records the bounded undo depth and the presence TTL as qualifications. |
