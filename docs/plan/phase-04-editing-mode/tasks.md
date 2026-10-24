# Phase 04 tasks

Status: Partially Implemented
Version state: [../VERSIONS.md](../VERSIONS.md)

The tasks below are delivered by the version naming their milestone in
[../VERSIONS.md](../VERSIONS.md). `M00` and `M01` are implemented; `M02` and `M03`
are Planned. Task identifiers continue the repository's sequence and are not
restarted per version. The milestone that owns a task is named in its heading.

## M00 — single-user editing and snippets

State: implemented.

| Id | Task |
|---|---|
| T69 | Add the core's atomic `patch` command: validate `born`, `died` and `expectGeneration` before applying anything, apply all of it, record one edit, and reply the counts. Document it in the world's protocol and cover it with core tests, including a refused patch that changes nothing. |
| T70 | Add the edit runtime to the service: enter/leave with pause and resume, the document version, the content hash, the transaction chain and the author field. |
| T71 | Add `POST /api/edit/transaction`: serialise per session, recompute `born`/`died` at commit time, apply through `patch`, append the transaction, and broadcast a `patch` event. |
| T72 | Add the edit surface to the page: explicit enter/leave, tools, gesture-to-transaction commit, and the transaction state. |
| T73 | Add selection and region save: selection geometry, the region read from the core, the 256 x 256 and 8192 limits, and the local draft store. |
| T74 | Add the snippet library: content-addressed objects under `data/snippets/`, `index.json`, publish with a pinned hash, list, read, delete, and name validation. |
| T75 | Add the snippet controls: palette with canvas thumbnails, draft save, publish, transform controls, `overwrite`/`merge` mode, and the placement preview. |
| T76 | Add undo and redo over the session transaction stack, with per-cell attribution and the inverse-transaction rule. |
| T77 | Add resynchronisation: the patch window, `GET /api/edit/state?since=`, the full-state fallback and the page's resynchronising state. |
| T78 | Add the M00 verification: core patch cases, service transaction cases, page tool cases, and the acceptance cases E1–E9 recorded in the dev-log. |

## M01 — real-time collaboration

State: implemented.

| Id | Task |
|---|---|
| T79 | Add presence over the event stream: cursor, selection, view point, with throttling and no persistence. |
| T80 | Merge concurrent transactions: the rebase rule for absolute intents, the `stale_base` refusal, the deterministic same-cell order, and convergence cases with two clients. |
| T81 | Extend undo across authors: attribution, "last writer" skipping, the visible author of an undo, and the compaction of old attribution entries. |
| T82 | Add the collaboration verification: two-client cases for different cells, an overlapping overwrite, an undo by another author, and a stale client's resynchronisation (E11–E13). |

## M02 — tokens and roles

State: Planned.

| Id | Task |
|---|---|
| T83 | Add the edit token: transport, validation, and the refusal of a missing or wrong token on the mutating routes. |
| T84 | Add roles and permission checks: observer, editor, owner; committing, undoing another author's transaction, publishing, deleting, and entering the mode. |
| T85 | Add the audit trail: who committed and who undid what, readable by the owner, with the named refusals. |

## M03 — operation-log persistence

State: Planned.

| Id | Task |
|---|---|
| T86 | Decide whether the operation log is persisted; record the decision and its reasons in the ADR for the storage format. |
| T87 | If persistence is chosen, implement the format, the write path, the replay to the document hash, and the relation to the session archive. |
