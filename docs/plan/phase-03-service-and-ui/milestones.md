# phase-03-service-and-ui — milestones

> **Authority.** This file owns the content of each milestone; the version that
> delivers one is named only in [../VERSIONS.md](../VERSIONS.md), and the
> milestone's exit condition is judged by [acceptance.md](acceptance.md).

## M00 — localisation, one source per value, and a history timeline

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* **One message catalogue** for Chinese and English, with the same key set in
  both, and every user-visible string taken from it — including titles,
  accessible names and the units next to a number. The core's own error
  *messages* are diagnostics and are not translated; its error *codes* are part
  of the protocol and get a localised label.
* **One source for every shared value.** The frame budget and its admission
  rule, the tick-rate bounds, the step limit, the world size and the coordinate
  limit are each declared once. Where a value is enforced by the core, the core
  advertises it and the service and page consume it rather than keeping a copy
  that drifts.
* **One style rule per kind of control.** Every control group shares one layout
  rule and every select shares one appearance rule. A rule that no element can
  match, or that applies to one control and not its siblings, is a defect.
* **The history as a timeline.** The recorded generations are listed, the
  current one is marked, and clicking one rolls the world back to it. An archive
  can be written from the interface.

**Exit condition:** the page is usable in Chinese and in English with no string
outside the catalogue; every shared value has a single declaration point, or the
duplication is stated with its reason and a test; the style sheet has no rule
that fails to apply; and a recorded run can be rolled back from the page.

## M01 — the history as a tree, and an interface that can reach it

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* **A branched history.** A recorded generation becomes a node with a parent,
  and the session holds a pointer to the node the world currently corresponds
  to. Recording creates a child of that pointer instead of truncating what came
  after it, so editing after looking at an older state keeps the older work and
  shows the result as a second branch. This is the change that makes the model a
  tree rather than a chain, and it is why the previous version's truncation is
  replaced rather than patched.
* **Preview by selection.** Selecting a generation loads it into the world so the
  canvas shows it. The old work is not discarded, and the next edit becomes a
  child of the selected node.
* **A panel that can get out of the way.** The timeline and the readouts live in
  a panel on the right that hides to the right, leaving the canvas the full
  width, and can expand leftwards to full width for a large view. Its state is
  remembered.
* **Gestures for a tablet.** Two-finger pinch to zoom about the midpoint of the
  fingers, two-finger drag to pan, and the existing one-finger behaviour
  unchanged: tap toggles a cell, drag pans.
* **Archive management.** Export the history to a named file, list what is in the
  repository's data directory, rename it, delete it, and import one back as a
  session. A client names a file and never a path.

**Exit condition:** two branches can exist at once and both are reachable; a
selection shows its state without destroying what came after it; the panel can
be hidden and restored; a tablet can zoom and pan; and an archive can be written,
listed, renamed, deleted and read back.

## M02 — the interface as routed pages

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* **One page per concern, at its own path**: the world, the history and the
  archives stop sharing a document. The layout, the tab navigation and the script
  assembly are declared once and composed by the service, and each page loads
  only its own module, so a change to one cannot break the other two.
* **A test that can see a missing element.** The synthetic document used by the
  browser tests used to invent an element the first time a script looked one up,
  which made a page whose markup omitted a container pass every test — and draw
  nothing. It now returns null for what the markup does not declare, and a
  contract test asserts both directions per page.
* **An audit that can see a rule which applies to nothing.** The style audit
  accepted a class mentioned anywhere in a file, so a renamed class left rules
  behind and a person saw an unstyled panel while every test passed.
* **The history as nodes** whose detail appears on hover or on keyboard focus,
  with indentation that changes only at a real fork — a linear run stays in one
  column instead of marching off the edge.

**Exit condition:** each concern has its own path and its own module, the shared
parts are declared once, a missing container and an orphaned style rule both fail
a test rather than reaching a person, and the history reads as a tree.

## M03 — multi-session service and a pattern library

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* **More than one session per service**, each with its own core and its own
  history, so a person can compare two runs without restarting anything.
* **A pattern library.** The classic still lifes, oscillators and ships, and at
  least one gun, placed from the interface rather than drawn cell by cell. A
  pattern is data in one file, not code.
* **Automatic representation choice.** The service already knows the population
  and already knows how to switch storage without losing the world, so the
  decision the measurement describes — sparse for a scattered population, tiled
  for a clustered one — belongs here rather than in the caller's head. This is
  the item phase 02's risk R16 recorded as having no owner when the switch was
  manual only.

**Exit condition:** two sessions run at once, a pattern can be placed and named,
and nobody has to know which storage is faster for the pattern they just drew.

## M04 — the UI a second person can use

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* **Undo of the last edit**, distinct from selecting a recorded generation:
  placing a cell is an edit, and undoing it should not require the timeline.
* **Discoverability**: what the page can do, where the keyboard shortcuts are,
  and what a control will do before it is pressed.
* **Saving without a command line**, and loading a saved world back.

**Exit condition:** someone who has not read this repository can open the page,
place a pattern, run it, undo a mistake and save the result.
