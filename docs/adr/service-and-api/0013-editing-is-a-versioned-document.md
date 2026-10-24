# ADR 0013 — Editing is a versioned document over a paused session

## Status

Accepted (2026-10-19), at the design level. Implementation is **Planned**: it will
be delivered by the versions naming phase 04 milestones 00 and 01 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md). The storage decision for
snippets is [0014](../data-and-formats/0014-snippets-are-content-addressed-objects.md);
the core primitive is [0012](../simulation-core/0012-atomic-patch-in-the-core-protocol.md).
The requirements and the owner's answers are in
[../../plan/phase-04-editing-mode/design.md](../../plan/phase-04-editing-mode/design.md).

## Context

The authoring surface the project needs is not a larger set of buttons. The
owner's answers fixed the shape: edit the current generation of the current
session (Q1), enter and leave the mode explicitly (Q2), treat one gesture as one
transaction (Q3), keep one session-global undo history (Q4), include shared view
and real-time co-editing (Q5), merge automatically in the manner of shared
documents (Q6), start without authentication on one machine and add tokens and
roles for collaboration (Q7).

Two constraints from the existing system decide the rest. The world's authority
is the core, and the service is a transport that must not grow a second world
model. And the world can be *running*: its generation advances under the client,
so a transaction measured against one generation can be stale before it is
committed.

## Decision

* **The mode is explicit and the world is paused while it is open** (Q2, and the
  owner's confirmation C1). Entering pauses a running world; leaving restores
  the run state it had. This removes the running world as a concurrent writer and
  keeps a transaction's generation stable for its whole life.
* **The edited thing is a versioned document.** Each edit session carries a
  monotonic `version`, a canonical content `hash`, and an ordered chain of
  transactions (`txId`, `author`, `baseHash`, operations, patch, resulting hash).
  The session id plus the version and hash are the "session number plus state
  number" the owner asked for (Q10, confirmed as C4).
* **A transaction carries intent, and the service computes the difference at
  commit time.** Operations are `paint`, `erase`, `fill`, `merge`, `clear` and
  `stamp`; a `fill` says "this box becomes this shape", not "these cells were
  born and these died when I looked". The service reads the authoritative region
  and computes `born`/`died` against the world it actually meets, then applies
  the core's atomic `patch`. Computing a difference is not simulating; the world
  model stays in the core.
* **Merge is server-serialised last-writer-wins over absolute writes** (Q6).
  Writes are assignments, not positional inserts, so operations on different
  cells commute; operations on one cell resolve by the order the server commits
  them, and that order is broadcast to everyone. A transaction whose base is
  behind is automatically rebased when every operation is an absolute intent, and
  refused with `stale_base` when it depends on stale content. This is the
  OT/CRDT family answer for a bounded cell grid, without per-cell tombstones
  growing without a bound.
* **Undo is a session-global stack of inverse transactions** (Q4). For each cell
  the undone transaction touched, the inverse restores the value from
  immediately before it, but only when that transaction is still the cell's last
  writer; a cell another author wrote since keeps the newer value. Redo
  re-applies the undone intent (C3). The undo is itself a transaction, so every
  client sees who undid what.
* **One committed transaction records one edit** (C2). The current generation's
  history node is amended and the generation does not move; running or stepping
  advances the generation as before.
* **Collaboration and permissions are the later milestones** (Q5, Q7): presence
  and concurrent merging in M01; edit tokens and the observer/editor/owner roles
  in M02. Until then the mode is reachable on the loopback address only.
* **Resynchronisation is by version**: a client applies broadcast patches while
  the server's window covers its gap, and takes full state outside it, with the
  cost declared. A client that cannot prove the same hash does not commit.

## Consequences

* The world is editable and observable but not both at the same instant. A
  person who wants to watch a run leaves the mode, and the mode says so by
  restoring the run state on exit.
* Undo is not time travel. A cell written after the undone transaction keeps its
  newer value; the interface names the author and the rule, and the acceptance
  criterion E12 asserts it rather than leaving it to a comment.
* The service now owns a real document: version, hash, transaction chain,
  attribution map and patch window. That is more state than the transport had,
  and it is the price of collaboration; the service still owns no rule and no
  next generation.
* The document hash is computed server-side from a canonical live-cell set. On a
  world with millions of cells a hash per commit is a real cost; the delivery
  version measures it and may make the hash incremental, which changes the
  implementation and not the contract.
* Absolute-write merging is deterministic but not intent-preserving in the way a
  text CRDT is. Two authors who both mean "add this shape" and overlap get the
  later shape, which is the rule the design chose; the alternative, a richer
  intent model, was rejected as more machinery than the product needs.
* Alternatives were rejected: a client-authoritative world (a second model), a
  service-owned simulation (breaches the authority rule), editing a running world
  (a tick becomes a third writer), per-client undo stacks (the owner asked for one
  history), full positional OT (the operations are absolute, so it buys nothing
  here), and storing edits as state diffs (loses intent, undo attribution and
  conflict explanation).

## Superseding

None. This ADR does not supersede
[ADR 0007](../service-and-api/0007-viewer-service-delivered-in-phase-02.md); it
adds an editing surface to the service that ADR 0007 placed in phase 02.
