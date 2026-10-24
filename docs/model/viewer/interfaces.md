# viewer — interfaces

> This file owns what the module exposes: the HTTP API and its event stream, the
> frame admission contract, the JavaScript surfaces on both sides of the browser
> boundary, the page's operator interface, the CLI and the compatibility policy.
> The **line protocol is not owned here** — it is specified in
> [world/interfaces.md](../world/interfaces.md) §4, and §9 below only lists which
> of its commands this module forwards. What the module promises is owned by
> [responsibilities.md](responsibilities.md).

## 1. Surface inventory

| File | Exposes | Consumed by |
|---|---|---|
| [server.mjs](../../../src/viewer/server.mjs) | `createViewerServer(options)`, `startViewerServer(options)`, `resolveStaticPath(publicDir, urlPath)`, `resolveArchivePath(name, dir)`, `defaultHistoryPath`, `defaultArchiveDir`, `MAX_FRAME_CELLS`, and a CLI when run directly | The tests, the operator, and the page (over HTTP) |
| [routes.mjs](../../../src/viewer/routes.mjs) | `ROUTES`, `NAV_ITEMS`, `LAYOUT_SLOTS`, `LAYOUT_FILE`, `SHELL_SCRIPT`, `defaultPublicDir`, `routeFor(pathname)`, `scriptsFor(route)`, `fragmentFor(route)`, `fillSlots(template, values, where)`, `slotsIn(template)`, `renderNav(currentId)`, `renderScripts(route)`, `createPageRenderer(publicDir)`, `defaultPageRenderer`, `renderRoute(id)` | `server.mjs`, and the routes and page tests (§2.7) |
| [events.mjs](../../../src/viewer/events.mjs) | `EventHub` | `server.mjs`, and the hub tests |
| [public/shared.mjs](../../../src/viewer/public/shared.mjs) | `MAX_FRAME_CELLS`, `MAX_CELLS_FOR_NEAREST`, `NO_LIMITS`, `frameAdmission(options)`, `readLimits(hello)`, `clampTicksPerSecond(value, limits)` | `server.mjs`, `events.mjs` and `public/app.js`, so one declaration serves both runtimes (§11) |
| [bridge.mjs](../../../src/viewer/bridge.mjs) | `CoreBridge`, `CoreUnavailableError`, `CoreTimeoutError`, `PROTOCOL_VERSION`, `REPRESENTATIONS`, `BOOTSTRAP_HINT`, `repoRoot`, `defaultPythonPath(root)` | `server.mjs`, `events.mjs` and the bridge tests |
| [public/decode.mjs](../../../src/viewer/public/decode.mjs) | `base64ToBytes`, `decodeCells`, `forEachLiveBit`, `decodeBits` | `public/app.js` and the decoder tests |
| [public/locales.mjs](../../../src/viewer/public/locales.mjs) | `LOCALES`, `DEFAULT_LOCALE`, `LOCALE_STORAGE_KEY`, `HINT_SEGMENTS`, `KNOWN_ERROR_CODES`, `translate(locale, key, params)`, `resolveLocale(stored, preferred)`, `describeError(locale, code, message)`, and the two catalogues themselves | `public/app.js`, and the locale and page tests (§12) |
| [public/viewport.mjs](../../../src/viewer/public/viewport.mjs) | The constants and functions of §7.4, including the default-view rule `DEFAULT_PIXELS_PER_CELL` with `defaultSpan`, `worldCentre`, `viewCentre` and `centreViewport` | The world page and the history page, so a cell is the same size in both, and the viewport and page tests |
| [public/rule.mjs](../../../src/viewer/public/rule.mjs) | `CUSTOM_RULE`, `RULE_PRESETS`, `PRESET_RULES`, `RULE_REASONS`, `parseRule(text)`, `presetFor(rule)`, `reportedRule(reply, sent)` | The world page, and the rule tests (§7.5) |
| [public/theme.mjs](../../../src/viewer/public/theme.mjs) | `THEME_STORAGE_KEY`, `GRID_WIDTH_STORAGE_KEY`, `THEMES`, `GRID_WIDTHS`, `DEFAULT_GRID_WIDTH`, `MIN_GRID_WIDTH`, `MAX_GRID_WIDTH`, `CANVAS_PALETTE_KEYS`, `isExplicitTheme`, `resolveTheme`, `nextTheme`, `clampGridWidth`, `parseColor`, `toCssColor`, `deviceLineWidth`, `snapLineCenter`, `readStored`, `writeStored`, `clearStored` | `public/app.js` and the theme tests |
| [public/app.js](../../../src/viewer/public/app.js) | Nothing importable: it is the shell, loaded by every page, and it touches the DOM at module scope | The browser, and the page suite through the synthetic browser (§13) |
| [public/link.mjs](../../../src/viewer/public/link.mjs) | `SHELL_EVENT`, `SHELL_REQUEST_EVENT`, `connectShell(fill, ready)` | The shell and every page module, so the two halves of one handshake cannot be spelled two ways (§13) |
| [public/history.mjs](../../../src/viewer/public/history.mjs) | `MAX_INDENT_LEVELS`, `indentLevel(forkDepth)`, `GUIDE_KINDS`, `flattenHistory(rows)`, `nodeById(rows, id)`, `nearestCell(cells, point)`, `previewFocus(options)`, `formatHistoryTime(at, locale, noneLabel)` | The history page, and the history tests (§14) |
| [public/focus.mjs](../../../src/viewer/public/focus.mjs) | `FOCUS_STORAGE_KEY`, `readFocus(storage)`, `writeFocus(point, storage)` | The world page writes the point it is looking at, the history page reads it to centre a preview |
| [public/frame-draw.mjs](../../../src/viewer/public/frame-draw.mjs) | The drawing and palette contract: `DEFAULT_PALETTE`, `readPalette(styles, base)`, `paintBits(base64, width, height, image, aliveRgb)`, `drawGrid(options)` and `drawFrame(options)` — the routines that turn a decoded frame into pixels | The world page and the history page's preview, so one cell looks the same in both |
| [public/options.mjs](../../../src/viewer/public/options.mjs) | `fillOptions(select, values, labelOption)`, `labelOptions(select, labelOption)` | The shell (the language list) and the world page (the grid widths and the storage choices) |
| [public/pages/layout.html](../../../src/viewer/public/pages/layout.html) | The shared document skeleton with four `{{…}}` slots, the pre-paint theme script, the header and the tab bar | The composer in `routes.mjs`, and the routes tests (§2.7) |
| [public/pages/world.html](../../../src/viewer/public/pages/world.html), [history.html](../../../src/viewer/public/pages/history.html), [archives.html](../../../src/viewer/public/pages/archives.html) | One fragment per route: the containers that route's script binds, and nothing else — no `<html>`, `<head>` or `<body>` | The composer, and the DOM contract cases |
| [public/pages/world.js](../../../src/viewer/public/pages/world.js), [history.js](../../../src/viewer/public/pages/history.js), [archives.js](../../../src/viewer/public/pages/archives.js) | Nothing importable: each is a page module, loaded after the shell and connected to it by `link.mjs` | The browser, and the page suite through the synthetic browser |
| [public/style.css](../../../src/viewer/public/style.css) | Presentation only | The browser |

The surface sections below are ordered as they grew: §5 to §7 cover the browser's
logic leaves, §8 the theme, §9 the operator interface, §11 and §12 the shared
values and the locale catalogue, and §13 and §14 the shell's handshake with a page
and the history tree. §1 is the ordering authority; a section number is an
address, not a sequence.

`README.md` beside them is the module's operator-facing note. It belongs to no
component: it has no behaviour and nothing imports it.
[tests/dom-stub.mjs](../../../src/viewer/tests/dom-stub.mjs) is the synthetic
browser the page suite installs; it ships to nobody and is part of
`test-harness`.

## 2. HTTP API

The service binds `127.0.0.1` by default. Every JSON response the service writes
itself has the shape

```json
{ "ok": false, "error": "<code>", "message": "<human-readable reason>" }
```

A forwarded reply is the core's reply **unchanged**, including its `ok`, `error`,
`message` and `id` fields. A client therefore reads a refusal such as
`out_of_bounds` from the same place it would read it from the core.

