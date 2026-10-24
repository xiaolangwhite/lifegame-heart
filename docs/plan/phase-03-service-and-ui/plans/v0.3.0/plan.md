# Plan for the version naming phase 03 milestone 00

> The version identifier and its state are owned by
> [../../../VERSIONS.md](../../../VERSIONS.md); this file owns only the plan for
> delivering it.

## Claim

Phase 03 milestone 00 ([../../milestones.md](../../milestones.md)): make the
interface one a person can use in Chinese or English, give every shared value a
single declaration point, and show the recorded history as something you can
roll back from.

## Why it is where it is

The previous two versions added capability in a straight line: a page that can
edit and run a world, a second storage engine, a history with rollback. Each
arrived with its own costs, and the costs accumulated where nobody was looking —
in the strings, in the numbers, and in the stylesheet. This version pays them
down, and the history panel is the visible reason: a store that can restore any
generation is not useful until a person can see the generations.

## Approach

1. **Advertise rather than copy.** The core already knows its own limits. The
   handshake carries them, and the page, the service and the test suite read
   them from there. This is the same rule the project applies to documents: one
   authority, and the consumer links to it.
2. **Share where both sides can reach.** A value the service and the page both
   need goes into the page's own directory, which the service can also read,
   so "the browser cannot import a server module" stops being a reason to keep
   two copies.
3. **One catalogue, checked.** Both languages must define the same keys; an
   empty value is a defect; a visible literal in the markup is a defect. The
   catalogue is data and the checks are tests, so a missing translation fails a
   gate rather than reaching a user.
4. **Style by kind, not by instance.** One layout rule for every control group,
   one appearance rule for every select. The rule that a control group is
   missing from a shared selector is exactly the defect this version was
   prompted by.
5. **Record the interface's own actions.** The history is only useful if an edit
   is visible in it, so a mutation records the generation it happened at, and
   the recorded chain stays replayable.

## Risks that are live

| Risk | How it is handled |
|---|---|
| A string reaches the markup directly and is never translated | The markup is structure only; a test compares the two key sets and the DOM contract test rejects a visible literal |
| A shared value is copied because the two sides cannot import each other | The shared module lives where both can import it; a boundary test asserts the two callers agree |
| The page offers a limit the core refuses | The limits come from the handshake, asserted against a stub handshake with non-default values |
| Recording costs more than the run it records | Deltas rather than snapshots, a bounded keyframe interval, and a measurement in the store's performance record |
| An edit makes the chain unreplayable | A mutation re-keyframes its own generation, and the replay refuses a chain that does not describe a life history |

## Definition of done

* The page works in both languages with no string outside the catalogue, and
  switching needs no reload.
* Every shared value has one declaration point, or a recorded reason and a test.
* The stylesheet has no unreachable rule and no rule that applies to one control
  and not its siblings.
* A recorded run can be listed, rolled back from the interface, and written to an
  archive that reads back.
* The isolation check passes with the history database in place, and every gate
  is green with the observed results in `dev-log/`.
