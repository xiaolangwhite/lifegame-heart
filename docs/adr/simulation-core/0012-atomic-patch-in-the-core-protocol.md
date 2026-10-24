# ADR 0012 — The core gains an atomic patch command for editing

## Status

Accepted (2026-10-19), at the design level. Implementation is **Planned**: it will
be delivered by the version naming phase 04 milestone 00 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md). The decision it serves is
[0013](../service-and-api/0013-editing-is-a-versioned-document.md).

## Context

The editing mode needs a unit of change that either happens completely or does
not happen at all. The core's existing `set` command does not provide one: it can
apply the cells it accepts and stop at the first out-of-bounds coordinate, and it
replies with a population and a count rather than the cells that changed. A
partially applied fill is not an edit a person can undo, record once, or merge
with another person's work.

Three more facts shape the decision.

**The service cannot become the transaction engine by itself.** It can validate a
request and send a compensating request after a failure, but a compensation is
not atomicity: between the failed `set` and the compensation the world has
already changed, and a second writer can observe the half-applied state. Only
the owner of the world can decide that nothing will be applied before everything
has been checked.

**Recording is part of a transaction.** The history records per generation; an
edit amends the current generation's node. An edit expressed as several cells
must become **one** recorded edit, not one record per cell, or the history's
generation nodes stop describing generations and start describing clicks.

**The observation surface must keep working.** The existing `set` and `toggle`
are used by the observation page and by other clients. Replacing or redefining
them would make an additive feature a breaking one.

## Decision

* **One new protocol command, `patch`**, with `born[]`, `died[]` and
  `expectGeneration`. It validates every coordinate, the size of the change and
  the expected generation **before** applying anything; then it applies all of
  it in one pass; then it records **one** edit; then it replies
  `{generation, population, bornCount, diedCount, born, died}`. The `born` and
  `died` arrays name the cells that actually changed, in application order, so a
  caller records the change that happened rather than the candidate it sent.
* **The command is additive.** `set`, `toggle` and `clear` keep their current
  meaning and their current tests. A client that does not know `patch` is
  unaffected, and the observation page keeps its behaviour until it moves onto
  transactions.
* **The caller sends candidates; the core filters and applies them.** The service
  turns an intent into the cells it asks to be born or dead; the core applies
  them atomically and answers with the cells that actually changed. The service
  never reads a region to compute the difference, and the core never learns what
  a "fill" or a "snippet" is. This keeps the world model in one place: the core
  is the only component that knows which cells actually changed.
* **A refused patch changes nothing**, and the refusal is a named error
  (`out_of_bounds`, `bad_arguments`, `stale_generation` or `too_large`) that the
  service can pass on without translating its meaning.

## Consequences

* The protocol gains a second way to write cells. The two are not equivalent:
  `patch` is atomic and carries a generation precondition, `set` is neither. The
  editing path will use `patch` exclusively; the protocol documentation states
  which command carries which guarantee rather than implying that the old one
  improved.
* The `expectGeneration` field makes a lost race detectable by the core instead
  of assumed away by the service. In the edit mode the world is paused, so the
  common case is a match; a running world is the case that the refusal protects.
* The history's "one edit, one record" rule depends on this command. If a later
  version wants several records per transaction, it changes the recording policy,
  not the atomicity guarantee.
* The cost is a second implementation of coordinate validation and cell writing
  inside the core. It is bounded by the same 8192-cell limit the service
  enforces, and the refusal case asserts that a bad coordinate leaves the world
  unchanged.
* Alternatives were rejected: making `set` atomic (changes existing semantics
  and still cannot record one edit or check a generation), a service-side
  transaction wrapper over `set` (a compensation is not atomicity), and leaving
  atomicity to the client (no client can make a remote world atomic).

## Superseding

None. This ADR does not change
[ADR 0008](../simulation-core/0008-the-world-is-bounded-and-does-not-wrap.md);
`patch` enforces the same bounds.