| Route | Method | Meaning |
|---|---|---|
| `/` and `/world` | GET | The world page: the canvas, the controls and the readouts, composed from `pages/world.html` (§2.7) |
| `/history` | GET | The history page: the recorded tree, composed from `pages/history.html` (§2.7) |
| `/archives` | GET | The archive page: the archive manager, composed from `pages/archives.html` (§2.7) |
| `/static/<file>` | GET | A file under `public/`, confined to that directory |
| Any other path | GET | `404` with the JSON error envelope. There is **no default page**: a path nobody serves must answer 404, because falling back to the world would make every typo look like a working address |
| `/api/state` | GET | Forwards `state` |
| `/api/frame?x0=&y0=&w=&h=` | GET | Forwards `frame`, after admission (§3) |
| `/api/cells` | GET | The core's `export` as the live set, taken once per selection so a preview can centre on the nearest live cell. Above `MAX_CELLS_FOR_NEAREST` the reply carries `truncated: true`, the population and the core's `bounds` instead of the cells, and the page reports that in words (§11) |
| `/api/command` | POST | Body is `{"cmd": ...}` plus that command's fields; forwards everything except `frame` |
| `/api/patterns` | GET | The pattern library: each pattern's name, kind, width, height and population (§2.8) |
| `/api/pattern` | POST | `{"name": "...", "x": N, "y": N}`; places the named pattern with its bounding box at `(x, y)` as one `set`, then reconsiders the storage (§2.8) |
| `/api/snippets` | GET | The published snippet library: each snippet's name, content hash, box and live-cell count (§2.10) |
| `/api/snippets` | POST | `{"name": "...", "width": N, "height": N, "cells": [[x,y],...], "expectedHash"?: "..."}`; publishes a content-addressed snippet, refusing a silent overwrite (§2.10) |
| `/api/snippets/<name>` | GET | One published snippet by name, optionally pinned with `?hash=`; a 64-character hex name reads the content object directly (§2.10) |
| `/api/snippets/<name>` | DELETE | `{"expectedHash"?: "..."}`; removes the name from the index and leaves the content object in place (§2.10) |
| `/api/edit` | GET | The session's editing state: `editMode`, version, hash, generation and undo/redo depth (§2.11) |
| `/api/edit/enter`, `/api/edit/leave` | POST | Open the mode (pausing a running world) and close it (restoring the run state) (§2.11) |
| `/api/edit/transaction` | POST | `{txId, baseVersion, baseHash, author, ops[]}`; one atomic transaction, answered with the changed patch and the new version/hash (§2.11) |
| `/api/edit/undo`, `/api/edit/redo` | POST | `{"author"?, "txId"?}`; an inverse transaction and its re-application. `txId` names the transaction to undo, so a person can undo their own while another author's newer write survives (§2.11) |
| `/api/edit/state?since=N` | GET | Incremental resynchronisation while the window covers `N`, `full: true` outside it (§2.11) |
| `/api/edit/presence` | GET | The collaborators currently in the session: `clientId`, `author`, `cursor`, `selection`, `view`, `at` (§2.11) |
| `/api/edit/presence` | POST | `{"clientId", "author"?, "cursor"?, "selection"?, "view"?, "leaving"?}`; records the report for at most 30 s and broadcasts a `presence` event (§2.11) |
| `/api/sessions` | GET | The service's sessions: the default and every one created since, with its label and the representation it runs, plus the cap and how many creations are queued |
| `/api/sessions` | POST | `{"label"?, "width"?, "height"?, "representation"?, "history"?}`; creates one more core with its own history store, and returns its state. At the cap the request waits for a session to close (§2.8) |
| `/api/sessions/close` | POST | `{"session": "s1"}`; stops that core and forgets the session. The default session cannot be closed |
| `/api/capabilities` | GET | The editing surfaces a page or an API client may rely on, the session cap and queue, and the shareable view point (§2.9) |
| `/api/events[?x0=&y0=&w=&h=]` | GET | The event stream for one subscriber (§2.3) |
| `/api/subscription` | POST | `{"clientId": N, "x0": -, "y0": -, "w": -, "h": -}`; moves one stream's rectangle (§2.4) |
| `/api/representation` | POST | `{"representation": "sparse" \| "tiled"}`; restarts the core on the other representation, carrying the world across (§2.5) |
| `/api/history` | GET | Forwards `history`: the session, the recorded nodes **as a tree**, and the recording head (§2.6) |
| `/api/select` | POST | `{"node": N}` or `{"generation": N}`; moves the world **and** the recording head onto a recorded node, which is what makes the next record a branch (§2.6) |
| `/api/rollback` | POST | `{"generation": N}`; loads a recorded generation **without moving the head**, and tells every subscriber (§2.6) |
| `/api/archive` | POST | `{"name": "archive.jsonl"}`; writes the recorded session to a portable file inside the archive directory (§2.6) |
| `/api/archives` | GET | Lists the archives in the archive directory: name, generations, size and modified time (§2.6) |
| `/api/archive/rename` | POST | `{"from": "…", "to": "…"}`; renames one archive inside that directory (§2.6) |
| `/api/archive/delete` | POST | `{"name": "…"}`; deletes one archive inside that directory (§2.6) |
| `/api/archive/import` | POST | `{"name": "…"}`; imports an archive as a new recorded session and makes it current (§2.6) |

### 2.1 Status codes this layer raises itself

| Status | `error` | When |
|---|---|---|
| `400` | `bad_request` | Malformed body or query; `frame` sent as a command; a rectangle refused by admission; a rectangle with a negative origin, a zero dimension, or an area that is not a safe integer; an unknown representation; a subscription field that is not an integer; a `select` naming neither a node nor a generation; an archive name that is not a plain name |
| `400` | `archive_exists` | A rename onto a name that is already taken, rather than overwriting the file that is there |
| `403` | `forbidden` | A static path that resolves outside `public/` |
| `404` | `not_found` | Unknown route, or a static path with no file |
| `404` | `unknown_session` | A request naming a session the service does not have |
| `404` | `unknown_pattern` | A placement naming a pattern the library does not contain |
| `404` | `unknown_snippet` | A snippet read or delete naming a name the index does not hold |
| `400` | `bad_placement` | A placement whose box would not fit at the given origin, or an origin that is not a non-negative integer |
| `400` | `default_session` | A request to close the default session |
| `404` | `unknown_client` | A subscription naming a stream that is not open |
| `409` | `name_conflict`, `hash_mismatch` | A snippet publish would silently replace a name, or its pinned hash is not the one the name holds |
| `409` | `edit_active` | A world-writing route — a command, a placement, a representation switch, a rollback, a select or an archive import — arrived while the session is in the editing mode |
| `409` | `stale_base`, `stale_generation`, `duplicate_tx`, `not_editing` | An edit transaction whose base, generation or id is not usable, or a transaction outside the mode |
| `404` | `unknown_transaction` | An undo or redo with no transaction on the stack |
| `413` | `bad_request` | A request body over 1 MiB |
| `413` | `too_large` | A snippet or an edit transaction whose box is over 256 cells on a side or whose live-cell count is over 8192 |
| `502` | `export_failed`, `import_failed` | A representation switch whose export payload was malformed, or whose import the core refused |
| `503` | `core_unavailable` | The interpreter is missing, the core crashed past its restart limit, or the bridge is stopping |
| `503` | `switch_in_progress` | Another route was called while a representation switch was running (§2.5) |
| `503` | `session_queue_full` | A session creation arrived at the cap while 1024 creations were already waiting; it is refused rather than queued (§2.8) |
| `504` | `core_timeout` | The core did not answer within the request timeout |
| `500` | `internal` | Anything else threw; the message carries the error's name and text |

Two codes are **not** statuses, because the request was fine and the answer is a
fact about the core:

| Reply | `error` | When |
|---|---|---|
| `200`, `ok: false` | `no_history` | A route needing a history was called on a core started without one |
| `200`, `ok: false` | `archive_import_unsupported` | `POST /api/archive/import` reached a core that does not implement `open`, which is a forwarded `unknown_command` renamed so the page can label it. The core in this build implements `open`; the translated refusal remains for an older core. This layer does **not** replay an archive's deltas itself: that would be a second implementation of the stored format in a second language |

The page keeps being served while the core is unavailable, so an operator reads
the reason in the page rather than in a blank tab.

### 2.2 Query rules

| Parameter | Rule | Violation |
|---|---|---|
| `x0`, `y0` | Integer, `>= 0` | `400` naming the parameter, or the non-negative rule |
| `session` | A service-generated session id; omitted means `main` | `404 unknown_session` |
| `w`, `h` | Integer, `>= 1` | `400` naming the parameter, or the positive rule |
| `w * h` | Must be a safe integer | `400`: the dimensions are too large |

For `/api/events` the four viewport parameters are **all or none**: a partial set
is a `400` naming what is missing, and **none means the stream carries `hello`
and nothing else**. There is deliberately no default rectangle. A stream that has
not said where to look is shown nothing, rather than being sent a frame of a view
nobody is looking at — the previous behaviour, and the reason a page that had not
yet measured its canvas could be pushed a frame it never asked for.

### 2.3 The event stream

`GET /api/events` answers `text/event-stream; charset=utf-8` with
`cache-control: no-store, no-transform`, `connection: keep-alive` and
`x-accel-buffering: no`. The response stays open until the client goes away, and
the first thing written is the comment line

```
: connected
```

which flushes the headers, so a client knows it is attached before the first
real event. One connection then carries every kind of change:

| Event | Data | When |
|---|---|---|
| `hello` | `clientId`, `protocolVersion`, `session`, `world`, `rule`, `representation` | Once, immediately after the comment |
| `frame` | A frame payload, exactly as `GET /api/frame` returns it | On connect, after a mutation, and after each step while running |
| `tick` | `generation`, `population`, `changed` | When the core steps itself, forwarded unchanged |
| `state` | The `state` reply | After a mutation, and after a representation switch |
| `patch` | A committed transaction: `txId`, `author`, `patch`, `version`, `hash`, `rebased`, and `kind`/`of` for undo and redo | After an editing transaction, undo or redo; every subscriber sees the same version and hash |
| `presence` | A collaborator's `clientId`, `author`, `cursor`, `selection`, `view` and `at`, or `{clientId, leaving: true}` | After a presence report; never persisted |
| `error` | `error`, `message`, and the rectangle when one was refused | The core is unavailable, or the subscription could not be served |
| `ping` | `at` | Every 15 s, so a proxy does not drop an idle connection |

The contract has four clauses:

* **A subscriber is never asked to poll.** While the stream is open, a change the
  service knows about produces an event. A client that ignores the stream still
  works, because every REST route keeps its shape (§10).
* **A slow subscriber coalesces rather than queues.** Each client has at most one
  frame being built; a change arriving while one is in flight sets a flag and the
  next frame is built when it lands. A core running at 60 ticks per second
  against a transport that issues one request at a time would otherwise build 60
  frames per second per client, without bound.
* **A rectangle is clipped to the world, not refused.** A subscriber asking for a
  view wider than the world is asking for a view, not for cells that do not
  exist, and the core would answer the raw request with an error. A rectangle
  that *is* inside the world but that the encoder cannot serve cheaply is
  refused with an `error` event under the rule of §3, the same rule the REST
  route applies.
* **`error` keeps the protocol's name, and the reader disambiguates.** The
  browser's `EventSource` fires an event called `error` when the connection
  drops, and a server-sent `event: error` dispatches on the same name. A server
  event carries `data`; a transport failure does not. Renaming the event would
  have moved an ambiguity from the reader into the vocabulary of the protocol.

The heartbeat is a comment-free `ping` event, not a comment line, so a client can
observe liveness rather than merely rely on the socket staying open. Its timer is
unreferenced: a heartbeat must never be the reason the process stays alive.

### 2.4 The subscription route

Server-Sent Events travel one way, so a page that pans or zooms cannot tell the
service through the stream itself. Reconnecting on every wheel event would be
worse than one small request, so the rectangle is updated over HTTP and the next
frame arrives on the same connection:

```json
{ "clientId": 1, "x0": 0, "y0": 0, "w": 1024, "h": 768 }
```

| Reply | When |
|---|---|
| `200 {"ok": true, "clientId": N, "viewport": {x0, y0, w, h}}` | The rectangle was accepted. The echoed viewport is the **clipped** one, because the hub fits every subscription inside the world |
| `400 bad_request` | A field is not an integer, the origin is negative, a dimension is not positive, or the rectangle is refused by admission |
| `404 unknown_client` | No stream is open with that `clientId` |
| `503 switch_in_progress` | A representation switch is running |

The next frame is pushed on the open connection; the reply does not carry it.

### 2.5 The representation switch

`POST /api/representation` changes which representation the core keeps the world
in, without losing the world:

```
export  ->  restart the child with --representation  ->  import
```

The service owns the sequence, because the live set is the core's and the service
cannot read it. The **generation travels with the payload** — the core's `import`
accepts one — so a switch does not rewind the clock, which is the difference
between "the cells were preserved" and "the world was preserved".

