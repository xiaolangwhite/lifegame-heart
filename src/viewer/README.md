# viewer — the browser front end

An HTTP service and **three routed pages** over one canvas world the Python core
owns: `/world` (and `/`) is the canvas with its controls and readouts, `/history`
is the recorded generations as a tree, and `/archives` manages the exported
sessions. Each page is the same document — one shared layout, one tab
navigation, one language and theme — with one fragment inside and one page module
loaded, so a change to the tree cannot touch the canvas. Click a cell to toggle
it, drag to pan, wheel to zoom, and run, pause, step or clear the world. There is
a dark and a light palette, the grid line width is adjustable, and the core's
storage can be switched between the two representations without losing the world.

The service is a transport. It never computes a generation and never reads the
core's memory; it starts `python -m lifegame.world`, forwards requests over the
core's line protocol and returns the replies unchanged. The protocol is owned by
[src/lifegame/world/bridge.py](../lifegame/world/bridge.py) — its docstring is
the authority for every field below.

Changes reach the page over one **Server-Sent Events** stream rather than a poll
timer: the core announces every automatic step, and the service now forwards that
and every mutation to whoever is watching. Polling still exists, but only as the
fallback for a browser or a network that cannot hold a stream open.

## Running it

```powershell
# from the repository root, after the environment preamble in AGENTS.md §1
node src/viewer/server.mjs                 # http://127.0.0.1:8765, 65536 x 65536 world
node src/viewer/server.mjs --port 9000     # another port
node src/viewer/server.mjs --width 512 --height 512
node src/viewer/server.mjs --representation tiled   # start on the tiled storage
```

It binds `127.0.0.1` by default. Three pages are served from it:
`http://127.0.0.1:8765/world` (the same page as `/`), `/history` and `/archives`;
any other path is a `404`. It serves those pages from memory and writes no file
of its own — **but it does cause one file to be written**: the core it starts
records every generation into `data/history.db` inside the repository, because
recording is on by default. `--no-history` turns that off and `--history <path>`
moves it; `POST /api/archive` writes a second one, always inside `data/`. Nothing
else is written, and the path is never chosen by a browser. The interpreter is
`<repo>/.venv/Scripts/python.exe`; when it is missing the API answers
`503 core_unavailable` and says to run

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
```

## Files

```
src/viewer/
  bridge.mjs            starts the core and drives the line protocol
  server.mjs            HTTP routes, static files, the representation switch, history
  routes.mjs            the one route table: paths, fragments, page modules, <nav>
  events.mjs            the Server-Sent Events hub: one stream per client
  snippets.mjs          the content-addressed snippet store and its published index
  edit.mjs              the editing document: transactions, version and hash chain, undo
  edit-runtime.mjs      the editing service: pause, commit through the core, undo, resync
  public/
    app.js              the shell: language, theme, status, errors, API, event stream
    link.mjs            the page-to-shell handshake (one declaration of the event names)
    shared.mjs          the values the service and the browser must agree on
    locales.mjs         every user-visible string, in English and Chinese
    options.mjs         building a <select> from the list that owns it
    viewport.mjs        the viewport arithmetic, as pure functions
    decode.mjs          the client half of the two frame encodings
    frame-draw.mjs      drawing a frame onto a canvas, for both canvases
    edit-tools.mjs      the editing tools: lines, rectangles, transforms, stamp operations
    focus.mjs           the world point the world route was last looking at
    history.mjs         the recorded tree as pure functions: fork depth, guides, order, cap,
                        and the rule gap between a selected node and the world
    panel.mjs           the panel's three states, as pure functions
    rule.mjs            the rule presets, and one parser for B…/S…
    theme.mjs           theme precedence, colour parsing, grid geometry, storage
    style.css           both palettes, the routed page layouts, one rule per concept
    pages/
      layout.html       the shared document: head, tab navigation, footer
      world.html        the canvas, its panel (readouts) and its controls
      history.html      the tree, the statement about the selected generation's rule, and the
                        preview of the generation it selects
      archives.html     the archive manager
      world.js          the canvas, the gestures, the readouts, the controls
      history.js        the tree, the connectors, the drag, the preview canvas, the adoption
                        button
      archives.js       the archive list and its three operations
  tests/
    bridge.test.mjs     the bridge against a real core
    server.test.mjs     the service over a real socket, streaming and history included
    routes.test.mjs     the route table, the composition and the pages over a socket
    decode.test.mjs     the browser's decoder against real frames
    theme.test.mjs      theme, colour and grid geometry against plain values
    locales.test.mjs    the two tables against each other, key by key
    shared.test.mjs     the shared values and the declared-limits reader
    history.test.mjs    the recorded tree's shape, its guides, its order, its cap and its
                        rule gap
    panel.test.mjs      the panel's three states
    rule.test.mjs       the rule parser and the preset list, branch by branch
    rule-page.test.mjs  the rule editor, executed: what it sends and what it refuses
    css-audit.test.mjs  the stylesheet against the classes the pages really carry
    dom-contract.test.mjs  each page, its scripts and the stylesheet against each other
    dom-stub.mjs        a synthetic browser: DOM, canvas recorder, EventSource
    page.test.mjs       the real shell and page modules, executed against that browser
    viewport.test.mjs   the viewport arithmetic, asserted exactly
    events.test.mjs     the push hub, without a socket
    edit.test.mjs       the editing document: transactions, hash chain, undo, resync window
    edit-runtime.test.mjs  the editing runtime against a scripted core
    edit-tools.test.mjs  the editing tools: lines, rectangles and transforms
    snippets.test.mjs   the content-addressed snippet store, against a real directory
