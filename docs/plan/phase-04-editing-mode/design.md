# Editing mode — requirements and design

Status: Partially Implemented
Owner: the project owner
Version state: [../VERSIONS.md](../VERSIONS.md)
Decisions: [ADR 0012](../../adr/simulation-core/0012-atomic-patch-in-the-core-protocol.md), [ADR 0013](../../adr/service-and-api/0013-editing-is-a-versioned-document.md), [ADR 0014](../../adr/data-and-formats/0014-snippets-are-content-addressed-objects.md)

This document owns the requirements and the agreed design of the editing mode.
M00 (single-user editing and snippets) and M01 (real-time collaboration) are
implemented; M02 (tokens and roles) and M03 (operation-log persistence) are
Planned. The answers quoted in §3 were given by the project owner on 2026-10-19;
the four follow-up confirmations were given on the same day. Version state and
version scope are owned by [../VERSIONS.md](../VERSIONS.md), never by this file.

## 1. Why the mode exists

The simulation core already runs worlds of 65536 x 65536, records history, and
switches storage; the interface can observe a world well. **Authoring is the
bottleneck**, and the current interface exposes it only as single-cell clicks and
whole-pattern stamps at the centre of the view.

| Id | Pain point | What exists today |
|---|---|---|
| P1 | No bulk drawing | One click toggles one cell; there is no line, rectangle, fill, selection, move, rotate or flip |
| P2 | Patterns cannot be placed precisely | `POST /api/pattern` places at the centre of the view only |
| P3 | A bulk change is not atomic | The core's `set` can apply part of a request and report no changed cells; a half-applied fill is possible |
| P4 | Edits are not operations | History records states per generation, and an edit amends the current node, so the timeline cannot serve as an edit log |
| P5 | Undo is narrow | Only cell edits are reversible; a placed pattern or a clear is not, and there is no redo |
| P6 | Large regions are unworkable | No region selection, no region save, no coordinate jump, no defined "current region" |
| P7 | Programmatic editing has no contract | An API client forwards raw protocol commands and has to build transactions, bounds checks and retries itself |
| P8 | No collaboration | Sessions exist, but no shared view, selection, presence, conflict handling or roles |
| P9 | The mode is not discoverable | A person cannot tell whether a click edits or navigates; on touch the same ambiguity is worse |

The three missing layers behind the pain points are an **operation** (a
transaction with intent and a base version), an **edit session** (a document
that is versioned independently of the generation counter), and **editing as an
API** (one surface for the page and for programmatic clients).

## 2. Requirements

### Functional

| Id | Requirement |
|---|---|
| R1 | The mode will be entered and left explicitly. Entering will pause a running world; leaving will restore the run state it had. |
| R2 | Tools will cover paint, erase, line, rectangle, fill, selection, stamp and pan; one gesture will commit one transaction. |
| R3 | A transaction will be atomic. Out-of-bounds, oversized or stale content will be refused with no cell changed. |
| R4 | A document version and a content hash will advance with every committed transaction, and a transaction will carry the base version it was built against. |
| R5 | Concurrent transactions on different cells will merge; transactions on the same cell will resolve deterministically for every client. |
| R6 | Undo will be session-global and will create an inverse transaction; redo will re-apply the undone intent. |
| R7 | One committed transaction will record one edit: the current generation's history node is amended, and the generation counter does not move. |
| R8 | A rectangle of at most 256 x 256 cells and at most 8192 live cells will be saved as a snippet; snippets are drafted locally and published to a shared content-addressed library. |
| R9 | A snippet will be placed with `mode: overwrite` (the box becomes the snippet) or `mode: merge` (cells are only lit), with rotate and flip transforms. |
| R10 | The page and an API client will use the same transaction and snippet routes; the page will have no private editing channel. |
| R11 | Collaboration will add presence (view point, selection, cursor) and real-time co-editing; tokens and roles will gate who may edit, publish and undo. |
| R12 | A client that falls behind will resynchronise from its version while the server's patch window covers the gap, and by full state outside it. |