| Condition | Reply |
|---|---|
| The representation is already running | `200 {"ok": true, "switched": false, "representation": …, "state": …}`. The process is **not** replaced |
| The switch ran | `200 {"ok": true, "switched": true, "representation": …, "previousRepresentation": …, "exported": {population, generation}, "imported": {changed, population, generation}, "state": …}` |
| The value is not one of `REPRESENTATIONS` | `400 bad_request` naming the accepted values |
| A switch is already running | `503 switch_in_progress` |
| The export payload was malformed, or the import was refused | `502 export_failed` or `502 import_failed` |

While a switch is running, **every other route refuses with
`503 switch_in_progress`**: the restart leaves an empty world for the moment
between the two halves, and that window must not be observable. The refusal
covers `/api/state`, `/api/frame`, `/api/command` and `/api/subscription`; the
stream stays open and is told the new state when the switch completes.

A switch is not free. It replaces the core process and round-trips the whole live
set through the service, so on a world with millions of live cells it is a
visible pause. It is refused rather than queued if another one is already
running, and the cost at that scale has not been measured
([performance.md](performance.md) §7).

### 2.6 The history routes, and the tree

The recorded history belongs to the **core**; these routes forward it. The
service never opens the store, never knows its schema and never edits it.

| Route | Body | Reply |
|---|---|---|
| `GET /api/history` | none | The core's `history` reply with `history: true` added: `session`, `current`, `head`, `count`, and `generations[]`, each naming its `id`, `generation`, `parent` (the root's is `null`), `kind` (`keyframe` or `delta`), `population`, `changed`, `born`, `died` and `at` |
| `POST /api/select` | `{"node": N}` or `{"generation": N}`, exactly one | The core's reply plus `state`: the node selected, the generation it carries and the population |
| `POST /api/rollback` | `{"generation": N}`, a non-negative integer | The core's reply plus `state`: the loaded generation, the population and the bounds |
| `POST /api/archive` | `{"name": "…"}` optional, defaulting to `archive.jsonl` | The core's reply: `path` and the number of generations written |
| `GET /api/archives` | none | The archives in the archive directory: `name`, `generations`, `bytes` and `modified`. A file whose generation count cannot be read within a size bound reports it as unknown rather than as a wrong number |
| `POST /api/archive/rename` | `{"from": "…", "to": "…"}` | `400 archive_exists` if the target is taken, otherwise the new listing |
| `POST /api/archive/delete` | `{"name": "…"}` | The new listing |
| `POST /api/archive/import` | `{"name": "…"}` | The core's reply: the new session id, the generation it was left on and the population |

**The history is a tree, and four rules say what that means.**

1. **Recording appends.** A new generation is a child of the node the world is
   on. Nothing that already descends from that node is discarded, which is what
   makes a second branch possible at all.
2. **Reading and working are two operations.** `rollback` loads a node and leaves
   the recording head where it was, so looking at the past is not destructive;
   `select` moves the head, and moving it is what makes the next record a
   sibling of what the selected node already has. An operation that did both
   would turn inspection into an edit.
3. **Amending the tip of a branch is not a branch.** An edit rewrites the head's
   node when nothing descends from it, and adds a node when something does —
   which is exactly the case after selecting an older node. Placing a cell on the
   tip therefore does not produce a second generation zero.
4. **A generation number is a label, not an identity.** Two branches may hold a
   node with the same number, which is what a fork *is*. `rollback` and
   `select` by generation answer for the branch the world is on and refuse a
   number that exists only on another branch rather than guessing;
   `select {"node": N}` reaches any branch.

The page uses `select`, because its timeline is a tree and a numbered list cannot
address a sibling. `rollback` is kept for API callers who want to look without
moving anything.

Three rules are this layer's own:

* **A core started without a history answers `200` with `ok: false` and
  `error: "no_history"`**, not a status code. The absence of a history is a fact
  about how the core was started rather than a failure of the request, and the
  page uses it to hide the panel instead of showing a broken one. The core's own
  message is carried through unchanged.
* **A select or a rollback is broadcast.** The world moved, so every subscriber
  receives the new `state` and a fresh `frame`; only telling the caller would
  leave two pages showing two generations of one world.
* **An archive name is a name, not a path.** Every archive route resolves its
  name through one function, inside the archive directory, and anything
  containing a separator, a drive letter or a traversal is refused `400` rather
  than repaired. A request must not choose where a process on the same machine
  reads or writes. Deleting is behind a second press in the page because it is
  the one action in that manager that cannot be undone.

These routes refuse with `503 switch_in_progress` while a representation switch
runs, like every other route.

**One consequence of a switch is worth stating.** A representation switch
restarts the core, and a restarted core records a *new* session, so the tree
begins again at the generation that was carried across and the earlier nodes stay
in the store under the previous session. That is a limitation with an owner, not
a behaviour a caller should infer: it is recorded in [risks.md](risks.md).

### 2.7 The routed pages

The interface is three pages rather than one document, and they are composed on
the server. `routes.mjs` is the **only route table**: the dispatch, the tab bar
and the script set a page loads are all read from its `ROUTES` array, so a route
cannot exist in the navigation without existing in the service, and a page cannot
be served without the module that drives it.

| Route id | Paths | Fragment | Page module | Navigation key |
|---|---|---|---|---|
| `world` | `/`, `/world` | `pages/world.html` | `/static/pages/world.js` | `nav.world` |
| `history` | `/history` | `pages/history.html` | `/static/pages/history.js` | `nav.history` |
| `archives` | `/archives` | `pages/archives.html` | `/static/pages/archives.js` | `nav.archives` |

`/` and `/world` are **one route with two paths**, not two routes: they serve the
same fragment, and having one page reachable at two addresses is what makes a
launcher's smoke test and a navigation link agree.

**Composition.** A page is the shared layout
([public/pages/layout.html](../../../src/viewer/public/pages/layout.html)) with
four slots filled:

| Slot | Filled with |
|---|---|
| `{{page-id}}` | The route id, which lands on `<title>` and `<body>` as `data-page` |
| `{{nav}}` | `renderNav(currentId)`: one link per route, and `aria-current="page"` on the current one |
| `{{content}}` | The route's fragment, with its trailing blank lines trimmed |
| `{{scripts}}` | `renderScripts(route)`: the shell first, then the route's own module, so the shell is listening before a page asks it for anything |

`LAYOUT_SLOTS` names exactly those four and a test compares the two sets in both
directions. **An unfilled slot throws.** Emitting the slot instead would
ship a page whose navigation reads `{{nav}}`, which looks like a rendering bug in
the browser and is invisible in the composer.

**A fragment is a fragment.** It carries no `<html>`, `<head>` or `<body>`, so a
composed page has exactly one of each and exactly one `<title>` — the duplicate
heading a person reported, and the nested documents that a fragment with its own
head would have produced, are both structural rather than cosmetic.

**The layout and the fragments are read once and cached**, because they are files
this service ships: a change to one is a restart, not a request. Reading them per
request would put four synchronous file reads in front of every page for no
benefit.

**A path nobody serves is `404`** — `routeFor` answers `null` and the service does
not fall back to the world page, because falling back would make every typo look
like a working address.

### 2.8 Sessions, patterns and the storage choice

**A session is one core with one history.** `GET /api/sessions` lists the default
session (`main`) and every session created since, plus `cap`, `queueCap` and
`queued`; a service holds at most `MAX_SESSIONS` (64) sessions including `main`,
and a creation request that arrives at the cap **waits** rather than being
refused, until a session closes. At most `MAX_QUEUED_SESSIONS` (1024) creations
wait; one that arrives with the queue full is refused with
`503 session_queue_full`, because a refused request is better than a queue that
grows without a bound. `queued` is how many are waiting and `queueCap` is the
bound; both are what the page reports. `POST /api/sessions` creates one with its own
core, its own event hub and its own history store, and `POST /api/sessions/close`
stops one. Every session-scoped route in §2 takes `?session=<id>`; a request
without it means `main`, and an id the service does not have is
`404 unknown_session` rather than a fallback to another core. The ids are
generated by the service (`s1`, `s2`, …) and are **not persisted**: a restart of
the service starts again with `main` only. Archive export and import are
session-scoped; archive list, rename and delete are directory-scoped and take no
session.

**A pattern is placed by name.** `GET /api/patterns` lists the library — fifteen
classic still lifes, oscillators, ships and the Gosper glider gun, from
`src/viewer/patterns.json`. `POST /api/pattern` resolves the name, places the
pattern's bounding box with its top-left at `(x, y)` as **one `set` command**, and
answers with what changed. The cells are not part of the request: the service
resolves them against the running world, so a client cannot place a shape the
library does not contain, and the bounds are checked before the core sees them.

**The storage is reconsidered after a placement.** The service exports the whole
live set, applies the rule in
[representation.mjs](../../../src/viewer/representation.mjs) — tiled at or above
the measured crossover of 4,000 cells when the population's density is at least
`TILED_MIN_DENSITY`, sparse otherwise — and switches only when the choice differs
and the population is large enough for the measurement to have an opinion. Below
the crossover a person's manual choice stands. The density boundary is **chosen
between the two measured shapes** (packed about 0.24, spread about 0.004) and is
not itself measured; that is recorded in [risks.md](risks.md) VWR-32.

A placement's reply is the core's `set` reply plus `name`, `cells`, `width`,
`height`, `representation` and `switched`, so the page can show what landed and
whether the storage moved. The switch keeps the world and the generation, exactly
as `POST /api/representation` does (§2.5).

### 2.9 The editing surface, and the shareable view point

**The single-machine editing API is implemented** (§2.11); collaboration, roles and
the page tools are planned. This route names the seam an editor builds on rather
than restating the protocol. `GET /api/capabilities` answers with the session, the
world, the rule, the representation, the limits and the history flag the core
reported, the HTTP surfaces (`command`, `pattern`, `patterns`, `snippets`, `edit`,
`editTransaction`, `editState`, `sessions`, `closeSession`, `events`), the session
cap and queue (`cap`, `queueCap`, `queued`), and
`editing: {mode: "implemented", paused: true, limits: {side: 256, cells: 8192}}`.
It deliberately does **not** list the command vocabulary: that belongs to the
core's protocol, and a copy here would be the copy that drifts.

**The API is callable.** Every route is HTTP and JSON, served on loopback by
default; a page and a local API client use the same surface, and there is no
authentication (VWR-01). The editing API is the first surface designed for both:
it is what the page will use, and what an external editor can drive directly.

**The remembered view point is shareable.** The point the history preview centres
on belongs to a session: it is stored under `lifegame.viewer.focus` for `main` and
`lifegame.viewer.focus.<session>` for a created session, so two worlds no longer
overwrite each other's memory. A `?focus=x,y` URL parameter is the sharing
mechanism: a page that loads it stores the point for its own session, and that
session's history preview opens there. Sharing is therefore explicit and by link;
nothing is shared by implication.

