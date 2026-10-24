# viewer — testing

> This file owns what is tested, what is deliberately not, how to run it, the
> fixture layout, the failure modes each suite covers, and the exact command
> that produced the last recorded result. The measured numbers that the tests do
> not produce are owned by [performance.md](performance.md).

## 1. What is tested

Twenty-three suites, all inside the module. The case counts below are what this file
records for each suite; the whole-suite total is the recorded run in §5.1, and it
moves whenever a case is added — it moved once **while this file was being
updated**, so §5.1 carries both readings.

| Suite | Cases | Drives |
|---|---|---|
| [tests/bridge.test.mjs](../../../src/viewer/tests/bridge.test.mjs) | 18 | A **real core process** through the bridge: the protocol, both encodings, request serialisation, the run loop, `quit`, the crash and restart policy, the missing-interpreter message, and both representations answering the same commands |
| [tests/server.test.mjs](../../../src/viewer/tests/server.test.mjs) | 65 | The service over a **real socket** on an ephemeral port: routing, static confinement, traversal, round trips, forwarded errors, malformed requests, frame admission including the band case, the `503` path, a real event stream read the way a browser reads one, two subscribers, a pushed mutation, a subscription update, an unknown client, the representation switch, the history and select routes against a **real store on disk**, the fork a select makes, the archive routes including forty traversal refusals, **the pattern library and one-request placement including a still life, a glider and a gun stepped by a real core**, **the two directions of the automatic storage choice**, and **two sessions with their own cores, worlds and history files** |
| [tests/routes.test.mjs](../../../src/viewer/tests/routes.test.mjs) | 9 | The **routed pages composed in process**, with no socket: every route serving its own fragment, `/` and `/world` agreeing, the navigation built once with exactly one `aria-current`, the script set being the shell and then the route's module, the layout's slots compared with what the composer supplies in both directions, an unfilled slot throwing rather than reaching a browser, and `null` for a path nobody serves |
| [tests/history.test.mjs](../../../src/viewer/tests/history.test.mjs) | 23 | [history.mjs](../../../src/viewer/public/history.mjs) against **plain rows**: a linear run staying at one level however long it is, a fork putting its children one level in and equal to each other, a parent outside the window starting a branch rather than dropping the row, the indent cap holding against an absurd depth, the branch letters naming a fork's children, and a timestamp rendered in the reader's locale |
| [tests/events.test.mjs](../../../src/viewer/tests/events.test.mjs) | 12 | The **push hub without a socket**, against a scripted bridge: the `hello` then `frame` sequence, a tick reaching every subscriber, coalescing under a slow frame, a removed subscriber, client lookup, rectangle clipping, an admission refusal becoming an `error` event, an unreachable core, and the representation a client is told |
| [tests/page.test.mjs](../../../src/viewer/tests/page.test.mjs) | 98 | **The real shell and the real page modules**, executed against the synthetic browser of [tests/dom-stub.mjs](../../../src/viewer/tests/dom-stub.mjs): both render paths asserted on the pixels they write, the pointer gestures including the two-finger pinch and its anchor, the drag threshold, the right button, the stream replacing polling, a viewport change published rather than polled for, a dropped stream falling back, a stream `error` not closing the connection, both outcomes of a representation switch, the language switch changing every rendered string, the panel's three states applied to the stage, the history rendered **as a tree** with its forks, branch letters and hover-only detail, a selection moving the world, the archive manager's list, rename, two-press delete and import, **the pattern control filled from the service and placing one**, **the session control filled from the service registry**, and **the editing mode: enter/leave, one paint gesture as one transaction, a refused transaction, a selection saved and published, and a palette stamp with a transform and merge** |
| [tests/decode.test.mjs](../../../src/viewer/tests/decode.test.mjs) | 8 | The browser's own decoders against payloads the real core produced, plus hand-built payloads that pin the bit order, the row stride and the truncation guard |
| [tests/shared.test.mjs](../../../src/viewer/tests/shared.test.mjs) | 10 | [shared.mjs](../../../src/viewer/public/shared.mjs) as **plain data**: the admission rule on both sides of its boundary and at it, the live-set cap and the payload it allows, and the declared limits in each shape a core can send — including the nulls |
| [tests/locales.test.mjs](../../../src/viewer/tests/locales.test.mjs) | 14 | [locales.mjs](../../../src/viewer/public/locales.mjs) as **plain data**: identical key sets with no empty entry, both resolutions of a stored choice against a browser preference, an unsupported stored value, an absent preference, parameter substitution, and the label-versus-diagnostic boundary |
| [tests/theme.test.mjs](../../../src/viewer/tests/theme.test.mjs) | 23 | [theme.mjs](../../../src/viewer/public/theme.mjs) against **plain values**: theme precedence, the closed theme set, width clamping and rounding, both colour notations and a dozen notations it must refuse, the device-pixel geometry at five ratios, and storage that throws |
| [tests/panel.test.mjs](../../../src/viewer/tests/panel.test.mjs) | 7 | [panel.mjs](../../../src/viewer/public/panel.mjs) against **plain values**: the three states resolving, an unrecognised stored value falling back rather than being repaired, each control's transition including the one from the other state, the cycle's order, and what is visible in each state |
| [tests/viewport.test.mjs](../../../src/viewer/tests/viewport.test.mjs) | 29 | [viewport.mjs](../../../src/viewer/public/viewport.mjs) against **plain values**: clamping, the visible height from the canvas aspect, the zoom bound for a sparse and for a dense world, the frame request at and past the population limit, the pointer mapping including the canvas offset and the lagging frame, the zoom's fixed point, the drag translation, the click threshold, the drawing scale, the two-finger midpoint and spread, the pinch's anchoring asserted as an equality, and the state transition when a finger arrives or leaves |
| [tests/patterns.test.mjs](../../../src/viewer/tests/patterns.test.mjs) | 10 | The pattern library as **data and one parser**: the RLE grammar including runs, `$` counts and a leading dead run, every refusal the parser has (missing terminator, unknown character, a run before `!`, an oversized run), the shipped file's fifteen names and each pattern's published population, a malformed document refused rather than repaired, and placement anchored and bounded |
| [tests/representation.test.mjs](../../../src/viewer/tests/representation.test.mjs) | 9 | The storage choice as **plain data**: the two measured shapes choosing tiled and sparse at the same population, the population crossover, the density boundary inclusive and between the anchors, a core that offers no tiled storage, the bounds and density computation, and the rule that speaks only at or above the crossover |
| [tests/focus.test.mjs](../../../src/viewer/tests/focus.test.mjs) | 6 | The remembered view point: the default session keeping the original storage key and a created session getting its own, a point round-tripping within a session and invisible to another, an unreadable entry meaning no memory, a `?focus=x,y` link parsed and a malformed one ignored, and the module reading no browser `location` |
| [tests/edit.test.mjs](../../../src/viewer/tests/edit.test.mjs) | 14 | The editing document as **plain data**: a transaction advancing the version and the chain hash deterministically, the same history producing the same hash, a stale base rebasing an absolute intent and refusing a content-dependent one, a wrong generation and a duplicate id refused, cells canonicalised and bounded, the candidate patch composing set/clear/fill intents in order, the check refusing before a core write, undo reversing only the cells the undone transaction still owns, undo and redo recorded as transactions, and the resync window |
| [tests/edit-runtime.test.mjs](../../../src/viewer/tests/edit-runtime.test.mjs) | 7 | The editing runtime against a **scripted core**: entering pauses a running world and leaving resumes it at the same rate, a transaction records the cells the core actually changed rather than the candidate and broadcasts one `patch`, a duplicate id or a stale base is refused before the core is asked, the resync view answers inside the window and says `full` outside it, and a transaction without the mode is refused |
| [tests/edit-tools.test.mjs](../../../src/viewer/tests/edit-tools.test.mjs) | 6 | The pure editing tools as **plain data**: a box normalising its corners, a line including both ends and staying connected on a steep slope, a stroke not resending cells it already swept, every rotation and flip mapping the exact cell set, a stamp operation carrying a fill with relative cells, the closed tool and mode vocabularies, and a box fitting its world |
| [tests/snippets.test.mjs](../../../src/viewer/tests/snippets.test.mjs) | 11 | The content-addressed snippet store against a **real filesystem**: publish/list/read/remove round trips, a hash stable across input order and duplicates, one content object shared by two names, name validation, an idempotent republish, a silent overwrite refused and a pinned replace accepted, remove leaving the object in place, the 256/8192 limits, and a missing or corrupt index reported rather than repaired |
| [tests/rule.test.mjs](../../../src/viewer/tests/rule.test.mjs) | 13 | [rule.mjs](../../../src/viewer/public/rule.mjs) as **plain data**: the eight presets by name and in one place, every preset name and every refusal reason having words in both languages, a well-formed rule normalised, the ends of the digit range accepted, each of the six refusals returned for the shape that causes it, every refusal naming a reason the catalogue has words for, a rule matched to a preset by its own string and to nothing else, and the rule a reply reports read from the reply and then from its state |
| [tests/rule-page.test.mjs](../../../src/viewer/tests/rule-page.test.mjs) | 19 | **The rule editor, executed** against the synthetic browser: every id it binds being declared, the select built from the one list that owns it, a preset sent at once and reported by the readout, every preset sent as its own string, a typed rule sent by the button and by `Enter` and by nothing else, case and digit order normalised before the request, a malformed rule and an empty field refused locally with nothing sent, a core refusal shown with the core's own reason and changing nothing, the refusal in the language on screen and gone once a rule is taken, a rule changed while the world runs without disturbing the run, a rule the core reports at handshake becoming both the readout and the select, a preset the core reports selecting its own entry rather than the custom one, the custom entry focusing the field instead of sending, and a readout redraw not moving the field out from under a typist |
| [tests/dom-contract.test.mjs](../../../src/viewer/tests/dom-contract.test.mjs) | 20 | The layout, the three fragments and the scripts **against each other**: every id a route's scripts read is declared by that route **and** every id a fragment declares is read by that route's scripts, a floor on the id count per route, the absence of duplicate ids, the widths the control offers, the language options, the key the pre-paint script repeats, the palette variables the stylesheet defines, the names the scripts import, the absence of prose in the markup, and that a fragment carries no `<html>`, `<head>` or `<body>` of its own |
| [tests/css-audit.test.mjs](../../../src/viewer/tests/css-audit.test.mjs) | 16 | The **stylesheet against the markup**, as text: every class a rule names appears where a class is *borne* (`class=`, `className=`, `classList.add\|remove\|toggle`), the only id selector is the canvas, every control group carries the shared class, no appearance rule is scoped to a single control, `button` and `select` share one rule, a `[data-panel]` rule's subject class is on the element that really carries `data-panel`, the toolbar has a minimum width, a hidden panel stays hidden, and the tree's detail is collapsed until hover or focus |

