# v0.4.0 plan — single-user editing and snippets

Status: Planned
Phase: [overview.md](../../overview.md)
Design: [design.md](../../design.md)
Version state: [../../../VERSIONS.md](../../../VERSIONS.md)

This plan covers the first version of the editing mode, milestone M00 in
[milestones.md](../../milestones.md). It is the version that proves the
transaction model with one person before collaboration, roles or persistence are
added.

## Claim

When this version is complete, a person can enter the edit mode, draw a shape,
place a saved snippet over a region in one atomic transaction, undo and redo it,
leave the mode, and find the world and its recorded history in exactly the state
the transactions produced. The same transaction and snippet routes will answer a
direct API client.

## Scope

The work items are T69–T78 in [../../tasks.md](../../tasks.md):

* T69 the core's atomic `patch`;
* T70 the edit runtime and the document version/hash chain;
* T71 the transaction route and the `patch` event;
* T72 the edit tools and gesture-to-transaction;
* T73 selection and region save;
* T74 the snippet library and its index;
* T75 the snippet controls, transforms and modes;
* T76 undo and redo;
* T77 resynchronisation;
* T78 the verification and the acceptance record.

## Approach

1. **Core first.** The `patch` command is the only protocol addition and every
   later case depends on it; it lands with a refusal case that asserts nothing
   changed.
2. **The document next.** The version, hash and transaction chain are service
   state; they are testable before a tool exists.
3. **Then the page.** The tools will be a client of the transaction route; the
   gesture boundary is the transaction boundary, and the page has no private
   mutation path.
4. **Snippets after selection.** Saving a region needs the region read; the
   library's publish/read cases do not need the page.
5. **Verification throughout.** Each task adds its own cases; T78 records E1–E9
   in the version's dev-log with the commands and observed results.

## Not in scope

Collaboration, roles and persistence (M01–M03). The observation page's existing
click-to-toggle and centre placement stay until the edit mode replaces them; no
behavior of the observation page is removed to make room for the mode.

## Done when

* The nine M00 criteria E1–E9 in [acceptance.md](../../acceptance.md) are judged
  by cases whose commands and results are recorded in the version's dev-log.
* The documentation coupling of the changed modules is updated in the same
  work item, and the version reaches a complete state in
  [../../../VERSIONS.md](../../../VERSIONS.md) before it is tagged.
* No new npm dependency, build step or native component enters the viewer.