### 2.10 The published snippet library

The library is **implemented**; the page controls that will use it are part of the
planned editing mode. A snippet is an immutable value `{cells, width, height,
contentHash}` stored one JSON object per hash under `data/snippets/`, with
`index.json` mapping a name to `{hash, width, height, cellCount}`. Publishing is
compare-and-swap: identical content under one name is idempotent, a different
content without a pinned `expectedHash` is `409 name_conflict`, and a stale pin is
`409 hash_mismatch`. A name can be read pinned with `?hash=`. Removing a name
deletes only the index entry; the content object stays, because it is immutable
and another name may reference it. The box limits are 256 cells on a side and
8192 live cells, and a selection or a transaction larger than that is
`413 too_large`. Drafts are not stored here: a draft belongs to the page or to an
API client until it is published. The library is separate from the built-in
patterns, which remain read-only data shipped with the viewer. The decisions are
[ADR 0014](../../adr/data-and-formats/0014-snippets-are-content-addressed-objects.md).

### 2.11 The editing API

**The world is paused while the mode is open.** `POST /api/edit/enter` pauses a
running world, reads the session's live set once to fingerprint it, and opens a
document at that generation; `POST /api/edit/leave` closes it and resumes the run
state it had. While the mode is open, every world-writing route is refused with
`409 edit_active` — `/api/command` (except its read-only commands), `/api/pattern`,
the representation switch, rollback, select and archive import — because a second
writer would move the world out from under the transaction document.

**A transaction is one atomic edit.** `POST /api/edit/transaction` takes
`{txId, baseVersion, baseHash, author, ops}`. The operations are absolute intents:
`set` (cells alive or dead), `clear` (a box dead), and `fill` (a box becomes a
source shape, `mode: "overwrite"` or `"merge"`). The service turns them into the
cells it asks the core to write; the core's atomic `patch` applies them and
answers with the cells that **actually changed**, which is what the document
records. The reply carries that patch, the new version and hash, and `rebased`
when the base was behind and every operation was absolute. A duplicate id, a
stale base with a content-dependent operation, or a wrong generation is refused
before the core is touched.

**Versions and hashes are a chain.** The document's `version` advances by one per
committed transaction, and `hash` is a SHA-256 over the previous hash, the
transaction and the change it made; the session id, version and hash are the
executor's "session number plus state number". A client that applies the
broadcast `patch` events computes the same hash, and `GET /api/edit/state?since=N`
answers with the patches after `N` (or `full: true` when `N` has fallen out of the
retained window).

**Undo is a transaction.** `POST /api/edit/undo` restores the cells the named
transaction still owns and records an inverse transaction; without `txId` it
names the newest transaction on the session's global undo stack. A cell another
author wrote since keeps its newer value, and the reply names the transaction
(`of`) and the author of the undo. `POST /api/edit/redo` re-applies the undone
intent. Both broadcast a `patch` event, as a commit does. The undo stack is
bounded by the same retained window as incremental resynchronisation (`1000`
transactions): a transaction that has left the window is no longer undoable, and
its per-cell attribution is compacted with it, which bounds a long session's
memory.

**Concurrent transactions merge in commit order.** The service is the only
serialiser: it rebases a transaction whose base is behind when every operation is
absolute, refuses a content-dependent one with `stale_base`, and applies the
transaction to the world it actually meets. Two clients writing different cells
both survive; two clients overwriting the same cell converge on the later
commit, and every subscriber sees the same `version` and `hash` in its `patch`
event. A client that receives a version it cannot follow resynchronises through
`/api/edit/state`.

**Presence is ephemeral.** `POST /api/edit/presence` records a collaborator's
cursor, selection and view point, broadcasts a `presence` event, and never writes
anything down; an entry expires after 30 s and `leaving: true` removes it at once.
`GET /api/edit/presence` answers the current list for a client that joins late.
A presence report is refused with `not_editing` when the mode is closed.

**Limits.** A box is at most 256 cells on a side; an operation or snippet names at
most 8192 cells; the request body stays under 1 MiB. A refusal is `too_large` or
`bad_arguments` with no cell changed.

**The page tools.** The world page has an explicit edit control (§7.7): entering
opens a toolbar whose tool, transform and mode selects own their vocabularies
(`public/edit-tools.mjs`), and whose buttons send the routes above. A drag becomes
one transaction; a selection becomes a draft in browser storage that can be
published; the palette places a snippet with the chosen transform and mode. Undo
and redo call `/api/edit/undo` and `/api/edit/redo`, and a stale refusal resyncs
through `/api/edit/state` and says so.

## 3. The frame admission contract

This is the only place where the service acts on knowledge of the *encoding*
rather than merely forwarding. It is a contract about **what the service
guarantees to the core**, and it exists because one of the two encodings
allocates inside the core.

### 3.1 What the core does

The core's encoder is authoritative and lives in
[bridge.py](../../../src/lifegame/world/bridge.py) `encode_frame`: it chooses
`cells` when eight bytes per live cell is no larger than one bit per cell in the
rectangle, that is while

```
8 * live  <=  ceil(w / 8) * h          (the encoder's rule)
```

and otherwise builds a dense bitmap of `w * h` bits. The `cells` path scans the
live set and never materialises a grid, which is what makes viewing the whole
`65536 x 65536` world possible while it holds a few thousand cells. The `bits`
path allocates `w * h` bytes of intermediate storage inside the core, so a
`65536 x 65536` request that took it would ask for about 2.8 GB.

The rule is stated here in the service's own units because the service has to
apply it; its meaning, and the encodings themselves, remain owned by
[world/interfaces.md](../world/interfaces.md) §4.6.

### 3.2 The rule the service applies

The rule is implemented **once**, in
[public/shared.mjs](../../../src/viewer/public/shared.mjs) `frameAdmission`,
because three callers need it: the `/api/frame` route, which has a request to hang
the decision on; the push transport, which does not; and the page, which bounds
its own zoom with the same rule rather than a second copy of it (§11).

Let `area = w * h` and `population` be the last world population the core
reported on any reply that carried a `population` field — `state`, `set`, `step`
and every `frame` reply update it.

```
population * 64  <=  area        ->  the cells encoding is guaranteed; admit at any area
otherwise,  area <= MAX_FRAME_CELLS   ->  admit; the allocation is bounded by the cap
otherwise                             ->  refused, naming the area and the population
```

* `MAX_FRAME_CELLS` is `16 * 1024 * 1024` cells, so the largest transient
  allocation the service will allow inside the core is 16 MiB.
* `population * 64 <= area` is the encoder's rule with the ceiling dropped, which
  makes it very slightly conservative for widths that are not a multiple of
  eight. Being conservative here costs a rare refusal of a rectangle the encoder
  would in fact have served as `cells`; being optimistic would let a dense
  bitmap through.
* `population` is an **upper bound** for the live cells inside any rectangle,
  which is why one number suffices. The hub keeps its own and takes the larger of
  the two it can see, because erring towards a refusal is the safe direction.
* The guarantee is made against the **last reported** population. A world that
  grows between the last report and the frame request can therefore still take
  the `bits` path — and then the area cap is what bounds the allocation. That is
  the cap's purpose, and it is why the cap is not the primary rule.
* A refused request must never reach the core. This is asserted by counting the
  stub's calls, not by inspecting the reply.

A refusal has two shapes because there are two callers: the REST route answers
`400 bad_request`, and the hub sends an `error` event carrying the same `error`
code, message and the rectangle it refused.

### 3.3 The page applies the same rule

[public/viewport.mjs](../../../src/viewer/public/viewport.mjs) applies the same
rule to bound how far the view may zoom out: the widest span for which `cells` is
guaranteed at the current population, or the span whose area is
`MAX_FRAME_CELLS`, whichever is smaller. A sparse world can therefore be viewed
whole, and a dense one is pulled in with the reason stated in the span readout.

`MAX_FRAME_CELLS` and the rule that uses it are declared **once**, in
[public/shared.mjs](../../../src/viewer/public/shared.mjs), which the service
imports by relative path and the browser loads over `/static/shared.mjs` — the
same bytes, served by the same handler, with no build step. The page, the
`/api/frame` route and the push transport therefore cannot disagree: they are
three callers of one function. The duplication this section used to record is
gone, and [risks.md](risks.md) VWR-04 is retired with it (§11).

## 4. The bridge surface

### 4.1 Module exports

| Export | Kind | Contract |
|---|---|---|
| `PROTOCOL_VERSION` | `number`, `1` | The protocol version this bridge speaks, mirroring the core's own constant |
| `REPRESENTATIONS` | `string[]`, frozen | `['sparse', 'tiled']`: the representations the core accepts, in the order the page offers them |
| `repoRoot` | `string` | The repository root, resolved from this file rather than from the caller's working directory |
| `defaultPythonPath(root)` | `(string?) => string` | `<root>/.venv/Scripts/python.exe` on Windows, `<root>/.venv/bin/python` elsewhere |
| `BOOTSTRAP_HINT` | `string` | The command to run when the interpreter is missing |
| `CoreUnavailableError` | `Error` subclass | `name` is `CoreUnavailableError`, `code` is `core_unavailable` |
| `CoreTimeoutError` | `Error` subclass | `name` is `CoreTimeoutError`, `code` is `core_timeout` |
| `CoreBridge` | class | §4.2 |

### 4.2 `CoreBridge`

```js
new CoreBridge(options?)
```

| Option | Default | Meaning |
|---|---|---|
| `worldWidth`, `worldHeight` | `65536`, `65536` | Passed to the core on its command line |
| `representation` | `'sparse'` | Which representation the core is started on; passed as `--representation` |
| `pythonPath` | `defaultPythonPath(repoRoot)` | The interpreter to spawn |
| `cwd` | `repoRoot` | The child's working directory |
| `requestTimeoutMs` | `30000` | Per-request timeout; overridable per call |
| `crashLimit` | `3` | Consecutive crashes after which the bridge stops respawning |
| `restartBaseDelayMs`, `restartMaxDelayMs` | `250`, `4000` | The exponential backoff window applied to a request that arrives after a crash |
| `killGraceMs` | `750` | How long `stop()` waits for a graceful exit before killing |