```

`public/shared.mjs` is imported by **both** sides: the service reaches it as
`./public/shared.mjs`, and the browser loads the same bytes over
`/static/shared.mjs`. There is no build step, so there is no second copy.

`routes.mjs` is imported by `server.mjs` and by the tests, never by the browser:
the page's identifiers are English strings, and the composed markup is served,
not generated in the client.

## Tests

```powershell
node --test "src/viewer/tests/*.test.mjs"
```

346 tests, about fifteen seconds. `tests/bridge.test.mjs` drives a
real core process; `tests/server.test.mjs` starts the service on an ephemeral
port and exercises it over a real socket, including a real event stream read the
way a browser reads one and a real recorded run rolled back;
`tests/routes.test.mjs` does the same for the three pages, with a bridge that
throws if it is ever asked anything — composing a page must not reach the core —
and checks that each route's body is its own, that no path falls back to a page,
and that the navigation is generated once with the current tab marked;
`tests/decode.test.mjs`
runs the browser's own decoder over payloads produced by the real core, including
hand-built payloads that pin the bit order and the row stride;
`tests/theme.test.mjs`, `tests/shared.test.mjs`, `tests/history.test.mjs`,
`tests/panel.test.mjs` and `tests/viewport.test.mjs` test
the pure logic against plain values; `tests/locales.test.mjs` compares the two
language tables key by key; `tests/events.test.mjs` tests the push hub against a
scripted bridge, where the timing that matters (a slow frame, twelve changes at
once) can be controlled; and `tests/dom-contract.test.mjs` and
`tests/css-audit.test.mjs` read the pages, the scripts and the stylesheet as text
and check them against each other.

**The pages themselves are executed, not just read.** `tests/page.test.mjs`
installs the synthetic browser from `dom-stub.mjs` — a DOM, a canvas whose 2D
context records everything it is asked to draw, a controllable `EventSource` and
a scripted core — and then imports the real `public/app.js` plus the real page
module of the route under test. It asserts on pixels (a `cells` frame is drawn
cell by cell at the right coordinates; a `bits` frame reaches `putImageData` with
exactly the live cells painted), on gestures (a click toggles the cell under the
pointer and a drag moves the camera without editing the world), on the transport
(a connected stream stops the polling, a viewport change is published rather than
polled for, and a dropped stream falls back), and on each route's own subject:
the tree's rows, markers, connectors and node details, the size a row keeps while
its numbers are open, the tree drag and the arrow keys, the statement about a
generation recorded under another rule and the one press that adopts it, the
preview's centre and its own pan and zoom, the archive list and its three
operations, and the panel's three states.

**The synthetic document is honest, and that is new.** `getElementById` returns
`null` for an id the page's markup does not declare — it used to invent the
element on first request, which is how a history page that had lost its
`#timeline` container drew nothing in a real browser while every test passed.
`tests/dom-contract.test.mjs` now checks the static half of the same rule, per
route, and `tests/page.test.mjs` checks the runtime half: a route's scripts read
no id its own markup does not declare, and a fragment declares no id its script
does not read.

That suite exists because of a defect it would have caught: `paintBits` called a
colour constant that had been deleted when the palette moved into the stylesheet,
so any bitmap frame threw. `node --check` passed, because it parses syntax and
does not resolve bindings, and no test had ever drawn a bitmap.

No mock stands in for the protocol. The only stub in the server suite covers the
service's own `frame` admission rule, where building a 100,000-cell world through
the protocol would test the core instead of the rule. The bridge's tests decode
frames with a decoder written independently of `decode.mjs`, so a mistake in one
cannot hide behind the other.

**Note on the directory form.** `node --test src/viewer/tests/` does not scan the
directory on Node v24.19.0: the runner tries to load the directory as a module
and fails with `Cannot find module .../src/viewer/tests`. Passing the glob, or
the file names, works. The `viewer:test` script in `package.json` uses the glob
for that reason.

## HTTP API

| Route | Meaning |
|---|---|
| `GET /`, `GET /world` | the world page: canvas, panel of readouts, controls (`pages/world.html`) |
| `GET /history` | the history page: the recorded generations as a tree beside a preview of the selected one (`pages/history.html`) |
| `GET /archives` | the archives page: the exported sessions (`pages/archives.html`) |
| anything else | `404 not_found` — there is no default page to fall back to |
| `GET /static/<file>` | a file under `public/`, confined to that directory |
| `GET /api/state` | forwards `state` |
| `GET /api/frame?x0=&y0=&w=&h=` | forwards `frame` |
| `POST /api/command` | body is `{"cmd": ...}` plus that command's fields; forwards everything except `frame` |
| `GET /api/events[?x0=&y0=&w=&h=]` | the event stream for one subscriber (below) |
| `POST /api/subscription` | `{"clientId":N,"x0":..,"y0":..,"w":..,"h":..}` — move a stream's viewport |
| `POST /api/representation` | `{"representation":"sparse"\|"tiled"}` — switch storage, keeping the world |
| `GET /api/history` | forwards `history`: every recorded node with its `id`, its `parent`, its generation, and `head` — the node the world is on |
| `GET /api/cells` | the live set of the generation the world is on, as the core's `export` payload (`{"cells": <base64>, "population": N}`), or the population and the core's `bounds` when it is too large to send (below) |
| `POST /api/select` | `{"node":N}` or `{"generation":G}` — move the world **and the recording head** onto a node; every subscriber is told |
| `POST /api/rollback` | `{"generation":N}` — load a recorded generation **without** moving the head; every subscriber is told |
| `POST /api/archive` | `{"name":"run.jsonl"}` — write the session to a portable file inside `data/` |
| `GET /api/archives` | every archive in `data/`: name, size, modification time and generation count |
| `POST /api/archive/rename` | `{"name":"old.jsonl","to":"new.jsonl"}` — rename one; a name that already exists is refused |
| `POST /api/archive/delete` | `{"name":"run.jsonl"}` — delete one |
| `POST /api/archive/import` | `{"name":"run.jsonl"}` — load one as a session by forwarding `{"cmd":"open"}` to the core |

A reply is the core's reply, with its `ok`, `error`, `message` and `id` fields
intact. A client therefore reads an `out_of_bounds` refusal from the same place
it would read it from the core.

`GET /api/state` is the one place this layer adds to a reply rather than
forwarding it: the core declares its limits and its history flag in `hello`
alone, and a page that fell back to polling never sees a `hello`, so those ride
along with every state reply as `limits`, `history` and `representation`.

**A request names an archive; it does not choose a path.** An HTTP client that
could name an absolute path would be deciding where this process writes, so
`name` must be a plain file name — no separator, no drive letter, no traversal —
and it is resolved inside `data/`. Anything else is refused with `400`. Every
archive route obeys this, including delete, and the check is the same function
for all of them: a name is refused, never repaired.

**Loading an archive is the core's job, and the core does it.** Opening an
archive as a *session* means replaying the store's deltas — the whole timeline,
not only its final world — and that belongs to the Python store, which is the
only implementation of the stored format. This service therefore names the file
and forwards `{"cmd":"open"}`; it never reads an archive itself, because a second
implementation of a format in a second language is exactly what this repository's
rules exist to prevent. If the core does not implement the command, its
`unknown_command` is translated into `archive_import_unsupported` so the page can
say so in the reader's language instead of showing an empty success.

Errors this layer raises itself:

