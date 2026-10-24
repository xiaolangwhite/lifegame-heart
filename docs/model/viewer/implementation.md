# viewer — implementation

> This file owns how the module is built: its layout, the algorithms that matter
> and their complexity bounds, the environment it requires, how it is configured
> and relocated, why the structural choices were made, and the alternatives that
> were rejected. What the module promises is owned by
> [responsibilities.md](responsibilities.md); measured costs by
> [performance.md](performance.md).

## 1. Layout

```
src/viewer/
  bridge.mjs                 the core child process, the request queue, the restart policy
  server.mjs                 HTTP routes, static confinement, the CLI, the switch sequence
  routes.mjs                 the only route table, and the composer that builds a page
  events.mjs                 the push transport: one subscription per client, coalescing
  README.md                  the operator-facing note; belongs to no component
  public/
    pages/
      layout.html            the shared document: head, pre-paint theme script, header, tab bar
      world.html             the world route's fragment: the canvas, the panel, the controls
      history.html           the history route's fragment: the tree and its two buttons
      archives.html          the archive route's fragment: the archive manager
      world.js               the world page: gestures, rendering, controls, the stream client
      history.js             the history page: the tree, a selection, the step buttons
      archives.js            the archive page: export, list, rename, delete, import
    link.mjs                 the shell-to-page handshake: two event names, and connectShell
    history.mjs              the recorded tree: flatten, fork depth, the cap, branch letters, guides, preview centring
    options.mjs              building a <select> from the list that owns it
    shared.mjs               the values both runtimes import: budget, live-set cap, rule, limits
    app.js                   the shell: shared DOM, theme, language, status, errors, panel
    viewport.mjs             where the page is looking, as pure functions, and the default view
    panel.mjs                the right-hand panel's three states, as pure functions
    focus.mjs                the world point a person was last looking at, remembered in storage
    frame-draw.mjs           drawing a frame onto any canvas, with the palette read back from the theme
    decode.mjs               both frame encodings, free of DOM and canvas
    locales.mjs              every user-visible string, in one table per language
    theme.mjs                theme resolution, colour parsing, storage, grid geometry
    style.css                both palettes, the shared control rules, the presentation
  tests/
    bridge.test.mjs          the bridge against a real core process
    server.test.mjs          the service over a real socket, the event stream included
    routes.test.mjs          every route composed in process, with no socket
    events.test.mjs          the push hub against a scripted bridge, without a socket
    page.test.mjs            the real shell and page modules, against a synthetic browser
    history.test.mjs         the tree's flattening, fork depth, cap and branch letters
    shared.test.mjs          the one declaration of the values both sides use
    locales.test.mjs         both key sets, and the language precedence rule
    decode.test.mjs          the decoders against real and hand-built payloads
    theme.test.mjs           theme precedence, storage, colour parsing, line geometry
    panel.test.mjs           the three panel states and their transitions
    viewport.test.mjs        the viewport arithmetic, asserted as equalities
    dom-contract.test.mjs    the markup, the scripts, the catalogue and the stylesheet
    css-audit.test.mjs       the stylesheet audited against the markup it styles
    dom-stub.mjs             the synthetic browser the page suite installs
```

Twenty-eight files at this revision. Each source file belongs to exactly
one component ([internal-components.md](internal-components.md) §1); `README.md`
belongs to none, because it has no behaviour, and `dom-stub.mjs` belongs to
`test-harness` because nothing that ships imports it.

Three of the files above are the ones a claim about *pixels* has to go through.
[public/frame-draw.mjs](../../../src/viewer/public/frame-draw.mjs) is the whole
drawing contract for both canvases — the two encodings' paint paths, the
one-cell grid, and `readPalette`/`DEFAULT_PALETTE`, which is what a palette read
back out of the stylesheet means in code — and
[public/focus.mjs](../../../src/viewer/public/focus.mjs) is the smallest logic
leaf in the module: a pair of world coordinates in browser storage under
`FOCUS_STORAGE_KEY`, read and written through `theme.mjs`'s never-throwing
storage wrappers. Both exist because the world route and the history route draw
the same world and have to mean the same place while disagreeing about their
canvas size.

Six separations in this layout are deliberate:

* **The decoders are a separate file from the page.** They are the only part of
  the browser's behaviour that can be tested without a browser, so they are kept
  free of DOM and canvas and imported by both the page and `node --test`.
* **The theme module is separate for the same reason, and deliberately knows
  nothing about the DOM or about storage.** It takes what was stored as an
  argument and returns what should happen; the page reads the storage and touches
  the document. That split is what makes the precedence rule, the colour parser
  and the line geometry testable without a browser
  ([theme.mjs](../../../src/viewer/public/theme.mjs)).
* **The viewport arithmetic is separate from the page that uses it.** It was in
  `app.js`, where the only way to check it was to run a browser and a defect in
  it would therefore be caught by nothing. As pure functions it is asserted as
  equalities, including the property a person actually notices — that a wheel
  gesture does not slide the world out from under the pointer
  ([viewport.mjs](../../../src/viewer/public/viewport.mjs)).
* **The admission rule and every shared value live in one module both runtimes
  import.** Three callers apply the rule: the `/api/frame` route, which has a
  request to hang the decision on; the hub, which pushes frames without one; and
  the page, which bounds its own zoom with it. Leaving a copy in each would be
  three rules that agree until one of them is edited — which is what the previous
  version recorded as a risk and this one removed
  ([public/shared.mjs](../../../src/viewer/public/shared.mjs), §3.11).
* **The bridge is a separate file from the service, and from the hub.** The
  service deals in HTTP and knows nothing about pipes; the hub deals in
  subscriptions and knows nothing about sockets; the bridge deals in pipes and
  knows nothing about either. What they share is the error classes and the
  request queue.
* **The page's assets are served from disk, unmodified.** There is no build
  step, no bundler and no transpiler, so what is in `public/` is what the
  browser runs. This is also why the page suite imports `app.js` by path and why
  the synthetic browser has to model the browser rather than the page.

## 2. Prior art

The module is assembled from small, well-known pieces rather than from a
framework, and each piece is used the way its own documentation describes:

| Piece | Prior art it follows |
|---|---|
| Serving static files with `node:http` | The platform's own pattern: resolve the path, check it is under the root, `stat`, `readFile`, `writeHead` with a content type and a length |
| Line-delimited JSON over a pipe | The framing the core already defines: one JSON object per line, replies matched by `id`. The bridge adds a buffer split on newline and nothing more |
| Correlating replies by `id` | A pending map keyed by the request id, with a per-request timer. The map exists because answers arrive asynchronously, not because several requests may be outstanding |
| Restart with exponential backoff and a limit | The standard supervisor shape: a counter, a capped doubling delay, and a hard stop so a permanently broken child cannot become a process storm |
| Confining a path to a directory | Decode first, then resolve, then require the result to start with the root plus a separator. Decoding before resolving is what catches percent-encoded traversal |
| Base64 of packed bits, high bit first | The encoding the core defines; the browser side is a straightforward walk with a zero-byte fast path |
| Canvas rendering, two paths | Plotting coordinates for a sparse rectangle; filling an `ImageData` and drawing it scaled for a bitmap |
| Resolving a theme against a system preference | The standard "explicit choice beats the environment" shape: read the stored value, treat only a known value as a choice, otherwise ask `matchMedia`. The rule is written as one pure function so it can be tested without a browser |
| Reading a colour back out of the stylesheet | `getComputedStyle(...).getPropertyValue('--custom-property')` and a parser for the notations a palette actually writes. The canvas cannot inherit CSS, so this read-back is the only way to keep one palette |
| Snapping a stroke to the device-pixel grid | The standard canvas technique for a crisp line: express the width in whole device pixels and offset the centre by half a device pixel when the width is odd |
| Storage that never throws | `try`/`catch` around every storage access, returning `null` or `false`. `localStorage` throws in private mode, under a disabled cookie jar, on a `file://` origin and on a full quota |
| Server-Sent Events | The platform's own streaming response, used as documented: `text/event-stream`, one `event:` and one `data:` line per message, a leading comment to flush the headers, and a client that reconnects on its own. No framing of this module's own is invented |
| Coalescing a slow consumer | The standard shape for a producer that outruns a consumer: one item in flight, a flag instead of a queue, and the newest item built when the current one lands. The alternative accumulates lag without bound |
| Carrying a state across a restart | The core's own `export`/`import` pair with the generation in the payload — the ordinary serialise, replace, deserialise sequence for a planned restart, rather than a hand-rolled format |
| A synthetic DOM with a recording canvas | The standard headless technique short of a real browser: implement exactly the API surface the code touches, record the calls, and assert on the record. It catches a path that throws and a call made with the wrong arguments; it does not rasterise |
| A heartbeat on a long-lived connection | A periodic event so an intermediary does not treat an idle connection as dead, with the timer unreferenced so that a keep-alive cannot become the reason a process stays alive |

No algorithm here is novel, and none is asymptotically interesting: the module's
work is proportional to what it moves, not to what it computes.

## 3. Algorithms and complexity

`n` is a payload's byte length, `live` the live cells in a rectangle, and
`area = w * h`.

### 3.1 Request serialisation

`request()` chains onto a promise that resolves when the previous request
settles, so exactly one request is in flight. The chain is re-armed after a
rejection, so one failed request cannot stall the queue. Cost per request is
`O(1)` plus the queue wait.

The choice matters more than the cost: with one request in flight, replies
cannot be reordered and a slow `frame` cannot be overtaken by the next poll. The
pending map is an id-to-resolver lookup, not a concurrency window.

### 3.2 Static path confinement

`resolveStaticPath` percent-decodes, rejects a null byte, strips leading
separators, resolves against the public directory, and requires the result to
begin with that directory plus a separator. Cost is `O(n)` in the path length
(the decode), and `O(1)` after it.

Two details are the difference between a check and a decoration: decoding
**before** resolving means `%2e%2e%2f` is caught by the same prefix test as a
literal `../`; and comparing against `root + separator` rather than `root`
prevents a sibling directory whose name merely starts with the root's name from
passing.

### 3.3 Frame admission

Cost is `O(1)`: one comparison, and one more if the first fails.

```
knownPopulation * 64 <= area          -> admitted; the cells encoding is guaranteed
area <= MAX_FRAME_CELLS               -> admitted; the allocation is bounded
otherwise                             -> 400, forwarded nowhere
```

`knownPopulation` is updated from any reply that carries a `population` field,
and is an upper bound for the live cells inside any rectangle, which is why one
number suffices for every rectangle.

**The rule was corrected inside this version.** Its first form was

```
population * 256 <= area
```