| Member | Contract |
|---|---|
| `request(cmd, fields?, options?)` | Returns a promise for the core's reply. Queued behind every request already accepted; strictly one is in flight. Rejects with `CoreTimeoutError` or `CoreUnavailableError`. `options.timeoutMs` overrides the default |
| `start()` | Starts the child without waiting for a reply; returns its pid |
| `stop()` | Sends `quit`, waits for exit, kills if it must, and detaches. Idempotent |
| `restart({representation?})` | Ends the current child as a **planned** exit and starts a fresh one, optionally on another representation. Resets the crash counter, because a planned restart is not a strike against the limit. Throws `CoreUnavailableError` when the wanted value is not in `REPRESENTATIONS`. The caller owns whatever has to be carried across — the bridge itself carries nothing |
| `running` | `true` while a child is attached |
| `representation` | Which representation the core is currently started on |
| `pid` | The child's pid, or `null` |
| `stderr` | The last 8192 characters of the child's stderr. **Never part of the protocol**; for logs only |
| `stats()` | A diagnostic snapshot: `running`, `pid`, `pending`, `requests`, `crashes`, `crashLimit`, `lastError`. Never consulted by the request path |
| `onEvent(listener)` | Subscribes to unsolicited core events (`tick`); returns an unsubscribe function. A listener that throws is ignored, so a broken listener cannot take down the transport. The event hub is a listener |
| `pythonPath`, `cwd`, `worldWidth`, `worldHeight` | Read-only in practice: set at construction |

Ownership and lifetime: the resolved value of `request` is the core's parsed
JSON line. It is not copied and not retained; a caller that keeps it keeps its
own reference, and the bridge holds nothing after settling.

### 4.3 The restart policy, as a contract

1. A crash — a failed spawn, an `error` event, or an **unplanned** exit —
   increments a counter, records the reason, and rejects every pending request
   with `CoreUnavailableError`.
2. A request that arrives while no child is attached and the counter is non-zero
   waits out an exponential backoff (`250 ms`, doubling, capped at `4000 ms`)
   and then starts a fresh child. A restart is therefore invisible to the
   caller.
3. **Any** traffic from the core resets the counter, including an unsolicited
   event. Traffic is the liveness signal; the bridge invents no heartbeat.
4. When the counter reaches `crashLimit`, the bridge refuses to respawn and
   every request fails with `CoreUnavailableError` naming the last error. This
   is what stops a core that dies on start-up from being respawned for ever.
5. A **planned** restart — `restart()`, which is what a representation switch
   uses — is not a crash. It ends the child deliberately, resets the counter, and
   starts a fresh one. Without that distinction one switch would spend one of the
   three lives, and three switches would take the service down.

## 5. The decoder surface

Free of DOM and canvas on purpose, so the browser's own decoding path is
exercised by `node --test` against payloads the real core produced.

| Export | Contract | Raises |
|---|---|---|
| `base64ToBytes(base64)` | `Uint8Array` of the decoded bytes | The platform's `atob` error on invalid input |
| `decodeCells(base64)` | `[[x, y], ...]` in **absolute world coordinates**, little-endian `int32` pairs | Throws when the payload is not a whole number of pairs: a truncated frame must be reported, never half-drawn |
| `forEachLiveBit(base64, width, height, visit)` | Calls `visit(x, y)` for every live cell in row order; returns the live count. Zero bytes are skipped whole, so an empty or sparse bitmap costs one test per eight cells rather than one per cell | Throws when the payload is shorter than `ceil(width / 8) * height` |
| `decodeBits(base64, width, height)` | `{ bitmap: Uint8Array(width * height), live: number }` for callers that want a grid | Same as `forEachLiveBit` |

Bit order and row stride are the encoder's, not this module's:
[world/interfaces.md](../world/interfaces.md) §4.6 owns them.

## 6. The theme surface

[public/theme.mjs](../../../src/viewer/public/theme.mjs) is one of the three
browser-side modules with no DOM in it, alongside the decoder of §5 and the
viewport arithmetic of §7.4. The browser could not be driven from `node --test`
when this module was written, so every decision the page makes that *can* be a
pure function of plain values is one, and lives here.

### 6.1 Constants

| Export | Value | Meaning |
|---|---|---|
| `THEME_STORAGE_KEY` | `'lifegame.viewer.theme'` | Where an explicit theme choice is remembered |
| `GRID_WIDTH_STORAGE_KEY` | `'lifegame.viewer.gridWidth'` | Where the grid line width is remembered |
| `THEMES` | `['dark', 'light']` | The closed set of concrete themes |
| `GRID_WIDTHS` | `[1, 2, 3, 4]` | The widths the control offers, in CSS pixels |
| `DEFAULT_GRID_WIDTH` | `2` | Used when nothing is stored and when a stored value is not a number |
| `MIN_GRID_WIDTH`, `MAX_GRID_WIDTH` | `1`, `4` | The ends of `GRID_WIDTHS` |
| `CANVAS_PALETTE_KEYS` | `['--alive', '--dead', '--grid']` | The custom properties the canvas reads back out of the stylesheet (§7.2). Every other colour on the page is CSS-only |

The two storage keys are namespaced and distinct; a test asserts both, because a
shared key would make one control overwrite the other's setting.

### 6.2 Theme precedence

```
stored === 'dark' | 'light'   ->  that theme, whatever the system says
anything else                 ->  the system preference
```

`resolveTheme(stored, systemPrefersDark)` is that rule and nothing else, and
`isExplicitTheme(stored)` exposes the first line so a caller does not restate it.
"Anything else" includes a value written by an older build: it falls back to the
system rather than raising.

The rule exists **once**. The stylesheet does not carry a
`prefers-color-scheme` media query, because `data-theme` on `<html>` is always a
concrete `dark` or `light` — set before the first paint by
[the layout](../../../src/viewer/public/pages/layout.html) and kept in step afterwards
by `app.js`. A media query here would mean a second copy of the light palette
and a second copy of the precedence rule, and changing one copy later would be a
silent visual defect rather than a compile error.

### 6.3 Storage

Reading and writing never throw. `readStored` returns `null` when the storage is
absent, unreadable or holds a non-string; `writeStored` returns `false` when the
choice could not be remembered. A private-mode window therefore keeps a working
theme button that simply forgets the choice, instead of a button that throws.

`clearStored(key, storage)` removes a key so the setting returns to following the
system. The page has no control that calls it yet — see the open question in
[risks.md](risks.md).

### 6.4 Colour parsing

`parseColor(text)` accepts what a palette realistically writes: `#rgb`, `#rgba`,
`#rrggbb`, `#rrggbbaa`, and `rgb()`/`rgba()` in either the comma or the space
separated form, with or without an alpha channel.

**An unrecognised value returns `null`, never a guess.** That is the contract the
caller depends on (§7.2): a `null` means "keep the colour you already have",
which is why a palette the parser cannot read degrades to the previous theme
rather than to a black canvas. `toCssColor` turns a parsed colour back into a
string for `fillStyle` and `strokeStyle`, omitting the alpha channel when it is
opaque.

### 6.5 Grid line geometry

Two problems, one function each.

`clampGridWidth(value)` maps a stored or selected value into `GRID_WIDTHS`,
rounded. A value that is **not a number** falls back to `DEFAULT_GRID_WIDTH`
rather than to the minimum, so a corrupted entry does not silently become the
thinnest line.

`deviceLineWidth(cssWidth, dpr)` rounds a width to a whole number of **device**
pixels and returns it in CSS pixels. A stroke whose width is not a whole number
of device pixels has a partially covered edge on each side, which the rasteriser
blurs into two grey rows instead of drawing one line. At a fractional ratio the
user's `2 px` therefore becomes the nearest width that can actually be drawn —
`2.4` CSS pixels at a ratio of `1.25`, and the control still reads `2 px`.

`snapLineCenter(cssPosition, dpr, cssLineWidth)` returns where a line's centre
belongs for whole-pixel coverage: at `n + 0.5` device pixels for an odd width and
at `n` for an even one. The result is in CSS pixels because the context is scaled
by the ratio before anything is drawn.

A device pixel ratio that is missing, non-finite or not positive is treated as
`1`, so a caller cannot make the geometry undefined.

## 7. The page's operator interface

| Gesture or key | Effect |
|---|---|
| Click | Toggles the cell under the cursor. A press that moves at most 4 pixels is a click, not a drag |
| Drag | Pans the viewport |
| Wheel | Zooms about the cursor, from 8 cells across to the bound of §3.3 |
| Two-finger pinch | Zooms about the **midpoint of the two fingers**, so the world point under that midpoint stays where it is. The same anchoring rule as the wheel, asserted as an equality |
| Two-finger drag | Pans with the midpoint |
| `Space` | Runs and pauses |
| `.` or `ArrowRight` | Steps once |
| `h` | Hides the panel, or brings it back. From the full-width state it hides rather than returning to the column, because the control means "get it out of the way" |
| `w` | Expands the panel to the full width of the stage, and back. From the hidden state it opens wide rather than restoring the column, because the press asked for the big view |
| Run / Pause, Step, Clear | The same three actions by button |
| Theme | Switches between the two palettes and remembers the choice. The button's label names the theme in effect, so the current palette is readable without looking at the canvas |
| Grid width | `1` to `4` pixels; takes effect on the frame already on screen, with no request to the core |
| Storage | `sparse` or `tiled`: which representation the core keeps the world in (§2.5). This one **is** a request, because the core process has to be replaced. The control shows what the core is actually running, and a refused switch leaves it showing that rather than the value that was asked for. Its options are the core's, from `hello.limits.representations` — the page does not list them itself |
| Language | `en` or `zh` (§12). Takes effect immediately, with no reload and no request; it updates the document's own `lang`, and every keyed node, translated attribute, readout label and the hint line. Options come from `LOCALES` |
| Rule | The life-like rule the core applies, from the preset list or typed as `B…/S…` (§7.5). Choosing a preset sends it at once; the field submits on `Enter` and on the button, which are the same call. **The core is the authority**: the page checks the shape first, so a malformed value sends nothing, and a `bad_rule` refusal is shown with the core's own reason while the running rule stays as it was. A rule that is none of the presets is shown by an entry that names it, never by the nearest preset. Changing the rule needs no pause — the core applies it from the next generation |
| Panel | Three states, persisted like the theme: a column beside the canvas, hidden off the right edge with the canvas taking the space it gave up, and full width with the canvas stepping aside. Collapsing changes the layout rather than covering the canvas, because a panel drawn over the world hides the thing being worked on, and the handle stays visible in all three states |
| Tick-rate slider | The range the core declared, applied from `hello.limits.ticksPerSecond`, taking effect immediately while running. A core that declared no range leaves the control unavailable rather than offering a value it would refuse |
| Timeline | The recorded generations **as a tree**, newest last: each row names its generation, its storage type (keyframe or delta), its population and its change count. Indentation is by depth, a fork point is marked and its children carry a branch letter, and both the recording head and the generation the world is on are marked. Selecting a row moves the world there — and the next edit or step then becomes a second branch beside the old one rather than replacing it. The panel's own controls step one generation back or forward along the current branch and export an archive. A core started without a history shows no timeline |
| Archive manager | Lists what the archive directory holds — name, generations, size, modified time — and renames, deletes or imports one. Export names the file to write. Deleting takes a second press, because it is the only action there that cannot be undone. Every name is a name: the page never sends a path (§2.6) |