| Status | Body | When |
|---|---|---|
| `400` | `{"ok":false,"error":"bad_request","message":...}` | malformed body or query, `frame` sent as a command, a frame rectangle refused by admission (below), an unknown representation, a non-positive subscription rectangle, an archive name that is not a plain file name, a rollback of a generation that is not an integer |
| `403` | `{"ok":false,"error":"forbidden",...}` | a static path that resolves outside `public/` |
| `404` | `{"ok":false,"error":"not_found",...}` | unknown route or missing file |
| `404` | `{"ok":false,"error":"unknown_client",...}` | a subscription naming a stream that is not open |
| `413` | `{"ok":false,"error":"bad_request",...}` | request body over 1 MiB |
| `503` | `{"ok":false,"error":"core_unavailable","message":...}` | the core is missing, crashed past its restart limit, or is restarting |
| `503` | `{"ok":false,"error":"switch_in_progress",...}` | another route was called during a representation switch |
| `504` | `{"ok":false,"error":"core_timeout",...}` | the core did not answer in time |

`GET /api/history` answers `200` with `{"ok":false,"error":"no_history"}` when the
core was started without one. The code is this layer's, not the core's, so the
page has a label to show; the core's own message is carried as the detail.

The service keeps serving the page while the core is unavailable, so an operator
sees the reason in the page instead of a blank tab.

## The event stream

`GET /api/events` answers `text/event-stream`. One connection carries every kind
of change, and the page no longer asks whether anything happened:

| Event | Data | When |
|---|---|---|
| `hello` | `clientId`, `protocolVersion`, `world`, `rule`, `representation`, `limits`, `history` | once, immediately after the headers |
| `frame` | a frame payload, exactly as `GET /api/frame` returns it | after the client has named a rectangle, after every mutation, and after every tick while running |
| `tick` | `generation`, `population`, `changed` | when the core steps itself, forwarded unchanged |
| `state` | the `state` reply | after a mutation, and after a representation switch |
| `error` | `error`, `message`, and the rectangle when one was refused | the core is unavailable, or the subscription could not be served |
| `ping` | `at` | every 15 s, so a proxy does not drop an idle connection |

The first line is a `: connected` comment, which flushes the headers so a client
knows it is attached before the first real event.

Four details are worth stating because they are choices:

* **A client that has not named a rectangle is shown nothing.** There is no
  default view on the service side: the default view is the watching page's canvas
  over a fixed number of pixels per cell, and a rectangle invented here would be a
  second declaration of it — and, for a design-target world, a whole-world frame
  pushed to a page that is about to say where it is really looking. The page names
  its rectangle in `POST /api/subscription`, which is the next thing it does after
  `hello`.
* **The subscription is updated over HTTP, not over the stream.** Server-Sent
  Events travel one way, so a page that pans or zooms cannot tell the service
  through the stream itself. Reconnecting on every wheel event would be worse
  than a small POST, so the viewport is sent to `/api/subscription` and the next
  frame arrives on the same connection.
* **A slow subscriber coalesces rather than queues.** Each client has one frame
  in flight at a time; a change that arrives while that frame is being built sets
  a flag instead of starting a second request. A core running at 60 ticks per
  second against a transport that issues one request at a time would otherwise
  build 60 frames per second per client.
* **`error` collides with the browser's own event name.** `EventSource` fires
  `error` when the connection drops, and a server-sent `event: error` dispatches
  on the same name. The page tells them apart by `data`: a server event carries
  it, a transport failure does not. The protocol asked for an event called
  `error`, so the name was kept and the ambiguity resolved in the reader.

A subscription rectangle is clipped to the world rather than refused: a client
asking for a view wider than the world is asking for a view, not for cells that
do not exist, and the core would answer the raw request with an error. A
rectangle that *is* inside the world but that the encoder cannot serve cheaply is
refused with an `error` event, using the same rule as the REST route.

## Choosing the representation

`POST /api/representation` restarts the core on the other representation and
carries the world across:

```
export  ->  restart the child with --representation  ->  import
```

The service owns this sequence, because the live set is the core's and the
service cannot read it. The generation travels with the payload — the core's
`import` accepts one — so a switch does not rewind the clock, which is the
difference between "the cells are preserved" and "the world is preserved".

While a switch is running, every other route answers `503 switch_in_progress`
rather than reading the empty world the restart leaves behind for the moment
between the two halves. A switch to the representation already running is a
no-op and does not replace the process.

Which one to choose is measured, not a matter of taste
([docs/model/world/performance.md](../../docs/model/world/performance.md)): the
tiled storage advances 64 cells per word operation and wins by a factor of fifty
once a pattern is clustered, while the sparse storage is the faster of the two
for cells scattered across a wide world — which is what clicking produces. The
default is `sparse` for that reason, and the control starts showing whatever the
core is actually running.

## `frame` encoding

A frame's rectangle **is** its resolution: `w` and `h` say both how much of the
world is covered and how many cells wide the answer is, one cell per element.
Two encodings are chosen by the core, by measured size:

| `format` | `data` | Cost |
|---|---|---|
| `cells` | base64 of little-endian `int32` pairs, `x` then `y`, **absolute** world coordinates | 8 bytes per live cell in the rectangle |
| `bits` | base64 of row-major packed bits, one bit per cell, **high bit first**, row stride `ceil(w / 8)` bytes | `w * h / 8` bytes, whatever the population |

The core prefers `cells` while `8 * live <= ceil(w / 8) * h`, which is the same
as `live * 64 <= w * h`. That path scans the live set and never builds a dense
grid, so it is affordable at any rectangle size — which is what makes viewing the
whole 65536 x 65536 world possible while it holds a few thousand cells.

The `bits` path allocates `w * h` bytes inside the core. A `65536 x 65536`
request that took that path would ask for 2.8 GB, so the service refuses any
rectangle that is both larger than 16 Mi cells and denser than the `cells` rule
allows:

```
area > 16 * 1024 * 1024  and  population * 64 > area   ->  400 bad_request
```

That is the encoder's own rule applied to the last population the core reported,
so a legal wide request is never rejected — and when the world grows between the
state poll and the request, the area cap still bounds the allocation at
`MAX_FRAME_CELLS` bytes. The world page (`public/pages/world.js`) applies the same
rule to bound how far
the view can zoom out; `MAX_FRAME_CELLS` is the one constant that appears in
both files, and it is duplicated only because the browser cannot
import a server module.

### The live set, for a page that has to pick a point

`GET /api/cells` is the core's `export` wrapped for one purpose: a page that has
to choose a *point in the world* — the history preview, which centres the
selected generation on the live cell nearest to where the world route was last
looking — needs the live set itself, and a frame request per candidate rectangle
would scan the world once per frame instead of once per selection. The payload is
the same `cells` encoding `decode.mjs` already reads, so the page has one decoder
and not two.

