# Phase 04 milestones

Status: Partially Implemented
Version state: [../VERSIONS.md](../VERSIONS.md)

Every milestone below is delivered by the version naming it in
[../VERSIONS.md](../VERSIONS.md); this file states no version numbers and no
version states. `M00` and `M01` are implemented; `M02` and `M03` are Planned. The
identifiers `M00`–`M03` are this phase's own; they are not the version ordinals in
`VERSIONS.md`.

## M00 — single-user editing and snippets

State: implemented.

**Contains.** The core's atomic `patch`; an edit document with a version, a
content hash and a transaction chain; enter/leave with pause and resume; the
tools (paint, erase, line, rectangle, fill, select, stamp, pan); transaction
commit and refusal; undo and redo; region save, local drafts, publish, and stamp
with transforms and `overwrite`/`merge`; incremental and full resynchronisation.

**Exit condition.** One person will be able to enter the mode, draw and place a snippet
repetitively, undo and redo, leave, and find the world and its history exactly
as the transactions left them; every mutation is a transaction; all criteria
`E1`–`E10` in [acceptance.md](acceptance.md) are judged.

## M01 — real-time collaboration

State: implemented.

**Contains.** Presence (view point, selection, cursor) over the existing event
stream; concurrent transactions merging by the server's absolute-write order;
`rebased` replies; global undo across authors with per-cell attribution; the
resynchronisation path used by a client that falls behind; the collaboration
cases `E11`–`E13`.

**Exit condition.** Two clients will edit one session at once, different cells both
survive, an overlapping overwrite resolves to the same state on both, an undo by
one is seen and explained by both, and a stale client resynchronises without
editing a version it does not hold.

## M02 — tokens and roles

State: Planned.

**Contains.** An edit token accepted by the edit and snippet routes; the roles
observer, editor and owner; permission checks for committing, undoing another
author's transaction, publishing, deleting, and entering the mode; an audit trail
of author, transaction and undo.

**Exit condition.** An observer will not be able to mutate, an editor will not be able to delete the owner's
snippets or another author's transactions without the role that allows it, every
attempt is refused with a named code, and the audit answers who changed what.

## M03 — operation-log persistence

State: Planned.

**Contains.** The decision on whether the operation log is persisted, and if it
is, its format, its storage, its replay and its relation to the session archive.

**Exit condition.** The decision will be recorded with its reasons; if persistence is
chosen, a session's edit chain will be reopened and replayed to the same document
hash, and the archive format says whether it carries operations, states, or both.

This milestone is contingent: its first work item is the decision, and the
decision may be that the log stays in memory.