Readouts: generation, population, viewport origin, span, rule notation, world
size, and the current scale in pixels per cell or cells per pixel.

Two status surfaces exist for failures: a banner (`#error`) that states what went
wrong while the previous frame stays on screen, and a core-status element
(`#core-status`) that distinguishes "core ok" from "service unreachable" and
"world core unavailable". The core-status line also names the representation the
core reported, so the two sources of truth about it — the control and the stream
— can be compared by eye.

### 7.1 The DOM contract between the page and its script

The shell and the page modules bind these ids, and the markup must provide them.
`dom-contract.test.mjs` asserts that every id a route's scripts read is declared
by that route — the check that would have caught the missing `#timeline`.

```
core-status  error  hint  locale  stage  toggle-theme
grid  canvas-area  panel  panel-handle  panel-wide  grid-width  representation
rule-preset  rule-custom  rule-apply  rule-error
toggle-run  step-once  clear-world  tps  tps-value
readout-generation  readout-population  readout-origin  readout-span
readout-rule  readout-world  readout-cell
timeline  timeline-list  timeline-note  step-back  step-forward
archive-name  archive-list  archive-note  archive-refresh  export-archive
```

Thirty-nine ids, and **which file declares one is part of the contract** because
the three pages are composed from different fragments:

| Declared by | Ids | Why there |
|---|---|---|
| [layout.html](../../../src/viewer/public/pages/layout.html) | 6: `core-status`, `error`, `hint`, `locale`, `stage`, `toggle-theme` | Every route shares them: the status line, the error banner, the hint line, the language control, the stage the panel states are applied to, and the theme switch |
| [world.html](../../../src/viewer/public/pages/world.html) | 23: the canvas, the panel, the world controls, the four rule controls and the seven readouts | The world page owns the canvas and everything that acts on it, and the rule is one of the things that acts on it |
| [history.html](../../../src/viewer/public/pages/history.html) | 5: `timeline`, `timeline-list`, `timeline-note`, `step-back`, `step-forward` | The tree and the two buttons that walk it |
| [archives.html](../../../src/viewer/public/pages/archives.html) | 5: the archive manager | Exporting, listing, renaming, deleting and importing |

The shell binds ids belonging to **every** route and tolerates `null`, so a page
asks only for what its own scripts use; `hint` is declared by the layout on all
three routes and filled by the world and history pages only, which leaves an
empty paragraph on the archive page rather than a missing one.

The tree added **no** ids of its own: it renders into `timeline-list` and reuses
`timeline`, `timeline-note`, `step-back` and `step-forward`. A row is a
`<button class="timeline-row">` carrying `data-node`, `data-generation`,
`data-current`, `data-head`, `data-fork` and `data-branch`, and its own numbers
are revealed on hover or keyboard focus (§14).

`dom-contract.test.mjs` asserts that every id the script binds is present in the
page, that the page declares no duplicate id, that the width options the control
offers are exactly `GRID_WIDTHS`, that the locale control's options are exactly
`LOCALES`, and that the storage control's options are exactly what
`hello.limits.representations` declares.

### 7.2 The canvas palette contract

The canvas paints itself, so it cannot inherit CSS. The three colours it needs
are read back out of the active theme's custom properties —
`CANVAS_PALETTE_KEYS` of §6.1 — through `getComputedStyle`, parsed with
`parseColor`, and cached in the page's `palette` object.

The contract:

* A palette value the parser cannot read **leaves the previous colour in
  place**. It is never replaced by a default, and never by black. A stylesheet
  that cannot be read therefore leaves the page as it was rather than blank, and
  a future palette written in a notation the parser does not know degrades to the
  previous theme instead of to an unreadable canvas.
* Changing the theme refreshes the cache and redraws the frame already on
  screen. It **does not fetch**: the world has not changed, only the pixels.
* Both rendering paths take their colour from the same cache — the coordinate
  path paints points with `palette.aliveRgb`, and the bitmap path builds its
  image data from the same field. A palette field that is read but never
  declared is a defect this contract exists to prevent, and it is asserted by
  `dom-contract.test.mjs`; that the filled cache is truly read by both paths is
  asserted by `page.test.mjs`, which draws a frame of each encoding.

### 7.3 Grid lines

Drawn only while a cell is at least `GRID_MIN_CELL_PX` (6) CSS pixels across;
below that the lines would be denser than the cells they separate.

The width comes from the grid-width control, through `deviceLineWidth` and
`snapLineCenter` of §6.5, so the stroke covers whole device pixels at any ratio.
The colour comes from the active theme's `--grid`, because a fixed light grey is
invisible on a light background. The line is deliberately low-contrast: it
separates cells without competing with them (contrast figures in
[performance.md](performance.md)).

Changing the width redraws the frame already on screen, with no request to the
core, exactly like a theme change.

### 7.4 The viewport surface

[public/viewport.mjs](../../../src/viewer/public/viewport.mjs) is the third
browser-side module with no DOM, no network and no canvas in it. It owns every
decision the page makes about *where it is looking*, so the page's gestures can
be tested as arithmetic instead of as browser behaviour.

| Export | Kind | Contract |
|---|---|---|
| `MAX_FRAME_CELLS` | `number` | Mirrors the server's cap (§3.3) |
| `MIN_SPAN` | `number`, `8` | The narrowest view, in world cells across |
| `DEFAULT_PIXELS_PER_CELL` | `number`, `60` | The default view: one world cell per this many canvas CSS pixels **across**, so a canvas 800 pixels wide opens at 13 cells |
| `defaultSpan(cssWidth, pixelsPerCell)` | function | The span a fresh canvas opens with, from its measured width |
| `worldCentre(world)` | function | The world's centre in world coordinates, or `null` when the world size is not known yet |
| `viewCentre(viewport, cssWidth, cssHeight)` | function | The world point the viewport is currently centred on |
| `centreViewport({point, cssWidth, cssHeight, world, …})` | function | `{span, x0, y0}`: a viewport of the default span centred on a world point |
| `DRAG_THRESHOLD_PX` | `number`, `4` | How far a pointer may travel and still count as a click |
| `GRID_MIN_CELL_PX` | `number`, `6` | Below this many pixels per cell the grid is not drawn |
| `clamp(value, low, high)` | function | Inclusive at both ends |
| `visibleHeight(span, cssWidth, cssHeight)` | function | The world-space height the canvas covers, from the canvas aspect |
| `maxSpan({cssWidth, cssHeight, population, world, …})` | function | The widest span whose frame the service will admit (§3.3) |
| `clampViewport(viewport, world, cssWidth, cssHeight)` | function | Pulls a viewport inside the bounded, non-wrapping world. Mutates and returns |
| `frameRequest({viewport, world, cssWidth, cssHeight, population, …})` | function | `{frame: {x0, y0, w, h}, span, zoomLimited}`: the rectangle to ask for, rounded to whole cells and pulled in when the population outgrew the view |
| `screenToWorld({clientX, clientY, rect, cssWidth, cssHeight, frame})` | function | The world cell under a pointer, using the **frame that was drawn**, not the live viewport, so the mapping accounts for a frame one generation behind |
| `zoomAt({viewport, clientX, clientY, rect, cssWidth, factor, minSpan, spanLimit})` | function | `{span, x0, y0}`: the span rescaled about a fixed point, so the world point under the pointer does not move |
| `panByPixels(viewport, deltaX, deltaY, cssWidth)` | function | Translates a screen drag into world coordinates. Mutates and returns |
| `isClick(moved, threshold)` | function | Whether a pointer that travelled `moved` pixels edits a cell or moves the camera |
| `scaleFor(frame, cssWidth, cssHeight)` | function | `{scaleX, scaleY}` for drawing a frame onto the canvas |

The three functions that *decide* something rather than compute a coordinate —
`maxSpan`, `frameRequest` and `isClick` — are the ones whose rules are restated
from elsewhere: the first two from the admission rule of §3, the third from the
page's own gesture contract. The rest is arithmetic.

`public/app.js` keeps the wiring: it reads the DOM, calls these functions and
writes the canvas. That split is what lets `viewport.test.mjs` assert the
arithmetic exactly and `page.test.mjs` assert that the wiring calls it.

### 7.5 The rule surface

[public/rule.mjs](../../../src/viewer/public/rule.mjs) is the fourth browser-side
module with no DOM, no network and no canvas in it. It owns the rule vocabulary
the page can decide by itself — the presets and one parser — and it is the
**first** check, never the last: the core is still the authority on what it will
run.

| Export | Kind | Contract |
|---|---|---|
| `CUSTOM_RULE` | `string`, `custom` | The value of the select's ninth entry: a rule that is none of the presets |
| `RULE_PRESETS` | frozen array of eight frozen `{rule, key}` | The rules people ask for by name, in the order the control lists them. `key` names the locale entry holding the display name, so the list itself holds no English and no Chinese |
| `PRESET_RULES` | frozen array of `string` | Every rule string the preset list offers, for a membership test |
| `RULE_REASONS` | frozen array of six `string` | Every reason `parseRule` can return, each of which the locale table has a sentence for |
| `parseRule(text)` | function | `{ok: true, rule, birth, survival}` or `{ok: false, reason}`. Either case and any digit order are accepted and nothing is padded, so `b3/s23` and `S32/B3` both become `B3/S23` and `B2/S` stays `B2/S` |
| `presetFor(rule)` | function | A preset's own rule string when the running rule **is** that preset, and `CUSTOM_RULE` otherwise |
| `reportedRule(reply, sent)` | function | The rule the core reports: `reply.rule`, then `reply.state.rule`, then the string that was sent |

The refusals are codes rather than sentences: `missingB`, `missingS`,
`badCharacter`, `outOfRange` (a `9`, which no cell can have as a neighbour count),
`duplicateDigit`, and `badFormat` for an empty value or a value that is not a
string. The sentence a person reads is keyed `rule.error.<reason>` in the locale
table (§12), which is what keeps the words in the catalogue and the grammar in
one function.

**The ninth entry names the rule in force, and that is a decision rather than a
convenience.** Its label is `rule.custom` — `custom · {rule}`, carrying the
running rule string — and **selecting it sends no request**, because "custom" is
not a rule: it moves the keyboard to the text field, which is the one useful
thing the entry can mean. The alternative, selecting the nearest preset, would
have the control claim a rule the core is not running, and the point of the
control is to say what is in force. A rule the core reports at handshake is the
first case of this and a hand-typed rule is the second.