**A large population degrades rather than queues.** The payload is eight bytes
per live cell before base64, so above `MAX_CELLS_FOR_NEAREST` (16384 cells:
128 KiB of payload, about 171 KiB of base64, in `public/shared.mjs` because the
service applies the cap and the page reports it) the reply carries the population
and the core's `bounds` instead of the cells, and `truncated: true`. The page
then centres on the middle of those bounds and says so in words beside the
canvas: a preview centred on a bounding box is a coarser answer than one centred
on a cell, and the difference is stated rather than hidden.

```json
{"ok":true,"truncated":false,"population":5,"generation":0,"format":"cells","cells":"<base64>"}
{"ok":true,"truncated":true,"reason":"population_above_cap","cap":16384,"population":90210,"bounds":[x0,y0,x1,y1],"cells":null}
```

## Pages and routes

`routes.mjs` is the only route table. The service dispatch, the `<nav>` every page
carries and the script set a page loads are all read from it, so a route cannot
exist in the navigation without existing in the service, and a page cannot be
served without the module that drives it. Two lists would drift.

| Page id | Paths | Fragment | Page module |
|---|---|---|---|
| `world` | `/`, `/world` | `pages/world.html` | `pages/world.js` |
| `history` | `/history` | `pages/history.html` | `pages/history.js` |
| `archives` | `/archives` | `pages/archives.html` | `pages/archives.js` |

The composition is string concatenation, not a template engine: the layout
(`pages/layout.html`) is HTML with `{{slot}}` placeholders, and the composer fills
them and **throws** on a slot nobody supplied rather than serving `{{nav}}` to a
browser. A fragment is a fragment — no `<html>`, `<head>`, `<body>` or `<title>` —
so a composed page has exactly one of each; the tests assert that both ways.

**Every page loads the shell plus one module, and the sets never overlap.** The
shell (`app.js`) owns what more than one route needs: the language, the theme, the
status line, the error banner, the API client, the event stream and the shared
state. A page module owns its route's DOM and behaviour. The containers are
mutually exclusive, so `/world` has a canvas and no archive list, `/archives` has
an archive list and no canvas, and `/history` has neither — the tests assert all
three directions.

**A page module never imports the shell, and that is a rule with a scar.** The
first attempt at this split had `pages/*.js` import `../app.js`. The page suite
loads `app.js?case=N` so each case gets a fresh page, so the page module resolved
a *different* shell instance — one with no data in it — and the tree rendered
zero rows while every test stayed green. The two sides now talk over the document
instead (`public/link.mjs`): the page asks with `lifegame:shell-request`, the
shell answers with `lifegame:shell` carrying `{state, dom, t, describeError,
afterChange, refreshHistory, …}`, and it also publishes once at start-up so that
either load order works. `tests/dom-contract.test.mjs` fails if a page module
imports the shell or restates an event name, and `tests/page.test.mjs` runs the
page-before-shell order as well.

## What the world page does

* **Click** toggles the cell under the cursor and re-fetches the view.
* **Drag** pans. A press that moves at most four pixels is a click, not a drag.
* **Wheel** zooms about the cursor, from 8 cells across to a bound derived from
  the budget above (the whole world when the world is sparse).
* **Run / Pause / Step / Clear**, and a **tps** slider (1–60) that takes effect
  immediately while running.
* **Grid** sets the grid line width to 1, 2, 3 or 4 pixels, and **storage**
  switches the core between `sparse` and `tiled` while
  keeping the world. The grid redraws the frame already on screen and sends
  no request; the storage switch is a request, because the core has to be
  replaced. Both are remembered across reloads.
* Readouts: generation, population, viewport origin, span, rule, world size, and
  the current scale in pixels per cell or cells per pixel.
* **Rule** runs a different life-like rule, from the preset list or typed in by
  hand (below). Changing it needs no pause: the core applies it from the next
  generation.
* **Space** runs and pauses; **`.`** and **→** step once; **h** and **w** move the
  panel between its three states (below).
* The **theme** toggle and the **language** selector sit in the shared footer, so
  both are on every route and both come from the same storage key; the hint line
  beside them is filled by the page whose keys it describes.
* Changes arrive over one event stream. While it is open, the page sends no
  request to find out whether anything happened: the service pushes a frame after
  every tick and every edit. A gesture sends one small subscription update
  instead of a poll.

Two rendering paths mirror the two encodings: a `bits` frame is drawn scaled
from an offscreen bitmap, and a `cells` frame is plotted directly so that a
single cell stays visible as a dot when a thousand of them share a pixel. Grid
lines appear only when a cell is at least six pixels wide; below that they would
be a grey wash.

### The view the page opens with

