# Phase 04 acceptance criteria

Status: Partially Implemented
Version state: [../VERSIONS.md](../VERSIONS.md)

Each criterion below is **Planned** and will be judged by the case named in its
row, with the command and the observed result recorded in the delivering
version's dev-log. A criterion whose case has not run yet is not satisfied, and
this file says so by the absence of a judged note.

## M00 — single-user editing and snippets

| Id | Criterion | Will be judged by |
|---|---|---|
| E1 | Entering the mode will pause a running world, and leaving will restore the run state it had | a page case with a running stub: enter, observe paused, leave, observe running |
| E2 | One gesture will commit exactly one transaction, and one transaction will record one edit with the generation unchanged | a store case: a stroke, one amended history node, the same generation, and one committed transaction |
| E3 | An out-of-bounds or oversized transaction will be refused with no cell changed | a contract case: the patch primitive refuses before applying, and the service returns the named code |
| E4 | A refused transaction will be visible with the code's words and will change nothing | a page case: a `too_large` refusal, the message, and the unchanged readout |
| E5 | Undo will restore the previous state of the cells the transaction touched, and redo will re-apply the intent | a case: place, undo, redo, assert the exact cell sets and the document hash |
| E6 | A saved snippet will equal the region's live cells, with the box limits enforced | a service case against a real core: save a region, compare the cell set, refuse a selection above the limits |
| E7 | Publishing will write a content-addressed object and an index entry, and a re-publish of a different content under the same name will be refused | a service case: publish, list, read by hash, attempt a silent overwrite, observe the refusal |
| E8 | `overwrite` will make the box exactly the source shape, `merge` will only light the source's cells, and a transform will produce the exact rotated or flipped set | a contract case and a service case: the born/died sets for both modes and for every transform |
| E9 | The page and an API client will drive the same transaction and snippet routes | an end-to-end case: the same transaction committed through the page's route and through a direct request produces the same document hash |
| E10 | The document version and hash will advance with every commit, and a client's hash will match the server's after it applies the patch | a case: version increments by one, the hash equals the server's, and an induced mismatch triggers resynchronisation |

**E1–E10 are judged** by `v0.4.0`: the cases and the observed commands are in
[dev-log/v0.4.0.md](../../../dev-log/v0.4.0.md). The page suite records the mode,
the one-gesture transaction, the refusal, the selection draft and the palette
stamp; the server suite records the pause and resume, the fill and merge
transactions, the one-history-edit rule, and the version/hash chain.
## M01 — real-time collaboration

| Id | Criterion | Will be judged by |
|---|---|---|
| E11 | Concurrent transactions on different cells will both survive; an overlapping overwrite will resolve to one state on both clients | a two-client case: different cells, then an overlap, with both views compared cell by cell |
| E12 | A global undo will be seen by both clients, and a cell written after the undone transaction will keep its newer value | a two-client case: A commits, B writes the same cell, A undoes, both compare and the newer value is asserted |
| E13 | A stale client will resynchronise from its version while the window covers the gap, and by full state outside it | a case with a deliberately truncated window and a hash mismatch: incremental and full paths asserted |

**E11–E13 are judged** by `v0.4.1`: a real-core case commits overlapping
transactions from three authors, asserts that both event streams see the same
version and hash, and that an undo named by `txId` keeps a later author's cell;
the membership of the undo stack is bounded by the retained window and asserted
in the model suite. The commands and results are in
[dev-log/v0.4.1.md](../../../dev-log/v0.4.1.md).

## M02 — tokens and roles

| Id | Criterion | Will be judged by |
|---|---|---|
| E14 | An observer will not be able to mutate, an editor's rights will stop at the owner's content, and every refusal will have a named code | a case per role and per refused action, with the code asserted |
| E15 | The audit will answer who committed and who undid what | a case: two authors and an undo, read back through the audit surface |

## M03 — operation-log persistence

| Id | Criterion | Will be judged by |
|---|---|---|
| E16 | The persistence decision will be recorded with its reasons, and if persistence is chosen a reopened chain will replay to the same document hash | the decision record, or a replay case whose final hash equals the committed hash |