which is four times more conservative than the encoder it claimed to restate.
The encoder's rule is eight bytes per live cell against one bit per cell, that
is `8 * live <= ceil(w / 8) * h`, which is `live * 64 <= area` up to the
ceiling. The first form compared quantities in different units — the core's own
encoder carries a comment recording an earlier defect of exactly that class,
where a bit count was compared against a byte count — and its comment and the
README both asserted it *was* the encoder's rule. It was therefore an inaccurate
attribution rather than a deliberate safety margin, and it was replaced by the
encoder's rule in [server.mjs](../../../src/viewer/server.mjs),
[public/app.js](../../../src/viewer/public/app.js), the boundary values in
[server.test.mjs](../../../src/viewer/tests/server.test.mjs) and the module
README. **In the previous version the rule moved to a file of its own**, because
the push transport became a second caller; **in this version it moved again**, to
[public/shared.mjs](../../../src/viewer/public/shared.mjs), because the page
became a third and the browser cannot import a server module. That file is
written as a plain ES module inside `public/`, so the service reaches it by
relative path and the browser loads the same bytes over `/static/shared.mjs`.
One rule, one place, three callers that cannot drift — and the constant beside
it, which was the last duplicated value in the module, is declared once for the
same reason. The zoom bound in
[public/viewport.mjs](../../../src/viewer/public/viewport.mjs) is the same rule
applied to a span, and `viewport.mjs` now imports the budget rather than holding
a copy of it.

The correction is observable, and was observed. A rectangle of `4097 x 4097`
has area 16,785,409, just above `MAX_FRAME_CELLS`; with 100,000 live cells the
superseded rule requires `25,600,000 <= 16,785,409`, which is false, so it would
answer `400`, while the corrected rule requires `6,400,000 <= 16,785,409` and
answers `200`. Driven against a real server, the request returned `200`, a
`cells` payload of 800,000 bytes, in 40 ms
([testing.md](testing.md) §5).

The bound the cap provides is unchanged and is still needed: the guarantee is
made against the **last reported** population, so a world that grows between the
state poll and the frame request can still take the `bits` path, and the cap is
what bounds that allocation.

### 3.4 Decoding

| Function | Cost | Notes |
|---|---|---|
| `base64ToBytes` | `O(n)` | `atob` then a `charCodeAt` walk into a `Uint8Array`; no per-character array allocation |
| `decodeCells` | `O(live)` | One `DataView` over the decoded bytes; two `getInt32` per live cell |
| `forEachLiveBit` | `O(area / 8)` byte tests, `O(live)` visits | A zero byte is skipped whole, so a sparse or empty bitmap costs one comparison per eight cells rather than one per cell |
| `decodeBits` | `O(area)` allocation plus the walk | Only for callers that want a grid; the page's `bits` path does not use it |

Two guards are part of the contract rather than the implementation: a `cells`
payload that is not a whole number of 8-byte pairs throws, and a `bits` payload
shorter than `ceil(width / 8) * height` throws. A truncated frame is a defect,
and the page reports it instead of drawing half of it.

### 3.5 Rendering

Two paths, mirroring the two encodings:

* **`bits`** fills an `ImageData` of the rectangle (`O(area)` fill plus `O(live)`
  writes) and draws it scaled, which is what a dense or mid-zoom view wants.
* **`cells`** plots absolute coordinates directly (`O(live)`), which keeps a
  single cell visible as a dot when a thousand of them share one pixel.

Grid lines are drawn only when a cell is at least six pixels wide
(`GRID_MIN_CELL_PX`); below that they would be a grey wash over the image.

Neither path owns a colour. Both take one from the page's `palette` cache, which
is filled by reading the active theme's custom properties and is refreshed when
the theme changes (§3.7). The grid is stroked with the same cache's `--grid`
value, because a fixed light grey is invisible on a light background.

### 3.6 Viewport arithmetic

Lives in [public/viewport.mjs](../../../src/viewer/public/viewport.mjs), as pure
functions, and is owned as a surface by [interfaces.md](interfaces.md) §7.4.

`maxSpan()` derives the widest cheat-free span from the admission rule and the
canvas aspect: the span at which `cells` is still guaranteed at the current
population, or the span whose area is `MAX_FRAME_CELLS`, whichever is smaller.
Zoom and pan are `clamp` and a multiply each; `clampViewport` keeps the
rectangle inside the bounded, non-wrapping world
([ADR 0008](../../adr/simulation-core/0008-the-world-is-bounded-and-does-not-wrap.md)).
Cost is `O(1)` per gesture.

The one piece worth stating because it is easy to get wrong is `zoomAt`: the
world point under the pointer before the gesture must be the world point under it
afterwards. The implementation reads that point off the old scale, sets the new
one and puts it back, which is three lines and is asserted as an equality rather
than as an approximation. A wheel that rescaled about the canvas origin instead
would still zoom, and would slide the world sideways while it did.

### 3.7 The default view, derived from the canvas

A page that opens with no view has to invent one, and the useful invention is one
*scale* rather than one span: a person looking at a cell should see the same size
cell whatever window they are in. The scale is therefore the module's only
constant here, and the span is arithmetic over the canvas:

```
DEFAULT_PIXELS_PER_CELL = 60
span        = cssWidth / DEFAULT_PIXELS_PER_CELL
```

An 800 CSS pixel canvas therefore opens on `800 / 60`, a little over thirteen
world cells across, and a 1920-pixel canvas on thirty-two. Nothing else may
declare that scale: there is no fixed span anywhere in the service or the page,
and no second copy of the rule in the preview, which calls the same
`defaultSpan(cssWidth)` on its own canvas so a generation looks the same size in
both panes.

**The origin is the general form, not the square-canvas form.**

```
visibleHeight = span * cssHeight / cssWidth
x0 = round(W / 2 - span / 2)
y0 = round(H / 2 - visibleHeight / 2)
```

`centreViewport({point, span, cssWidth, cssHeight, world})` is that formula, and
`viewCentre` is its inverse. There is a simpler-looking pair of lines for the same
job in which the second axis also subtracts `span / 2`, and it is wrong for every
canvas that is not square: the visible height is the span *only* there, so on a
wide canvas that rule puts the world's centre above the middle of the view by
`(span - visibleHeight) / 2` — tens of cells at the default scale. The world would
visibly sit high in the window while the code looked right. A case asserts that
the two forms agree exactly where the canvas is square, and four canvas ratios —
`800 x 600`, `600 x 800`, `800 x 800` and `1000 x 400` — assert that the world's
centre is the viewport's centre within half a cell.

The two halves of *how* the rule is applied are as load-bearing as the rule:

* **Nothing is asked for until there is something to ask about.** The world route
  refuses to place a view, and therefore refuses to request a frame, until the
  core has described a world (`state.world !== null`) **and** the canvas has a
  measured rectangle with a positive width and height. The `wide` panel state
  sets the canvas's width to zero, so a canvas that is merely present is not
  enough: the check is `getBoundingClientRect()`, not the element's own declared
  size. Without that gate the first thing a page would do is ask for a rectangle
  derived from a canvas nobody has laid out, which is the guess a person then
  sees.
* **The user's own view outranks the derivation.** `placeDefaultView` re-derives
  the span on every canvas change *until* the person has panned or zoomed, and
  never afterwards. A resize that re-centred a view someone had moved would throw
  away the place they were working, and the flag that stops it is per page, not
  per gesture. The history preview has the same rule under `previewMoved`, with
  one difference: its *centring* can be re-derived while its span may not.

**The narrowest view is `MIN_SPAN = 8` world cells across.** It is a floor on
zoom-in rather than a physical limit, and it is what makes the first turn of the
wheel stop somewhere. It also means the maximum magnification is bounded by the
canvas: in an 800-pixel window the view can be pulled in from about thirteen
cells to eight, a little under 1.7x, which is a known limit rather than an
accident (see [risks.md](risks.md) VWR-25).

**The superseded shape of this rule is gone entirely, not renamed.** The view a
page opened with was once three declarations that did not mention a canvas: one
fixed number of world cells across, one fixed width-to-height ratio, and one
fixed rectangle the service pushed to any subscriber that had not named its own.
Each was correct for exactly one window size, and together they meant the first
thing a person saw depended on their screen rather than on the world. Nothing in
the module declares a span or an aspect any more, and the service declares no
default rectangle at all (§3.10). Nothing asserts the absence either: a
reintroduced fixed span would have to be caught by reading the diff, because no
case reads the source for a name it must not contain
([risks.md](risks.md) VWR-27).

### 3.8 Theme resolution, colour parsing and grid geometry

All four are `O(1)` per call, or `O(length)` for a colour string. What matters is
*when* they run, not what they cost.

| Step | Cost | When |
|---|---|---|
| `resolveTheme(stored, systemPrefersDark)` | `O(1)` | At start-up, and on every system preference change |
| `parseColor`, `toCssColor` | `O(len)` | Reading the palette: three calls per theme change |
| `clampGridWidth` | `O(1)` | At start-up and on every change of the control |
| `deviceLineWidth`, `snapLineCenter` | `O(1)` each, per drawn line | Every frame that draws grid lines |

**The palette is read once per theme change, not once per frame.** The page
calls `getComputedStyle` three times when the theme changes, caches the parsed
colours, and every subsequent frame paints from the cache. Reading the computed
style per frame would put a style recalculation in the render loop for a value
that changes when a person clicks a button.

**A colour the parser does not understand returns `null`, and the caller keeps
what it had.** This is what makes the read-back safe to do at all: a palette
written in a notation the parser does not know — `oklch()`, `light-dark()`, a
`var()` that resolved to nothing — degrades to the previous theme's colour rather
than to a canvas that paints black on black. The parser accepts the four hex
lengths and both the comma and the space separated `rgb()`/`rgba()` forms, and
returns `null` for everything else rather than guessing.

**A grid width that is not a number falls back to the default, not to the
minimum.** The two are the same only if the default happens to be the minimum;
falling back to the minimum would turn a corrupted stored value into the
thinnest line, which is the hardest one to notice and to diagnose.

**Grid geometry is computed in device pixels and returned in CSS pixels.** The
context is scaled by the device pixel ratio before anything is drawn, so a stroke
of a whole number of CSS pixels covers a fractional number of device pixels at a
fractional ratio, and the rasteriser blurs it across two rows. `deviceLineWidth`
rounds to whole device pixels and `snapLineCenter` puts the centre at `n + 0.5`
device pixels for an odd width and at `n` for an even one. The control therefore
reads `2 px` while the stroke is `2.4` CSS pixels at a ratio of `1.25` — the
nearest width that can actually be drawn.