### Non-functional

| Id | Requirement |
|---|---|
| N1 | The world's authority stays in the core. The service will turn an operation into candidate cells and hand them to the core, which reports the cells that actually changed; neither the service nor the page will compute a next generation. |
| N2 | The viewer keeps **zero npm dependencies**; hashing is server-side, thumbnails are canvas rendering, and no build step is introduced. |
| N3 | The service and the page stay within the existing limits: 1 MiB request bodies, request timeouts, the 64-session cap and the bounded queue. |
| N4 | Every refusal will have a named error code and a message in both languages. |
| N5 | The mode will be testable from plain data: transaction application, merge, undo attribution, transforms and hashes will be asserted as values. |
| N6 | The design will not introduce a second stored format for the world; snippets are a new small format, not a second history store. |

## 3. The owner's answers and confirmations

The twelve scoping questions were answered on 2026-10-19 as follows.

| Id | Question | Answer |
|---|---|---|
| Q1 | What is edited? | a — the current generation of the current session, with no separate draft document |
| Q2 | Is the mode explicit? | a — explicit enter and leave |
| Q3 | What is one transaction? | b — one drag or one placement, with the continuous editing session as an optional outer concept |
| Q4 | Undo ownership | b — one session-global transaction stack that every client sees |
| Q5 | Collaboration scope | a + b + c — shared view and selection, real-time co-editing, and asynchronously shared content |
| Q6 | Conflict policy | b — automatic merge, modelled on shared-document editing (OT/CRDT family) |
| Q7 | Permissions | a on one machine; b once collaboration starts; c as the end state |
| Q8 | Snippet storage | c — local drafts plus a publish step into a shared directory |
| Q9 | Placement mode | c — both modes, overwrite by default, with `mode` explicit in the API and the UI |
| Q10 | Transforms and identity | transforms required; each session and each state carries its own number plus a hash chain, in the manner of a commit plus a working-tree hash |
| Q11 | Size limits | 256 x 256 cells and 8192 live cells per selection or transaction |
| Q12 | Snippet and pattern libraries | separate libraries: patterns are read-only data shipped with the viewer; snippets are user-authored and mutable by publishing a new version |

Four follow-up points were confirmed on the same day:

| Id | Question | Confirmation |
|---|---|---|
| C1 | Pause the world while editing | accepted |
| C2 | One transaction amends the current generation's node; running advances the generation | confirmed |
| C3 | Redo is required | confirmed |
| C4 | The version and hash interpretation of Q10 | confirmed — session id plus document version and hash; snippet name plus content hash, pinnable as `name@hash` |

## 4. The model

```
Session
 └─ EditDocument                     (one live session)
     ├─ version      monotonic edit sequence, independent of the generation
     ├─ hash         SHA-256 of the canonical live-cell set at that version
     ├─ generation   the core's generation; static while the mode is open
     ├─ transactions ordered committed chain (txId, author, baseHash, ops, patch, hash)
     └─ undoStack    session-global stack of committed transactions
```

An **operation** will carry intent, not a precomputed patch:

| Operation | Intent |
|---|---|
| `paint` | set these cells alive |
| `erase` | set these cells dead |
| `fill` | the box becomes the source shape: inside it, source cells alive and other cells dead |
| `merge` | the box only gets the source's live cells; nothing inside it is killed |
| `clear` | every cell in the box becomes dead |
| `stamp` | a `fill` or `merge` whose source is a pattern or a snippet, with an optional transform |

The service will turn an operation into the **candidate** cells it asks to be
born or dead, and the core will apply them atomically and answer with the cells
that actually changed. The document records that actual change. The core remains
the only place that knows which cells changed; the service computes no next
generation, and N1 keeps the boundary.

## 5. Authority split and the core's primitive