Two of the suites are the answer to a boundary the module used to be unable to
cross. The browser could not be driven from `node --test`, so everything the page
decides was pushed into pure functions — the decoders, the theme logic, the
viewport arithmetic, the shared values, the catalogue — and the wiring that was
left is now executed too, through a synthetic browser. Nothing is left in the page
that no test runs, except what a rasteriser does, which is
[risks.md](risks.md) VWR-10.

The `css-audit` suite exists because the two defects it was written after were
structural rather than visual, and a missing rule is invisible in a stylesheet:
there is nothing to look at. It asks the inverse question — does every token this
stylesheet names exist, and is every control covered by the shared rule — and it
states its own limit: it does not evaluate selectors, so it cannot prove a rule
*matches* at run time ([risks.md](risks.md) VWR-15).

No mock stands in for the protocol. A real `python -m lifegame.world` child is
spawned by the first suite, the page's decoder is run against that core's real
frames by the fifth, and an independently written decoder in the first suite
cross-checks those frames so a mistake in one cannot hide behind the other. The
server suite reads a real event stream over a real socket and drives a real
history store on disk.

Two stubs exist, and both are named rather than hidden:

* a **stub bridge** for the service's own admission rule, where building a
  100,000-cell world through the protocol would test the core instead of the
  rule. It counts the calls it receives, which is how "a refused frame never
  reaches the core" is asserted rather than assumed;
* the **synthetic browser** for the page suite. It is deliberately a stub of the
  *browser*, not a double of the page: it records what the page asked of the
  browser — pixels written, requests sent, listeners registered — and the real
  `app.js` runs against it.

## 2. How to run it

```powershell
# from the repository root, after the environment preamble in AGENTS.md §1
node --test "src/viewer/tests/*.test.mjs"
```

The same command is a gate in the repository's single entry point
([AGENTS.md](../../../AGENTS.md) §4), so `scripts/verify.ps1` runs it.

**The directory form does not work on Node v24.19.0.** `node --test
src/viewer/tests/` tries to load the directory as a module and fails:

```
Error: Cannot find module '<repo>\src\viewer\tests'
```

Pass the glob as above, or list the files. The `viewer:test` script in
`package.json` uses the glob for that reason. This is a runner behaviour, not a
module defect, and it is recorded because it costs a reader a debugging session
otherwise.

## 3. Fixture layout

The suites use almost no fixture files:

| Kind of input | Where it comes from |
|---|---|
| A world, a rule, a generation | Constructed over the protocol against a real core |
| Frames | Produced by the real core's encoder and decoded by the suite |
| Bit-order and stride pins | Built in the test as raw bytes, then base64-encoded, so the payload is independent of the encoder under test |
| Truncated and malformed payloads | Built in the test by truncating or mis-sizing a valid payload |
| A large population for the admission rule | A stub bridge that reports a population without any core work |
| A missing interpreter | A `CoreBridge` pointed at a path that does not exist |
| Stored theme values, and a storage that throws | Built in `theme.test.mjs` as plain values: `null`, both theme names, a value from an older build, a number, and three accessors that raise |
| Colour strings in every notation | Written in the test, including a dozen the parser must refuse (`oklch()`, `light-dark()`, `var()`, empty, truncated hex) |
| Device pixel ratios | Passed as plain numbers: `1`, `1.25`, `1.5`, `2`, `3`, plus `0`, `NaN` and a missing ratio |
| A browser | [tests/dom-stub.mjs](../../../src/viewer/tests/dom-stub.mjs): a DOM of elements keyed by id, a canvas whose 2D context **records** every call rather than rasterising, an `EventSource` a test can open, fail or drop, a scripted `fetch` that answers from a small core model, and a `settle()` helper that drains pending microtasks |
| An offscreen canvas | Created by the page itself through `document.createElement('canvas')`; the stub keeps every canvas it hands out, because the bitmap path composes on one and draws it to the visible canvas |
| The page, the script and the stylesheet as text | Read from disk by `dom-contract.test.mjs`, which is the only suite that treats its inputs as files rather than as values |

Nothing is written to disk by any test. Servers listen on port `0`, so a run
never collides with a developer's own service, and every suite closes what it
opened. The page suite tears each case down by stopping any run loop the page
left going — which it must do carefully, because the page's poll timer reads
`globalThis.fetch` **at fire time** and a loop left running would therefore fire
against the next case's stub (§7.6).

## 4. Failure modes covered

