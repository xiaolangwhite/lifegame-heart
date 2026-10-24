# phase-03-service-and-ui — acceptance

> **Authority.** This file owns the acceptance criteria. Each is judged by a
> command with an observed result recorded in the version's `dev-log` entry; a
> criterion without a recorded command is not satisfied.

## M00 and M01 — delivered

> Their criteria are judged together because the history and the archive that
> M01 delivered are the same surface M00 built, and splitting them would have
> produced two tables describing one page.

| Id | Criterion | Decided by |
|---|---|---|
| C1 | The page is usable in Chinese and English, and switching language needs no reload | a synthetic-document test that switches and asserts the visible text changed, plus a `lang` attribute assertion |
| C2 | Every user-visible string comes from one catalogue, and both languages define the same keys with no empty value | a test that compares the two key sets and rejects an empty string, and a test that no user-visible English remains in the markup |
| C3 | The core's error codes have localised labels while the core's own messages are passed through as detail | a test that renders a known code in both languages and asserts the label differs and the message is unchanged |
| C4 | The tick-rate bounds, the step limit, the world size and the coordinate limit that the interface offers are the ones the core enforces | the handshake's advertised limits are applied to the control, asserted against a stub handshake with non-default values |
| C5 | The frame budget and its admission rule are declared once and used by both the service and the page | one module, imported by both; a test asserts the two callers agree on a boundary case |
| C6 | Every control group shares one layout rule and every select one appearance rule | a test that every control group in the markup carries the shared class, and a manual audit recorded in the module's `implementation.md` |
| C7 | The recorded history is listed, the current generation is marked, and clicking a generation rolls the world back to it | an end-to-end session through a real service: record, list, roll back, and assert the state |
| C8 | An archive can be written from the interface and read back | the same session, writing an archive and importing it into a fresh store |
| C9 | The service and the core leave no file outside the repository | `scripts/verify-temp-isolation.ps1`, including the new history database |

## M02 — the routed interface

| Id | Criterion | Decided by |
|---|---|---|
| C16 | The interface is a set of routed pages rather than one document: each concern has its own path, and the layout, the tab navigation and the script assembly are declared once | a test that each route answers 200 with its own body and its own page module, that the navigation is identical across routes with one current item, that an unknown path answers 404 rather than falling back, and that the shared layout has one declaration |
| C17 | A page's markup and its script cannot disagree about an element | the synthetic document returns null for an id the markup does not declare, and a contract test asserts both directions per route: every id a route's script reads is declared by that route, and every id a fragment declares is read by that route's module |
| C18 | A stylesheet rule names a class that something actually bears | the audit requires the class to appear where a class is borne, and separately that a rule keyed on `data-panel` names a class on the element that carries the attribute |
| C19 | The history is nodes whose detail appears on hover or on keyboard focus, and indentation changes only at a real fork | tests that a linear run keeps one column for twenty generations, that a fork's children are deeper than the fork and equal to each other, and that the detail elements exist in the row |

## M03 — the version naming it

| Id | Criterion | Decided by |
|---|---|---|
| C10 | Two sessions run at once, each with its own history | an end-to-end session driving both |
| C11 | A pattern can be placed from the interface by name | a test that places one and asserts the cells it produced |
| C12 | A representation switch does not truncate the timeline | the generation count before and after a switch |

**C10 and C11 are judged**, by the cases recorded in
[dev-log/v0.3.6.md](../../../dev-log/v0.3.6.md). **C12 is satisfied**: the
switch-continuity case records a run, switches the storage, and asserts the same
session id and the same node count afterwards, with a further step appended to
that session; it is recorded in [dev-log/v0.3.7.md](../../../dev-log/v0.3.7.md).

## M04 — the version naming it

| Id | Criterion | Decided by |
|---|---|---|
| C13 | The last edit can be undone without a rollback | a test that edits, undoes, and asserts the previous state |
| C14 | A person who has not read the repository can find what the page does | a written walkthrough in the dev-log, and the interface naming its own controls |
| C15 | A world can be saved and loaded without a command line | an end-to-end session doing both |

**C13, C14 and C15 are judged** by `v0.3.7`: the undo cases in the page suite, the
controls' own titles and shortcut hint plus the walkthrough in
[dev-log/v0.3.7.md](../../../dev-log/v0.3.7.md), and a real-core server case that
records a run, writes an archive, imports it, and asserts the same generation and
population. C12 is judged there too, so the version's dev-log is the record all
four point at.