The default view is **a function of the canvas**: one world cell per
`DEFAULT_PIXELS_PER_CELL` (60) CSS pixels across, so a canvas 1920 pixels wide
opens on 32 cells and a canvas twice as wide opens on twice as many — the cell a
person sees is the same size on both, and no fixed span has to be right for every
window. The origin puts the *world's* centre in the middle of that view
(`x0 = round(width / 2 - span / 2)`, and the same on `y` with the visible height
the canvas' aspect gives), because the world is what the core described and the
page has not been told about any contents yet.

There is deliberately **no second declaration of it**. `public/viewport.mjs` owns
the rule (`DEFAULT_PIXELS_PER_CELL`, `defaultSpan`, `worldCentre`,
`centreViewport`), and the service no longer has a default subscription at all:
a stream that has not been told a rectangle is shown nothing rather than being
pushed a frame for a view nobody is looking at (`events.mjs`).

Neither half is decided before it is known. The span needs a canvas that has been
laid out — a canvas the full-width panel state has hidden measures zero — and the
origin needs the world from the core's `hello`; until both are there the page asks
for no frame, and the request it would otherwise make is a rectangle the user
would then see. A resize re-derives the span while the view is still the page's;
once the user has panned or zoomed it is theirs, and the default is not applied
over it again.

The route also remembers **where it is looking**, in world coordinates, under
`lifegame.viewer.focus` (`public/focus.mjs`). The history route reads it to decide
which part of a generation to show first.

An unknown `format`, or a `data` field too short for its rectangle, is reported
in a banner and leaves the previous frame on screen rather than blanking it.

### The rule

The rule the world runs is the core's, and it is changed with `set_rule`:

```
{"id":N,"cmd":"set_rule","rule":"B3/S23"}   ->   {"ok":true,"rule":"B3/S23","birth":[3],"survival":[2,3]}
                                            ->   {"ok":false,"error":"bad_rule","message":"…"}
```

The editor is in the world page's control row, beside the other settings: a
select of the rules people ask for by name — Conway, HighLife, Maze, Seeds, the
eight-neighbour rule, Day & Night, Replicator and Life without Death, from
`public/rule.mjs` — a text field that takes any `B…/S…`, and a button. Choosing a
preset sends it at once; the field submits on `Enter` and on the button, which are
the same call. Both are reachable with `Tab`, and the page's own key handler
ignores events from a field, so `Space` and the arrow keys are text editing inside
one rather than transport control.

**The client checks the shape first, and the core still has the last word.** A
value is normalised and refused locally before anything is sent — `b3/s23` and
`S32/B3` become `B3/S23`, and a missing section, a digit above 8, a repeated digit
or a stray character is reported beside the field with a sentence naming which of
those it was, in the language on screen. Nothing is sent for one of those, so the
user is spared a round trip that would tell them the same thing. A value that
passes can still come back `bad_rule`, and then the core's own `message` is what
is shown, appended to the translated label for the code. **A refusal never changes
the rule**: the readout, the select and the world keep saying what is actually
running, and the text stays in the field so it can be corrected rather than retyped.

**When the running rule is not one of the presets, the select shows a custom
entry that names it** — `自定义 · B1357/S02468`. The alternative, selecting the
nearest preset, would have the control claim a rule the core is not running, and
the point of the control is to say what is in force; a rule the core reports at
handshake is the first case of this, and a hand-typed rule is the second. Choosing
that entry is not a request — "custom" is not a rule — so it moves the keyboard to
the text field instead.

The change needs no pause because it does not touch the transport: the core
applies the rule from the next generation, so a running world keeps running and a
paused one stays paused until the user steps it. `tests/rule.test.mjs` asserts the
parser branch by branch and `tests/rule-page.test.mjs` runs the editor against the
synthetic browser: what a preset sends, what `b3/s32` sends, that each malformed
shape sends nothing and says why, that a `bad_rule` shows the core's reason and
changes nothing, and that a rule change leaves a running world running.

## The panel, and the space it takes

On the world page, the readouts live in a panel down the right side, in one of
three states:

| State | What it is for | Canvas | Panel |
|---|---|---|---|
| `normal` | the default: a column beside the world | as wide as what is left | `--panel-width` |
| `collapsed` | get it out of the way | takes the space back | hidden |
| `wide` | read the numbers with room to spare | stepped aside | the whole stage |

Collapsing **changes the layout instead of covering the canvas**: a panel drawn
over the world hides the thing the user is working on, and the canvas would keep
paying for space it no longer has. The handle stays visible in every state, and
its label changes with the state, because a panel that can hide itself with no
way back is a panel that loses the user's information.

The choice is remembered across reloads with the same fallback as the theme: a
stored state that names one of the three wins, and anything else means "no
preference I can honour" rather than being repaired into the nearest state.
`tests/panel.test.mjs` checks the three-state arithmetic and the fallback.

**The three states are a stylesheet rule, and they were once a no-op.** When the
interface was first routed, the panel rules were written as
`.stage[data-panel='…']` while the composed markup kept the id `stage` and changed
the class to `page page-split`, so collapse and full-width matched **nothing**:
the logic had tests, the styles did not, and the panel simply sat there. The
markup now carries `class="stage page page-world"` on the element with
`data-panel`, and `tests/css-audit.test.mjs` fails if a `data-panel` rule hangs off
a class the stage element does not carry — and, more generally, if any class the
stylesheet names is not put on an element in a class-bearing position
(`class=`, `className=`, `classList.add`). The previous class check asked only
whether the token appeared *anywhere* in the files, which `page`, `archives` and
four dead `.stage` rules all satisfied.

`h` collapses and expands, `w` toggles full width. Both are letters because
`Space`, `.` and the arrows are already taken.

A size change is observed on the canvas itself with a `ResizeObserver`, so
collapsing the panel — or switching language, which changes the labels' width —
redraws immediately. Waiting for the next pushed frame would leave a stretched
canvas on screen until something unrelated happened.

## Touch

One contact behaves as it always has: a press that does not travel toggles the
cell under it, and a press that travels pans. Two contacts pinch:

* the span scales by how far the fingers spread, and
* the world point under the point *between* them stays under it, which is what
  makes a two-finger drag pan with the same arithmetic.

Pointer Events, not the deprecated touch events, so a pen and a mouse go down the
same path; `pointercancel` ends a gesture without editing anything, and a contact
arriving or leaving re-baselines the gesture rather than making the view jump.

Two details are worth knowing because they were both wrong first:

* **The pinch is measured from where the fingers started, not from the previous
  event.** Fingers report separately, so a two-finger drag arrives as one finger
  moving and then the other; composing those intermediate samples zooms in and
  back out on every pair of events, which is a visible pump.
* **A drag that continues a pinch is never a click.** Ending a pinch with one
  finger still down used to toggle whatever cell that finger was over, because
  the leftover drag had not travelled far enough to look like a pan.

## Archives

The archives page lists what is in `data/`: name, generation count, size and
modification time, newest first. Each row can load, rename and delete; deleting
takes two
presses, because it is the one action here that pressing something else cannot
undo. Renaming happens in place, in an input, rather than through a native
dialog: a browser prompt cannot be translated and cannot be driven from a test.
The export control is disabled while the core records nothing, which the page
reads from the shared state rather than asking the service a second time.

A file whose generation count could not be read says so rather than claiming
zero, and a file in the directory whose name this service would refuse is not
listed at all — a row the user cannot act on is worse than no row.

## Themes and grid width

Both palettes live in `public/style.css`, selected by a `data-theme` attribute on
`<html>`. There is **no `prefers-color-scheme` media query**: the attribute is
always a concrete `dark` or `light`, set before the first paint by a small inline
script in the shared layout (`pages/layout.html`) and kept in step afterwards by
the shell. The rule "no
explicit choice means follow the system" therefore exists once, in `theme.mjs`:

```
a stored 'dark' or 'light'   ->  that theme, whatever the system prefers
anything else, or nothing    ->  the system preference
```

A stored value from an older build counts as no choice rather than as an error,
and a browser whose `localStorage` throws — private mode, no origin, a full quota
— starts normally and simply forgets the choice instead of breaking the button.

The canvas cannot inherit CSS, so it reads `--alive`, `--dead` and `--grid` back
out of the active theme with `getComputedStyle` and caches them. A colour the
parser cannot read leaves the previous one in place rather than painting black,
so a palette written in a notation the parser does not know degrades to the
previous theme instead of to an unreadable canvas.

The grid line width is chosen in CSS pixels but drawn in whole **device** pixels,
so at a device pixel ratio of 1.25 the setting `2 px` is stroked at 2.4 CSS
pixels — the nearest width that can actually be drawn. Without that rounding a
stroke covers part of a device pixel on each side and the rasteriser blurs it
into two grey rows instead of one line. Grid lines are drawn only while a cell is
at least six pixels wide.

Contrast, computed with the WCAG formula (live cell on dead cell): 11.83:1 in the
dark palette and 6.01:1 in the light one, both far above the 3:1 a non-text
graphic needs. The grid line is deliberately low-contrast at 1.45:1 in both, so
that it separates cells without competing with them.

## Where every shared value lives

A value that two files both declare is a value that will disagree with itself.
Each of these has exactly one declaration, and the consumer list is the reason
the declaration is where it is:

| Value | One declaration | Consumers |
|---|---|---|
| The routes, their paths, fragments and page modules | `routes.mjs` (`ROUTES`) | `server.mjs` (the dispatch), the `<nav>` of every page, and the script assembly |
| The frame budget and its rule | `public/shared.mjs` (`MAX_FRAME_CELLS`, `frameAdmission`) | `server.mjs` (the REST routes), `events.mjs` (the push hub), `public/viewport.mjs` (the zoom range) |
| The live-set cap | `public/shared.mjs` (`MAX_CELLS_FOR_NEAREST`) | `server.mjs` (the `/api/cells` reply), `pages/history.js` (the note that reports the degradation) |
| The default view | `public/viewport.mjs` (`DEFAULT_PIXELS_PER_CELL`, `defaultSpan`, `worldCentre`, `centreViewport`) | `pages/world.js` and `pages/history.js` — the world canvas and the preview canvas, so a cell is the same size in both. There is no service-side default: a subscription that has not named a rectangle is shown nothing |
| The remembered focus point | `public/focus.mjs` (`FOCUS_STORAGE_KEY`) | `pages/world.js` writes it, `pages/history.js` reads it to centre a preview |
| The frame drawing | `public/frame-draw.mjs` (`drawFrame`, `readPalette`, `DEFAULT_PALETTE`) | `pages/world.js` and `pages/history.js`, so two canvases cannot paint one world two ways |
| The world size and its design target | the core (`bridge.py`, `DEFAULT_WORLD_SIZE`) | the bridge omits `--width`/`--height` unless the operator names them; the page reads `hello.world` |
| The rate bounds | the core (`bridge.py`, `MIN/MAX_TICKS_PER_SECOND`) | published in `hello.limits`, applied by `pages/world.js` to the slider's `min`/`max`/`value`, and enforced by `events.mjs` |
| The representation vocabulary | the core (`bridge.py`, `REPRESENTATIONS`) | published in `hello.limits.representations`; the world page builds its options from it and `server.mjs` validates against it |
| The coordinate bound | the core (`hello.limits.maxCoordinate`) | `pages/world.js`, when it decides whether a coordinate is worth sending |
| The grid widths | `public/theme.mjs` (`GRID_WIDTHS`) | `pages/world.js` builds the `<select>` options from it |
| The languages | `public/locales.mjs` (`LOCALES`) | the shell builds the `<select>` options from it, on every route |
| The grid line threshold | `public/viewport.mjs` (`GRID_MIN_CELL_PX`) | `pages/world.js` |
| The indentation cap | `public/history.mjs` (`MAX_INDENT_LEVELS`) | `pages/history.js` caps `--depth` with it, `style.css` multiplies one level by it |
| The connector gutter | `public/history.mjs` (the `guides` each flattened node carries) | `pages/history.js` renders one cell per level, `style.css` draws the line, the elbow and the end at the same level width |
| The panel's three states | `public/panel.mjs` (`PANEL_MODES`) | `pages/world.js` applies them to `data-panel`, `style.css` selects on that attribute |
| The rule preset list | `public/rule.mjs` (`RULE_PRESETS`) | `pages/world.js` builds the `<select>` options from it; the names are locale keys. The rule itself, and what it accepts, are the core's |
| The handshake event names | `public/link.mjs` | the shell answers on them, every page module asks on them |
| The theme key and its precedence | `public/theme.mjs` | the layout's pre-paint script repeats the key and the rule — the one deliberate copy, forced by a classic inline script not being able to import a module, and pinned by `dom-contract.test.mjs` |

No fragment declares an `<option>` and none carries user-visible text: the options
come from the modules above and every string comes from the locale table. The
product name is the single exception, because it is the same word in every
language.

## Language

The viewer is available in English and Chinese. Every string it can show — labels,
buttons, the page title, `title` and `aria-label` attributes, status lines, the
hint, the tree's column names, error labels, units, and the tab navigation — comes
from
`public/locales.mjs`, which holds one table per language with identical keys.
`tests/locales.test.mjs` compares the key sets and fails on a key that exists in
one language only, or on an empty value.

No page fragment contains **user-visible text**: each node carries a
`data-i18n="key"` attribute, the shell fills every one of them, and each page
module fills the rest — the option labels, the `title` attributes and the hint
line. For a visitor,
this is one choice across three routes: the same storage key, the same resolution
rule, and a language chosen on the archives page is the language the history page
opens in. Switching language rewrites those nodes in place, sets `<html lang>`, and
needs no reload and no second copy of any string. The choice is remembered; with
nothing stored the page follows `navigator.language`, so `zh-CN` opens in Chinese.

There is no pre-paint script for the language, and that is deliberate: the theme
needs one because a colour applied a frame late is visible, while no text is
rendered until the shell fills it, so there is nothing to flash. Having no second
copy of the locale key is worth more than the microsecond.

**Error labels are translated; the core's messages are not.** A refusal arrives
as a stable `error` code plus a `message` the Python core wrote. The page shows
the translated label for the code, then the message as detail:

```
that is outside the world: (70000, 1) is outside a 64 x 64 world
```

The message is a diagnostic that names the field or the bound that was wrong.
Translating it would create a second description of the same fact, drifting from
the first, and it would have to be translated in the core — which would put user
interface text in a library that has no page. The boundary is also why
`GET /api/history` translates the core's "no history" refusal into this layer's
own `no_history` code: a code is what can be labelled.

## History and the tree

The core can record every generation; the history page draws it as a tree beside a
preview of the generation that tree selects.

```powershell
node src/viewer/server.mjs                       # records into data/history.db
node src/viewer/server.mjs --history run.db      # somewhere else inside the repo
node src/viewer/server.mjs --no-history          # do not record
```

The route is two panes, because a node is a *place in the world* and the only way
to know which place is to look at it: the tree on the left, the selected
generation on the right. The page itself does not scroll — each pane does — so the
canvas stays on screen while a long run is read.

**A row is a node, and a node is one line tall whatever it is showing.** What is
always visible is the generation, the branch mark and the connector; the node's
own details — whether it is a keyframe or a difference, its population, how many
cells it changed, and when it was recorded — are in the document but collapsed,
inside an overlay that is **out of the row's flow**:

```css
.timeline-overlay { position: absolute; inset-inline: … ; overflow: hidden }
.timeline-detail { max-inline-size: 0; opacity: 0; transition: … }
.timeline-row[data-open='true'] .timeline-detail { max-inline-size: 26ch; opacity: 1 }
```

That is the whole of the fix for the defect this pane was rebuilt for. The
details used to be laid out *in the row*, so opening them changed the row's
height and pushed the rows below it down; a row with several marks overflowed its
grid and was drawn in two lines; and the row was `inline-size: 100%` of a
page-wide column, so one generation filled the width with nothing in it. The
overlay makes the height a function of the line box alone, the marks live in one
in-flow container that cannot wrap, and the pane is a column of its own.
`tests/page.test.mjs` measures the rendered rows before and after the reveal
(reading which containers are absolutely positioned out of `style.css`), and
`tests/css-audit.test.mjs` asserts the stylesheet half.

The reveal is one state, `data-open`, which the page sets for the pointer **and**
for the keyboard (`focus`/`blur` as well as `pointerenter`/`pointerleave`). It
used to be `:hover`/`:focus-visible`, which meant two rules the stylesheet had to
keep in step and neither of which could be exercised without a browser. A row is a
`<button>`, so `Tab` reaches it and `Enter` selects it; `↑`/`↓`/`Home`/`End` move
along the tree, because forty rows is forty tab stops otherwise.

Three further rules in this pane exist because a person used it in a browser and
found them missing. They were measured there — headless Edge over the DevTools
Protocol, reading scroll widths, hit tests and pixels — rather than reasoned
about, and each is written down with the numbers that identified it in
[dev-log/v0.3.3fix1.md](../../dev-log/v0.3.3fix1.md):

* **the collapsed overlay is zero width.** Collapsed, its three details were zero
  wide but two flex gaps and a trailing padding were not, so an opaque box twenty
  pixels wide sat over the first two characters of the working-point label. A
  collapsed thing that still occupies space is not collapsed.
* **the overlay sets both inline insets and clips its content**, so it cannot
  contribute to the scrollable overflow of the container it is scrolled in.
  Setting only the start inset let its box grow past the tree, which made a
  horizontal scrollbar appear under the newest generation, which moved that row
  out from under the pointer, which closed the overlay — a loop through the
  layout engine that no reading of two files as text can see.
* **the pointer capture is taken on the control that was pressed, not on the
  list.** A click is dispatched to the nearest common ancestor of the press and
  the release, so capturing on the list sent both to the list and the control's
  own listener never ran. The first form of it was the row: the tree could not be
  selected by clicking, and only the step buttons worked, because a keyboard
  `Enter` produces its click synthetically and never goes near the pointer path.
  The second form was the window control at the top of the list: "show the
  earlier generations" is not a row, so the fallback put the capture back on the
  tree, and the measurement over CDP was `pointerdown` on the button with
  `pointerup` and `click` both on `#timeline` and the list unchanged — while the
  same page's own `.click()` on that button widened the window twice. The capture
  is therefore taken on the row when the press landed inside one and on the
  pressed element itself otherwise, which is the only form that never moves a
  click *up* past the control it belongs to. A press that travelled is a pan
  whichever control it started on, so both refuse one.

**Indentation is fork depth, not tree depth, and every level carries a
connector.** A linear run of twenty generations is drawn in one column, however
long it is; a level is added only where the tree actually parts — a node with more
than one child — so the two children of a fork sit at the same level, one step in
from their parent, and a chain below a fork adds nothing. Each level also carries
a guide kind: `line` for a branch that has a later sibling, `elbow` where a branch
starts and something follows it, `end` where a branch starts and nothing does, and
`blank` for a chain below the last branch. `public/history.mjs` computes both,
caps the drawn depth at `MAX_INDENT_LEVELS` (six levels, 84 px, inside a tree
column `min(12rem, 22rem)` wide) and rebases the shallowest row a window still
shows on zero. `tests/history.test.mjs` asserts the linear case, the fork case, the
cap and the guides; `tests/page.test.mjs` asserts the same on the rendered rows.

**The tree is draggable.** Dragging the list pans it — the surface a person
reaching for a long run uses before they think about scrolling — through Pointer
Events, with `touch-action: none` on the list so a touch drag cannot be stolen by
the page's own scrolling. A drag that travelled more than four pixels is not a
click, so panning never moves the working point.

A node with more than one child is a **fork**, marked as one, and its children are
labelled `a`, `b`, … so two branches are told apart by name and not only by
position. The **working point** is highlighted: it is the node the world is on and
the node the next record appends to. If the core is not recording at all, the tree
section stays hidden and the note beside it says so — on a page whose subject is
the tree, the page has to ask in order to learn that, which is the one behaviour
that could not be carried over unchanged from the single-page version.

**Clicking a row previews it, and previewing is how a branch is made.** A click
sends `select`, which moves the world *and* the working point onto that node. From
there, anything the user edits or steps is recorded as a sibling of the nodes that
already descend from it — the core appends to the working point, and only rewrites
it in place when nothing descends from it — so the older work stays and a second
branch appears beside it. The step buttons follow the tree rather than a list:
backwards is the parent of the working point, forwards is its most recently
recorded child.

**A node carries the rule that produced it, and the page says so when the two
disagree.** A session's rule can change part-way through, every recorded node
stores the rule in force when it was written, and **selecting a node restores its
cells and not its rule** — so a generation from before a change leaves the world
running the new rule over a world the old one produced, which is exactly the
situation a person is about to continue from. When the selected generation's own
`rule` (from the history reply) differs from the rule in force (`state.rule`, from
the state reply) the page states both, as the two strings themselves
(`timeline.ruleGap`), and offers one button (`action.adoptRule`) that sends
`set_rule` for the generation's own rule through the same `/api/command` path the
world page's editor uses. The core keeps the last word: a refusal is shown with the
core's own reason (`error.bad_rule` plus its message) and changes nothing — the
rule in force stays and the statement stays with it, because the two still differ —
while an accepted rule is taken from the reply, which is what makes the statement
disappear as soon as the two agree. **The selected generation is the working
point**, the id the history reply names in `head` and the row the tree highlights,
and it is `ruleGap` in `public/history.mjs` that compares the two strings: a node
the store wrote without a rule, a rule that has not arrived and two equal rules
all say nothing, and nothing is derived from a generation number. **That button is
the only thing on this route that sends `set_rule`**: loading the page, the
automatic preview, the two step buttons and dragging the tree only re-decide what
the statement says, and `tests/page.test.mjs` asserts each of them sends nothing,
one by one. The comparison is asserted as data in `tests/history.test.mjs` and its
two sentences in both languages in `tests/locales.test.mjs`.

**Where the preview looks is a decision, and the page states it.** A generation is
a whole world, and dropping the user into an arbitrary corner of it is the
difference between "here is that state" and "here is a state, somewhere". So the
preview centres on **the live cell nearest to where the world route was last
looking** — `lifegame.viewer.focus`, written by the world page in world
coordinates, read here — which is read **once per selection** through
`GET /api/cells` and scanned in the browser; nothing is scanned per frame. The
preview's own span is the same rule as the world canvas: its width over
`DEFAULT_PIXELS_PER_CELL`, so a cell is the same size in both, and it can be
panned and zoomed without touching the selection. Two fallbacks are possible and
both are said in words beside the canvas:

* the live set is above `MAX_CELLS_FOR_NEAREST`, so the reply carried the
  population and the bounds instead — the preview centres on the middle of those
  bounds (`preview.note.bounds`);
* nothing is alive in that generation — there is no nearest cell, so it centres on
  the middle of the world (`preview.note.world`).

`rollback` is the other half of the pair and the page does not use it: it loads a
generation **without** moving the working point, which is what a caller wants when
it means to look rather than to continue. The route is kept because the
distinction is the point — a single operation that both read and moved would have
made looking at history destructive.

Two details are worth stating:

* **The core owns the tree.** The service forwards `history`, `select`, `rollback`
  and `archive` and adds nothing to their meaning; the store, the node identity,
  the keyframe interval and the parent links are the Python core's, documented in
  `docs/model/world/` and `docs/model/store/`.
* **A long tree is windowed.** A run records a generation per tick, so the page
  renders the newest forty rows with a control that widens the window by another
  forty. A thousand rows in the document would be a thousand layout boxes for a
  list the user scrolls past. The window cuts from the beginning, which can orphan
  a row from its parent, so the shallowest row still shown is rebased on zero
  rather than the tree drifting further right with every page.

The window is per visit, not stored: arriving at `/history` shows the newest forty
rows again.

## Limits worth knowing

* **Polling is a fallback, not a legacy path.** If `EventSource` is missing, or
  the stream drops, the page goes back to asking for frames on a timer and keeps
  working. The fallback is tested by deleting `EventSource` from the synthetic
  browser and by failing a live stream.
* **One file is written, by the core, because it was asked for.** Recording is on
  by default, so `data/history.db` holds the run; `--no-history` stops it and
  `--history <path>` moves it. The path is the operator's — a browser cannot
  choose it. Without a history the world still lives only in the core's memory,
  and stopping the service loses it. A representation switch is the other case
  where the world crosses a process boundary, and that one is still carried
  through the core's `export`/`import` rather than through a file.
* **One world per service.** The bridge drives one child process; there is no
  session concept. Several *subscribers* share that one world, each with its own
  rectangle.
* **Zoom-out is bounded when the world is dense.** The bound comes from the
  protocol, not from the page: a wide view is only cheap while the `cells`
  encoding applies. If a run makes the world denser than the current view can
  afford, the page pulls the view in and says so in the span readout instead of
  asking for a frame that would be refused.
* **The default view is close to the zoom-in floor.** The view opens at 60 pixels
  per cell and the narrowest view is 8 cells across (`MIN_SPAN`), so a small
  window — 800 pixels wide opens on 13 cells — has about 1.7× of zoom-in left
  before it stops. That is a consequence of the default being a function of the
  canvas rather than of the old whole-world default, and a wider window has more
  room. Whether `MIN_SPAN` should scale with the canvas is a design question this
  version does not answer.
* **The canvas is executed, but not in a browser.** `tests/page.test.mjs` runs the
  real shell and the real page modules against a synthetic DOM and a recording
  canvas, which covers the two render paths, the gestures, the stream client, the
  fallback, the tree, the connectors, the tree drag, the preview and the archive
  list. What that cannot cover is anything the rasteriser or the layout engine
  does: whether a line is crisp at a fractional device pixel ratio, whether a
  connector really meets the row above it, how tall a row is in pixels, and what a
  page looks like. The row-height case is the closest this suite gets: it counts
  the row's in-flow children against the grid tracks the stylesheet declares, and
  reads which containers are `position: absolute` out of the same file — a model
  of the layout, not the layout engine.
* **The text audits prove tokens, not matches.** `tests/css-audit.test.mjs` reads
  the stylesheet, the composed markup and the scripts as text. It proves that every
  class a rule names is put on an element in a class-bearing position, and that a
  `data-panel` rule hangs off a class the stage element really carries — which is
  the defect that made the panel's three states a no-op. It cannot prove that a
  selector matches at run time, that a transition animates, or that a rule is not
  overridden by a later one. Those need a browser, and they are the remaining gap
  in this module's coverage rather than a closed item.
* **A route is its own document, so nothing crosses routes at run time.** Loading an
  archive on `/archives` cannot refresh a tree on `/history`, because the two pages
  are separate documents; the tree is read again when that page is opened. The
  in-page couplings that remain (an import updating the shared state, a `select`
  refreshing the tree) are asserted in the page suite.
* **The palette cache is now executed through both ends.** It was the seam where
  the `paintBits` defect hid — what filled it and what read it were each checked
  by contract and never together. The page suite draws a `bits` frame, so the
  filled cache is read and the pixels are asserted.
* **There is no control for "follow the system".** Once a theme has been chosen,
  the only way back is to clear the stored key by hand from the browser's
  developer tools. `clearStored` exists in `theme.mjs` and is tested; no button
  calls it, because a two-state button has no third state to show.
* **A representation switch is not free.** It replaces the core process and
  round-trips the whole live set through the service. On a world with millions of
  live cells that is a visible pause, and the switch is refused rather than
  queued if another one is already running.