The text field is written in exactly two places: when the core's rule first
arrives, and after a rule the core accepted. It is deliberately **not** rewritten
by a readout redraw, so a refused value stays in the field for the person to
correct rather than being replaced under their hands. **The first of those two
moments does not reliably happen before the page starts**, because the shell
publishes its context before its first `state` reply; the field is therefore
filled the first time a rule arrives, and the person's own edits win from then on.
That ordering was the recorded browser defect VWR-28, fixed inside the version
that delivered the editor and retired from [risks.md](risks.md); the failing and
passing runs are [testing.md](testing.md) §5.10 and the record is §7.15.

A `bad_rule` refusal is shown beside the field, through
`describeError(locale, code, message)`: the translated label for the code with the
core's own message appended as detail (§12.3). It changes nothing about the
running rule — the readout, the select and the world go on describing what runs —
and that is what makes a text field safe to offer at all.

### 7.6 Undo, and saving a world

**Undo is the page's own inverse, not a timeline move.** The world page keeps the
last 64 cell edits it made, newest last; pressing `undo` (or `Ctrl+Z` with the
canvas focused) sends one `toggle` for the most recent cell, which is its own
inverse. The stack is emptied the moment anything else moves the world — a step, a
run, a clear, a placed pattern, a selection, a rollback, or any other change of
generation — because an inverse measured against a state the person no longer sees
would be wrong. A placed pattern and a clear are therefore **not** undoable by this
control; the recorded timeline is the path for those, which is why this is distinct
from a rollback.

**Saving and loading use the archive routes.** `POST /api/archive` writes the
current recorded session to a file in the archive directory, and
`POST /api/archive/import` has the core open one as a new session and restores the
world to its newest generation. Both are reachable from the archives page, so a
world can be saved and loaded without a command line; the core owns the file
format, and the service never replays a delta itself.

### 7.7 The editing surface

The world page's controls include an explicit edit button and, while the mode is
open, a toolbar with the tool select, undo and redo, a snippet name field, save
and publish, the transform and mode selects, the published-snippet palette, and a
status line. The run, step, clear and representation controls are disabled while
the mode is open, because the service refuses a second writer until the mode is
left. The tool, transform and mode vocabularies come from `edit-tools.mjs`; the
snippet list comes from `/api/snippets`, never from a copy in the page. A
selection is drawn as a dashed outline over the frame; a draft is stored only in
browser storage until publish is pressed.

## 8. Command line

```
node src/viewer/server.mjs [--port 8765] [--host 127.0.0.1]
                           [--width 65536] [--height 65536]
                           [--representation sparse|tiled] [--python <path>]
                           [--history <path>] [--no-history]
```

| Flag | Default | Meaning |
|---|---|---|
| `--port` | `8765` | Listening port. `0` asks the operating system for a free port |
| `--host` | `127.0.0.1` | Bind address |
| `--width`, `--height` | `65536`, `65536` | The world size passed to the core |
| `--representation` | `sparse` | Which representation the core starts on. Must be one of `REPRESENTATIONS`, or the process exits `2` naming the accepted values |
| `--history` | `data/history.db`, inside the repository | Which store the core records a session into. The core writes it; the service only passes the path |
| `--no-history` | — | Starts the core without a history at all. The history routes then answer `no_history` and the page shows no timeline |
| `--python` | the project interpreter from `defaultPythonPath` | Overrides the interpreter, for a test or a second environment |
| `--help` | — | Prints the usage line and exits `0` |

On start it writes three lines to standard output: the listening URL, the world
size, and the representation. Exit codes: `0` after `--help` and after a `SIGINT`
or `SIGTERM` shutdown; `2` for a `--port` that is not an integer in `0..65535`,
or a `--representation` outside `REPRESENTATIONS`; a non-zero code if the
listener cannot bind. The module can also be imported without starting a server
— it only runs the CLI when it is the process entry point — which is how the
tests use it.

**The default history path is inside the repository** (`<repo>/data/history.db`)
because that is the rule for anything this project creates
([AGENTS.md](../../../AGENTS.md) §1). `data/` is git-ignored except for its own
README, so a recorded session cannot be committed by accident. Archive exports
default to the same directory.

## 9. What this module consumes from the line protocol

The protocol is owned by [world/interfaces.md](../world/interfaces.md) §4. This
module forwards, and does not interpret:

| Command | Forwarded by | Route |
|---|---|---|
| `hello` | The event hub, once per stream, to describe the world to a subscriber | `GET /api/events` |
| `state` | The service | `GET /api/state`, and the `state` event |
| `frame` | The service, after admission (§3) | `GET /api/frame`, and the `frame` event |
| `set`, `toggle`, `step`, `run`, `pause`, `clear`, `set_rule` | The service, generically | `POST /api/command` |
| `history` | The service | `GET /api/history` (§2.6) |
| `select` | The service | `POST /api/select` (§2.6) |
| `rollback` | The service | `POST /api/rollback` (§2.6) |
| `archive` | The service | `POST /api/archive` (§2.6) |
| `open` | The service, for `POST /api/archive/import` | `POST /api/archive/import` (§2.6). The core opens the file because the stored format is the core's; a service that replayed an archive's deltas would be a second implementation of that format in a second language |
| `export`, `import` | The service, only inside a representation switch | `POST /api/representation` (§2.5) |
| `export`, `import` | The service, only inside a representation switch (§2.5) | `POST /api/representation` |
| `quit` | The bridge only, on shutdown and on a planned restart | — |
| the `tick` event | The bridge records it and the hub forwards it as a `tick` event | `GET /api/events` |

Commands are forwarded generically: the service passes the body minus `cmd`
through as the request's fields, so a command added to the core is reachable
without a change here. The one exception is `frame`, which is refused on the
command route because the frame path has its own guard.

## 10. Compatibility policy

* The **HTTP API is versionless**. Adding a route, or adding a field to a reply
  the core produced, is compatible. Changing a status code, or changing one of
  this layer's own `error` strings, is not: the page branches on `503`,
  `ok: false` and on nothing else, and a client may branch on the rest.
* The **event stream is additive**. A new event name is compatible for a reader
  that ignores unknown events; removing or renaming one is not. The `error` name
  is fixed by the protocol and is disambiguated by the presence of `data`, which
  is part of the contract rather than an accident of the browser.
* **Polling is not deprecated.** Every REST route a polling page needs keeps its
  shape and its meaning, because the fallback is a supported path and not a
  legacy one. A change that made the page depend on the stream would be a
  breaking change to that promise.
* The **frame admission rule must not become more permissive** without evidence
  that the core can afford it. It may become more conservative freely: that only
  refuses rectangles, and it never lets an allocation through.
* The **representation switch must preserve the world**. A switch that lost the
  generation, or that became observable half-done, would be a breaking change to
  the claim in [responsibilities.md](responsibilities.md) §1.
* The **session parameter is additive**. A route without `?session=` still means
  the default session, and adding a field such as `state.session` or
  `hello.session` is compatible; removing one is not.
* The **bridge's exported surface** is used by `server.mjs`, `events.mjs` and by
  the module's own tests. It is not a public API of the repository, but a change
  to `request`, `restart`, `stop`, `running` or the error classes is a change to
  three files and their tests.
* The **decoder's exports** are consumed by `app.js` and by the decoder tests.
  Changing a signature changes both.
* The **viewport module's exports** are consumed by `app.js`, by the viewport
  tests and by the page suite, which drives the real `app.js` through them.
* The **rule module's exports** are consumed by `pages/world.js` and by the rule
  tests. Two things about this surface are contracts with something outside this
  module: the eight preset rule strings are also the eight the world module's
  benchmark prices, listed there as strings rather than imported, because the
  viewer is JavaScript and a benchmark that could not run without it would be a
  benchmark nobody runs; and `rule.error.<reason>` keys are a contract with
  `RULE_REASONS`, which a test asserts in both directions.
* The **theme module's exports** are consumed by `app.js`, by the theme tests and
  by `dom-contract.test.mjs`. The two storage keys and the precedence rule are
  additionally restated in the pre-paint script of
  [the layout](../../../src/viewer/public/pages/layout.html) — the one deliberate
  duplication in this module, described in §3.8 of
  [implementation.md](implementation.md) and pinned by a test that compares the
  key the inline script uses with the key the module exports.
* The **DOM ids** of §7.1 are a contract inside one component.
* The **synthetic browser** in
  [tests/dom-stub.mjs](../../../src/viewer/tests/dom-stub.mjs) is a contract
  between the page suite and the page: it must provide every browser capability
  `app.js` uses — `document`, `canvas` and its 2D context, `EventSource`,
  `fetch`, `matchMedia`, `getComputedStyle` and `localStorage`. A new browser API
  in `app.js` means a new stub, and the page suite fails loudly until it exists
  rather than skipping the path.
* The **palette variable names** `--alive`, `--dead` and `--grid` are a contract
  between `style.css` and `app.js`: the canvas reads them by name, so renaming
  one in the stylesheet alone leaves the canvas on the previous colour. A test
  asserts that all three exist and can be parsed.
* The **CLI flags** are an operator interface: a removed flag is a breaking
  change, an added flag is not.

## 11. The shared-value surface

[public/shared.mjs](../../../src/viewer/public/shared.mjs) is the module both
runtimes import. It lives in `public/` because that directory is already served
statically: the service reaches it by relative path (`./public/shared.mjs`) and
the browser loads `/static/shared.mjs`, which is the same bytes through the same
handler. There is no build step and no second copy.

What belongs in it is exactly the intersection of the two sides — a value one
computes and the other must not recompute.

| Declaration | What it is | Consumers |
|---|---|---|
| `MAX_FRAME_CELLS` | The largest rectangle the `bits` encoding may be asked to build: 16 Mi cells, which is 2 MiB of payload and 16 MiB of transient storage in the core | `server.mjs`, `events.mjs` and `app.js` |
| `frameAdmission({area, population, maxFrameCells})` | The admission decision, returning `null` or an error object. `population` is an upper bound for the live cells in the rectangle, so satisfying `population * 64 <= area` **guarantees** the coordinate encoding | The `/api/frame` route, the push transport, and the page's zoom bound |
| `MAX_CELLS_FOR_NEAREST` | The largest live set the service will send for a preview to centre on: 16384 cells, which is 128 KiB of raw payload before base64. Past it the reply carries no cells and the page centres on the reported bounds instead, and says so | `server.mjs` (the `/api/cells` reply) and the history page (the note that reports the degradation) |
| `NO_LIMITS`, `readLimits(hello)` | The core's declared limits, read into a plain object. A bound the core did not declare becomes `null` — never a plausible substitute | `server.mjs` and `app.js` |
| `clampTicksPerSecond(value, limits)` | A tick rate the core will accept, or `null` when it declared no range. Clamping rather than refusing, because the slider already constrains the input | `server.mjs` and `app.js` |