**Theme resolution happens once for the whole page, and the stylesheet carries no
media query.** `data-theme` on `<html>` is always a concrete `dark` or `light`,
so `style.css` has exactly two palette blocks and no
`@media (prefers-color-scheme: …)`. The alternative — resolving the preference in
CSS — would put a second copy of the light palette and a second copy of the
precedence rule in the stylesheet, and the second copy is the one that goes stale.

### 3.9 The one deliberate duplication

The layout sets `data-theme` from an inline script before the first paint, so a
stored choice does not flash the system theme. That script cannot import a module
— a classic inline script has no import — and a deferred module runs after the
first paint, which is the flash it exists to prevent. It therefore repeats the
storage key and the five-line precedence rule that
[theme.mjs](../../../src/viewer/public/theme.mjs) owns.

The copy is marked as a copy in the source: the inline block names `theme.mjs` as
the owner, and a test asserts that the key the inline script reads is the key the
module exports (`dom-contract.test.mjs`). Repeating the rule was chosen over the
two alternatives — a flash of the wrong theme on every load, or a light palette
duplicated in CSS — because it is the only one of the three whose failure mode is
caught by a test rather than by an eye.

### 3.10 The push transport

Lives in [events.mjs](../../../src/viewer/events.mjs). Its cost is `O(1)` per
event per client, plus one `frame` request per changed client per coalescing
window; what matters is the shape, not the cost.

The core has always *announced* its automatic steps — `Bridge._tick` writes
`{"event":"tick", …}` on standard output and `CoreBridge.onEvent` has always
surfaced them. Nothing was listening. The hub listens, and turns three sources of
change into events on one connection per client:

| Source | Event |
|---|---|
| The connection opening | `hello`, and a `frame` **only** if the client named a rectangle |
| A core tick while running | `tick`, then a fresh `frame` |
| A REST mutation, routed through `invalidate()` | `state`, then a fresh `frame` |
| The core failing or refusing | `error`, leaving the connection open to recover |

Five decisions in it are worth recording, because each has an obvious alternative
that is worse:

* **There is no default rectangle, so there is no frame for a client that has
  not named one.** The rule the page opens with is a function of a canvas this
  process cannot measure (§3.7), and a rectangle invented here would be a second
  declaration of it — one that could only be right for one window size. A client
  that opens the stream without a viewport therefore receives `hello` and nothing
  else, and receives its first `frame` when it names its rectangle through
  `POST /api/subscription`, which the page does immediately after `hello`. The
  hub implements this by making a subscription rectangle **all four parameters or
  none**: a partial rectangle is a `400`, and `none` means "send me no frame",
  not "send me a standard one". That last half is the behaviour change — an
  earlier version treated a missing rectangle as a request for a fixed
  page-sized view and pushed a frame of it, which was work with no reader
  ([data-flow.md](data-flow.md) §3.2).
* **A slow client coalesces rather than queues.** Every client carries an
  in-flight flag and an `again` flag. A change arriving while that client's frame
  is being built sets `again` instead of starting a second request. Without it, a
  core running at 60 ticks per second would queue 60 frames per second per client
  against a bridge that issues one request at a time, and the lag would grow
  without bound. The bound is one outstanding frame per client, whatever the tick
  rate.
* **A frame belongs to a snapshot of the subscription.** The viewport can change
  while the core is answering, and the reply describes the rectangle that was
  asked for. The hub copies the rectangle before the request and the event
  carries the copy, so a wheel gesture during a slow frame cannot mislabel it.
* **A rectangle that *is* named is clipped to the world, not refused.** A
  subscription can be wider than the world the core described, and the core
  answers a rectangle outside its world with an error rather than a frame. The
  hub therefore fits the rectangle to the world *before* it tells the client
  which client it is, so the `hello` and the frame that follows agree
  ([testing.md](testing.md) §7.4). This is the one path where naming no
  rectangle and naming an impossible one differ: nothing is clipped when there is
  nothing to clip.
* **The population is injected, not read.** The rule of §3.3 needs a population,
  and the core's `hello` does not carry one: it describes the size of the world,
  not its contents. A hub that pushed frames without a population would apply the
  rule with zero, and zero admits any rectangle at all. The service therefore
  passes the hub a reader for the population it has already seen and a callback
  for the hub to report what it sees, and the hub uses the larger of the two
  ([testing.md](testing.md) §7.5).

The heartbeat is a `ping` event every 15 seconds rather than a comment line, so a
client can observe liveness rather than only rely on the socket. Its timer is
`unref`ed: a keep-alive must never be the reason the process stays alive.

### 3.11 The representation switch

Lives in [server.mjs](../../../src/viewer/server.mjs) `handleRepresentation`, and
it is the one place where the service performs a multi-step transaction rather
than forwarding one request.

```
export (one reply, the whole live set)  ->
  bridge.restart({representation})      ->  a fresh child on the other storage
    import (with the payload and the generation)  ->
      broadcast the new state to every subscriber
```

Three properties make it hold together:

* **The service owns the sequence and the bridge does not.** The live set is the
  core's, and this process cannot read it; the bridge knows how to replace a
  child and nothing about worlds. `restart()` therefore carries nothing across,
  and the caller owns whatever has to survive.
* **The generation travels with the payload.** The core's `import` accepts a
  generation, so the switch does not rewind the clock. That is the difference
  between "the cells were preserved" and "the world was preserved", and it is the
  property [testing.md](testing.md) §5.2 records across a real process
  replacement in both directions.
* **The window is not observable.** A restart leaves an empty world between the
  two halves, so every other route refuses with `503 switch_in_progress` while a
  switch runs, rather than answering from half a world. A switch to the
  representation already running is a no-op and replaces nothing; a second
  concurrent switch is refused rather than queued, so pauses cannot accumulate.

A planned restart must not be counted as a crash. `restart()` resets the crash
counter, because the crash limit exists to stop a core that dies on start-up from
being respawned for ever, and a switch is a deliberate exit. Without that
distinction, three switches would take the service down
([interfaces.md](interfaces.md) §4.3, clause 5).

Cost is `O(live)` for the payload in each direction plus the process start-up,
and both are dominated by the payload at scale. It is recorded as unmeasured at
scale in [performance.md](performance.md) §7.

### 3.12 The shared-value module

A value two runtimes must agree on has three possible homes and only one of them
is honest. It can be declared twice, which is a divergence waiting for an edit; it
can be published by the service, which costs a request before the page can bound
its own zoom; or it can live in a file both runtimes load. The third is what
[public/shared.mjs](../../../src/viewer/public/shared.mjs) is, and it is written
as a plain ES module inside `public/` for one reason: that directory is already
served statically, so the browser loads `/static/shared.mjs` and the service
imports `./public/shared.mjs` — the same bytes through the same handler, with no
build step and no second copy.

What belongs there is exactly the intersection: **a value one side computes and
the other must not recompute.** The frame budget and the rule that uses it (the
service enforces it, the page bounds its zoom with it); the live-set cap and the
degradation it defines (the service applies it, the page reports it); and the
reader for the core's declared limits (both sides need the same interpolation of
one reply).

Two things deliberately do **not** belong there, and both are rules that need a
canvas or a protocol rather than a number. The **default view** is a function of
the canvas a page was given, so it lives beside the rest of the viewport
arithmetic in [viewport.mjs](../../../src/viewer/public/viewport.mjs) and has one
declaration there (§3.7); a value of it in this file would be the second copy.
And **a default rectangle for a subscriber** does not exist at all, in this file
or anywhere else: the service has no way to measure a canvas, so a stream that has
not named a rectangle is sent no frame rather than a guessed one (§3.10).

The distinction that keeps the file from growing into a general constants pool is
that it holds **rules and presentation defaults, never facts the core owns**. The
tick-rate range, the step ceiling, the coordinate ceiling and the list of
representations come from `hello.limits`, and a bound the core did not declare
becomes `null` rather than a plausible number. A page that offers a rate the core
refuses is a page that lies to the person using it, and the failure mode of a
substituted default is a control that produces an error the user cannot explain.

Complexity is a non-issue here and is stated for completeness: `frameAdmission` is
four comparisons, `readLimits` walks four fields, and `clampTicksPerSecond` is
two. The cost that mattered was never the arithmetic; it was the second
declaration.

### 3.13 The stylesheet audit, as a method

Two defects led to [tests/css-audit.test.mjs](../../../src/viewer/tests/css-audit.test.mjs),
and both were structural: a layout rule that listed its control groups **by name**
and therefore missed the one added later, and a `select` appearance rule scoped to
one control's class, so the second and third selects shipped with the browser's own
chrome ([testing.md](testing.md) §7.9). A missing rule is invisible — there is
nothing in the stylesheet to look at — and a page that merely renders does not
fail.

The audit therefore asks the **inverse** question. Instead of "does this rule look
right", it asks:

* does every class and every id the stylesheet names exist in the page or in the
  script that builds it? A token nothing references is a rule that does nothing,
  and it is the signature of a rename that was not followed;
* is the only id selector the canvas? Styling by id is how a rule ends up
  applying to exactly one control — the mechanism of the second defect — and the
  canvas is the legitimate exception because there is exactly one and its size is
  what the drawing code measures;
* does every control group carry the shared `control` class, and does the shared
  layout rule exist?
* is any appearance rule for a form element scoped to a single control's
  container, rather than matching the element?
* do `button` and `select` share one appearance rule?
* do labels and buttons carry a minimum inline size, so that a language with
  different text widths cannot reflow the toolbar under a pointer that was
  reaching for a control?

The method generalises past this stylesheet: **when a defect is a missing
declaration rather than a wrong one, the test has to enumerate what should be
there.** A test that checks the things that exist cannot see the thing that does
not.

Its limit is stated in the file rather than implied: it reads two files as text
and does not evaluate selectors, so it proves the tokens exist and the shared
rules are complete, not that a rule applies at run time
([risks.md](risks.md) VWR-15). What would close that is a CSS engine or a
browser, and the phase has neither.

### 3.14 Keeping the recorded chain replayable across an edit

The core records a generation when it **steps**, and the store's chain is built
from those deltas. A mutation is not a step: `set`, `toggle`, `clear` and `import`
change the world between two generations, so the delta that brought the world to
the current generation no longer describes where the next step starts.

Nothing in either half is wrong on its own — the core records what it steps, and
a mutation is not a step — and the result is a chain that replays to a world that
never existed. It was found on the first hand-driven session by the **store's own
replay validation**, which reported `generation 1 kills (1, 0), which is not
alive` ([testing.md](testing.md) §7.7). That validation exists precisely because a
corrupted chain produces a plausible wrong world rather than an error, and it is
the reason this defect was a message instead of a silent divergence.

The fix follows from what the mutation means: an edit is not part of a
generation's history, so it is recorded **at the head** rather than appended as a
new generation. What "at the head" means is the interesting half, and the tree is
what decides it:

