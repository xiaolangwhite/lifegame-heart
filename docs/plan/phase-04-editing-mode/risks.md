# Phase 04 risks

Status: Partially Implemented
Version state: [../VERSIONS.md](../VERSIONS.md)

The risks below are read against the implemented part of the mode (M00 and M01)
and the planned part (M02 and M03). Each names who would own it and what would
remove it. The four questions that gated the design were answered by the project
owner on 2026-10-19 and are recorded in [design.md](design.md) §3; they are not
repeated here.

| Id | Risk | What makes it real | Effect | Mitigation now | Owned by |
|---|---|---|---|---|---|
| EDR-01 | **The service computes cell differences, which is close to owning a world model** | A template or fill implementation that grows into rule logic | Two sources of truth for the world | The core validates bounds and the generation and applies the patch; the service only turns an intent into `born`/`died` (design N1); a review of the boundary is part of T71 | the version delivering M00 |
| EDR-02 | **A per-cell attribution map grows with editing** | Long editing sessions with many touched cells | Memory growth and slower commits | Attribution is compacted when the oldest transaction leaves the retained window; the cost is that undo depth is the window (M01) | the version delivering M01, closed by the compaction and its case |
| EDR-03 | **Full-state resynchronisation of a huge world is expensive** | A client outside the patch window on a 65536 x 65536 world with a large population | A slow reply and a large socket | The window keeps the incremental path normal; the full path declares its reason and will be regioned with explicit progress (design §12) | the version delivering M00, measured before its bound is fixed |
| EDR-04 | **Undo does not mean "turn back time"** | A person expects undo to reverse later work too, or expects a rollback | Confusion about what was undone | The inverse-transaction rule skips cells another author has written and the interface names the author and the cells; the acceptance case E12 asserts the behaviour | the version delivering M01 |
| EDR-05 | **The atomic `patch` command is a protocol addition** | Any client that does not know it, or a partial implementation | The editor cannot commit; a half-applied patch is possible | `patch` is additive, validates before applying, and is covered by a refusal case that asserts nothing changed (T69, E3) | the version delivering M00 |
| EDR-06 | **Collaboration depends on the service being the only serialiser** | A second service, or a client writing the core directly while the service edits | Two orders, two document hashes | The design keeps one writable edit path and the document hash as the detection; a second writer is out of scope and named here rather than assumed away | the version delivering M01 |
| EDR-07 | **Snippet publishing has no owner until roles exist** | A name collision, a publish race, or a delete of a published object | Silent loss of a snippet | Publishing is refused unless the pinned hash matches; roles arrive in M02; until then the service stays reachable on the loopback address only (design §13) | the version delivering M02 |
| EDR-08 | **The limits are product choices, not measurements** | A transaction the 1 MiB body limit or the 8192-cell cap refuses although a person considers it reasonable | A feature that looks broken at the edge | The limits are named in the interface and the refusal carries `too_large`; the delivery version records the measured cases and may raise a limit by a recorded decision | the version delivering M00 |

## Decisions deferred to a named version

| Decision | Will be decided by |
|---|---|
| The patch-window size and the full-resync chunking policy | the version delivering M00 |
| Whether snippet version history is kept beyond the indexed hash | the version delivering M00 |
| The operation-log format, and whether it is persisted at all | the version delivering M03 |
| Token transport and the final role names | the version delivering M02 |