| Layer | Will own | Change |
|---|---|---|
| core | world state, rule, generation | one new command: `patch` with `born[]`, `died[]` and `expectGeneration`; it will validate every cell and the generation **before** applying anything, will apply all of it, will record one edit, and replies `{generation, population, bornCount, diedCount}` |
| service | edit session, version/hash chain, transaction queue, merge, undo stack, snippet library, presence, roles | the edit and snippet routes, the edit event stream, and the author model |
| page | tools, selection, local echo, preview, transforms | a routed edit page and its modules, with no world authority |

`patch` is the only protocol addition. It exists because the current `set` is
not atomic (P3) and because a transaction must record one edit (R7). ADR 0012
records the decision.

## 6. Transactions, versions and hashes

1. A client builds a transaction with a `txId`, a `baseVersion`, a `baseHash`
   and a list of operations, and may preview it locally.
2. The service serialises transactions per session. If the base is current, it
   commits; if the base is behind but every operation is an absolute intent, it
   recomputes the **candidate cells** at the current version and reports
   `rebased: true`; if an operation depends on stale content (for example saving
   a region), it refuses with `stale_base`.
3. The service applies the patch through the core's `patch`, updates
   `version` and `hash`, appends the transaction, and broadcasts a `patch` event
   with `born`, `died`, the new version, the hash and the author.
4. A client compares the broadcast hash with its own; a mismatch moves it to
   resynchronisation (R12).

The document hash covers the sorted live-cell coordinates, the world size and
the version, so two clients that hold the same world agree on one value. The
transaction chain is `hash = H(previous hash, txId, author, operations)`; it
gives integrity, a cheap staleness check, and the attribution undo needs.

## 7. Merge

The writes are **absolute** (these cells become alive or dead), not positional
inserts, so a full text-style OT is unnecessary:

* operations on different cells commute;
* operations on one cell resolve by **server commit order**, which is the same
  order every client receives;
* a `fill` is recomputed at commit time, so its overwrite intent is interpreted
  against the world it actually meets: inside its box the later commit wins, and
  outside the box nothing is touched.

The result is a last-writer-wins register per cell at transaction granularity,
serialised by the service. This is the OT/CRDT family answer for a bounded grid,
without per-cell tombstones growing without a bound. ADR 0013 records it.

## 8. Undo and redo

The undo stack is session-global (Q4). An undo appends an **inverse
transaction** rather than moving a head:

* for each cell the undone transaction touched, the inverse restores the value
  the cell held immediately before that transaction, **but only if that
  transaction is still the cell's last writer**;
* a cell another client has written since keeps the newer value, so undo never
  overwrites later work;
* the undo is a new transaction with its own author, so every client sees who
  undid what;
* redo re-applies the undone intent against the current world.

The service keeps a per-cell last-writer attribution map; entries older than the
oldest version every client has confirmed will be compacted.

## 9. Snippets

A snippet is an immutable value `{cells, width, height, contentHash}`. The name
is an index entry, the hash is the identity.

* **Save**: the service reads the selected rectangle from the core, refuses a
  selection above 256 x 256 or 8192 live cells, and returns the snippet value.
* **Draft** (Q8c): the page keeps drafts in browser storage; an API client holds
  its own content. A draft is not in the shared library.
* **Publish**: `POST /api/snippets` validates and writes the content-addressed
  object into `data/snippets/` and updates `index.json` (`name -> hash`).
  Republishing an existing name is refused unless the caller pins the expected
  hash; a new content hash can be referenced as `name@hash`.
* **Place**: a `stamp` operation names the source, an optional pinned hash, a
  transform (rotate 90/180/270, flip horizontal/vertical) and a mode
  (`overwrite` by default, `merge` optional). The service resolves the content
  and commits one transaction.
* **Libraries stay separate** (Q12): patterns remain read-only data shipped with
  the viewer; snippets are user data with their own lifecycle.
* A snippet's cell set is rule-agnostic: it is a shape, and the world's rule
  decides what it becomes when it runs.

ADR 0014 records the storage decision.