* **When nothing descends from the head**, its own row is rewritten as a keyframe.
  Amending the tip of a branch changes no history anyone can reach, so placing a
  cell there does not produce a second generation zero — which it did, briefly,
  when every edit appended.
* **When something does descend from the head**, the edit becomes a **new node
  whose parent is the head**. That is exactly the state a select leaves behind, so
  an edit after looking at an older generation is where a branch is born. The node
  keeps the generation *number* of its parent, because placing a cell is not a
  step and the label follows the world.

The distinction is not a special case; it is the difference between editing the
present and editing the past, and it is why the operation is named for amending
the head rather than for recording a generation. The cost is one snapshot per
edit, which is bounded by how fast a person can click.

### 3.15 Drawing a history that is a tree

The core hands over nodes with `id`, `parent` and `generation`. Three decisions
turn that into rows, and each has a failure it avoids:

* **Grouping is by `parent`, never by generation number.** A fork is two nodes
  that share a number, so grouping by the number would merge two branches into one
  row per number and lose the fork entirely. A node whose parent is not in the
  list — which happens when the window cut above it — is treated as a root rather
  than dropped, because a row that vanishes is worse than a row that is indented
  as if it began there.
* **A fork is marked, and its children are lettered.** A node with more than one
  child is drawn as a fork point and each child carries `a`, `b`, … so two
  branches are told apart by name and not only by indentation. Indentation alone
  is ambiguous the moment a reader scrolls.
* **Indentation is fork depth, not tree depth.** A level is added only where the
  tree actually parts, so two siblings of a fork are drawn one step in from their
  parent and equal to each other, while every node in a chain stays beside the one
  before it. Indenting by absolute depth would walk the twentieth row of a linear
  run off the right edge of the panel while saying nothing the generation number
  does not already say — which is the defect a person reported, and the reason the
  rule is now a tested property of a pure function rather than a line of DOM code.
  The level is capped at six, beyond which a row stops moving right instead of
  escaping the view: a row that cannot be read is worse than one that is not
  indented.
* **Indentation is rebased on the shallowest row still shown.** The window keeps
  the newest rows and cuts from the beginning, which can orphan a row from its
  parent; without the rebase, the remaining rows would each be one level deeper
  than the last and render as a staircase that drifts off the panel. The window
  widens by a page at a time.

**A row shows a generation and a branch mark, and nothing else until asked.** The
node's own numbers — its storage kind, its population, its change count and the
time it was recorded — are collapsed by the stylesheet and revealed while the
pointer is over the row **or the row holds keyboard focus**, so a fork is legible
at a glance and the detail is one gesture away. Focus is not an afterthought: a
reveal that only a pointer can reach is a reveal half the people cannot use.

Depth and the reveal both travel to the stylesheet as a custom property and a
class rather than as a chain of nested elements, so a row is one element at any
depth and the panel's width does not depend on how deep the history happens to be.

**The connector between a row and its parent is arithmetic, not markup.**
Indentation alone says "something is nested here"; it does not say which parent,
nor which of two siblings continues below. `flattenHistory` therefore returns,
for every row, one *guide kind* per level the row is inside, drawn from the
closed set `GUIDE_KINDS = ['line', 'elbow', 'end', 'blank']`:

| Kind | What the row is inside | What the stylesheet draws |
|---|---|---|
| `line` | A branch that has a later sibling | A vertical rule continuing past this row |
| `elbow` | The start of a branch that has a sibling after it | A vertical rule plus a horizontal turn to the row |
| `end` | The start of the last branch of its fork | A vertical rule that stops at its own turn |
| `blank` | A chain below the last branch | Nothing: the row is indented and no rule is drawn |

The stylesheet gives each level a **14 px** slot (`.timeline-guide`), reusing the
same 14 px the row's `padding-inline` adds per level, so a connector lands exactly
above the parent it belongs to. The slot set is absolutely positioned inside the
row and takes no space in the row's line box, which is what keeps a connector from
being able to change a row's height.

Because the kind is computed by a pure function over `parent` and the sibling
order, whether a connector joins the right rows is assertable without a DOM —
but *whether it visually joins them* is arithmetic over the stylesheet's own
declarations, not a layout, and that distinction is
[risks.md](risks.md) VWR-21's.

**The reveal is the page's state, not `:hover`'s.** Every row carries
`data-open="false"`, and the page sets it to `"true"` on `pointerenter` and on
`focus`, back to `"false"` on `pointerleave` and on `blur`. The stylesheet reads
that one attribute and nothing about hover or focus-visible, so the pointer and
the keyboard open exactly the same thing, and a test can drive the state without
a browser. The open state is also why the node's numbers sit in
`.timeline-overlay`, a single `position: absolute` element: the reveal animates
`max-inline-size`, and an element **in** the flow that grew from `0` to `26ch`
would change the row's grid tracks and grow the row — which is one of the four
defects §3.17 records.

### 3.16 The history page is a tree beside a preview

The history route was a single column and is now two panes, because a node is a
*place in the world* and nothing in a list of generations says which place. The
split is one container with two sections, and nothing about it is a panel state:
the tree is the page and the preview is the only thing on the route that draws.

```
div.history-split
  section.history-tree      #timeline > ol#timeline-list   ... + p#timeline-note
  section.history-preview   p#preview-note, div#preview-area > canvas#preview
```

The grid is `minmax(12rem, 22rem) minmax(0, 1fr)`: the tree is narrow because a
row is a generation and a mark, and the preview takes the rest because it is what
a person is looking at. `#preview-canvas` is a class rather than a styled id for
the same reason the world's canvas is the stylesheet's only id selector — see
§3.13's audit.

Five behaviours of the page are choices rather than layout:

* **The tree is draggable, and a drag is never a click.** Pointer Events on
  `#timeline` with `touch-action: none`, so a touch drag pans the tree instead of
  scrolling the page. A press that travels more than `DRAG_THRESHOLD_PX` (4)
  marks the drag, and the row's `click` handler returns early when it is marked:
  panning a long run therefore never changes the selection. Without that guard,
  the gesture a person reaches for first would silently move the working point.
* **The same surface answers the keyboard.** A row is a `<button>`, so `Tab`
  reaches it and `Enter` selects it for free; `ArrowUp`, `ArrowDown`, `Home` and
  `End` move focus in the order the tree is read, which is what makes forty rows
  navigable without forty tab stops. `data-open` follows focus, so the detail a
  pointer user sees is the detail a keyboard user sees.
* **The preview has its own viewport and its own gestures.** Drag pans and the
  wheel zooms (`Math.exp(deltaY * 0.0015)` about the pointer), through the same
  `viewport.mjs` functions the world route uses, and neither changes the
  selection. Its span is `defaultSpan(previewWidth)` — §3.7's rule on this
  canvas — and its bounds are `maxSpan` at the current population, so a preview
  cannot ask for a frame the service would refuse.
* **One request is in flight at a time, and the newest rectangle wins.** A drag
  emits a move event per frame; the page sets `previewAgain` while a request is
  out and asks for the latest rectangle when it lands, which is the same
  coalescing the world route's polling does (§3.10). The traffic of dragging is
  therefore bounded by the round-trip, not by the pointer's rate — and at a
  `tick` the preview's pixels are refreshed too, because a tick changes the
  generation the preview is showing, though not its rectangle.
* **Nothing is scanned per frame.** The live set is read **once per selection**
  through `GET /api/cells` (§2 of [interfaces.md](interfaces.md)), and the
  centring is decided from that one payload
  ([data-flow.md](data-flow.md) §3.13).

The page reads its own three ids — `#preview`, `#preview-area`, `#preview-note` —
through literal `getElementById` calls, because the contract case reads that list
out of the file as text and asserts the history fragment declares every id it
names. That is the mechanism that would have caught the missing `#timeline`, and
it is why the page's ids are spelled out rather than looked up in a table.

### 3.17 Four defects the whole suite was green through

The interface was rebuilt into three pages, and the history page came out of that
split drawing nothing. It was then given a tree, a selection and the two step
buttons, and four more defects appeared — **none of which any case could see**,
because no browser has ever run this interface
([risks.md](risks.md) VWR-21). Each is recorded here as a mechanism, because the
mechanism is what a later change has to avoid re-introducing, and because the
suite was green at 255 cases throughout all four.

| # | What a person saw | The mechanism | What replaced it |
|---|---|---|---|
| 1 | Rows drew on top of one another, and a fully marked node was twice as tall as its neighbours | `.timeline-row` was a grid with a **fixed small number of tracks**, and the generation plus every mark that applied — branch, fork, head, current — were appended as *further grid items* with no `grid-auto-flow`. Every item past the last declared track landed in an **implicit row**, so a node carrying all four marks was two rows tall and one carrying more was taller still | The marks are collected into **one** in-flow container. The in-flow children are then always exactly two — the generation and the marks — which is exactly the two tracks the grid declares, whatever is set. A case asserts the in-flow child count against the track count read out of `style.css` |
| 2 | A single row filled the whole screen | The row was `inline-size: 100%` of a **single-column page**, so 100% was the page | The page is two columns (§3.16), so a row is 100% of a column that is `minmax(12rem, 22rem)` wide |
| 3 | Opening one row's detail pushed every row below it down | The detail was an **in-flow grid item** animated from `max-inline-size: 0` to `26ch`. Growing it changed the row's track sizes, which grew the row, which moved everything after it | The numbers moved into `.timeline-overlay`, a `position: absolute` element: the reveal animates inside a box that is out of the flow, so opening a detail cannot change a row's height |
| 4 | The rows did not look like a tree at all | Indentation was only `padding-inline: calc(4px + var(--depth) * 14px)` — an offset with no connector — and the window's rebase against the shallowest row still shown could flatten the indentation of a branch whose root had been cut | Every level now carries a **guide kind** computed by `history.mjs` (`GUIDE_KINDS`, §3.15), which the stylesheet draws as a rule, an elbow or nothing. The rebase remains, because it is what keeps a window from rendering as a staircase; what changed is that the depth it rebases now *means* something on screen |

The first three are the same mistake at three sizes: **a grid whose item count is
not the track count it declares.** The markup added whatever marks applied, the
layout grew to fit, and nothing in a synthetic document notices, because a stub
that records element creation does not lay anything out. The fourth is the
narrower one — the geometry *was* computed and *was* asserted, and what was
missing was the drawing. That is the honest shape of VWR-21: the arithmetic of
this module is asserted, and the arithmetic was not the part that was wrong.

The table above is also why the coupling rules in §3.13 and §3.16 exist. The
count of in-flow children is now asserted against the track count the stylesheet
declares, and the connector set is asserted as data, so a fifth mark or a renamed
guide kind is a red case rather than a fifth defect — but both remain **model**
assertions over two files read as text, not a layout engine's answer.

