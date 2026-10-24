# Plan for the version naming phase 02 milestone 02

> The version identifier and its state are owned by
> [../../../VERSIONS.md](../../../VERSIONS.md); this file owns only the plan for
> delivering it.

## Claim

Phase 02 milestone 02 ([../../milestones.md](../../milestones.md)): make a
session outlive the process that produced it, let the interface choose how the
world is computed, stop the browser polling, and execute the browser behaviour
that until now was only inspected.

Four claims, and each is a different type: persistence and rollback are
**implementation plus verification**, the representation choice is
**interface**, the push transport is **protocol**, and the browser coverage is
**evidence for code that already shipped**.

## Why it is where it is

The previous version closed the scalability gap for clustered populations and
recorded what it did not close: nothing chose between the representations, and
the viewer kept polling. Both are only worth fixing once the world is worth
watching for a long time, which is what the history layer makes possible — a
session that can be rolled back and archived is what turns an interesting
pattern into something a person can work on.

## Approach

1. **Record diffs, not states.** A Life generation changes a small fraction of
   its population, so a delta is tens of bytes where a snapshot is eight bytes
   per live cell. A keyframe every
   `KEYFRAME_INTERVAL` generations bounds how far a rollback walks.
2. **Make the world report the change it already computed.** Both representations
   hold the previous and next state side by side while stepping, so naming the
   born and dead cells costs a mask comparison. Re-deriving it from two snapshots
   would cost a scan of the population per generation, which would make
   recording — the feature — the slow part.
3. **One schema, rendered twice.** SQLite is the default because it is in the
   standard library and keeps the history in the repository; MySQL is supported
   through the same schema with an optional driver. The decision, including what
   could not be verified here, is
   [ADR 0011](../../../../adr/data-and-formats/0011-sqlite-default-mysql-supported.md).
4. **Validate on replay.** A rollback replays deltas forward, checking that what
   it kills was alive and what it bears was dead. A corrupted chain is caught
   where it is corrupted rather than producing a world that looks plausible.
5. **Switch representation through the archive format.** Export the live set,
   start a core on the other representation, import it back — which is only
   lossless because `restore` sets the generation counter as well as the cells.
6. **Drive the page from a synthetic document.** No browser is available and no
   dependency may be added, so the drawing, gesture and polling paths are
   executed against a stub that records what the page asked it to draw.

## Risks that were live

| Risk | How it was handled |
|---|---|
| A rollback that silently restores the wrong generation is worse than one that fails | The requested generation must exist, and the replay validates every delta; a test forges a bad chain and one asks for a deleted generation |
| The stored coordinate layout could drift from the wire layout | Two independent encoders and a test that asserts they agree, rather than one shared helper |
| The MySQL path cannot be executed here | The schema rendering, parameter-marker translation and SQL generation are executed by tests that need no server, and the round trip is recorded as an open item with the command that would close it |
| A UI switch that loses the world would be worse than no switch | The round trip is tested through the real core on both representations, comparing the exported bytes before and after |

## Definition of done

* A session survives a reopen, can be rolled back to any recorded generation, and
  writes an archive that reads back identically.
* The world's shared contract gains `advance` and `restore`, both held to the
  same oracle as the rest of the world, including across representations.
* The representation is chosen from the page and the generation survives the
  switch.
* The page is driven by pushed events, with polling kept as a tested fallback.
* The drawing, gesture and polling paths are executed by tests.
* Every gate passes and the record is in `dev-log/`, including what could not be
  verified in this environment.
