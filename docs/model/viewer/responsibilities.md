# viewer — responsibilities

> This file owns the claims the module makes about itself, the boundary against
> each peer, the behaviour required when something fails, and the things it must
> never do. What the module *exposes* is owned by [interfaces.md](interfaces.md);
> how a request moves is owned by [data-flow.md](data-flow.md).

## 1. Claims this module owns

| # | Claim | Where it is observable |
|---|---|---|
| C1 | The service is a transport: it returns the core's reply with the core's own `ok`, `error`, `message` and `id` fields, and never rewrites, reinterprets or invents one | A client reads an `out_of_bounds` refusal from the same place it would read it from the core |
| C2 | The service decides exactly two things itself: where a static file may be read from, and whether a `frame` rectangle is admissible | [interfaces.md](interfaces.md) §2 and §3 |
| C3 | The service starts, supervises and stops the core as one child process, with one request in flight at a time | [bridge.mjs](../../../src/viewer/bridge.mjs); [data-flow.md](data-flow.md) §3 |
| C4 | A core that dies is restarted transparently, and a core that keeps dying is not restarted for ever | [interfaces.md](interfaces.md) §4.3; [testing.md](testing.md) §4 |
| C5 | The page renders a frame at one cell per pixel of the requested rectangle, so the rectangle is both what is covered and how much detail exists | [interfaces.md](interfaces.md) §3 |
| C6 | Both frame encodings are decoded by the browser's own code, and a malformed payload is reported rather than half-drawn | [decode.mjs](../../../src/viewer/public/decode.mjs); [testing.md](testing.md) §4 |
| C7 | The service writes no file and holds no session. One file is created by the **core** at the operator's request — the history store — and one more per archive export; both are named by the operator and both default inside the repository | [data-flow.md](data-flow.md) §4; [interfaces.md](interfaces.md) §2.6 |
| C8 | The page keeps loading, and shows the reason, while the core is unavailable | [testing.md](testing.md) §4, the `503` cases |
| C9 | The theme is resolved by one rule, stated once: a stored `dark` or `light` is an explicit choice and wins, and anything else means "follow the system" | [theme.mjs](../../../src/viewer/public/theme.mjs); [interfaces.md](interfaces.md) §6.2 |
| C10 | The two palettes live in the stylesheet, and the canvas reads the three colours it needs back out of the active one. A value the parser cannot read leaves the previous colour in place | [interfaces.md](interfaces.md) §7.2; [style.css](../../../src/viewer/public/style.css) |
| C11 | A theme change or a grid-width change redraws the frame already on screen and sends no request to the core | [data-flow.md](data-flow.md) §3.6; [implementation.md](implementation.md) §3.8 |
| C12 | Grid lines are drawn only while a cell is large enough to separate, at a width snapped to whole device pixels, in the theme's own line colour | [interfaces.md](interfaces.md) §7.3 |
| C13 | A change the service knows about is **pushed** to every subscriber on one connection per client, and the page asks for nothing to discover it | [interfaces.md](interfaces.md) §2.3; [data-flow.md](data-flow.md) §3.2 |
| C14 | A subscriber that falls behind is **coalesced, never queued**: at most one frame is being built per client, however fast the core runs | [implementation.md](implementation.md) §3.10; [performance.md](performance.md) §2 |
| C15 | A subscription rectangle is fitted inside the world rather than refused, and a rectangle the encoder cannot serve cheaply is refused with an `error` event under the same rule the REST route applies | [interfaces.md](interfaces.md) §2.3; [implementation.md](implementation.md) §3.10 |
| C16 | Polling is a **supported fallback**, not a legacy path: with no `EventSource`, or after a stream drops, the page keeps working by asking for frames on a timer | [interfaces.md](interfaces.md) §10; [testing.md](testing.md) §4 |
| C17 | The representation can be switched from the interface without losing the world: the live set, the population **and the generation** cross a real process replacement, and the window in between is never observable | [interfaces.md](interfaces.md) §2.5; [data-flow.md](data-flow.md) §3.7; [testing.md](testing.md) §5.2 |
| C18 | Every user-visible string in the module comes from one table per language, and the two tables have identical key sets with no empty entry. The page carries no prose of its own | [locales.mjs](../../../src/viewer/public/locales.mjs); [interfaces.md](interfaces.md) §6; [testing.md](testing.md) §5 |
| C19 | The core's `message` is **not** translated. It is a diagnostic written by the core; what is translated is the label for a known error code, and the core's message is appended to it as detail | [interfaces.md](interfaces.md) §12.3; [responsibilities.md](responsibilities.md) §3.6 |
| C20 | The language is resolved by one rule, stated once: a stored supported language is an explicit choice and wins, and anything else follows the browser's own preference, falling back to the catalogue's default | [locales.mjs](../../../src/viewer/public/locales.mjs); [interfaces.md](interfaces.md) §12.4 |
| C21 | Every value the service and the page must agree on is declared **once**, in a module both import: the frame budget, the admission rule that uses it, the default view, and the interpolation of the core's declared limits | [shared.mjs](../../../src/viewer/public/shared.mjs); [interfaces.md](interfaces.md) §5 |
| C22 | A bound that belongs to the core is read from `hello.limits` and never invented. A bound the core did not declare becomes `null`, and the control that would have used it is **unavailable** rather than set to a plausible number | [shared.mjs](../../../src/viewer/public/shared.mjs); [interfaces.md](interfaces.md) §5.2 |
| C23 | The recorded history is the **core's**, exposed by the service as a **tree** of nodes that each name their parent, plus a select, a rollback and the archive routes. A select or a rollback moves the world, so every subscriber is told the new state rather than only the caller | [interfaces.md](interfaces.md) §2.6; [data-flow.md](data-flow.md) §3.8 |
| C24 | An archive name is a **name**, not a path: every archive route resolves it through one function inside the archive directory, and a separator, a drive letter or a traversal is refused rather than repaired. A request never chooses where the service reads or writes | [server.mjs](../../../src/viewer/server.mjs); [testing.md](testing.md) §5 |
| C25 | Every control group shares one layout rule and every `select` and `button` shares one appearance rule, so a control added later looks like the ones beside it | [style.css](../../../src/viewer/public/style.css); [implementation.md](implementation.md) §3.13; [testing.md](testing.md) §7.9 |
| C26 | Editing the world keeps the recorded history replayable **and** is where a branch can be made: an edit amends the head's own node when nothing descends from it, and adds a node when something does — which is the case after selecting an older node | [implementation.md](implementation.md) §3.13; [testing.md](testing.md) §7.7 and §5.8 |
| C27 | Reading a recorded generation and working on one are **two operations**. A rollback loads a node and leaves the recording head alone; a select moves the head, and moving it is what makes the next record a sibling of what the selected node already has. One operation doing both would make looking at history destructive | [interfaces.md](interfaces.md) §2.6; [data-flow.md](data-flow.md) §3.8 |
| C28 | A generation number is a **label**, not an identity: two branches may hold a node with the same number, so the page groups nodes by `parent` and a generation-addressed request answers for the branch the world is on and refuses a number that exists only on another branch rather than guessing | [interfaces.md](interfaces.md) §2.6; [testing.md](testing.md) §5.8 |
| C29 | The panel has three states — a column, hidden with the canvas taking the space back, and full width with the canvas stepping aside. Collapsing changes the layout instead of covering the canvas, the handle stays visible in all three, and an unrecognised stored value means no preference rather than the nearest state | [public/panel.mjs](../../../src/viewer/public/panel.mjs); [interfaces.md](interfaces.md) §7; [testing.md](testing.md) §1 |
| C30 | A two-finger pinch zooms about the **midpoint of the fingers**, so the world point under that midpoint does not move — the same anchoring rule as the wheel — and a two-finger drag pans. One finger keeps its meaning: a press that moves at most four pixels toggles a cell, and a drag pans | [public/viewport.mjs](../../../src/viewer/public/viewport.mjs); [testing.md](testing.md) §7.10 |
| C31 | The archive manager never asks the client for a path and never overwrites: a rename onto a taken name is refused, and a delete takes a second press, because it is the one action there that cannot be undone | [interfaces.md](interfaces.md) §2.6; [testing.md](testing.md) §5 |
| C32 | The interface is **four routes declared in one table**: `/` and `/world`, `/history` and `/archives`. The dispatch, the tab bar and the script set are all read from that table, so a route cannot exist in the navigation without existing in the service. A path nobody serves answers `404` rather than falling back to a page, because a fallback would make every typo look like a working address | [routes.mjs](../../../src/viewer/routes.mjs); [interfaces.md](interfaces.md) §2.7; [testing.md](testing.md) §1 |
| C33 | A page is the **one shared layout plus one fragment**. A slot the composer does not supply **throws** rather than being emitted, because `{{nav}}` reaching a browser is a rendering bug that is invisible on the server. A fragment carries no `<html>`, `<head>` or `<body>`, so a page has exactly one of each and exactly one `<title>` | [routes.mjs](../../../src/viewer/routes.mjs); [interfaces.md](interfaces.md) §2.7; [testing.md](testing.md) §1 |
| C34 | The shell and a page module **never import each other**. The handshake is two event names owned by one module, and it works whichever of the two loads first — the page asks for the context, and the shell also publishes it once at start-up. A page module importing the shell would resolve a second copy that has already run and discarded its state | [public/link.mjs](../../../src/viewer/public/link.mjs); [interfaces.md](interfaces.md) §13; [risks.md](risks.md) VWR-22 |
| C35 | The history is drawn as **nodes**: a row shows a generation and a branch mark, and the node's own numbers are revealed while the pointer is over it **or it holds keyboard focus**. Indentation is **fork depth**, one level only where the tree actually parts and capped, so a linear run stays in one column instead of walking off the panel | [public/history.mjs](../../../src/viewer/public/history.mjs); [interfaces.md](interfaces.md) §14; [testing.md](testing.md) §1 |
| C36 | A route's markup and its scripts agree **in both directions**: every id a route's scripts read is declared by that route, and every id its fragment declares is read by that route's scripts. The synthetic document the tests use returns `null` for an id the markup does not declare rather than inventing one, so a container a page needs and does not have fails the suite instead of passing it | [dom-contract.test.mjs](../../../src/viewer/tests/dom-contract.test.mjs); [testing.md](testing.md) §7.11; [risks.md](risks.md) VWR-15 |
| C37 | The view a canvas opens with is **derived from that canvas**, by one rule with one declaration: one world cell per `DEFAULT_PIXELS_PER_CELL` (60) CSS pixels across, with the world's centre in the middle of the view. The rule lives in [public/viewport.mjs](../../../src/viewer/public/viewport.mjs) and nowhere else, and no fixed span, aspect or rectangle is declared by the service or the page | [public/viewport.mjs](../../../src/viewer/public/viewport.mjs); [implementation.md](implementation.md) §3.7; [testing.md](testing.md) §1 |
| C38 | A subscription rectangle is **all four parameters or none**, and **"none" means no frame**: a client that has not named a rectangle is told `hello` and shown nothing. There is no service-side default view, because a default would be a second declaration of a rule that needs a canvas the service cannot measure | [events.mjs](../../../src/viewer/events.mjs); [interfaces.md](interfaces.md) §2.3; [data-flow.md](data-flow.md) §3.2 |
| C39 | A degradation is **stated in words**, never silent. When the live set is too large to send, the preview centres on the core's `bounds` and the note beside the canvas says which of the three sources decided the centre — a cell, a bounding box or the middle of the world | [public/history.mjs](../../../src/viewer/public/history.mjs); [interfaces.md](interfaces.md) §11; [data-flow.md](data-flow.md) §3.14 |
| C40 | A preview is centred by a rule with a declared order: the live cell **nearest to where the world route was last looking**, then the middle of the core's `bounds` when the live set was too large to read, then the **middle of the world** when there is nothing alive. The remembered point is world coordinates in browser storage, so the two routes may disagree about their canvas and still mean the same place | [public/history.mjs](../../../src/viewer/public/history.mjs), [public/focus.mjs](../../../src/viewer/public/focus.mjs); [interfaces.md](interfaces.md) §14; [testing.md](testing.md) §1 |
| C41 | The tree's **connector geometry is a pure function**: `flattenHistory` returns one guide kind per level from the closed set `line`, `elbow`, `end` and `blank`, so which parent a row hangs from, and which of two siblings continues below, is assertable without a DOM. The stylesheet draws what the function decides; the function never reads a style | [public/history.mjs](../../../src/viewer/public/history.mjs); [implementation.md](implementation.md) §3.15; [testing.md](testing.md) §1 |
| C42 | **The rule is the core's, and the page is a front for one command.** The page offers eight presets and one parser, refuses a malformed value locally so nothing is sent for it, normalises a value that passes before sending it, and then reports whatever the core says it took — never what was asked for. A `bad_rule` refusal is shown with the core's own reason and **changes nothing**: the readout, the select and the world go on describing the rule in force, and the person's text stays in the field to be corrected | [public/rule.mjs](../../../src/viewer/public/rule.mjs), [public/pages/world.js](../../../src/viewer/public/pages/world.js); [interfaces.md](interfaces.md) §7.5; [testing.md](testing.md) §1 |
| C43 | **The preset control never claims a rule the core is not running.** When the rule in force is not one of the presets — including one the core reports at handshake — the select shows an entry that carries that rule's own string rather than the nearest preset, and choosing that entry sends **no request**, because "custom" is not a rule: it moves the keyboard to the text field | [public/rule.mjs](../../../src/viewer/public/rule.mjs), [public/pages/world.js](../../../src/viewer/public/pages/world.js); [interfaces.md](interfaces.md) §7.5; [implementation.md](implementation.md) §3.23 |
| C44 | **A service can run more than one session.** Each session is one core, one history store, one event hub and one switch window; a request names it with `?session=`, a request without one means the default session, and an unknown id is `404 unknown_session` rather than another core's world | [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.8; [data-flow.md](data-flow.md) §3.16; [testing.md](testing.md) §1 |
| C45 | **The registry is in memory, and closing is not deleting.** The default session cannot be closed; closing a created one stops its core and leaves its history file, which is the core's; a service restart starts again with the default session only | [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.8; [risks.md](risks.md) VWR-30 |
| C46 | **A pattern is data, and the page never parses it.** One JSON document carries the library in the Life community's RLE form; one strict parser reads it, refusing a malformed pattern rather than shortening it; a placement names a pattern and the service resolves the cells, checks the box against the world and sends one `set` | [patterns.json](../../../src/viewer/patterns.json), [patterns.mjs](../../../src/viewer/patterns.mjs), [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.8; [implementation.md](implementation.md) §3.24 |
| C47 | **The storage is chosen from the measured shape, but only when the measurement has an opinion.** At or above 4,000 live cells the tiled world is chosen when the population's density is high, and the sparse world otherwise; below it a person's manual choice stands. The density boundary is chosen between the two measured anchors and is **not** itself measured | [representation.mjs](../../../src/viewer/representation.mjs), [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.8; [risks.md](risks.md) VWR-32 |
| C48 | **A switch does not truncate the timeline.** A representation switch restarts the core, and the replacement adopts the recorded session the previous core was writing to; the node count is unchanged by the switch, and the next step appends to that session | [server.mjs](../../../src/viewer/server.mjs), [bridge.py](../../../src/lifegame/world/bridge.py); [world/interfaces.md](../world/interfaces.md) §4.10; [testing.md](testing.md) §1 |
| C49 | **Sessions are capped, and creation waits rather than failing.** The service holds at most 64 sessions including the default; a creation at the cap stays pending until a session closes, and `queued` in `GET /api/sessions` is the number waiting, which the page shows | [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.8; [testing.md](testing.md) §1 |
| C50 | **The remembered view point belongs to a session and is shareable by link.** It is stored per session, and `?focus=x,y` stores that point for the session that loads the link; nothing is shared by implication | [focus.mjs](../../../src/viewer/public/focus.mjs); [interfaces.md](interfaces.md) §2.9; [testing.md](testing.md) §1 |
| C51 | **The last cell edit can be undone without a rollback.** The page keeps the cell edits it made; undo toggles the last one back, and any other move of the world empties the stack. A bulk edit — a placed pattern or a clear — is **not** undone this way, and the control does not claim it is | [pages/world.js](../../../src/viewer/public/pages/world.js); [interfaces.md](interfaces.md) §7.6; [testing.md](testing.md) §1 |
| C52 | **A session is capped and its creation queue is bounded.** At most 64 sessions, at most 1024 creations waiting; beyond the queue bound a creation is refused with `session_queue_full` instead of being queued | [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.8; [testing.md](testing.md) §1 |
| C53 | **A world can be saved and loaded from the interface.** The archive routes write the recorded session and load one back; the core owns the file format and restores the world, and the service forwards both directions | [pages/archives.js](../../../src/viewer/public/pages/archives.js), [server.mjs](../../../src/viewer/server.mjs), [bridge.py](../../../src/lifegame/world/bridge.py); [interfaces.md](interfaces.md) §7.6; [testing.md](testing.md) §1 |
| C54 | **A snippet is content-addressed and published through an index.** The object is immutable and hash-named, the index is the only mutable part, a publish is compare-and-swap with a pinned hash, and a remove leaves the object | [snippets.mjs](../../../src/viewer/snippets.mjs), [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.10; [testing.md](testing.md) §1 |
| C55 | **The editing document is a transaction model, not a second world.** A transaction carries absolute intents and a base version; the document computes the chain hash, rebases a stale absolute intent, records the patch, and undoes only cells the undone transaction still owns | [edit.mjs](../../../src/viewer/edit.mjs); [interfaces.md](interfaces.md) §15; [testing.md](testing.md) §1 |
| C56 | **The editing runtime pauses, commits and resumes, and refuses a second writer.** Entering pauses a running world, a transaction becomes the core's atomic `patch`, the document records the cells the core reports as changed, and every world-writing route is refused while the mode is open | [edit-runtime.mjs](../../../src/viewer/edit-runtime.mjs), [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.11; [testing.md](testing.md) §1 |
| C57 | **The page's editing surface turns a gesture into one transaction.** A drag is one atomic edit; a selection can be saved as a draft and published; a palette stamp carries a transform and an `overwrite` or `merge` mode; undo and redo call the session's routes | [pages/world.js](../../../src/viewer/public/pages/world.js), [public/edit-tools.mjs](../../../src/viewer/public/edit-tools.mjs); [interfaces.md](interfaces.md) §2.11; [testing.md](testing.md) §1 |

Claims C1 and C10 are the two that would be easiest to break silently, so each
is asserted directly: the forwarded error code and the `503` and `504` mapping
have their own tests, and the palette's variable names, their parseability and
the field names the script reads have their own contract tests
([testing.md](testing.md) §4). Claims C13 to C26 are the ones this version adds,
and each is asserted on both sides of the browser boundary: the server suite
reads a real stream, performs a real switch and drives a real history, and the
page suite drives the page's own client, its text and its timeline against a
synthetic one. C18, C21 and C25 are each held by a test that reads two files and
compares them, which is the only kind of test that can catch a *missing* half —
a string that is not in the table, a value that is not in the shared module, a
rule that does not cover a control.

C37 to C41 are the claims this revision adds, and each is held on both sides of
the browser boundary because each is a rule about *what a person sees*. C37 and
C38 are the two halves of one change — the view is derived where a canvas exists,
and absent where one does not — and they are asserted from opposite ends: the
viewport suite fixes the arithmetic as equalities, and the hub's cases assert
that a stream with no rectangle receives `hello` and no `frame`. C39 and C40 are
the degradation and the centring rule, asserted both as a pure function over a
live set and as the sentence the page renders. C41 is the newest thing a test can
see without a browser: the connectors are computed as data and asserted as data,
and the page suite asserts which connector each row is given — yet what a
screenshot would still be needed for is recorded in
[risks.md](risks.md) VWR-21.

C44 to C47 are this version's claims. C44 and C45 are one boundary seen from two
sides — two cores really run, and neither the registry nor a closed session's
store is a service-owned copy of anything the core wrote. C46 is the pattern
library: the data is checked against published populations **and** three patterns
are stepped through a real core, because a count alone would pass a plausible
wrong shape. C47 is the only claim in this module that is a **measurement** rather
than a wire format, and its two anchors are quoted from
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) rather than
restated; the boundary between them is a chosen value and is recorded as a risk.

C42 and C43 are the rule editor's claims, and the second one is a claim about
honesty rather than about behaviour: a control that showed the nearest preset
while another rule ran would be telling the person something false, and the entry
that carries the rule's own string says the same thing without lying. Both are
asserted by executing the real page against the synthetic browser
([rule-page.test.mjs](../../../src/viewer/tests/rule-page.test.mjs)), and **C42 is
where the module's most recent browser-found defect lived**: the page reported the
rule the core took, and it still does, while the *field* beside the readout was
empty on a fresh load and the button therefore sent nothing until a rule was typed.
The suite was green through it and the browser probe was not. It is fixed inside
the version that delivered the editor and the probe now passes against the same
press ([testing.md](testing.md) §5.10 and §7.15, [risks.md](risks.md) VWR-28
retired). It stays recorded against C42 because a claim that holds and a claim that
is merely asserted are two different things, and this one had to be observed.

## 2. Boundary against each peer

| Peer | What crosses the boundary | What does not cross |
|---|---|---|
| The `world` core ([world/interfaces.md](../world/interfaces.md)) | JSON request lines in, JSON reply lines out, one per line, over the child's standard input and output; the child's exit | The service never imports Python, never reads the core's files, never parses the core's stderr as protocol, and never re-derives the protocol's rules. Its own admission rule is the encoder's rule *reused*, and [interfaces.md](interfaces.md) §3 states that inheritance explicitly |
| The browser page | The fifteen API routes, their status codes and their JSON bodies, and one event stream | The page never touches the core, never opens a socket to it, and never speaks the line protocol. Its only inputs are HTTP replies and events |
| The `store` module, through the core | Nothing directly. The history is the core's: the service forwards `history`, `rollback` and `archive` and never opens the store itself | The service does not read, migrate or write the SQLite file; it does not know the schema, and it could not restate the store's rules if it wanted to ([store/interfaces.md](../store/interfaces.md)) |
| The environment contract ([AGENTS.md](../../../AGENTS.md) §1, [environment](../environment/overview.md)) | The service itself writes no file. The core it starts writes the history store and an archive at the operator's request | Both defaults are inside the repository (`data/history.db` and the archive directory beside it), so the transient-location rule holds. The service does not manage caches, temporary directories or the interpreter's installation; it reads the interpreter's path and fails with a hint when it is absent |
| The documentation system | The gate command in [AGENTS.md](../../../AGENTS.md) §4 and the nine files here | The module does not decide version state, does not own the phase criteria, and does not own the protocol |
| The phase plan | Criterion B5 in [phase-02-simulation-core/acceptance.md](../../plan/phase-02-simulation-core/acceptance.md) | The module does not claim its own acceptance, and does not schedule its own successors |
| The operator | The URL it prints, the bootstrap hint it returns, and the page's readouts | The module does not authenticate, does not choose a port policy beyond its default of `127.0.0.1`, and does not survive a restart by design |
| The operating system's colour-scheme preference, and the browser's storage | One boolean from `matchMedia`, the browser's own language, and whatever was last stored under the module's four keys | None is authoritative: the preference is consulted only while the stored value is not an explicit choice, and a storage that throws changes nothing except that a choice is forgotten. The module never reads a preference from anywhere else, and never writes anything but those four keys |
| The browser's own language setting | One string from `navigator.language` | It decides the language only while nothing is stored. A stored language that the catalogue does not hold is treated as no choice rather than as an error, so removing a language from the build cannot break a returning visitor |

## 3. Required behaviour when something fails

The rule that governs every row: **a failure is reported where the caller can
see it, and the surface stays up.** A person must be able to tell "the world
core is not running" from "my request was wrong" from "the page is broken".

### 3.1 Starting and supervising the core

| Condition | Required behaviour | Where |
|---|---|---|
| The interpreter is not installed | The request fails `503 core_unavailable`; the message names the interpreter path and the bootstrap command; no child is spawned repeatedly | [bridge.mjs](../../../src/viewer/bridge.mjs); [testing.md](testing.md) §4 |
| The child exits or fails to spawn | Pending requests are rejected with `core_unavailable`; the crash counter increments; the next request waits out an exponential backoff and then starts a fresh child | [interfaces.md](interfaces.md) §4.3 |
| The crash counter reaches its limit | The bridge stops respawning and every request fails `503`, with the last error in the message | [interfaces.md](interfaces.md) §4.3 |
| Any reply arrives | The crash counter resets. Traffic is the liveness signal, not a heartbeat this module invents | [bridge.mjs](../../../src/viewer/bridge.mjs) |
| A request is not answered in time | That request fails `504 core_timeout`; the child is left running, because a slow frame is not a dead core | [interfaces.md](interfaces.md) §2 |
| The core exits while the service is stopping | `stop()` sends `quit`, waits a grace period, then kills; the listener is closed first, and idle keep-alive sockets are destroyed so shutdown cannot hang | [server.mjs](../../../src/viewer/server.mjs) |

### 3.2 Serving requests

| Condition | Required behaviour |
|---|---|
| The body is not JSON, is empty, is not an object, or exceeds 1 MiB | `400` or `413` before anything reaches the core, so a malformed request cannot consume core work |
| `frame` is sent as a command | `400` with the route to use instead, because the two have different shapes and different guards |
| A query parameter is missing or not an integer | `400` naming the parameter |
| A rectangle is negative or zero-sized, or its area overflows a safe integer | `400`, before the core is asked |
| A rectangle is refused by admission | `400` naming the area, the last reported population, and what to do about it. The request must not reach the core — this is asserted by counting the stub's calls |
| A static path leaves the public directory, literally or percent-encoded | `403 forbidden`, and no filesystem read outside `public/` |
| A route or file does not exist | `404`, never a stack trace and never a blank response |
| Anything else throws | `500` with the error's name and message, and the process stays alive |

### 3.3 Rendering

| Condition | Required behaviour |
|---|---|
| The frame's `format` is unknown | The previous frame stays on screen and the reason appears in the banner. The canvas is never blanked |
| The payload is too short for its rectangle, or a `cells` payload is not a whole number of pairs | The decoder throws, the frame is not drawn, and the banner says why |
| The population grows past what the current view can afford | The page pulls the view in and says so in the span readout, instead of requesting a frame that would be refused |
| A request is already outstanding | The next refresh is coalesced rather than queued, so a slow frame cannot pile up requests |

### 3.4 Theming and grid width

| Condition | Required behaviour |
|---|---|
| Nothing is stored, or what is stored is unreadable | The theme follows the operating system's preference, and does so again while the user has chosen nothing |
| A stored value comes from an older build | It counts as no choice at all: the theme follows the system rather than raising |
| The storage throws — private mode, no origin, full quota | The page still starts, both controls still work, and the choice is simply not remembered. No exception reaches the page's error banner |
| A palette value cannot be parsed | That colour keeps its previous value. The canvas is never repainted in a default or in black, and the page stays legible in the theme it already had |
| The theme changes | The palette cache is refilled, the frame already on screen is redrawn, and **no request is sent to the core**, because the world has not changed |
| The grid width changes | The same: redraw from the cached frame, no request |
| A grid width is not a number | It falls back to the default, not to the thinnest line, so a corrupted value is recognisable rather than nearly invisible |
| The device pixel ratio is missing or absurd | It is treated as `1`; the geometry stays defined and the line stays one whole device pixel wide |
| A cell is smaller than `GRID_MIN_CELL_PX` pixels across | No grid is drawn. A grid denser than the cells it separates is a grey wash over the image |

### 3.5 The stream, and switching the representation

| Condition | Required behaviour |
|---|---|
| A client opens the stream | It is told which client it is, what it is talking to and what world it is looking at before it is shown anything, and the rectangle it is subscribed to is inside that world |
| A tick arrives from the core while clients are subscribed | Every subscriber is told, and shown a fresh frame for its own rectangle. The page is not asked whether it wants one |
| A mutation is served over REST | Every subscriber is told the new state and shown a fresh frame. The caller of the mutation is answered as before |
| A frame is already being built for a client, and more changes arrive | One more frame is built when the current one lands, and the intermediate changes are discarded. The client's lag is bounded by one frame, not by the number of changes |
| A substrate rectangle is larger than the world | It is fitted to the world. Asking for a view of a small world is not an error |
| A subscribed rectangle is refused by the encoder | An `error` event carrying the reason, on the open connection. The connection is not dropped, and the client's last frame stays on screen |
| The stream drops, or `EventSource` is absent | The page closes the stream, says why, schedules a retry, and keeps working by polling on a timer. It never goes blank and never stops updating |
| The core becomes unavailable while clients are subscribed | Each subscriber receives an `error` event naming the reason; the connection stays open so a recovered core reaches the same client |
| A switch is requested for the representation already running | Nothing is replaced, and the reply says so. The process, the world and every subscription are untouched |
| A switch is requested while one is running | The second is refused with `503`, rather than queued, so process replacements cannot accumulate |
| Any other route is called while a switch runs | It refuses with `503` rather than answering from the empty world between the restart and the import |
| A switch completes | Every subscriber receives the new state, including the generation that was carried across, and a fresh frame. A switch must not silently reset the clock |
| A switch cannot complete | The failure is reported with its own code and the service leaves the switching state, so the next request is answered normally |

### 3.6 The language

| Condition | Required behaviour |
|---|---|
| Nothing is stored | The browser's own language decides, when the catalogue holds a language whose prefix matches it; otherwise the catalogue's default |
| A language is stored and the catalogue holds it | That language wins, whatever the browser prefers |
| A stored language is not one the catalogue holds | It counts as no choice at all: the browser's preference decides. Removing a language from a build must not break a returning visitor |
| The language changes | Every keyed node, every translated attribute and the document's own `lang` are updated immediately, with **no reload and no request**; the timeline and the hint line are re-rendered because their text is assembled rather than keyed |
| The storage throws | The switch still works for the session and the choice is simply not remembered. No exception reaches the banner |
| An error code the page has no label for | The raw code is shown with the core's message. A code the catalogue does hold shows its label with the core's message beside it as detail |
| A language's label is wider or narrower than the other's | The controls do not move: labels and buttons carry a minimum inline size, and a test asserts the rules exist |

### 3.7 The history

| Condition | Required behaviour |
|---|---|
| The core was started with a history | Its session and its recorded generations are listed, newest last, with the storage type, the population and the change count of each |
| The core was started without one | The page shows no timeline at all rather than an empty panel, and the list request is answered with a code of this layer's own so the absence is distinguishable from a failure |
| More generations are recorded than the panel can show | A window of the newest rows is rendered, with a count of those hidden and a control to widen it. A long run must not put thousands of rows in the document |
| A generation is rolled back | The core restores it, and **every** subscriber is told the new state and shown a fresh frame: a rollback one client saw and another did not would leave two pages showing two generations of one world |
| A generation is requested that was never recorded | The refusal comes from the core, unchanged, and the page shows it in the banner without moving the timeline |
| An archive is exported | The core writes it under the archive directory and the reply names the file. The name is confined: a separator, a drive letter or a traversal is refused rather than repaired |
| An archive is exported while a switch runs | `503 switch_in_progress`, like every other route |
| An edit is made between two generations | The current generation is re-recorded as a keyframe, so the chain stays replayable and the edit sits at the generation it happened. Without this the next rollback replays a delta that no longer describes the world |
| The timeline is showing while the world is stepped | The list follows the world: a new generation is appended, and the current-generation marker moves |

### 3.8 The default view, the preview and the tree

| Condition | Required behaviour |
|---|---|
| A page starts and the core has described no world yet | **No frame is requested at all**, and no view is placed. The page shows its empty state; the first `state` reply or stream `hello` that carries a world is what re-enters the placement |
| A page starts and its canvas has not been laid out, or the panel state hides it | The same: no view, and no request. The check is the canvas' **measured** rectangle rather than a declared size, so a canvas that is present with zero width does not pass it |
| The canvas changes size before the person has panned or zoomed | The span is re-derived from the new width, the world's centre stays in the middle, and one subscription follows. A rotated phone or a resized window therefore shows the same cell size rather than the previous window's |
| The canvas changes size after the person has panned or zoomed | The person's view stands. A resize must not throw away the place they were working, and the same rule holds in the preview under its own flag |
| A stream opens with no rectangle named | `hello` only. The page then names its rectangle over `POST /api/subscription`, and its first `frame` follows that. A service-side default is not substituted, because it could only be right for one window |
| A subscription names a partial rectangle | `400`, naming the parameters that must all be present. "All four or none" is the contract, and a partial rectangle is not a smaller request but an ambiguous one |
| A node is selected | The live set is read **once**, the preview is centred on the nearest live cell to where the world route was last looking, and the frame for that one rectangle is drawn. Nothing is scanned per frame |
| The live set is above the cap | The preview centres on the middle of the core's `bounds`, and `preview.note.bounds` says so with the population and the cap. The answer is coarser rather than wrong, and the difference is stated in the reader's language |
| Nothing is alive in the generation | The preview centres on the middle of the world, and `preview.note.world` says so |
| The preview is dragged or zoomed | Its own viewport moves and no request is issued per event: one request is in flight, the newest rectangle wins, and the selection is untouched |
| A row is dragged | The tree pans and the selection does not change, because a press that travelled more than four pixels is not a click on the row it started on |
| A row holds keyboard focus | The same detail the pointer reveals is revealed, from the same `data-open` state, so a keyboard user is not offered a smaller interface |
| A generation number appears on two branches | The rows are ordered by `parent`, and each child of a fork carries a letter, so two branches are told apart by name and not only by indentation |

## 4. What the module must never do

Even though it technically could:

* It must never **compute a generation**, apply a rule, or keep a shadow copy of
  the world. A second implementation of the rule would make the core's oracle
  evidence meaningless and would put the two authorities in conflict.
* It must never **rewrite a core reply**. Rewriting `error` into a status code,
  or `ok: false` into an exception, would move the error vocabulary into the
  wrong module.
* It must never **restate the line protocol** as a second authority. It links to
  [world/interfaces.md](../world/interfaces.md) §4 for the commands' meaning and
  documents only which ones it forwards.
* It must never **write a file itself**. The service opens no file for writing.
  The one file it causes to exist is written by the core, at the operator's
  request, at a path the operator named, and the archive name a request may give
  is confined to one directory ([data-flow.md](data-flow.md) §4).
* It must never **let a request choose where the service writes**. A browser with
  a path parameter could write anywhere the service can, which is not a power a
  page should have over a process on the same machine.
* It must never **open, read or migrate the history store**. It is the core's
  file, with the store module's schema; a second reader would be a second
  authority on its format.
* It must never **hold a user-visible string of its own**. A string in the markup
  or in the script is one no translator will find, and the rule is total rather
  than approximate: structure and keys in the page, words in the catalogue.
* It must never **translate the core's message**. That string names the field or
  the bound the core refused; a translation of it would be a second, drifting
  description of the same refusal. The label is translated, the detail is
  appended.
* It must never **invent a bound the core declares**. A tick rate, a step
  ceiling, a coordinate ceiling or a representation the core did not offer is a
  control that produces a refusal the user cannot explain; an undeclared bound
  disables the control instead.
* It must never **declare a shared value twice**. The budget, the rule and the
  default view exist once, in the module both runtimes import; a second copy is
  the defect that was removed, not a convenience.
* It must never **dress a control through its own container**. An appearance rule
  scoped to one control's class leaves the next control with the browser's own
  chrome, which is how the storage select once shipped unstyled; the shared rule
  is by element, and a test asserts no rule is scoped to a single control.
* It must never **leave a control's text out of the minimum-width rule**. Two
  languages have different widths, and without a floor the toolbar reflows under
  the pointer that was reaching for a control.
* It must never **serve a path outside `public/`**, including one reached by
  percent-encoding, a null byte, or an alternate separator.
* It must never **let a request reach the core when its own guard refused it**,
  because the guard exists precisely to prevent a rectangle the core cannot
  afford.
* It must never **respawn without a bound**. An unbounded restart policy turns a
  broken interpreter into a process storm.
* It must never **treat a slow core as a dead one**: no timeout may kill the
  child.
* It must never **hide a refusal behind a generic error**. `403`, `400`, `404`,
  `413`, `503`, `504` and `500` each mean one thing, and the body says which.
* It must never **assume the caller's working directory**. Both paths it needs —
  the public directory and the repository root — are resolved from the module's
  own location.
* It must never **hold a colour constant beside the stylesheet**. The palette
  has one definition, and it is `style.css`. A constant in script is a second
  definition of the same theme, and the copy the canvas uses would be the one
  nobody looks at — which is the defect that already broke the `bits` path once
  ([testing.md](testing.md) §7).
* It must never **restate the theme precedence rule in the stylesheet**. A
  `prefers-color-scheme` media query would be a second copy of both the rule and
  the light palette, and it cannot serve the canvas, which has no access to CSS
  at all. The pre-paint script in the layout is the one permitted repetition,
  and it is pinned by a test.
* It must never **paint with a colour it could not parse**. Keeping the previous
  colour leaves a stylesheet defect visible and the page usable; substituting a
  default hides the defect and can make the canvas unreadable.
* It must never **ask the core for a frame because the theme changed**. Nothing
  about the world changed, and a repaint costs no round trip.
* It must never **decide version state**. It links to
  [VERSIONS.md](../../plan/VERSIONS.md).
* It must never **queue frames for a subscriber that falls behind**. A queue grows
  at the tick rate and its length becomes the lag; the newest frame is the only
  one a person can see.
* It must never **send a rectangle to the core without checking the world it
  belongs to**. A subscription is fitted to the world the core described, because
  a view of a small world is a legitimate request and the core answers raw
  out-of-world rectangles with an error.
* It must never **let a route read the world while the core is being replaced**.
  The empty world between a restart and an import is not a state any caller may
  observe, and `503 switch_in_progress` exists to say so.
* It must never **queue a representation switch**. Each one replaces a process and
  round-trips the world; a queue of them is a queue of pauses.
* It must never **lose the generation in a switch**. Carrying the cells and
  resetting the clock is not preserving the world, and the core's `import`
  accepts a generation for exactly that reason.
* It must never **write the world down to carry it across a switch**. The payload
  is memory for the length of one request; a file here would be a persistence
  format this module has no mandate to invent.
* It must never **hold world state to answer a subscriber from a cache**. A
  cached frame is indistinguishable from a fresh one to the client that receives
  it, and the service's rule is that it holds no world.
* It must never **substitute a rectangle for a subscriber that named none**. The
  view a page opens with is a function of its own canvas, and a rectangle chosen
  by the service is a second declaration of that rule — one that is right for
  exactly one window and pushes work nobody asked to look at.
* It must never **request a frame before there is a view to request**. A request
  derived from a canvas nobody has measured, or from a world nobody has
  described, is a guess, and the guess is what the person then sees.
* It must never **re-derive a view the person has moved**. A resize that re-centred
  a panned or zoomed view throws away the place they were working, and the
  distinction between "not yet moved" and "moved" is a rule, not a detail.
* It must never **degrade a preview in silence**. A centre taken from a bounding
  box rather than from a cell is a different answer, and the one place it can be
  said is the note beside the canvas.
* It must never **read the live set more than once per selection**. The centring
  is a decision about a generation; a scan per frame would turn a gesture into a
  world-wide sweep and make the preview's cost depend on how far the pointer
  moved.
* It must never **let the tree's shape live only in the stylesheet**. Which parent
  a row hangs from, and which sibling continues below it, are properties of the
  recorded tree; the stylesheet draws what a pure function decides, and it decides
  nothing.
* It must never **let a pan change the selection**. A drag on the tree is a camera
  gesture, and the row it began on must not be selected by the release.
| C58 | **Collaboration merges in the service's commit order and every client converges.** A transaction whose base is behind is rebased when its operations are absolute and refused with `stale_base` otherwise; two authors writing different cells both survive, and an overlapping write resolves to the later commit. Both clients' `patch` events carry the same version and hash | [edit.mjs](../../../src/viewer/edit.mjs), [edit-runtime.mjs](../../../src/viewer/edit-runtime.mjs), [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.11; [testing.md](testing.md) §1 |
| C59 | **Undo names its transaction and never overwrites a later author.** The inverse patch is restricted to the cells the target is still the last writer of; `txId` lets an author undo their own transaction. The undo stack and per-cell attribution are bounded by the retained window, and a transaction outside it is no longer undoable | [edit.mjs](../../../src/viewer/edit.mjs), [edit-runtime.mjs](../../../src/viewer/edit-runtime.mjs); [interfaces.md](interfaces.md) §2.11; [risks.md](risks.md) VWR-38 |
| C60 | **Presence is ephemeral and reaches every client.** A report carries a cursor, a selection and a view point, is validated, broadcast and expires after 30 s; `leaving` removes it at once; nothing is persisted | [edit-runtime.mjs](../../../src/viewer/edit-runtime.mjs), [server.mjs](../../../src/viewer/server.mjs); [interfaces.md](interfaces.md) §2.3 and §2.11; [testing.md](testing.md) §1 |