### 3.18 The panel's three states, and why they are a module

The panel where the history and the archive manager live has three states, not
two, because "get it out of the way" and "let me read it properly" are different
requests:

| State | Canvas | Panel |
|---|---|---|
| `normal` | the remaining width | a column, wide enough for a generation row |
| `collapsed` | **takes the space the panel gave up** | off the right edge |
| `wide` | hidden | the whole stage |

Collapsing changes the layout rather than covering the canvas. A panel drawn over
the world hides the thing the person is working on, so the canvas is given the
space and a `ResizeObserver` repaints it immediately rather than at the next
pushed frame — which also covers the language switch, since a wider label changes
the toolbar's height.

The transition rules are worth stating because two of them are not the obvious
ones. Collapsing from `wide` goes to `collapsed` rather than to `normal`: the
control means "hide it", and a press that left the panel on screen would look
broken. Opening from `collapsed` goes to `wide` rather than to the column: the
press asked for the big view, and a narrow one would be a third meaning for one
button.

They live in `public/panel.mjs` rather than in `app.js` for the same reason the
theme and viewport rules do: the browser cannot be driven from `node --test` and
its storage can throw, so the resolution rule is a pure function that a suite
asserts directly. An unrecognised stored value is treated as **no preference**
rather than repaired into the nearest state — the same rule as the theme, and for
the same reason: a value that names no state is not a state the user asked for.

### 3.19 The archive manager never asks for a path

Every archive route — export, list, rename, delete, import — resolves its name
through **one** function: a regular expression that refuses a separator, a drive
letter, a traversal and the encodings of each, then a prefix check that the result
is inside the archive directory. The page sends a name and never a location, so a
request cannot choose where a process on the same machine reads or writes.

Two of the manager's rules are not about safety:

* **A rename onto a taken name is refused** (`400 archive_exists`) rather than
  overwriting. Overwriting would destroy an archive by typo, and the file that
  would be destroyed is the one thing in the manager that is not reproducible.
* **A delete takes a second press.** It is the only action there that cannot be
  undone, and the store keeps no copy of an archive that has been written out.

The importer asks the **core** to open the file rather than replaying it in the
service. An archive is the store's format; a JavaScript reader of it would be a
second implementation of that format in a second language, which is the failure
this project's rules exist to prevent. A core that does not implement `open`
produces `archive_import_unsupported`, and the page says so in the user's language
instead of reporting a success it did not achieve.

### 3.20 The live set, and the cap that makes it a choice

`GET /api/cells` is the core's `export` wrapped for one purpose: a page that has
to choose a *point inside the world* needs the live cells themselves, and the
history preview is that page (§3.16). The alternatives were both worse. A frame
request per candidate rectangle would scan the world once per frame instead of
once per selection, and a JavaScript reader of the history store would be a second
implementation of the store's format in a second language. The route therefore
forwards one command the core already has, and the page decodes the reply with
`decode.mjs` — the same decoder the world route uses, because a `cells` payload is
a `cells` payload wherever it is drawn.

**The cap is a declared number, and both halves of the pair read it.**
`MAX_CELLS_FOR_NEAREST = 16384` lives in
[public/shared.mjs](../../../src/viewer/public/shared.mjs), which the service
imports by relative path and the browser loads over `/static/shared.mjs`. Eight
bytes of little-endian coordinate pair per cell before base64 makes that about
**128 KiB of raw payload**, or roughly 171 KiB encoded — one reply a person waits
for, where a million-cell world would be tens of megabytes. Above it the service
does not stream and does not queue: it answers

```json
{"ok":true,"truncated":true,"reason":"population_above_cap","cap":16384,
 "population":90210,"bounds":[x0,y0,x1,y1],"cells":null}
```

and the page takes the fallback the reply names, centring on the middle of the
core's `bounds` instead of on a cell. What matters about the degradation is that
it is **stated rather than silent**: `previewFocus` returns which of its three
sources decided the centre, and the page renders a different whole sentence for
each — `preview.note.cell`, `preview.note.bounds`, `preview.note.world`. A person
looking at a preview centred on a bounding box is told that is what they are
looking at, in their own language, rather than being left to infer it from the
pixels. The route is also the reason `MAX_CELLS_FOR_NEAREST` is a number in the
shared module rather than a constant in the service: a service-side cap the page
did not know about would be a degradation the page could not report.

The number itself is a **judgement, and it is recorded as one** — the degraded
path is exercised in the suite by lowering the service's own cap rather than with
a real population above sixteen thousand ([risks.md](risks.md) VWR-25).

### 3.21 The interface is four routes, composed from one table

The interface was one document. It grew until a change to the history touched the
same file as a change to the canvas, so it is now three pages — the world at `/`
and `/world`, the history at `/history`, the archives at `/archives`.

**`routes.mjs` is the only route table.** The dispatch in `server.mjs`, the `<nav>`
every page carries and the script set a page loads are all read from its `ROUTES`
array. Adding a route is therefore adding one entry, one fragment and one page
module: a route cannot exist in the navigation without existing in the service, and
a page cannot be served without the module that drives it. Two lists would drift,
and the drift would be a tab that leads nowhere.

**The composition is string concatenation, not a template engine.** The layout has
to set the theme before the first paint, and a classic `<script>` cannot import a
module — so the layout is HTML with four `{{…}}` slots and `fill()` does
the substitution. It **throws** on a slot nobody supplied, because emitting
`{{nav}}` into a page produces a rendering bug in the browser that is invisible to
the composer. A template language would be a dependency and a second syntax for
the same three operations.

**A fragment is a fragment.** It carries no `<html>`, `<head>` or `<body>`, so a
composed page has exactly one of each and exactly one `<title>`. A fragment that
grew its own head would produce nested documents; the duplicate heading a person
reported and that failure are the same mistake at different sizes.

**`/` and `/world` are one route with two paths.** `/` is what a person types and
what the launcher's smoke test probes; `/world` is what the tab bar links to. One
page at two addresses is what makes those two agree.

**A path nobody serves is `404`.** The service does not fall back to the world
page, because a fallback would make every typo look like a working address.

The layout and the fragments are read once and cached: they are files the service
ships, so changing one is a restart rather than a request. Reading them per request
would put four synchronous reads in front of every page for no benefit.

**This split produced two defects that no test could see** — a page that drew
nothing and a panel state with no styling — and both are recorded in
[testing.md](testing.md) §7.11 and §7.12. What matters here is that the two
mechanisms which let them through were removed rather than the two instances
patched: the synthetic document no longer invents an element on lookup, and the
stylesheet audit requires a class to appear where a class is borne.

### 3.22 The shell and a page module talk over the document

The shell runs on import and touches the DOM at module scope, which is why the
test suite loads it under a fresh module URL per case. A page module that imported
it by a plain path would therefore resolve a **second** copy — one that has already
run, found no data and discarded its state — so the two do not import each other.

They talk over the document instead. `public/link.mjs` owns the two event names and
the handshake: a page registers a listener for `lifegame:shell` and then dispatches
`lifegame:shell-request`; the shell answers every request with its context, and also
publishes once when it starts. **Both load orders work** — page first, where the
request is lost and the shell's start-up publication arrives afterwards, and shell
first, which is the order the layout produces and where the request is answered
synchronously.

The page hands the context to its module-level bindings, so its functions read
`state`, `dom` and `t` exactly as they did when all of this was one file. The cost
is that **nothing checks the shape of what is passed**; see
[risks.md](risks.md) VWR-22.

### 3.23 The rule editor

The rule the world runs is the core's, and the page's control group is a thin
front for one command. The markup carries three controls and one line — a select,
a text field, a button and a refusal message — and the select's options are built
from `RULE_PRESETS` in `public/rule.mjs` (§7.5 of
[interfaces.md](interfaces.md)), so the fragment holds an empty `<select>` and the
list exists once.

Two gestures submit a rule and they are deliberately one call: choosing a preset
sends it immediately, and the field submits on `Enter` and on the button through
the same function, so the two halves of "you have said what you want" cannot
drift apart. `Enter` is caught on the field rather than on the window because the
page's own key handler ignores events that came from a field, and that is right:
inside a text field `Space` and the arrow keys are text editing, not transport
control.

**The select has a ninth entry that names the running rule.** Its value is the
constant `custom` and its label is `rule.custom` — `custom · {rule}` — and
selecting it sends nothing, because "custom" is not a rule: it moves the keyboard
to the text field. The alternative, selecting the nearest preset, was rejected
because it makes the control claim a rule the core is not running; the entry that
carries the rule's own string is honest and still says what is in force. A rule the
core reports at handshake takes this branch too, which is what makes the control
correct before a person has touched it.

**The field is written in two places and nowhere else** — when the core's rule
first arrives, and after a rule the core accepted. `updateRuleControl` runs from
every readout update, including the ones a tick produces up to sixty times a
second, and a field rewritten under a person mid-correction is a field they cannot
finish correcting; that is also why the eight unchanged option labels are
relabelled only when the rule string changes, guarded by a module-level
`ruleLabelled`. The readout, the select and the world are re-stated from one
function, so they cannot describe two different rules.

**The first of those two moments is where the editor's browser-found defect
lived, and the record keeps it.** `main()` in the shell publishes its context
*before* it awaits its first `state` reply, so a page module loading after the
shell — the normal order — is answered synchronously and reaches
`initialiseRuleEditor()` while the shell's rule is still the empty string the
shell starts with. The field was therefore empty on a fresh load, the readout and
the select correctly said `B3/S23` while the field beside them was blank, and a
press on `set` refused locally and sent nothing; the suite was green because the
synthetic browser established the rule before the page started. It was found by
the browser probe and fixed inside the version that delivered the editor, by
filling the field the first time a rule arrives and never again under a person who
is typing. The defect record is [testing.md](testing.md) §7.15, the two probe runs
are §5.10, and [risks.md](risks.md) VWR-28 is retired. The property this section
requires still stands: a readout redraw must never rewrite the field under a
typist.

**The client checks, the core decides.** `parseRule` refuses a malformed value
locally and nothing is sent, which spares the person a round trip that would tell
them the same thing later. A value that passes is normalised before it is sent, so
the request carries the canonical form. A `bad_rule` refusal is then shown beside
the field through `describeError(state.locale, code, message)`, the core's own
message appended to the translated label for the code (§12.3 of
[interfaces.md](interfaces.md)) — the diagnostic itself is never translated,
because a second description of the same fact would drift from the first.

**A refusal changes nothing.** `state.rule` is written only from a reply that said
the core took the rule, so the readout, the select and the world go on describing
what is running, and the user's text stays in the field. That is the property that
makes a text field safe to offer at all, and it is asserted from the page side:
the case that sends a rule the core refuses checks the readout afterwards.