## 10. API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/edit` | GET | `{sessionId, editMode, running, version, hash, undoDepth, collaborators}` |
| `/api/edit/enter`, `/api/edit/leave` | POST | Enter (pausing a running world) and leave (restoring its run state) |
| `/api/edit/transaction` | POST | `{txId, baseVersion, baseHash, ops[]}`; reply carries the patch, the new version/hash and `rebased`; errors include `stale_base`, `out_of_bounds`, `too_large`, `not_editing` |
| `/api/edit/undo`, `/api/edit/redo` | POST | Inverse transaction and re-application on the session stack |
| `/api/edit/state?since=version` | GET | Incremental resynchronisation, or a full state with the cost declared |
| `/api/snippets` | GET, POST | List and publish content-addressed snippets |
| `/api/snippets/<name>` | GET, DELETE | Read (optionally `?hash=`) and delete an index entry |
| `/api/events` | SSE | Adds `patch`, `presence` and `edit-state` events to the existing stream |

`POST /api/pattern` will be expressible as a `stamp` transaction; it will remain
as a convenience for a non-editing page and will route through the same
transaction code, so there is one placement path.

Every mutation in the mode will be a transaction; no route will edit the world
outside one.

## 11. Interface behaviour

* Entering the mode pauses a running world and shows the edit surface: tools,
  selection, snippet palette, transaction state, collaborators. Leaving restores
  the run state.
* One gesture is one transaction (Q3): a stroke commits on pointer-up, a
  placement on confirm, a selection operation on release.
* The transaction state is visible: pending, committed with its version, or
  refused with the code's words. A refused transaction changes nothing.
* Undo and redo are controls and `Ctrl+Z` / `Ctrl+Shift+Z` (the platform's
  usual alternatives are accepted where they are unambiguous). `Escape` cancels
  the current gesture before it commits.
* Touch keeps the explicit mode: a tap edits, two fingers pan and zoom, so the
  tap/pan ambiguity of the observation page does not return.
* A stale client shows that it is resynchronising and blocks new transactions
  until it is current; it does not silently edit a different version.

## 12. Resynchronisation

The service will keep a bounded window of committed patches (the initial bound
is a configuration value, not a promise). `GET /api/edit/state?since=N` answers
with the patches after `N` while the window covers the gap, and with the full
live-cell set and a declared reason outside it. The full-state path will obey
the same region and response limits as any other large reply; a world too large
for one reply will be transferred by region with explicit progress.

## 13. Limits and safety

| Limit | Value | Behaviour beyond it |
|---|---|---|
| Selection and transaction box | 256 x 256 | refused `too_large` |
| Live cells in a transaction or snippet | 8192 | refused `too_large` |
| Request body | 1 MiB | refused `bad_request` |
| Patch window | configured; the delivery version fixes the value | full-state resynchronisation |
| Sessions | 64, queue 1024 (existing) | unchanged |
| Authentication | none on one machine (Q7a) | edit tokens from the collaboration version, roles after that |

## 14. Not in scope

* A separate draft document or a multi-document workspace (Q1a).
* Editing a world while it runs: the mode pauses it (C1).
* A second world model in the service or the page (N1).
* Text-style OT with positional operations; the model uses absolute writes (Q6).
* Server-side shared view points outside collaboration; the view point of one
  session is already shareable by `?focus=x,y`, and real-time sharing belongs to
  the collaboration milestone.
* A new npm dependency, a build step or a native component (N2).
* Persisting the operation log before its milestone decides the format (M03).

## 15. Decisions deferred to a named version

| Decision | Will be decided by |
|---|---|
| The patch-window size and the full-resync chunking policy | the version delivering [milestones.md](milestones.md) M00, measured before it is fixed |
| Whether snippet version history is kept beyond the indexed hash | the version delivering M00, from the first publish/republish cases |
| The operation-log format and whether it is persisted at all | the version delivering M03, which is contingent on this decision |
| Token transport (header or URL) and role names | the version delivering M02 |