| Area | Covered by |
|---|---|
| The protocol answers every forwarded command and reports the core's error codes unchanged | bridge suite (`hello`, `set`/`toggle`/`step`/`state`, protocol errors reported not thrown) |
| The sparse path decodes to exactly what was set, in absolute coordinates | bridge suite (sparse frame), decode suite (real frame), and the cross-check between the two decoders from different origins |
| The dense path agrees cell for cell, and its bit order and stride are right | bridge suite (dense frame), decode suite (high bit first, padding ignored, stride is the rounded-up width) |
| A truncated payload is reported, never half-drawn | decode suite (a `bits` payload shorter than the rectangle, a `cells` payload that is not a whole number of pairs) |
| Requests are serialised without loss | bridge suite (concurrent requests are serialised without losing any) |
| The tick event drives run and pause | bridge suite (run and pause drive the tick event without an id) |
| `quit` ends the child | bridge suite |
| A crashed core is restarted transparently, and a core that keeps crashing is not restarted for ever | bridge suite |
| A missing interpreter names the bootstrap command | bridge suite |
| Static files are served, and every path is confined to `public/` | server suite (`resolveStaticPath` unit cases, serving, traversal never reaching a file outside `public/`) |
| An unknown route is a `404`, not a crash | server suite |
| Malformed requests are rejected before they reach the core | server suite (missing and non-integer parameters, negative origin, empty and non-JSON bodies) |
| A forwarded protocol error keeps the core's own code | server suite |
| Frame admission follows the encoder's rule, and a refusal forwards nothing | server suite, asserted by counting the stub's calls |
| The page keeps being served while the core is unavailable | server suite (`503`, and the page served during the outage) |
| A stream describes the world before it shows it | server suite (a real `text/event-stream` read from a real socket) and the hub suite (`hello` precedes the first `frame`) |
| Two subscribers each receive their own rectangle | server suite, two streams on one service |
| A mutation is pushed rather than waited for | server suite, which mutates through `/api/command` and observes the `frame` event without asking for one |
| A subscription update is answered on the same connection | server suite, which updates the rectangle and reads the next frame from the same stream |
| An unknown `clientId` is refused | server suite (`404 unknown_client`) |
| A subscription rectangle the encoder would refuse is refused here too | server suite, and the hub suite where the same refusal becomes an `error` event |
| A rectangle larger than the world is clipped rather than refused | hub suite |
| A slow subscriber coalesces instead of queueing | hub suite, with a frame the test holds open while twelve changes arrive |
| A removed subscriber stops receiving, and the hub lets go of the core | hub suite |
| An unreachable core becomes an `error` event, not a thrown exception | hub suite |
| Both render paths paint the right pixels | page suite: a `cells` frame is asserted fill-by-fill at the coordinates it names, and a `bits` frame is asserted to reach `putImageData` on the offscreen canvas with exactly the live cells coloured |
| A frame that cannot be drawn is reported, not thrown | page suite |
| A click toggles the cell under the pointer; a drag never edits the world | page suite, asserting the `toggle` bodies the page sent |
| The drag threshold is a threshold | page suite, a press that travels past it and one that returns under it |
| A right button neither drags nor toggles | page suite |
| A connected stream stops the polling, and a viewport change is published rather than polled for | page suite, counting the scripted `fetch` calls |
| A dropped stream falls back to polling | page suite, dropping the `EventSource` |
| A server-sent `error` is reported without closing the connection | page suite, which distinguishes it from the browser's own `error` by the presence of `data` |
| A representation switch goes through the service, keeps the world, and is reflected by the control | page suite (the request body and the control's value), server suite (generation, population and the live set across a real process replacement), and the hub suite (the representation a client is told follows the core) |
| A switch to the running representation replaces nothing, and an unknown one is refused | server suite |
| Concurrent switches leave one winner and a usable core | server suite |
| A malformed rule never becomes a request, and the person is told which fault it was | rule-page suite (six shapes — no `B`, no `S`, a character that is not a digit, a `9`, a repeated digit and an empty field — each asserted to send nothing and to show the sentence for that reason), rule suite (the same six reasons as return values) |
| A rule that passes the page's check but is refused by the core changes nothing | rule-page suite, which sends a rule the core answers `bad_rule` to and then asserts the readout still names the rule that was running, and that the core's own message is the text beside the field |
| The rule the readout shows is the rule the core reported, not the rule that was sent | rule-page suite (a `b3/s32` request and the `B3/S23` readout), rule suite (`reportedRule` reading the reply, then its state, then the sent string) |
| A rule change does not disturb a running world | rule-page suite, which changes the rule with the run loop active and asserts the run was neither stopped nor restarted |
| The preset list, the preset labels and the refusal sentences exist in both languages | rule suite (every preset's `key` and every entry of `RULE_REASONS` resolved in both catalogues, with no empty value) |
| The viewport arithmetic is exactly right, including that a zoom does not move the world point under the pointer | viewport suite, as equalities rather than as approximate checks |
| The theme follows the system only while no choice was made, in both directions | theme suite (nothing stored, both explicit choices, a value from an older build) |
| A stored value that is not a theme means "no choice", not an error | theme suite (a number, an unknown name, an empty string) |
| A grid width is clamped, rounded, and falls back to the default rather than to the minimum | theme suite (both ends, a fractional value, a numeric string, junk) |
| Colours parse in every notation the palettes use, and nothing else parses | theme suite (four hex lengths, both `rgb()` forms, alpha, and the refusals) |
| Storage that throws leaves the page working | theme suite (each accessor raising, and a missing storage object) |
| A grid line is a whole number of device pixels at any ratio, and its centre is snapped | theme suite (five ratios, odd and even widths, device-pixel rather than CSS-pixel snapping) |
| The page and its script agree on every id, and the controls offer exactly what the modules accept | contract suite (ids bound, duplicate ids, the grid option list against `GRID_WIDTHS`, the storage option list against `REPRESENTATIONS`) |
| The pre-paint script uses the storage key the module owns | contract suite, comparing the inline script's string with `THEME_STORAGE_KEY` |
| The stylesheet defines the three canvas colours, they all parse, the two palettes differ, and every field the script reads is declared | contract suite |
| Every name the script imports exists in the module it imports from | contract suite, which parses the import list and checks it against the module's exports |
| A named pattern is placed in one request, and a box that would leave the world is refused before the core sees it | server suite (the request's cells, and the counting of `set` calls); patterns suite (placement anchored and bounded) |
| The shipped patterns are the shapes their kinds say, not merely the right number of cells | server suite, stepping a still life, a glider and the gun through a real core |
| Two sessions run at once with their own cores, worlds and history files, and an unknown session is refused rather than served by another | server suite (two populations, a step that appends to only the created session's store, `404 unknown_session`, and the default refused when closing) |
| The storage follows the measured shape, and a small manual choice is left alone | representation suite (both anchors, the boundary and the crossover), server suite (a packed placement switches to tiled and a spread one back to sparse against a real core) |
| A session control that cannot read the registry disables itself rather than offering unreachable ids | page suite |
| A representation switch keeps the recorded session and does not truncate the timeline | server suite: a recorded run, a switch, the same session id and the same node count, then a further step appended to the same session |
| A creation at the session cap waits, and the wait is reported | server suite: a cap of two, a queued creation, `queued: 1`, and the waiting request admitted when a session closes |
| A remembered view point belongs to its session and can be shared by a link | focus suite: per-session storage keys, a point invisible across sessions, `?focus=x,y` parsed, and a malformed point ignored |
| The capabilities route names the editing surfaces it can promise | server suite: the surfaces, the cap, the shareable point and `editing.mode` |
| A full session queue is refused with a named error instead of being queued | server suite: a cap of two and a queue bound of one, the second waiter answered `503 session_queue_full`, and the first admitted when a session closes |
| The last cell edit is undone, and a step makes it unavailable | page suite: a click, an enabled undo, an inverse `toggle`, the world back as it was; and a click followed by a step disabling the control |
| A recorded world is saved to an archive and loaded back through the service | server suite, against a real core and a real store: record, archive, import, same generation and population |
| Every control names itself, and the hint line states the shortcut this version adds | page suite: a title on undo, step, clear, place and new-session, and `Ctrl+Z` in the hint |
| A transaction advances the version and the hash chain, rebases an absolute stale base and refuses a content-dependent one | edit suite: deterministic hashes, the rebase flag, and the `stale_base` refusal |
| Undo reverses only the cells the undone transaction still owns, and redo is a transaction | edit suite: two authors on one cell, the inverse patch restricted by attribution, and the undo/redo chain |
| A snippet round-trips through publish, list, read and delete, and a silent overwrite is refused | server suite against a real store: publish, list, read, a `409 name_conflict`, a pinned replace, and a delete that removes the name |
| The snippet library refuses a bad name, an oversized box and a cell outside the box | server suite: `invalid_name`, `too_large` and `bad_arguments` with their statuses |
| The editing API pauses the world, commits one transaction with the actual changed cells, undoes, redoes and resumes | server suite against a real core: enter, `edit_active` on a step, a transaction, undo, redo, resync and leave |
| A world-writing route is refused while the session is being edited | server suite: a step during the mode answers `409 edit_active` |
| The editing mode pauses the run controls, and a paint gesture is one transaction | page suite: enter disables run and step, a drag sends one `set` transaction, undo sends its inverse |
| A refused transaction is visible and changes nothing | page suite: a `too_large` refusal leaves the version and the transactions unchanged |
| A selection is saved as a draft and published with relative cells | page suite: a selection drag, the saved draft's cells, and the publish body |
| A palette stamp applies the chosen transform and mode | page suite: a rotate-90 L-shape sent as one `fill` with `mode: "merge"` |
| A transaction fills a box, merges into one, and keeps one history edit | server suite against a real core: overwrite kills the box's other cells, merge only lights, the generation does not move, the history count does not grow, and the hash advances |

## 5. The last recorded result

### 5.1 The suite

Command, from the repository root:

```powershell
node --test "src/viewer/tests/*.test.mjs"
```

Observed tail of the TAP summary:

```
ℹ tests 447
ℹ suites 0
ℹ pass 447
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 29148.5876
```

Exit code `0`, wall time about 29.1 s including Node's start-up, on Node v24.19.0,
profile `M1`, with no `node` and no `python` process left afterwards and the
history store's files deletable.

**A total is a reading of a revision, and this one has moved again.** The
collaboration work added two cases to `tests/edit.test.mjs` (attribution
compaction and the named-transaction undo), two to
`tests/edit-runtime.test.mjs` (presence and the named undo), two to the server
suite (presence over the stream; two clients merging and undoing) and two to the
page suite (a remote patch; presence reporting and the roster). The per-suite
counts in §1 sum to 447, which is the run above.

The per-suite breakdown below belongs to the **earlier** revision whose total was
292 and is kept as that revision's record; it is not a breakdown of the run
above, and its smaller totals for `events` and `css-audit` are how that revision
differed from §1. Each suite run on its own:

| Suite | Cases | Wall time |
|---|---|---|
| bridge | 18 | 2.4–2.6 s (it spawns a real core, and kills one on purpose) |
| server | 40 | 4.5–5.0 s (it spawns a core, writes a history store and opens a socket) |
| page | 69 | 4.5–5.0 s |
| theme | 23 | 0.4 s |
| viewport | 29 | 0.4 s |
| dom-contract | 20 | 0.3 s |
| locales | 13 | 0.3 s |
| events | 11 | 0.4 s |
| shared | 10 | 0.2 s |
| css-audit | 9 | 0.2 s |
| decode | 8 | 0.5 s |

**No process is left behind.** After a whole-suite run the machine holds no
`node` process and no `python` process, and the history store's three files are
deletable. That is asserted by inspection at the end of a run rather than by a
case, and it is a property the suite did **not** have until §7.4.

The per-suite times exceed the whole-suite time added together only because the
suites are run in parallel by the runner and each pays Node's start-up. §5.7
records one run that failed and was not reproducible.

The directory form was also run, and failed as §2 records; the exit status was
non-zero and the message was the `Cannot find module` error quoted there.

### 5.2 A manual end-to-end session

Driven against a real service started with `node src/viewer/server.mjs --port
8899`, core at the default `65536 x 65536`, stream read with `curl -N`:

| Request | Observed |
|---|---|
| `POST /api/command {"cmd":"set","cells":[[1,0],[2,1],[0,2],[1,2],[2,2]]}` | `{"ok":true,"changed":5,"population":5,"id":1}` |
| `POST /api/command {"cmd":"step","count":4}` | `generation=4`, `population=5`, `changed=4` |
| `GET /api/state` | `rule=B3/S23`, `world=65536x65536`, `generation=4`, `population=5`, `bounds=[1,1,3,3]` |
| `GET /api/frame?x0=0&y0=0&w=64&h=64` | `format=cells`, `64x64`, `generation=4` |
| `GET /api/events?x0=0&y0=0&w=64&h=64` | `: connected`, then `event: hello` with `clientId=1`, `protocolVersion=1`, `world=65536x65536`, `rule=B3/S23`, `representation=sparse`, then `event: frame` for the rectangle, carrying `cells`, `generation=4`, `population=5`. Nothing was asked for: the frame arrived on connect |
| `POST /api/representation {"representation":"tiled"}` | `switched=true`, `previousRepresentation=sparse`, `representation=tiled`, `exported={population:5, generation:4}`, `state`: `generation=4`, `population=5`, `bounds=[1,1,3,3]` |
| `POST /api/representation {"representation":"sparse"}` | `switched=true`, `representation=sparse`, `state`: `generation=4`, `population=5` |
| `POST /api/representation {"representation":"sparse"}` again | `switched=false`, `representation=sparse`: the no-op path, with no process replaced |
| `POST /api/representation {"representation":"nope"}` | `400` |
| `GET /api/events?x0=0&y0=0&w=64` (no `h`) | `400`, because a viewport must be all four parameters or none |
| `POST /api/subscription {"clientId":999,…}` | `404`, because no stream is open with that id |

**The two switches are the claim that matters here.** The world survived a real
process replacement in both directions: the generation stayed at `4`, the
population at `5`, and the bounds at `1,1,3,3`. A switch that preserved the cells
but reset the clock would have shown `generation=0`, so the figure distinguishes
"the cells were carried" from "the world was carried".

After the session: no `node` process remained and nothing was listening on the
port.

Two further observations from the same session, both artefacts of the order in
which the subscription route checks things: a subscription with a non-integer
`w` and an unknown `clientId` answers `404`, not `400`, and an over-budget
rectangle from an unknown client likewise answers `404`. The client id is looked
up **before** the rectangle is validated, so `unknown_client` takes precedence
over `bad_request`. That is the implemented order and
[interfaces.md](interfaces.md) §2.4 states it.

### 5.3 The admission rule, discriminated

The case that distinguishes the corrected admission rule from the superseded
one ([implementation.md](implementation.md) §3.3). A rectangle of `4097 x 4097`
has area 16,785,409, just above `MAX_FRAME_CELLS`; with 100,000 live cells the
superseded rule requires `25,600,000 <= 16,785,409` (false, so `400`) while the
corrected rule requires `6,400,000 <= 16,785,409` (true, so `200`).

Driven against a real service with 100,000 cells set through three `POST
/api/command` calls: `GET /api/frame?x0=0&y0=0&w=4097&h=4097` returned **`200`**,
`format=cells`, an 800,000-byte payload, in 40 ms.

The suite now contains that case — `admission uses the encoder rule, not a wider
one` — and it asserts both the admission and that the request reached the core.
The manual measurement above is what first discriminated the two rules; the case
is what keeps them discriminated. Closing the gap retired `VWR-02`; see §7.1.

### 5.4 The environment contract

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1 -SkipCpp
```

Exit `0`: the service and its tests write nothing outside the repository tree,
which is what the module claims in [data-flow.md](data-flow.md) §4. The push
transport does not change that: an event stream is a response held open, not a
file, and the representation switch carries the world through the core's
`export`/`import` rather than through an intermediate on disk.

### 5.5 The assertions are not idle, shown by mutation

An assertion that passes because it cannot fail is worse than no assertion, so
two of the contract checks were deliberately broken and the suite was re-run.
Both mutations were reverted; neither survives in the tree.

| Mutation | Observed |
|---|---|
| The light theme's `--alive` replaced with `oklch(0.6 0.1 250)` in `style.css` | The suite failed and named the cause: the canvas colour could not be parsed. Exit `1` |
| `palette.aliveRgb` renamed to `palette.aliveRGB` in `app.js` | The suite failed and reported a palette field that is read but never declared. Exit `1` |

The second mutation is the shape of the defect in §7.3, which is why it is the
one that was chosen.

### 5.6 The page is executed, not merely read

`tests/page.test.mjs` installs the synthetic browser and then imports the real
`public/app.js`, so the wiring that the contract suite can only inspect as text
is executed. The assertions are on what the page asked the browser to do:

* a `cells` frame produces one `fillRect` per live cell at the coordinate the
  frame named, plus the background, and exactly one grid `stroke`;
* a `bits` frame does not plot cells at all: it reaches `putImageData` on the
  **offscreen** canvas the page created, with exactly the live cells coloured and
  the rest transparent, and the offscreen canvas is then drawn to the visible
  one;
* a click sends one `toggle` with the cell under the pointer, and a drag sends
  none while changing the viewport;
* with a stream open, the scripted `fetch` is not called to discover changes, and
  a viewport change arrives as one `POST /api/subscription` instead;
* with the stream dropped, the page polls again.

This is the coverage that `VWR-06` and `VWR-08` asked for. It is not a browser:
see §6 for what it still cannot see.

### 5.7 One run that failed, and was not reproduced

One whole-suite run of this revision failed once, and the failure has not been
reproduced. It is recorded rather than discarded.

| | |
|---|---|
| **Observed** | Wall time **41.21 s** against a normal 4.0 s, and an `ERR_ASSERTION` with `actual: 0`, `expected: 1`, `operator: 'strictEqual'`, `code: 'ERR_ASSERTION'`. The summary lines of that run were not captured before the output was truncated, so the failing case is not named |
| **Not reproduced** | Four consecutive whole-suite runs afterwards, plus three runs each of `server.test.mjs`, `page.test.mjs` and `events.test.mjs` — thirteen runs, all green, all within 3.4–4.2 s |
| **Leading candidate** | The assertion is of the form "exactly one of something arrived". The two places that assert exactly one arrival are `events.test.mjs` (`the first frame arrives without being asked for`) and `page.test.mjs` (`the offscreen bitmap is drawn to the canvas`, `the bitmap reaches putImageData`). All three depend on a scheduled continuation landing before the assertion runs |
| **Why the tenfold wall time matters** | A run ten times slower than normal is a run under contention. The machine is shared, and the suites spawn real Node and Python processes; a timing assumption that survives an idle machine is exactly what such a run tests |
| **What it is not** | It is not the representation switch's concurrency case, whose own docstring records that it is timing-sensitive and accepts either legal outcome; that case asserts on the winner rather than on an arrival count |

Until this is understood, the suite's stability is a claim about the thirteen
runs recorded here rather than a property that has been established. It is
carried in [risks.md](risks.md) as `VWR-14`.

### 5.8 A fork, end to end

This is the observation the version exists for. A history was recorded through a
real core (`--history`), a node was selected in the middle of it, the world was
edited and stepped there, and the resulting tree was read back:

```
before: current=4 head=5 count=5
  nodes: 1(g0,p-) 2(g1,p1) 3(g2,p2) 4(g3,p3) 5(g4,p4)

select node 3 -> generation=2 population=5      (place one cell, step once)

after : current=3 head=7 count=7
  nodes: 1(g0,p-) 2(g1,p1) 3(g2,p2) 6(g2,p3) 4(g3,p3) 7(g3,p6) 5(g4,p4)
  children of node 3: 6(g2) + 4(g3)
  the old generation-4 node 5 is still present: True
```

Read against the four rules of [interfaces.md](interfaces.md) §2.6:

* Node `3` gained a **second child**. `4` is the generation that already
  descended from it and `6` is the new one, so the fork is visible as two
  children of one node rather than as two lists.
* Node `6` carries generation `2` — **the same number as its parent**. A person
  placed a cell at generation two, and placing a cell is not a step, so the label
  did not advance. This is the clearest evidence that the number is a label and
  the id is the identity.
* Node `7` carries generation `3` and descends from `6`: the step after the edit
  did advance, and it advanced from the branch that was just made.
* **Nothing was discarded.** Node `5`, the tip of the old branch, is still in the
  tree and still reachable, which is what the previous model's truncation would
  have deleted.

The same session through the service's own routes is driven in
`server.test.mjs`, so the property is also asserted rather than only observed.

### 5.9 Five assertions that changed because the interface became three documents

The split from one document to four routes changed where five existing facts are
asserted. None of them was weakened; each is recorded here with its reason, so a
later reader can tell a deliberate change from a check that was quietly relaxed.

| Assertion | Before | After, and why |
|---|---|---|
| The indentation of a tree row | The third row of a linear chain carried `--depth: '2'`, and both children of a fork carried `'3'` | The linear chain carries `'0'`, and a fork's children are asserted to be **deeper than their parent and equal to each other**. The indentation rule changed from absolute depth to fork depth, so the old numbers are now wrong by definition: asserting them would assert the defect the user reported |
| `the timeline is hidden when the core records no history` | `requestsTo('/api/history')` was `0` | `>= 1`. On a page whose subject *is* the tree, the page must ask in order to learn that nothing is recorded, so zero requests would mean the page never looked. The assertions that carry the user-visible fact — `timeline.hidden === true` and the note — are unchanged |
| A selection's effect | `readout-generation === '0'` after clicking a node | The row's `data-current` and `data-head` markers, and the same for the world page's readout in its own case. Selecting moves the world and the head, which the history page shows on the row; the history route has no canvas readout to assert, so the old locator would have been asserting a different page's element |
| `every id the page reads exists on the page` | One page, one list, fifteen ids | Per route against an **honest** synthetic document, plus both directions — every id a route's scripts read is declared by that route, and every id a fragment declares is read by that route's scripts — and a floor on the count (15 for the world route, 8 for the other two). The old single list could not express that the layout declares six ids on every route while a fragment declares the rest on one |
| `loading an archive … refreshes the history` | Asserted that the timeline was re-rendered after an import | Renamed `… reports what it did`, with the same assertions plus one added. Each route is its own document now, so an import on `/archives` cannot re-render a tree on `/history`; a cross-route refresh is not a thing that can happen, and asserting it would have been asserting a fiction |

### 5.10 The interface in a real browser

The suite executes the page against a synthetic browser, and the browser probe of
[tools/browser-probe/](../../../tools/browser-probe/) is the second opinion: it
starts the shipped service on a free port with **no history**, drives an installed
browser over the DevTools protocol, and checks what the page really does — that a
routed path is served, that a named element is the topmost at its own centre, and
that a declared press produces the request it is supposed to produce. It reports
three states, and it is honest about the third: `0` every check passed, `1` an
assertion failed, `2` it could not run — including a machine with no browser.

Two runs were taken while this file was written, and both are kept because the
second is what makes the first mean anything. The command is the same in both; only
the pressed control differs:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1 `
    -Topmost '#rule-apply' -Click '#rule-apply' -ExpectRequest /api/command
```

```
HEALTH (5 checks)
  PASS  health.page:/                    200
  PASS  health.page:/world               200
  PASS  health.page:/history             200
  PASS  health.page:/archives            200
  PASS  health.unknown:/__browser-probe-unknown-route   status 404
GEOMETRY (3 checks)
  PASS  geometry.topmost:#rule-apply     centre (673, 704) hits button#rule-apply
  PASS  page.loaded                      readyState complete, viewport 1250x805
  PASS  page.errors                      none
INTERACTION (3 checks)
  PASS  interaction.press                pointerdown 1, mousedown 1, pointerup 1, mouseup 1, click 1
  PASS  interaction.topmost:#rule-apply  centre (673, 704) hits button#rule-apply
  FAIL  interaction.request:/api/command
          expected: the page issues a request whose URL contains /api/command
          actual:   4 request(s), none matching
  REQUESTS
    during load (4)   GET /api/state, GET /api/frame?x0=32761&y0=32763&w=14&h=10,
                      GET /api/events, POST /api/subscription
    caused by the press (0)

RESULT  mismatch: 1 of 11 check(s) failed (exit 1)
```

The control run presses an existing control that submits through the same route:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1 `
    -Topmost '#step-once' -Click '#step-once' -ExpectRequest /api/command
```

```
GEOMETRY (3 checks)
  PASS  geometry.topmost:#step-once      centre (107, 704) hits button#step-once
  PASS  page.loaded
  PASS  page.errors
INTERACTION (3 checks)
  PASS  interaction.press
  PASS  interaction.topmost:#step-once   centre (107, 704) hits button#step-once
  PASS  interaction.request:/api/command  1 request(s), first POST /api/command
  REQUESTS
    caused by the press (1)  fetch POST 200 /api/command

RESULT  passed: 11 of 11 check(s) (exit 0)
```

**The first run was a defect, and the second run is the proof that the first one
means it.** The press reached `#rule-apply` — the topmost check and the press
sequence both passed — and the page then issued no request at all, while an
identical press on `#step-once` issued one. The rule button was therefore inert on
a freshly loaded page, and every suite was green while it was: the shell publishes
its context before its first `state` reply, so the page filled the rule field while
the shell's rule was still empty and never re-filled it afterwards. A person saw
the readout say `B3/S23`, an empty field beside it, and a local refusal when they
pressed `set`.

It was fixed inside the version that delivered the editor. The command below is
the confirmation, run after the fix against the same shipped service: the same
press now produces the request.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1 `
    -Topmost '#rule-apply' -Click '#rule-apply' -ExpectRequest /api/command
```

```
PASS  interaction.press
PASS  interaction.topmost:#rule-apply
PASS  interaction.request:/api/command
        actual:   1 request(s), first POST /api/command
  caused by the press (1)
    fetch       POST  200     /api/command

RESULT  passed: 11 of 11 check(s) (exit 0)
```

The defect record is §7.15 below, and [risks.md](risks.md) VWR-28 is retired
rather than open. The failing run above stays because it is the reason the probe's
interaction check exists.

This is the second time in the module's history that a real browser has found what
a green suite could not, and the first time the probe found it rather than a
person ([risks.md](risks.md) VWR-21). It is also the reason the probe's plan
exists in the form it does: `interaction.request` is the check that turns "the
press did nothing" into a red line, and it is the check that would have caught
this at the moment the control was added.

## 6. Deliberately not tested

| Not tested | Why, and what would catch it |
|---|---|
| Whether a line is crisp at a fractional device pixel ratio, and what the page looks like | The synthetic canvas **records** drawing calls; it does not rasterise. The arithmetic that decides the width and the centre is tested exactly, and the calls the page makes are asserted, but the pixels a real rasteriser produces are not. Checked by eye, and recorded as `VWR-10` |
| The event stream's 15-second heartbeat firing | It is unreferenced so that it can never keep the process alive, and the suite asserts the process exits with a stream open. The interval itself is not waited out, because a fifteen-second case would dominate the suite. A heartbeat that never fired would leave an idle connection to be dropped by a proxy, which loopback tests cannot reproduce. `VWR-11` |
| A second client's first-frame timeout, and slow-client behaviour beyond one held frame | The hub suite holds one frame open to prove coalescing. What happens to a client whose *first* frame never arrives, and what a second client sees while the first is stalled, is not covered. `VWR-12` |
| The cost of a representation switch on a large world | The switch round-trips the whole live set through the service. The suite switches a five-cell world; the payload at millions of cells is unmeasured. `VWR-13` |
| The concurrent-switch case under real contention | Its docstring records that it accepts either legal outcome, so it is written not to flake — but "written not to flake" is not the same as "measured under load", and §5.7 is the reminder that this machine is shared |
| The palettes' appearance, and whether a person can tell the two themes apart at a glance | Contrast ratios are computed and asserted; taste is not |
| Keyboard shortcuts | The handlers are registered and `dom-contract.test.mjs` checks the ids they bind, but no case dispatches a key. The stub could, and it has not been done |
| Whether a CSS selector actually matches, and what the interface looks like | `css-audit.test.mjs` reads the stylesheet and the markup as text and cannot evaluate a selector. It now proves more than it did — that a class a rule names sits where a class is borne, and that a `[data-panel]` rule's subject is on the element carrying `data-panel` — but specificity, ordering and an overriding declaration stay invisible. Recorded as [risks.md](risks.md) VWR-15 |
| Whether the tree's detail really reveals on hover or focus, and whether the animation reads well | The synthetic document records that the detail elements exist and carry their class; it evaluates no CSS, so nothing here decides that `:hover` or `:focus-visible` reveals them, that the transition animates, or that the indent cap keeps a row on screen. A headless browser would answer it and none is provisioned, because the module allows no dependencies. Recorded as [risks.md](risks.md) VWR-21 |
| Behaviour on a second browser, a second Node version or another operating system | No second environment is provisioned |
| Memory usage | No measurement taken |
| The `bits` path at the largest admissible rectangle | The case is reachable in principle and would need a world built at the cap; recorded in [performance.md](performance.md) §7 |

## 7. Defects found and fixed inside this version

### 7.1 The admission rule was four times more conservative than the encoder

| | |
|---|---|
| **Defect** | The service's frame admission rule read `population * 256 <= area`, and its comment and the module README both asserted it was the encoder's rule. The encoder's rule is `8 * live <= ceil(w / 8) * h`, which is `live * 64 <= area` up to the ceiling — so the service's form required four times the area for the same population |
| **Class of error** | The two sides of the comparison were in different units. The core's own encoder carries a comment recording an earlier defect of exactly that class, where a bit count was compared against a byte count |
| **How it was found** | By reading the encoder in [bridge.py](../../../src/lifegame/world/bridge.py) against the rule the service claimed to implement |
| **Fix** | The rule in [server.mjs](../../../src/viewer/server.mjs) and the zoom bound in [public/app.js](../../../src/viewer/public/app.js) were replaced by the encoder's own rule, and the module README was corrected. The rule then moved, when the push transport became a second caller, and moved again — into [public/shared.mjs](../../../src/viewer/public/shared.mjs) — when the page became a third, because the browser cannot import a server module. That file is the single declaration, and the constant beside it moved with it |
| **Verified** | The measurement in §5.3: `4097 x 4097` with 100,000 live cells returns `200`, which the superseded rule would have refused with `400` |

**Why the two existing boundary cases did not catch it.** Both landed on
rectangles where the two rules agree, so neither could distinguish them:

* the sparse whole-world case, `65536 x 65536` with a population of 100,000, is
  below both thresholds — `100,000 * 256` is far under 4.29e9 — so both rules
  admit it;
* the `4096 x 4096` case has an area exactly equal to `MAX_FRAME_CELLS`, so the
  second half of the rule (`area > maxFrameCells`) is false and the request is
  admitted whichever way the first half goes;
* the refused case, `4097 x 4097` with a population of 300,000, is above **both**
  thresholds (`300,000 * 256` and `300,000 * 64` both exceed 16,785,409), so both
  rules refuse it.

Two rules that differ inside a band are only distinguished by a case inside that
band. None of the three cases was, and the corrected suite would have passed with
the old rule restored. That gap was recorded as `VWR-02`, and it is now closed: a
fourth case sits inside the band by construction and asserts an admission the
superseded rule would have refused:

```js
assert.ok(area > MAX_FRAME_CELLS, 'the case must be over the area budget');
assert.ok(population * 64 <= area && population * 256 > area, 'the case must be in the band');
```

The two assertions are what make the case self-checking: if a future edit moves
either boundary so that the rectangle is no longer in the band, the case fails
for that reason rather than passing for the wrong one.

### 7.2 A stale statement of the rule survived in two source comments

The module docstring of [server.mjs](../../../src/viewer/server.mjs) and the
header comment of [public/app.js](../../../src/viewer/public/app.js) described
the encoder as choosing `cells` under the superseded form — an inequality with a
factor of thirty-two on the live count, and an explicit
`population * 256 <= area` — while the code below them used the corrected one.

| | |
|---|---|
| **Class of error** | A constant corrected in code and not in the prose that explains it. The harder direction to notice, because the reader trusts the comment and the tests trust the code |
| **How it was found** | By reading the two files against [interfaces.md](interfaces.md) while writing this record, not by a failing test |
| **Fix** | Both comments now state the rule the code implements, and the rule itself lives in [public/shared.mjs](../../../src/viewer/public/shared.mjs) with its derivation written there once |
| **Verified** | The statement and the code agree; the rule itself is pinned by the case in §7.1 |

### 7.3 The dense rendering path threw, and no gate could see it

| | |
|---|---|
| **Defect** | `paintBits()` still referred to `ALIVE_RGB`, a module-level colour constant that was deleted when the canvas colours moved into a palette cache read back from the stylesheet. Every `bits` frame — that is, every dense or mid-zoom view — threw a `ReferenceError` and painted nothing. The `cells` path was unaffected because it had been updated |
| **Class of error** | A reference left behind by moving a value. The name still existed in the reader's memory of the code, and the syntax was valid, so nothing complained |
| **Why no gate caught it** | `node --check` parses syntax and does not resolve bindings, so an undefined identifier is legal to it. The browser would have thrown at the first dense frame. The suite ran no browser, and the contract suite had a case asserting only that the file does not *declare* the old constant — which a stale *reference* satisfies |
| **How it was found** | By grepping the changed files for leftover identifiers while finishing the work, not by a test |
| **Fix** | The reference now reads `palette.aliveRgb`, the same source the coordinate path uses |
| **Verified** | The assertion was strengthened from "the file does not declare this constant" to "this identifier does not appear in the file at all", and two contract cases of the same shape were added. In this version the connection is executed as well: the page suite draws a `bits` frame and asserts the pixels, which is what `VWR-08` asked for |

This is the defect that `VWR-08` existed for, and it is why the page suite was
built. The static contracts catch a renamed field and a missing import; the page
suite catches a path that is only wrong when it runs. What neither catches is
whether the result *looks* right, which is §6's first row.

### 7.4 The hub subscribed every new client to a rectangle outside a small world

| | |
|---|---|
| **Defect** | The hub's default subscription was a page-sized `1024 x 768` rectangle at the origin. On a world smaller than that — every test world, and any operator who starts the service with `--width 64` — the rectangle is outside the world, and the core answers such a request with an error rather than a frame. A new subscriber to a small world therefore received an `error` where a `frame` belonged |
| **Class of error** | A default that is correct for the design target and wrong for every smaller world. The default was chosen for a `65536 x 65536` world and never re-examined against the world the core actually described |
| **How it was found** | By the hub suite, which subscribes a client to a `64 x 48` world — that is, by a test written for the push transport, on its first run |
| **Fix** | `#clampToWorld` fits every subscription inside the world the core reported in its `hello`, and `addClient` computes that fit **before** sending `hello` to the client, so the `hello` and the frame that follows describe the same rectangle |
| **Verified** | The hub case `a rectangle larger than the world is clipped, not refused`, and the server case that reads a real stream against a real core |

### 7.5 The hub's admission rule needed a population the core does not announce

| | |
|---|---|
| **Defect** | The hub applies the same admission rule to a pushed frame as the REST route does, and that rule needs a population. The core's `hello` reply does not carry one — it describes the world's size, not its contents — so the hub's first admission decision would have been made with a population of zero, and a population of zero admits **any** rectangle, including one whose bitmap would be gigabytes |
| **Class of error** | A guard whose input arrives by a different path than its caller assumes. The REST route learns the population from the replies it forwards; a hub that pushes frames never sees a request to learn from |
| **How it was found** | By reasoning about the first frame during the design of the hub, and then pinned by the hub case `a frame the encoder would refuse becomes an error, not a request` |
| **Fix** | The service passes the hub two things: a `population()` reader for the number it has already seen, and an `onPopulation` callback the hub calls with every population it sees for itself. The hub uses the **larger** of the two, because erring towards a refusal is the safe direction |
| **Verified** | The hub suite's refusal case, which asserts that the refused rectangle never reached the core at all, and the admitted-rectangle case that asserts the complementary half |

Both of these are the same shape: a new caller of an existing rule, arriving with
less context than the original caller had. Neither was visible from the REST
route's tests, and both were found by the suite written for the new caller.

### 7.6 Two failures that were the test scaffolding, not the product

Recorded separately because "the test failed" and "the code failed" are different
findings, and the first instinct on a red suite is to assume the second.

| | |
|---|---|
| **Symptom** | The page suite failed intermittently, and a case that had passed alone failed when the whole file ran |
| **Cause** | The teardown clicked the Run control unconditionally to stop a run loop. On a page that was **not** running, that click *started* one, and the page's poll timer reads `globalThis.fetch` at fire time — so the loop left behind by one case fired against the next case's stub. The suite was measuring itself |
| **Fix** | The teardown stops the loop only when the page is actually running, and the timer is cleared; the stub install is per-case and the globals are removed at the end of each case |
| **Second cause** | The bitmap path composes on an **offscreen** canvas, and an assertion looked for `putImageData` on the visible canvas's recorded calls. The stub models two canvases because the page creates two, and the assertion was asking the wrong one |
| **Fix** | The stub keeps every canvas it hands out, and the assertion reads the offscreen one. The visible canvas is asserted to receive one `drawImage` |

Neither cause was a defect in `app.js`; both were the harness being less
careful than the code. They are recorded because a harness that lies is worse
than a harness that is missing, and because the poll timer's read-at-fire-time
behaviour is a real property of the page that the harness has to respect.

### 7.7 An edit between two generations broke the recorded chain

| | |
|---|---|
| **Defect** | `set`, `toggle`, `clear` and `import` change the world **between** two generations, so the delta that brought the world to the current generation no longer describes where the next step starts. The chain replayed to a world that never existed |
| **Class of error** | Two subsystems each correct alone and wrong together: the core records a generation when it steps, and a mutation is not a step. Nothing in either half was wrong; the sequence was |
| **How it was found** | By the **store's own replay validation**, on the first hand-driven session: `generation 1 kills (1, 0), which is not alive`. The validation exists because a corrupted chain produces a plausible wrong world rather than an error, and it reported the corruption at the generation where it happened |
| **Fix** | An edit **amends the head** rather than recording a plain new generation: the head's own row is rewritten as a keyframe when nothing descends from it, and a new node is added when something does — which is the case exactly after selecting an older node. The distinction is the difference between editing the present and editing the past, and it is what stopped a single placed cell from producing a second generation zero. Recorded in [implementation.md](implementation.md) §3.14 |
| **Verified** | A server-suite case edits the world with a history attached, steps it, and reads a generation on both sides of the edit; the replay validation would fail the case if the keyframe were not written. The fork itself is §5.8 |

### 7.8 Closing the service did not stop the core, and a locked store looked like a flaky suite

| | |
|---|---|
| **Defect** | After a whole-suite run the machine was left with **two `node` and two `python` processes**. The orphaned cores still held the history store open, so the next cleanup failed with `EBUSY` on `history.db` — and because the symptom is a file that will not delete, it presented as an intermittent failure rather than as a lifecycle bug |
| **Cause (a)** | The suite's `after` hooks ran in an order that let a case's own cleanup delete the store *before* the viewer had closed, so the core was still running when its file was removed |
| **Cause (b)** | The cleanup used a single `rm(force)`, which neither tolerates Windows' brief hold on a just-closed file nor removes the `-wal` and `-shm` sidecars. Deleting the main file while a sidecar remains is itself a state the next run inherits |
| **Fix** | The cleanup stops the core **first**, explicitly, then deletes the three files together, with a retry for the short window in which Windows still holds them |
| **Verified** | A whole-suite run leaves no `node` and no `python` process, and the store's three files are gone. The residual risk for an operator who kills the service rather than closing it is [risks.md](risks.md) VWR-17 |
| **Secondary effect, recorded** | Because the previous failure leaves a locked file, one failure used to make the *next* run fail too. A lifecycle bug therefore looked like a random red gate, which is the most expensive shape a defect can have in a suite used as a gate |

### 7.9 Two shared style rules each omitted a control

| | |
|---|---|
| **Defect** | The layout rule for a control group listed the groups **by name**, so the storage select had no layout; and the `select` appearance rule was scoped to one control's class, so the storage and language selects rendered with the browser's own chrome |
| **Class of error** | A rule that enumerates its members instead of matching them. Neither was visible in the stylesheet, because a missing rule has nothing to look at, and neither would fail any test that merely renders the page |
| **How it was found** | By reading the stylesheet against the page while adding the language control — the second select to be added made the scoping obvious |
| **Fix** | One shared layout rule (`.control`) that every control group carries, and one appearance rule that matches `select` and `button` **by element**, so a control added later looks like the ones beside it. A test asserts both, and that no appearance rule is scoped to a single control |
| **Verified** | [tests/css-audit.test.mjs](../../../src/viewer/tests/css-audit.test.mjs), which asks the inverse question — does every token exist, and is every control covered — and which states its own limit: it cannot evaluate a selector ([risks.md](risks.md) VWR-15) |
| **Kept as a method** | The audit is the durable output of these two defects: the next control added is checked by a test rather than by a reviewer remembering. The method is recorded in [implementation.md](implementation.md) §3.13 |

### 7.10 Two gesture defects that only a gesture produces

Both were found while building the two-finger support, and neither is visible in
a specification of the gesture.

| | |
|---|---|
| **Defect (a)** | A two-finger drag **pumped the zoom**: the view zoomed in and then back out, measured at `span 512 → 1024 → 102` |
| **Cause (a)** | Two fingers moving arrive as two separate `pointermove` events, one finger at a time. Deriving each step from the previous frame composes those intermediate states, so the spread of the pair is momentarily wrong in one direction and then the other |
| **Fix (a)** | Every step is derived from the samples taken when the gesture **began**, not from the previous frame. This removes the intermediate state rather than smoothing it, which is why the pumping is gone rather than smaller |
| **Defect (b)** | Lifting the remaining finger after a pinch was treated as a **tap**, which toggled the cell underneath it |
| **Cause (b)** | The single remaining pointer looked like a fresh one-finger press, and its release was within the click threshold |
| **Fix (b)** | A drag that continues from a pinch is marked as already moved, so it is never a click |
| **Verified** | [tests/viewport.test.mjs](../../../src/viewer/tests/viewport.test.mjs) asserts the pinch anchor as an equality — the world point under the midpoint does not move — and the transition when a finger arrives or leaves; [tests/page.test.mjs](../../../src/viewer/tests/page.test.mjs) drives the gestures through the synthetic browser and asserts the resulting cell and viewport |
| **Why both are recorded** | They are the class of defect that a real finger finds and a code review does not, and the synthetic pointer sequence is what turns them into something a gate can see |

### 7.11 The history page drew no tree, and no test could see it

| | |
|---|---|
| **Defect** | When the interface was split into routed pages, the history fragment did not carry the `#timeline` container. The history page's script binds `#timeline` and returns early when it is null, so in a real browser that page rendered **no tree at all** — an empty region where the recorded history should have been |
| **Class of error** | The synthetic document **invented an element** the first time a script looked one up. A page whose markup omitted a container its script required therefore did not fail: the stub conjured the element, handed it over, and the script went on working. The gap was not an untested case; it was an untestable one, and it made every mark-up-versus-script assertion in the suite incapable of failing |
| **How it was found** | By a person opening the page, not by a test. The suite was green |
| **Fix** | Three things, because a symptom this shape needs the mechanism removed rather than the instance patched. The fragment carries `#timeline` and its list and note again; `dom-stub.mjs` returns **null** for an id the markup does not declare, so a missing container is now visible to every case at once; and `dom-contract.test.mjs` asserts **both directions** per route — every id a route's scripts read is declared by that route, and every id a fragment declares is read by that route's scripts |
| **Verified** | Deleting `id="timeline"` from the history fragment fails **nine** cases, one of them named `the history page has no element with id="timeline"`. Before the fix the same deletion failed none |

### 7.12 The panel's three states had no styling at all

| | |
|---|---|
| **Defect** | Five stylesheet rules keyed off `.stage[data-panel='collapsed']` and its siblings. The split renamed the element's class to `page page-split` and left it only the id `stage`, so collapse and full width matched **nothing**. The controls worked, the logic was covered by seven cases, and the panel never changed shape in a browser |
| **Class of error** | The stylesheet audit asked whether a class the stylesheet names is *used somewhere*, and the token `stage` occurred in the markup as an id — so a rule that applied to nothing survived an audit written to find exactly that. The check was on the word, not on the thing |
| **How it was found** | By strengthening the audit, not by looking for the defect. Requiring a class to appear in a class-bearing position immediately reported four `.stage` rules and a group of `.archives` rules that applied to nothing |
| **Fix** | The panel rules hang off the element's real classes plus `data-panel`. The audit now requires a class the stylesheet names to appear where a class is borne (`class=`, `className=`, `classList.add\|remove\|toggle`), and a new case asserts that a `[data-panel]` rule's subject class is on the element that really carries `data-panel` |
| **Verified** | Adding a dead rule `.stage[data-panel='ghost'] .phantom` fails **two** cases. Under the previous audit the same rule passed, because `phantom` would have counted as used for having been written down |

Both defects share a shape worth naming: each was a **disagreement between two
files** that the suite checked one file at a time. Neither was a logic error, and
neither could be found by reading the module that was wrong.

### 7.13 Four defects in one row, reported as one complaint

The report was that the history page "cannot be shown as a tree", rows
"duplicate and overlap", and a single row "fills the whole screen, lacking
information and wasting space". Those are four independent mechanisms, and each
is worth naming because three of them are the kind a stylesheet hides.

| | Defect | Mechanism |
|---|---|---|
| 1 | **Rows overlapping, one node two or three rows tall** | `.timeline-row` was declared as a four-track grid, and the branch, fork, head and current marks were appended as **further grid items** with no `grid-auto-flow`. Every item past the fourth therefore landed in an **implicit row**: a node carrying all four marks was `ceil(8 / 4)` = 2 rows, and one carrying more was taller still |
| 2 | **A single row filling the screen** | The row was `inline-size: 100%` in what was, at the time, the only column. Nothing was competing for the width because there was nothing beside it |
| 3 | **The detail changing the row's height** | The node's numbers were **in-flow** grid items collapsed by animating `max-inline-size` from `0` to `26ch`. Animating a track's content changes the track, so opening a detail added a row and shifted every row beneath it — the reveal moved the thing it was revealing |
| 4 | **Not recognisable as a tree** | Indentation was `padding-inline: calc(4px + var(--depth) * 14px)` and nothing else: a fourteen-pixel shift per level, with no line between a parent and its children. Worse, the window cuts the list from the front and the indentation is rebased on the shallowest row shown, so a window that had cut a branch's root flattened the very indentation that was carrying the structure |

| | |
|---|---|
| **Class of error** | Three of the four are layout, and the module's tests read the **model** of the layout rather than the layout. A grid that spills into implicit rows, a track whose content is animated, and a `padding` that is too small to read are all invisible to a case that asserts a class name |
| **How it was found** | A person looked at it. The suite was green throughout, at 255 cases, including cases asserting the row's classes, its `data-` attributes and its indentation level |
| **Fix** | The marks are collected into **one** in-flow container, so the in-flow children are always exactly two and match two tracks however many marks are set. The numbers move into a `position: absolute` overlay, so opening a detail cannot change a track. Indentation becomes one fourteen-pixel slot per fork level carrying a connector glyph (`line`, `elbow`, `end`, `blank`, computed by `GUIDE_KINDS` in [public/history.mjs](../../../src/viewer/public/history.mjs)), so the parent-child relation is drawn rather than implied. The page becomes two columns, which is what stops a row from being the whole page. And the reveal becomes a single `data-open` state the page sets, so the pointer and the keyboard open exactly the same thing |
| **Verified** | The page suite asserts the number of **in-flow** children of a row against the track count read from the stylesheet, and that the numbers are in an absolutely positioned element. That is a model of the layout, not the layout — see §6 |
| **Still owed** | Whether the connectors meet the previous row, the pixel height of a row, how the overlay's transition looks, the two columns at a narrow width, and both palettes have **never been seen in a browser** |

### 7.14 Four test assumptions that the change falsified

Not defects in the product, and recorded because each one would have read as a
failure of the product the next time somebody ran it.

| Case | Was | Now | Why |
|---|---|---|---|
| The default frame of a whole world | `64 x 48` | `13 x 10` | The default view is derived from the canvas width over `DEFAULT_PIXELS_PER_CELL`, not from a fixed span |
| Click and drag coordinates | hard-coded at `12.5` pixels per cell | derived from the frame rectangle | The same reason: pixels per cell is a consequence of the canvas, and a test that hard-codes it breaks whenever the default view changes |
| A drag distance | `50` pixels | `300` pixels | At thirteen cells across an 800-pixel canvas, fifty pixels is not a whole cell, so the case was no longer testing a pan |
| The first row of the tree | `children[0].children[0]` | the first item **carrying a node id** | A windowed list starts with an "earlier" control, which is also a button. Selecting a row by position read the control and found no details on it |

### 7.15 The rule editor's button did nothing on a fresh page

Found by the browser probe, after the suite had been green at 337 cases. The
shell publishes its context **before** it awaits its state, so the page module
starts while `state.rule` is still empty; the field was filled only during
start-up, and only when a rule was already known. On a real first load the readout
and the select correctly showed `B3/S23` while the field was empty, and pressing
the button submitted an empty string, which was refused locally in words. The
command the control exists to send was unreachable until somebody typed a rule.
The two probe runs are in §5.10, and the failing one is kept there: the control run
that presses `#step-once` is what made the absence of a request on `#rule-apply`
mean something.

**Fixed** by filling the field the first time a rule arrives, and never again once
the person has typed in it: a field that rewrites itself under a typist is worse
than an empty one. The synthetic browser now reproduces the real order with a
handshake the case releases itself —
`test('the field opens on the running rule, which arrives after the page has started')`
in [rule-page.test.mjs](../../../src/viewer/tests/rule-page.test.mjs) — and asserts
the field was empty before, that it opens on the rule after, and that the button
then sends that rule. The probe confirms the same press against a real browser
(§5.10). This is why the probe is part of the gate rather than a tool somebody
remembers to run: the suite was green through the defect, and the synthetic
document had established the rule in an order a real page does not produce.

## 8. Inputs that would change the expectations

| Input | What it would change |
|---|---|
| A new command in the core's line protocol | Nothing in the suites: commands are forwarded generically. A new **encoding**, however, would need [decode.mjs](../../../src/viewer/public/decode.mjs) and its suite |
| A change to the encoder's rule in [bridge.py](../../../src/lifegame/world/bridge.py) | `frameAdmission` in [public/shared.mjs](../../../src/viewer/public/shared.mjs), the zoom bound in [public/viewport.mjs](../../../src/viewer/public/viewport.mjs), the two admission cases in the server suite (the boundary one and the band one), the shared suite's boundary cases, the hub's refusal case, and the rule's statement in [interfaces.md](interfaces.md) §3 — together, in one work item |
| A change to `MAX_FRAME_CELLS` | The same places. The constant itself is declared once, in [public/shared.mjs](../../../src/viewer/public/shared.mjs), so there is no second copy to forget |
| A new event name, or a change to an event's payload | The hub suite, the server suite's stream case, the page suite's stream cases, and the event table in [interfaces.md](interfaces.md) §2.3 |
| A new browser API used by the shell or by a page module | [tests/dom-stub.mjs](../../../src/viewer/tests/dom-stub.mjs). The page suite throws on the missing capability rather than skipping the path, which is deliberate. A capability used only by one page still needs the stub, because the stub is shared by all four routes |
| A fourth route, or a change to the paths of an existing one | [routes.mjs](../../../src/viewer/routes.mjs) and nothing else on the server side: the dispatch, the tab bar and the script set are all read from its `ROUTES`, so adding a route is adding an entry plus a fragment and a page module. Then the routes suite (the nav, the script set, the fragment), the DOM contract cases (the ids that route declares and reads), and [interfaces.md](interfaces.md) §2.7 |
| A fifth layout slot, or a renamed one | `LAYOUT_SLOTS` in [routes.mjs](../../../src/viewer/routes.mjs) and the slot in [layout.html](../../../src/viewer/public/pages/layout.html), together: a slot the composer does not supply **throws**, so the two cannot drift silently. The routes suite compares the two sets |
| A change to the shell's context, or to the handshake | [public/link.mjs](../../../src/viewer/public/link.mjs) owns both event names, so the shell and the pages move together or not at all; the shell publishes the context and every page case that connects a module would fail if the handshake broke. What the context *contains* is checked by whichever page case reads a field, and by no contract case — [risks.md](risks.md) VWR-22 |
| A change to how the tree is indented, or to the window | [public/history.mjs](../../../src/viewer/public/history.mjs), its suite, the `timeline-detail` rules in [style.css](../../../src/viewer/public/style.css), and the indentation and window statements in [interfaces.md](interfaces.md) §14. The rule is **fork depth**; a client that indented by tree depth would walk a long linear run off the panel |
| A change to the default view, or to what a canvas opens at | [public/viewport.mjs](../../../src/viewer/public/viewport.mjs) (`DEFAULT_PIXELS_PER_CELL`, `defaultSpan`, `worldCentre`, `viewCentre`, `centreViewport`), and the two page modules that apply it — the world canvas and the preview canvas, so a cell stays the same size in both. The viewport suite asserts the span is a canvas width over the constant and that the world's centre lands at the centre of the viewport, at four canvas aspects; the world page suite asserts no frame is asked for before both the canvas and the world size are known |
| A change to the live-set cap, or to what a preview centres on | `MAX_CELLS_FOR_NEAREST` in [public/shared.mjs](../../../src/viewer/public/shared.mjs), the `/api/cells` reply in [server.mjs](../../../src/viewer/server.mjs), `nearestCell` and `previewFocus` in [public/history.mjs](../../../src/viewer/public/history.mjs), the note the page shows when the set was too large, and the route row in [interfaces.md](interfaces.md) §2.2 |
| A third representation, or a change to `REPRESENTATIONS` | `bridge.mjs`'s constant, the `<select>` the world page fills from it, the contract case that compares them, the switch case in the server suite, and [interfaces.md](interfaces.md) §2.5 |
| A palette variable renamed in the stylesheet, or a fourth one added | `theme.mjs`'s `CANVAS_PALETTE_KEYS`, `readPalette` in `app.js`, and the contract case that asserts the three exist and parse. A renamed variable is caught; a new one the canvas should read is not, because the list is what the canvas reads |
| A third theme, or a change to the set of offered grid widths | `THEMES` or `GRID_WIDTHS` in `theme.mjs`, the `<select>` the world page fills from them, and the two contract cases that compare them with the module's constants |
| A build step or a bundler for the page | `dom-contract.test.mjs`, `page.test.mjs` and `routes.test.mjs` read the layout, the fragments and the scripts as text and import them by path, and the service serves them by path; all three assume `public/` is what the browser runs |
| A second client per world | The bridge's one-request-in-flight contract would have to be revisited, and the serialisation test with it |
| A branch in the recorded history, or a change to how one is made | The tree case in the server suite, the page suite's flattening and fork-marking cases, the four rules in [interfaces.md](interfaces.md) §2.6, and §5.8 here — together, in one work item. The flattening is by `parent`; a client that grouped by generation number would merge two branches into one row per number |
| A third panel state, or a change to what a control does | [public/panel.mjs](../../../src/viewer/public/panel.mjs), the stage's `data-panel` values in [style.css](../../../src/viewer/public/style.css), the option the controls set, and the panel suite's transition cases |
| A new archive route, or a change to name confinement | The archive cases in the server suite, including the forty traversal refusals, the manager's cases in the page suite, and [interfaces.md](interfaces.md) §2.6 |