**Changing the rule does not touch the transport.** The command is not an edit and
does not restart anything, so a running world keeps running and a paused one stays
paused until the user steps it. The page needs no pause-and-resume sequence, and
the fact that the rule is applied from the next generation is the core's
([world/interfaces.md](../world/interfaces.md) §4.2.1), not the page's.

### 3.24 The pattern library is data, and one parser reads it

A pattern is a shape, not a position, and the library is one JSON document:
[patterns.json](../../../src/viewer/patterns.json) holds fifteen classic
still lifes, oscillators, ships and one gun, each as a Run Length Encoded string —
the format the Life community already writes, so a pattern here can be checked or
replaced with any other Life tool. The parser in
[patterns.mjs](../../../src/viewer/patterns.mjs) is the only place the encoding is
understood; the page never sees RLE, because it names a pattern and the service
resolves the cells.

The parser is **strict rather than forgiving**: an unknown character, a missing
`!`, a run length before the terminator, a run that would allocate more than
`MAX_PATTERN_CELLS` or a side longer than `MAX_PATTERN_SIDE` is refused, not
truncated. A silently shortened pattern places a different shape than the one a
person chose, and the failure would look like a rendering bug. The result is
normalised so the top-left of the bounding box is `(0, 0)`, because a pattern is a
shape and a leading dead run is not part of it.

Placement is one `set` command: the protocol already takes a whole coordinate
list, and the service checks the box against the running world before sending it,
because `set` is not atomic. The library is read once per service, so a placement
costs one command plus one export when the storage is reconsidered (§3.25).

The data is asserted twice: every pattern's population is checked against its
published size, and three patterns are stepped through a **real core** — the still
life is unchanged after four generations, the glider is its own shape shifted by
one cell, and the gun's population grows. A count alone would not catch a
plausible wrong shape, and the counts alone are what the first version of this
suite asserted.

### 3.25 The storage is chosen from the measured shape

The measurement in
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5.2 gives two
anchors and the difference between them is spatial: a packed 4,000-cell
population costs 0.33 ms on the tiled world and 1.37 ms on the sparse one, while
the same population spread one block per tile costs 2.00 ms tiled against 1.40 ms
sparse. Population alone therefore cannot decide, and
[representation.mjs](../../../src/viewer/representation.mjs) decides on population
**and** density:

* below 4,000 live cells the sparse world wins, and the choice is not taken at
  all — `hasMeasuredOpinion` is false, so a manual choice survives a small
  placement;
* at or above it, tiled is chosen when the live set occupies at least
  `TILED_MIN_DENSITY` (0.05) of its bounding box, and sparse otherwise.

The two measured shapes are about 0.24 (packed) and 0.004 (spread); the boundary
is **chosen between them and not measured**, which is recorded as
[risks.md](risks.md) VWR-32 rather than presented as a result.

After a placement the service asks the core for `export` — the whole live set, in
the layout §4.7 of [world/interfaces.md](../world/interfaces.md) documents — and
decodes the same little-endian pairs the frame encoding uses. An export whose
length does not match its own population leaves the running storage in place: a
choice from a partial set is worse than no choice. A switch is the existing
§3.11 sequence, so it keeps the world and the generation, and it is taken only
when the choice differs from what is running.

### 3.26 One runtime per session, and one registry

A session is a **core process**, a history store, an event hub, a switch flag and
the facts the service learned from that core. `createSessionRuntime` builds that
group once, and `createViewerServer` keeps a `Map` of them with `main` in it
before the first request. Every session-scoped handler receives its runtime
rather than reading a shared variable, which is what makes two sessions safe
under interleaved requests: a handler cannot see another session's switch flag or
population, and a hub's client ids are unique only inside its own session, which
is why `/api/subscription` resolves the same session as its stream.

The default session is the bridge the service was always given, so a request
without `?session=` is byte-identical to what it was before sessions existed and
the whole existing suite still runs against `main`. A created session gets an id
the service generates (`s1`, `s2`, …), its own history path under
`data/sessions/`, and its own `CoreBridge`, so the crash counter and the restart
policy are per session as well.

**At the cap, creation waits rather than failing.** The service holds at most
`MAX_SESSIONS` (64) sessions, the default included. A creation that arrives at the
cap is parked in a waiter list and resumed when a session closes; the list length
is `queued` in `GET /api/sessions`, and it is what the page shows. A waiter that
loses a free slot to a request that arrived later re-checks and waits again, so the
loop is the fairness mechanism. A shutdown rejects the waiters with
`503 service_closing` instead of leaving the HTTP requests open. The factory that
builds a new session's bridge is an option, which is what lets the suite exercise
the cap without starting 64 Python children.

**The remembered point belongs to a session, and a link shares it.** The point the
history preview centres on used to be one storage entry for every session, which
meant two worlds overwrote each other's memory (VWR-34). It is now keyed by the
session (`lifegame.viewer.focus` for `main`, suffixed for a created session), and
`?focus=x,y` is the sharing mechanism: a page that loads the link parses the point
in `focus.mjs`, stores it for its own session and uses it for the preview. A
malformed point is ignored rather than repaired to the origin, and a session with
no point falls back to its own rule.

**`GET /api/capabilities` is a seam, not a contract.** The editing mode is still
being planned — by a person, not by the implementation — so the route names what a
future editor may rely on (the HTTP surfaces, the session cap and queue, the
shareable point, the fact that the mode is `planned`) and deliberately does not
describe an editing model. It also does not list the command vocabulary: that is
the core's protocol, and the service's job is to forward it, not to copy it.

**Undo is a page inverse, and it is deliberately narrow.** The last cell edit is
undone by toggling the same cell again; a toggle is its own inverse, so the page
keeps only the coordinate. The stack is emptied on any move this page did not
make — a step, a run, a clear, a placed pattern, a selection, a rollback, or a
generation change — because reversing an edit against a state the person cannot
see would be a wrong world presented as an undo. A placed pattern and a clear are
not in the stack: the page cannot compute their inverse without the prior state of
the cells they touched, and the recorded timeline is the right path for a bulk
move. This is why undo is not a rollback, and the distinction is stated in the
page's own documentation rather than left to the implementation.

**Save and load are the archive routes, and the core owns the format.** The
archives page already wrote a recorded session to a file and listed, renamed and
deleted those files; this version made the other half true by verifying that the
core's `open` **restores the world** as well as importing the session. The service
resolves a name to a path inside one directory, forwards `archive` and `open`, and
broadcasts the state. It never replays a delta in JavaScript, so the stored format
still has one implementation, in the core.

### 3.27 The snippet library and the editing API

The editing mode's API is in the tree ahead of its page tools. `snippets.mjs` is a
filesystem store: one immutable object per content hash, a versioned `index.json`,
and publish/read/remove rules that make a name a compare-and-swap pointer rather
than a mutable file. The service exposes four routes over it and forwards nothing
to the core, because a snippet is content, not world state. Drafts are
deliberately absent from the store: a draft is the page's or the API client's
until it is published.

`edit.mjs` is the document a transaction commits against, as a pure class. It
validates an operation into an absolute intent, records the version and the chain
hash, rebases a stale base when every operation is absolute and refuses one that
depends on content, and owns the inverse-transaction undo: a cell another author
wrote since keeps the newer value.

`edit-runtime.mjs` is the service around them and the part that makes the API
real. Entering pauses a running world, fingerprints the live set once and opens a
document at the generation the export reports. A transaction's operations become
the candidate cells the service asks the core to write; the core applies them
atomically and answers with the cells that **actually changed**, which is what the
document records — the service never reads a region to compute the difference, and
undo attribution cannot claim a cell a transaction only mentioned. A commit
broadcasts a `patch` event and invalidates the frame stream, so every client sees
the same version and hash. Undo and redo are transactions of their own, and
`GET /api/edit/state?since=` answers the retained window or says `full: true`.
While the mode is open, the service refuses the other world-writing routes with
`edit_active`; a second writer behind the document is the one thing the pause
exists to prevent.

What remains is collaboration and roles: the presence channel, concurrent
transactions, and the token and role model. The version state and the finished
items are in [VERSIONS.md](../../plan/VERSIONS.md) and
[phase-04](../../plan/phase-04-editing-mode/overview.md).


### 3.28 Real-time collaboration

Presence, the merge order and the cross-author undo are three different
mechanisms that share one serialiser: the service.

**Presence is ambient, never stored.** The runtime keeps a map of `clientId` to
`{author, cursor, selection, view, at}`, validates a report's shapes, broadcasts a
`presence` event and answers `GET /api/edit/presence` for a late joiner. An entry
expires after 30 s, so a closed tab leaves the roster by itself; `leaving: true`
removes it at once. The page throttles its own reports to 120 ms and keeps the
last cursor in the payload, so a view-point report does not erase the cursor.

**Concurrent transactions merge by the commit order.** The service is the only
writer of the core, and it serialises transactions per session. An absolute
intent whose base is behind is rebased onto the world the service actually meets;
a content-dependent one is refused with `stale_base`. Two authors writing
different cells both survive, and an overlapping write resolves to the later
commit. Every client receives the same `patch` event with the same version and
hash, which is the convergence check the two-client case asserts. A `patch` event
is the page's only signal to apply a remote change: if its version is the next
one it advances in place, and if it skips ahead it resynchronises through
`/api/edit/state`.

**Cross-author undo names its target.** `POST /api/edit/undo` takes an optional
`txId`, so one author can undo their own transaction while another author's newer
write to the same cell keeps its value: the inverse patch is restricted to the
cells the target is still the last writer of. Without `txId` the newest
transaction on the session's global undo stack is undone. The stack is bounded by
the retained window, and the per-cell attribution of a transaction that leaves
the window is compacted with it; the cost is that undo depth equals the window
(1000 transactions), which the interface states rather than hides.

The page draws a collaborator's selection and cursor from the presence map and
names them in the edit toolbar. Presence rendering is not an acceptance
criterion; it is how a person sees that the collaboration exists.

## 4. Environment
| Requirement | Why | If absent |
|---|---|---|
| Node.js 24 or newer | The service, the page scripts and `node:test`. Private class fields, `import.meta.dirname` and `node:test` are used | Nothing runs |
| A browser with canvas, `fetch`, ES modules, `EventSource`, `matchMedia` and `getComputedStyle` | The page, the system preference and palette it resolves, and the push transport | The service still serves; the page cannot run, and it falls back to polling if only `EventSource` is missing. The synthetic browser is what makes the rest of the page testable; the real browser is not |
| `matchMedia` and `getComputedStyle` | Resolving the system preference, and reading the palette out of the stylesheet | The page throws at start-up. Both are present in every browser the page targets |
| `localStorage`, optionally | Remembering the theme and the grid width | Not required: every access is wrapped, and a storage that throws means the two controls work and forget. A private-mode window therefore keeps a working theme button rather than a broken one |
| The project interpreter at `.venv/`, and the `lifegame` package installed in it | The bridge spawns it as the core | `503 core_unavailable` naming `scripts/bootstrap.ps1` |
| No package dependency | There is none to install; nothing is vendored | — |