### 11.1 The rule never a value

The distinction the module exists to hold: **a value the core declares is read,
never restated.** The core publishes `hello.limits`, and everything the core owns
comes through it — the tick-rate range, the per-request step ceiling, the
coordinate ceiling, and the list of representations it offers. A page that
invents a maximum offers a control that produces a refusal the user cannot
explain, so an undeclared bound is `null` and the control that would have used it
is unavailable.

What *is* declared here is what the core does not own and what the page cannot
derive from the core alone: the frame budget, because the `bits` allocation
happens in the service's core process at the service's request, and the live-set
cap a preview may be sent.

The default view is deliberately **not** here. It depends on a measurement only
the page can take — how wide its canvas is — so it lives in
[public/viewport.mjs](../../../src/viewer/public/viewport.mjs) as
`DEFAULT_PIXELS_PER_CELL`, and the service has no default rectangle at all: a
subscription that has not named one is shown nothing (§3.4).

### 11.2 Exports

`MAX_FRAME_CELLS`, `MAX_CELLS_FOR_NEAREST`,
`NO_LIMITS`, `frameAdmission`, `readLimits`, `clampTicksPerSecond`. The module
imports nothing, touches no DOM and no socket, and is asserted by
[shared.test.mjs](../../../src/viewer/tests/shared.test.mjs) as plain data.

## 12. The locale surface

[public/locales.mjs](../../../src/viewer/public/locales.mjs) holds every word the
user can read. The page has no user-visible text of its own: the layout and the
fragments carry structure and `data-i18n` keys, and the table
structure and `data-i18n` keys, and `app.js` fills every keyed text node and every
translated attribute (`title`, `aria-label`) from the table.

| Declaration | What it is |
|---|---|
| `LOCALES` | The languages on offer, in the order the control lists them |
| `DEFAULT_LOCALE` | The language used when nothing else decides |
| `LOCALE_STORAGE_KEY` | The one storage key this surface owns |
| `HINT_SEGMENTS` | The hint line, as segments. It is *copy*, not markup: the separators, the order and which tokens are keyboard keys all differ between languages |
| `KNOWN_ERROR_CODES` | The closed list of codes the page has a label for |
| `translate(locale, key, params)` | One entry in one language, with `{name}` parameters substituted |
| `resolveLocale(stored, preferred)` | A stored language if the catalogue holds it, otherwise the preferred one if the catalogue holds a language sharing its prefix, otherwise the default |
| `describeError(locale, code, message)` | The translated label for a code, with the core's own message appended as detail |

The rule editor added **twenty-one entries to each catalogue**, 152 to 173, in
both languages and with no empty value: four control labels, `action.setRule`,
`rule.custom`, the six `rule.error.*` sentences, the eight `rule.preset.*` names
and `error.bad_rule`. It also added `bad_rule` to `KNOWN_ERROR_CODES`, which is a
code rather than a catalogued key: that list is the closed set of codes the page
has a label for, and a code outside it is shown raw with the core's message
(§12.3).

### 12.1 Entries are templates, not fragments

An entry holds a whole phrase with `{name}` parameters, never a word that another
entry concatenates onto. A language that orders a sentence differently cannot be
served by gluing translated halves together, and neither can a language with a
different plural rule — so an entry that needs one is a function of its
parameters. `action.earlier` and `label.gridWidth` are the two that already are.

### 12.2 The two key sets are identical

A test asserts that the two catalogues have exactly the same keys and no empty
value, so a string added to one language and forgotten in the other fails rather
than falling back silently. That is the only failure mode a catalogue has that
no reader would notice.

### 12.3 The boundary: labels are translated, diagnostics are not

The core's `message` is **not** translated. It is a diagnostic written in English
by the Python core, naming the field or the bound that was wrong, and a
translation of it would be a second, drifting description of the same fact. What
is translated is the **label** for a known `error` code; the core's message is
appended to it as detail. A code the catalogue does not hold shows the raw code
with the message.

### 12.4 Precedence, and why the language needs no pre-paint script

```
a stored language the catalogue holds  ->  that language
anything else, or nothing             ->  the browser's preference, if a
                                          catalogue language shares its prefix
                                       ->  else the catalogue's default
```

The theme needs an inline pre-paint script because it changes colour, and a
colour applied a frame late is visible. The language does **not**: no text is
rendered until the script fills it from the table, so there is nothing to flash.
That is why the locale storage key appears exactly once in the codebase, while the
theme's appears twice and is pinned by a test (§9.5).

## 13. The shell and a page module

Every page loads the shell ([public/app.js](../../../src/viewer/public/app.js))
and then its own module. The two do **not** import each other:

**A page module must not import the shell.** The shell runs on import and touches
the DOM at module scope, so the test suite loads it under a fresh module URL per
case (`app.js?case=7`) to get a clean module state. A page module that imported
it by a plain path would resolve to a *second* copy — one that has already run,
found no data and thrown its state away. That is not hypothetical: it is why the
history page drew no tree at all when this split was first attempted, while every
test passed.

They talk over the document instead, through
[public/link.mjs](../../../src/viewer/public/link.mjs):

| Name | Owner | Meaning |
|---|---|---|
| `SHELL_EVENT` (`lifegame:shell`) | `link.mjs` | The shell publishes its context in `event.detail`, once at start-up and once per request |
| `SHELL_REQUEST_EVENT` (`lifegame:shell-request`) | `link.mjs` | A page asks for the context |
| `connectShell(fill, ready)` | `link.mjs` | Registers the listener, dispatches the request, and calls `fill(context)` for every context that arrives; `ready` runs once |

**Both load orders work.** *Page first*: the page's request is dispatched before
the shell exists and is lost, but the shell's own start-up publication arrives
afterwards. *Shell first* — the order the layout produces, because the shell's
`<script>` tag is written before the page's — the request is answered
synchronously.

The context carries the things the two sides share: the applied `state`, the DOM
nodes the shell bound, the `t` translation function, `describeError`, and the
callbacks a page needs after it has changed the world (`afterChange`,
`refreshHistory`). The page hands those to its module-level bindings, which is why
a page module's functions read `state` and `dom` exactly as they did when all of
this was one file.

**Nothing checks the context's shape at build time.** A page reading a field the
shell stopped publishing fails where it reads it, and the page suite sees a thrown
error rather than a quiet blank. That is weaker than a contract, and it is
recorded as such in [risks.md](risks.md).

## 14. The history tree

[public/history.mjs](../../../src/viewer/public/history.mjs) turns the recorded
nodes into the rows a person reads.

| Export | Contract |
|---|---|
| `flattenHistory(rows)` | Returns `{flat, children}`. A node hangs below its **parent**; a node whose parent is absent from the rows — because a window cut the branch's root, or because the store holds more than one session — starts a branch rather than being dropped |
| `indentLevel(forkDepth)` | Clamps to `0..MAX_INDENT_LEVELS`; a non-number means no indentation; a negative value is clamped to zero, because a window that starts below a fork can rebase a depth below it |
| `MAX_INDENT_LEVELS` | `6`. Six levels of the stylesheet's 14 px is 84 px, which leaves the generation, the branch mark and the node's numbers inside a panel `min(360px, 42vw)` wide |
| `nodeById(rows, id)` | The node with that id, or `undefined` |
| `formatHistoryTime(at, locale, noneLabel)` | An ISO-8601 timestamp in the reader's locale; a value that is not a date is shown **as it arrived** rather than replaced with a dash, because it came from the core and inventing a value over it would hide a fact |

**Indentation is fork depth, not tree depth.** A level is added only where the
tree actually parts — a node with more than one child — so two siblings of a fork
are drawn at the same level, one step in from their parent, and every node in a
chain stays beside the one before it. Indenting by absolute depth would walk the
twentieth row of a linear run off the right edge of the panel while saying nothing
the generation number does not already say. That was a defect a person reported,
and it is now a tested property: twenty linear generations all render at level
zero.

The children of a fork also receive a **branch letter** (`a`, `b`, …), so two
branches are told apart by name and not only by indentation.

## 15. Implemented and planned

Implemented and validated: everything in §2 through §14, each with a code entry
point named in [overview.md](overview.md); §11, §12, §13 and §14 are held by their
own suites or by the page suite. The rule editor of §7 and §7.5 is implemented as
well, held by [rule.test.mjs](../../../src/viewer/tests/rule.test.mjs) for the
vocabulary and by
[rule-page.test.mjs](../../../src/viewer/tests/rule-page.test.mjs) for the
behaviour in a synthetic browser.

Planned, and nothing here exists in the tree:

| Planned surface | What it would add | Owning milestone |
|---|---|---|
| An editing mode | The single-machine editing mode is implemented (§2.11): enter/leave with pause and resume, transactions, undo/redo, resync, the snippet library and the page tools. Collaboration, roles and the server-side shared view point are planned | phase 04, [overview.md](../../plan/phase-04-editing-mode/overview.md), [ADR 0013](../../adr/service-and-api/0013-editing-is-a-versioned-document.md) |
| A "follow the system" control | A control that calls `clearStored(THEME_STORAGE_KEY, …)`, which exists and is tested but has no caller in the page. It needs a third visual state, which the two-state button does not have | open question, [risks.md](risks.md) VWR-09 |
| A friendly HTML error page | `/world/` (a trailing slash) and `/index.html` answer the JSON error envelope with `404`, which is correct and unfriendly | open question, [risks.md](risks.md) |
| A context contract | `link.mjs` carries the handshake but nothing checks the shape of what it carries | open question, [risks.md](risks.md) |
| A third language, and direction | A catalogue entry is a file's worth of work; text direction is a layout change the page has never addressed | open question, [risks.md](risks.md) VWR-16 |
| A restore-on-restart policy | The history store makes the data available and nothing uses it automatically | open question, [risks.md](risks.md) VWR-07 |

The snippet **API**, the editing **API** and the edit document are delivered ahead
of the page tools: §2.10 and §2.11 list the routes,
[edit.mjs](../../../src/viewer/edit.mjs) holds the transaction, hash-chain, merge
and undo-attribution rules, and [edit-runtime.mjs](../../../src/viewer/edit-runtime.mjs)
owns the pause and the core call. The page tools, the snippet palette and
collaboration remain planned.

The single source for `MAX_FRAME_CELLS` that this section used to plan is
**delivered** as §11, and [risks.md](risks.md) VWR-04 is retired with it.