The module takes part in the repository's environment contract by writing
nothing at runtime; see [data-flow.md](data-flow.md) §4.

## 5. Configuration and relocation

There is no configuration file. Everything is a flag or a default
([interfaces.md](interfaces.md) §8), and two paths are derived rather than
configured:
* the **public directory**, from `import.meta.url` of `server.mjs`, so the
  service serves its own assets wherever the checkout lives;
* the **repository root and the interpreter path**, from `import.meta.dirname` of
  `bridge.mjs`, so the bridge starts the core from the checkout it belongs to
  rather than from the caller's working directory.

Moving or cloning the repository therefore requires no edit, and a second
checkout runs its own service against its own core. The one thing a relocated
checkout changes is the interpreter path, which is derived and not stored.

## 6. Why the structural choices were made

| Choice | Why |
|---|---|
| A child process rather than an in-process binding | The core is Python and the service is NodeJS ([ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §1.1); the protocol is the only interface the two share, and it is the one the core already had |
| Streaming, with polling kept as a fallback | The core announces every step, so the service can push instead of being asked. Polling is not removed: it is demoted to the path taken when `EventSource` is missing or the stream drops. A push transport that failed silently would leave a blank page with no explanation, and the fallback is tested by deleting `EventSource` and by breaking a live stream |
| Server-Sent Events rather than a WebSocket | The traffic is one-way from the service's point of view — the stream carries frames and ticks, and a gesture travels as a small POST (§3.10) — so a duplex protocol would add a handshake, a framing layer and a reconnect protocol to carry data that only goes one way. Server-Sent Events are a response with a content type, which this service already owns, and the browser's client reconnects on its own |
| One frame in flight per subscriber | The same reason the request queue holds one request: it bounds the core's concurrent work and makes reply order irrelevant. For a subscriber the bound is what turns a fast tick rate into coalescing instead of unbounded lag |
| The admission rule in one module, as a dependency of two components | The REST route and the push transport both need it, and the second caller is exactly when a duplicated rule starts to drift. It is a leaf so that neither caller can pull the other in through it |
| A synthetic browser rather than accepting no page coverage | The page's own wiring was the one place a defect could hide from every gate, and it did (§7 of `testing.md` in the previous version). A stub browser is a fraction of the cost of a headless one, needs no dependency, and catches an unreferenced identifier, a wrong argument and a path that throws. It cannot catch what a rasteriser does, and that limit is stated rather than glossed |
| The switch sequence owned by the service, not by the bridge | Only the service can reach the world: it reads an `export` reply and hands it back as an `import`. Putting it in the bridge would give that process a notion of a world it otherwise does not have |
| Every route refusing while a switch runs | A restart leaves an empty world between the two halves, and a route that answered during that window would report a world that is not the world. Refusing is the only answer that cannot be mistaken for data |
| One request in flight | It makes reply order irrelevant and bounds the core's concurrent work to one rectangle. A queue is simpler than a concurrency window and cannot starve a client |
| A bounded restart policy | A core that dies on start-up would otherwise be respawned for ever by a polling page |
| Admission in the service | The core cannot refuse its own caller: by the time it knows the encoding, it has already decided to allocate. The service is the last place that can refuse before the allocation happens |
| The decoders in their own file | It is the only way to test the browser's decoding without a browser, and a wrong bit order is invisible in a manual check |
| No build step | The module has no dependencies and no transform; adding a bundler would add a toolchain for a page of six hundred lines |
| Errors as an envelope, not as exceptions across HTTP | The core's error vocabulary stays the client's vocabulary: a refusal read from `/api/command` looks exactly like one read from the core |
| The palette lives in the stylesheet and is read back | One palette, in the file a designer opens. Keeping the canvas colours as JavaScript constants would mean two definitions of the same theme, and the one the canvas used would be the one nobody looks at. The read-back is cached so the cost is paid when the theme changes, not when a frame is painted |
| The theme rule lives in one module, so the stylesheet has no media query | Two copies of "no explicit choice means follow the system" drift, and the drift is invisible: a wrong precedence shows as a palette that ignores the system on one machine. One pure function is testable; a media query plus a resolution order is not |
| Five lines repeated in the pre-paint script | The alternatives are a flash of the wrong theme on every load, or the light palette duplicated in CSS. The repetition is the only option whose failure mode a test can catch (§3.9) |
| Grid geometry in device pixels, width in CSS pixels | The control's label is what a person reads; the geometry is what the rasteriser needs. Converting in one place keeps the fractional-ratio case right without the rest of the page knowing the ratio exists |
| A `null` from the colour parser means "keep the previous colour" | A palette the parser cannot read is a defect in the stylesheet, and the useful response is to leave the page legible in the previous theme rather than to paint something arbitrary |
| The view is derived from the canvas rather than fixed | A fixed span is right for exactly one window and wrong for every other, so the first thing a person saw depended on their screen. Deriving it makes one cell the same size on every canvas, and makes the preview and the world agree by construction rather than by a shared number (§3.7) |
| The default rectangle removed from the push transport | A service-side default is a second declaration of a rule that needs a canvas, and it pushed a frame of a view nobody was looking at to every client that connected. A stream that has not named a rectangle now receives `hello` and nothing else, and the page's first subscription is the first thing it sends (§3.10) |
| The connector geometry computed as data, not built as markup | A guide kind is a property of the tree, not of a DOM node, so whether a connector is a continuation, a turn or the end of a branch is assertable without a browser. Building it while walking the element tree would put the same decision somewhere only a browser can reach (§3.15) |
| The preview's live set read once per selection, with a declared cap | The alternatives are a frame request per candidate rectangle, which scans the world once per frame, or a JavaScript reader of the store, which is a second implementation of a format in a second language. The cap makes the remaining cost a number both sides read, and the degradation is a sentence the page can show (§3.20) |
| The reveal as one `data-open` attribute | `:hover` and `:focus-visible` are two mechanisms with two behaviours that a browser decides, and only one of them is reachable by a pointer. One attribute the page sets makes the pointer and the keyboard open exactly the same thing, and makes the state assertable without a browser (§3.15) |
| The rule editor checks a value before sending it | A round trip spent being told that `B3S23` has no slash is a round trip spent on arithmetic the page can do, in a control a person is likely to get wrong once. The check is deliberately the **first** one and not the only one: the core still has the last word, and the page shows the core's own reason when it refuses (§3.23) |
| A ninth select entry that names the running rule | The list means "the rules people ask for by name", so selecting a preset while a different rule runs would have the control claim a rule the core is not running. An entry that carries the current rule's own string is honest and still says at a glance which rule is in force |
| The rule field is not rewritten by a readout redraw | The readout is re-stated up to sixty times a second while a world runs, and a field rewritten under a person mid-correction is a field they cannot finish correcting. It is written only where a rule was actually taken |
| The preset list is data and its names are locale keys | The fragment carries an empty `<select>`, the rule strings live in `public/rule.mjs` and the words live in the catalogue, so a ninth preset is one array entry and two catalogue entries and no markup |

| One core process per session, with the service holding a registry | Two sessions must not pause each other (a switch is a restart) and must not share a crash budget, and the core already owns one world per process; a per-session bridge and hub give both without a protocol change | N processes, N worlds in memory, and a shutdown that has to reap them; the registry is not persisted |
| The session id in a query parameter | It works for `EventSource`, it leaves the route table and every page test untouched, and a request without it still means `main` | A stale id after a restart answers `404 unknown_session` rather than a page |
| One history file per session | Two cores on one SQLite file would be two writers, which is the hazard R27 records; separate files need no locking work | The service cannot list or import across sessions from one store, and a store file is left behind when a session is closed |
| The storage chosen only at or above the measured crossover | The measurement says sparse wins below it, but taking a manual choice away for a block is not what the milestone asked for | A manual choice below 4,000 cells is never reconsidered automatically |
| The RLE form for the library's data | It is the format other Life tools already read, so a pattern can be checked or replaced without learning a format invented here | A parser and a size bound, where a JavaScript array literal would need neither |
| The pattern placed at the centre of the view by the page | The page is the only component that knows what the person is looking at; the service resolves the cells and checks the bounds | The origin is a page decision, so a second client decides its own — which is the point |
| A separate component for the representation choice | It is the one rule in this module that is a measurement rather than a wire format, and it is testable as plain data with no core and no socket | One more leaf module and one more file to read before the choice is understood |

## 7. Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| A WebSocket transport instead of Server-Sent Events | It is the right tool for a duplex channel, and this channel is not duplex: the stream is one-way and a gesture is a small POST. A WebSocket would add a handshake, a framing of its own, a reconnect protocol and a second way to authenticate, all to replace a response with a content type |
| Sending the viewport update over the stream, by reconnecting per gesture | Server-Sent Events travel one way, so the only way to say "look here now" through the stream is to open another one. A wheel gesture produces several events per second, and a reconnect per event costs a request and a `hello` each time, against one small POST that reuses the connection |
| Queueing frames for a subscriber that falls behind | The queue would grow at the tick rate, and its length would become the lag. Coalescing discards the frames nobody will look at and keeps the newest, which is the only one a person can see |
| Counting a planned restart as a crash | The crash limit exists to stop a child that dies on start-up from being respawned for ever. A representation switch is a deliberate exit, and three of them would take the service down if they spent the same budget |
| Making the representation switch observable, and letting a caller watch it happen | It would expose a moment at which the world is empty, and every consumer would have to handle it. Refusing for the duration keeps the invariant that a reply describes a world |
| Letting the two server-side callers of the admission rule keep a copy each | They agree until one is edited, and the second caller is the moment the risk stops being theoretical. The rule is one small file with the derivation written in it |
| Driving the page with a real headless browser | It is the thorough answer, and it costs a dependency, a download and a second runtime to keep in step — in a module whose value includes having no dependency. The synthetic browser covers the wiring; the rasteriser stays uncovered and is recorded as its own risk |
| Storing a frame on the service so a new subscriber is answered from a cache | It would make the service hold world state, which is the one thing it must not do, and it would make a stale frame indistinguishable from a fresh one |
| Proxying raw protocol lines to the browser | It would put the protocol's framing, `id` correlation and error vocabulary into the page, and would make the browser a second protocol implementation |
| Letting the page request any rectangle and reporting the core's failure | A `65536 x 65536` `bits` request asks the core for about 2.8 GB before it can fail. The refusal has to happen before the request is sent |
| Applying the rule on the client only | The API is reachable without the page: a refusal that lives only in the browser is a suggestion, not a guard |
| Making the admission rule a fixed area cap | It would refuse the whole-world view that the sparse representation exists to make possible: `65536 x 65536` is 4.29e9 cells, far above any cap, and is a perfectly cheap `cells` frame at a realistic population |
| An absolute-path or configuration-file interpreter path | It breaks a clone or a git worktree the way the environment module's declared cache paths once did; the path is derived from the module's own location |
| Serving `public/` through a static-file middleware package | One dependency for a `readFile` and a content-type table, in a module whose value includes having no dependency |
| Rendering the canvas from the server as an image | It would put rendering in the transport, duplicate the viewport state, and make every pan a round trip |
| A `prefers-color-scheme` media query in the stylesheet | It duplicates the light palette and the precedence rule, and it makes the resolved theme a property of CSS rather than of the page: the canvas, which cannot use CSS, would still have to resolve it separately, which is the second copy the media query was meant to avoid |
| Storing the resolved theme instead of the explicit choice | The first start-up would freeze the system's answer for ever, and a later change of the operating system's preference would be ignored. Storing only an explicit choice keeps "follow the system" meaningful |
| Keeping the canvas colours as JavaScript constants beside the stylesheet | Two definitions of one theme. The `bits` path already carried a defect of the shape this invites: a colour constant was deleted while a reference to it stayed, and the path threw on every dense frame ([testing.md](testing.md) §7) |
| Reading `getComputedStyle` once per frame | A style recalculation in the render loop, for a value that changes when a person clicks a button. The cache costs one read per theme change |
| Snapping grid lines in CSS pixels | It leaves a partially covered device pixel on each side of the stroke at a fractional ratio, which the rasteriser draws as two grey rows instead of one line |
| Falling back to the minimum grid width on a value that is not a number | It turns a corrupted stored value into the thinnest, least noticeable line, and it makes "no choice" and "bad choice" look the same |
| Painting black, or the dark palette, when a palette value cannot be parsed | It converts a stylesheet defect into an unreadable canvas. Keeping the previous colour leaves the page usable and the defect visible |
| Selecting the nearest preset when the running rule is not one of them | It trades a truthful control for a tidier-looking select, and the cost is invisible: the readout and the select would disagree, and a person reading only the select would be told the wrong rule. The entry that carries the current rule's string says the same thing without lying (§3.23) |
| Sending what the user typed without normalising it first | The core normalises anyway and answers with its own spelling, so the request would carry a form the reply contradicts. Normalising before the request makes the request, the reply and the readout one string |
| Pausing and resuming around a rule change | The command does not touch the transport, so a pause would stop and restart the run for no reason — and would be visible to anyone watching a running world, which is exactly the case the control exists for |
| Relabelling the select's nine entries on every readout update | The readout runs up to sixty times a second and eight of the nine entries never change. The guard turns nine DOM writes per tick into none until the rule string itself changes |

| A session command inside one core process | It would need a protocol change, a world map in Python and a supervision path for a core that holds several worlds; the process boundary is already the unit of crash and restart, so a session is one process |
| A path prefix (`/s/<id>/world`) instead of a query parameter | Cleaner in a URL and easier to keep in a bookmark, but it changes the route table, the page composer, the tab links and every route and page assertion, for a benefit the query parameter already provides |
| One shared store for every session | It would give cross-session listing and import for free, but two cores would write one SQLite file, which is the two-writer hazard R27 records; a store that detects a second writer is a design of its own |
| Storing the library as JavaScript arrays in the page | A second copy of data the service also needs, a code change to add a pattern, and no format another Life tool could read |
| Choosing the storage from population alone | The measurement says the same population wins on different storages depending on its shape: 4,000 packed cells cost the sparse world four times what the tiled one charges, and 4,000 spread cells are the other way round |
| Switching on every placement, including below the crossover | It would take a manual choice away for a block, for a difference the measurement says is small at that size |
| A fixed density boundary presented as measured | The boundary sits between two measured anchors and the space between them has never been stepped under measurement; presenting it as measured would be the kind of claim this project's evidence rules exist to prevent |

## 8. Known gaps

| Gap | Consequence | Where |
|---|---|---|
| The synthetic canvas records drawing calls but does not rasterise | Whether a stroke is crisp at a fractional ratio, and whether the page is pleasant to look at, is checked by eye | [risks.md](risks.md) VWR-10 |
| The 15-second heartbeat is never waited out | A heartbeat that never fired would be invisible to the suite | [risks.md](risks.md) VWR-11 |
| A stalled first frame, and a second client behind a stalled one, are untested | One subscriber can hold a `hello` with no picture while the other waits behind it | [risks.md](risks.md) VWR-12 |
| The representation switch's cost at scale is unmeasured | A switch on millions of live cells is a visible pause of unknown length | [risks.md](risks.md) VWR-13 |
| **A real browser runs only the probe's declared interactions**, and no dependency may be added that provides more | The probe of [tools/browser-probe/](../../../tools/browser-probe/) drives an installed browser over the DevTools protocol, so a routed path that stopped being served, an element covered by another at a named point, and the request a declared interaction produces are all checked. What it does not do is look: whether the tree's connector really joins a row to its parent, whether a row is one line tall at a real line height, how the overlay's transition looks, whether the two columns survive a narrow window, and which palette is legible on a real display are still judged by eye. A page can be green in every case of the run on record ([testing.md](testing.md) §5.1) and still draw the four defects §3.17 records, which is what happened | [risks.md](risks.md) VWR-21 |
| The live-set cap has only ever been driven with a stub threshold | The degraded `preview.note.bounds` path is exercised by lowering the cap, never by a real population above it, so the number itself and the wording beside the canvas are unvalidated at the scale they exist for | [risks.md](risks.md) VWR-25 |
| Dragging the preview issues one frame request per round trip | The traffic is coalesced to one in flight, but a large canvas at a fast drag is the same order of requests as the world route's polling, and that cost is not measured | [risks.md](risks.md) VWR-25 |
| `MIN_SPAN = 8` bounds magnification by the window | In an 800-pixel window the view can be pulled in from about thirteen cells to eight, a little under 1.7x, and there is no affordance that tells a person they have reached the floor | [risks.md](risks.md) VWR-25 |
| Nothing asserts that a fixed span is absent | The rule that the default view is derived is held by the code and by the tests of the functions that do it; a reintroduced constant would be caught by reading a diff, not by a case | [risks.md](risks.md) VWR-24 |
| The synthesised `bits` payload the page suite installs is not the core's encoder | The stub's payload was rectangle-relative only after this version changed it, and it had been correct by accident before that — right only while a frame started at the origin. A divergence between the stub and the core is invisible until a different rectangle is exercised | [risks.md](risks.md) VWR-26 |
| The stylesheet audit reads text and cannot evaluate a selector | A rule can name a class that exists and still match nothing, through specificity, ordering or an overriding declaration | [risks.md](risks.md) VWR-15 |
| The shell's context has no declared shape | A field removed from the context fails at the page that reads it, on a page a person had to open | [risks.md](risks.md) VWR-22 |
| `/world/` and `/index.html` answer the JSON error envelope | A person following an old bookmark sees JSON where a page belongs | [risks.md](risks.md) VWR-23 |
| `hint` is declared on all three routes and filled by two | The archive page carries an empty paragraph | [interfaces.md](interfaces.md) §7.1 |
| `scripts/viewer.ps1 -SmokeTest` probes only `/` | The launcher gate proves the service answers and that an unknown route is 404; the three routed pages are covered by the routes suite and by a manual end-to-end run, not by that gate | [scripts/viewer.ps1](../../../scripts/viewer.ps1) |
| One suite run failed and was not reproduced | The gate's stability is a claim about the recorded runs rather than an established property | [risks.md](risks.md) VWR-14, [testing.md](testing.md) §5.7 |
| Whether a CSS selector matches at run time | The audit reads two files as text; a rule whose tokens exist but never combine is not caught | [risks.md](risks.md) VWR-15 |
| A core process that outlives the service keeps the history store locked | The next run inherits the locked file, so one failure looks like a random one | [risks.md](risks.md) VWR-17 |
| Any language beyond the two the catalogue holds, and any text direction | The layout was designed and measured for English and Chinese widths only | [risks.md](risks.md) VWR-16 |
| `clearStored` has no caller in the page | The only route back to "follow the system" is unreachable from the interface, so a tested export is either a missing control or dead code | [risks.md](risks.md) VWR-09 |
| The bridge's restart policy is tested against a core that exits, not against one that hangs | A hang is bounded by the request timeout, not by the restart policy, and the push transport adds a second path into the same bridge | [risks.md](risks.md) VWR-03 |
| The tree's window cuts from the beginning, so the oldest branch root can be hidden | A person can see a subtree with no visible trunk and read two branches as two histories. Folding a branch, the way a file tree does, is the better answer and is not implemented | [risks.md](risks.md) VWR-18 |
| The full-width panel state combined with the tree is asserted by nothing | Each half is tested and their combination was only walked by hand, so a layout defect that appears only at that width would pass every gate | [risks.md](risks.md) VWR-19 |
| The two-finger gesture is driven by a synthetic pointer sequence | A real digitiser's rate, jitter, and a third finger or a palm are not reproduced, so the risk is in the sampling rather than in the decision | [risks.md](risks.md) VWR-20 |
| The archive manager's generation count is read by counting lines, with a size bound | A very large archive reports its generation count as unknown rather than as a wrong number, which is honest but not useful | [interfaces.md](interfaces.md) §2.6 |
| The `cells` payload has no bound on the API | A client that is not the page can ask for a response of hundreds of megabytes | [risks.md](risks.md) VWR-05 |
| The page's rule parser and the core's are two implementations of one grammar | A value one accepts and the other refuses shows up as a `bad_rule` refusal rather than as drift, and both sides of the grammar are asserted branch by branch — but the two are kept in step by tests rather than by one shared source | [risks.md](risks.md) VWR-29 |
| A rule the running core will not run can still be typed into the editor | `B0`-class rules are refused by the sparse and tiled representations by design, and the page cannot know which representation is running, so it shows the core's reason and changes nothing | [world/risks.md](../world/risks.md) WLD-13 |
| The rule controls have no keyboard shortcut of their own | They are reached with `Tab`, and the page's key handler deliberately ignores keys typed inside a field, so the editor cannot be reached without leaving the canvas | [interfaces.md](interfaces.md) §7 |
