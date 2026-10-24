# viewer — performance

> This file owns the oracle, the measurement method, the measured costs and the
> explicit list of what has not been measured. Module-wide numbers, including
> the machine profile these were taken on, are owned by
> [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md).

## 1. Is there a performance contract?

Partly, and the module should say which part.

* **There is a contract on interactivity.** The page must stay usable: a click
  must produce a redraw, a run must not accumulate outstanding requests, and a
  frame must not take long enough to be felt. This is what §2 sets a floor on.
* **There is a contract on the transport's cost.** The service must not add a
  material fraction to what the core already spends. §3 defines the oracle for
  that, and §6 measures it.
* **There is no contract on throughput, memory or connection count.** The
  module serves one local client, writes no file of its own and buffers one
  response at a time. The history store is written by the core, one transaction
  per recorded generation, and its cost is the core's and is measured by the
  store module. Turning this into a multi-client service is phase 03's scope
  ([ADR 0007](../../adr/service-and-api/0007-viewer-service-delivered-in-phase-02.md)),
  and a throughput floor before that decision would be a number without a
  consumer.

The absence of a third contract is safe because of what the module does *not*
do: it never allocates a grid of its own (the page's `bits` path fills one
`ImageData` the size of the rectangle and nothing larger), never queues more
than one request, and never buffers a response it did not receive in full.

## 2. Admission floors

Measured on profile `M1`, warm, at the revision recorded in §6. A floor is a
gate, not a claim that the work is finished
([ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §4).

| Surface | Floor | Measured | Status |
|---|---|---|---|
| The module's suite, `node --test "src/viewer/tests/*.test.mjs"` | 15 s | 15.0 s wall for **337** cases (`duration_ms` 15032.9372 on the run recorded in [testing.md](testing.md) §5.1), against 13.4 s for 292 cases in the revision before this one, and up from 10.1 s for 255, 6.5 s for 221 and 4.4–4.8 s for 181 earlier. The 292-case increase was the history page becoming a workspace — the viewport suite gained the default-view and centring cases, the page suite gained the preview, the tree's connector geometry and dragging the tree, and the history suite doubled; the growth since is the rule editor's two suites plus one case another work item in this version added to the server suite, which is why the count is a reading of a revision rather than a constant | **At its floor, not under it.** Two consecutive runs of this revision read 15.037 s and 15.033 s against the 15 s above, so the suite has reached its own number rather than passing it with margin. The floor is this module's own and re-arguing it is recorded in §7 |
| A whole-world sparse frame, round trip through the service | 50 ms | 2–3 ms through a PowerShell client; 0.54–0.60 ms through the bridge | Validated for this revision |
| Requests in flight per page | exactly 1 | 1 by construction: a refresh that arrives while one is outstanding sets a flag and returns | Validated for this revision |
| Frames built per client per tick | at most 1 | 1 by construction: the hub holds one in-flight frame per client and coalesces the rest, so a 60-tick-per-second core cannot build 60 frames per second per client | Validated for this revision, by the hub case that holds a frame open while twelve changes arrive |
| Requests to the core caused by a theme or grid-width change | exactly 0 | 0 by construction: the change resolves in the page, reads the palette, and redraws the frame it already holds ([data-flow.md](data-flow.md) §3.6) | Validated by construction and by the page suite, which counts the scripted `fetch` calls |
| Frame paint | none yet | not measured; the synthetic canvas records calls and does not rasterise | Unvalidated |

The first three are gates the suite or the page would fail visibly. The fourth is
a structural claim with no browser behind it, and the fifth is listed so that it
is not mistaken for measured work.

### 2.1 Palette legibility

The two palettes were chosen against the WCAG contrast formula rather than by
eye, computed from the values in
[style.css](../../../src/viewer/public/style.css). Ratios are against the dead
cell colour for the canvas, and against the page background for the text.

| Theme | Live cell on dead cell | Grid line on dead cell | Text on background |
|---|---|---|---|
| dark (`--alive #7fd4ff`, `--dead #0b0d10`, `--grid rgba(255,255,255,0.14)`) | 11.83:1 | 1.45:1 | 15.55:1 |
| light (`--alive #1466a8`, `--dead #ffffff`, `--grid rgba(0,0,0,0.16)`) | 6.01:1 | 1.45:1 | 15.29:1 |

A live cell is far above the 3:1 that a non-text graphic needs in both themes,
which is what makes a single-cell dot visible on either background. The grid
line is deliberately low-contrast at 1.45:1 in both: it separates cells, and a
grid that competes with the cells it separates is worse than no grid. The 0.14
and 0.16 alphas are what put the two themes at the same ratio, so switching
themes changes the hue of the grid rather than its weight.

## 3. The oracle

The question this module has to answer is not "how fast is a frame" — that is
the core's answer, measured in [world/performance.md](../world/performance.md) —
but **"what does the viewer add to it"**. The oracle is therefore the same
command issued directly through [bridge.mjs](../../../src/viewer/bridge.mjs),
with no HTTP in between:

* **Bridge-direct** isolates the core's work plus the pipe and the JSON framing.
* **Service round trip** adds routing, the header work, the response and, in the
  measurement below, a PowerShell HTTP client rather than a browser.

The difference between the two is the transport's cost. It is an upper bound for
a browser, because the client measured here is not the client that ships.

For the page, the oracle for interactivity is the tick rate the page offers:
at 60 ticks per second a frame must complete in well under 16 ms for the view to
keep up, and §6 shows the whole-world frame completing two orders of magnitude
faster than that in the measured configuration.

## 4. Method

1. **Declare the profile.** `M1`
   ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1.1).
2. **Declare the lifecycle.** Warm: the core process is already started and has
   already served a request of the same shape; the service is already listening.
3. **Declare the unit.** Milliseconds per request, and bytes of payload. Frame
   rectangles are given as `w x h` with the live population they contained.
4. **Declare the workers.** One. The bridge serialises requests by design, so a
   concurrency figure would be meaningless.
5. **Declare included and excluded stages.** A bridge-direct figure includes the
   core's encoding, the pipe, the framing and the JSON parse. A service figure
   adds HTTP and the client. Neither includes browser decode or paint.
6. **Take the minimum of repeated cells**, and record the spread. A minimum is
   the right statistic for "what can this do when the machine is not busy"; the
   spread is recorded beside it so the margin is visible.
7. **Keep the losers.** §8 records the candidates that were tried or rejected,
   including the ones that lost.
8. **State the noise policy.** §5.

## 5. Noise policy

* The machine is shared with other work, so every cell is the minimum of at
  least three runs, and the individual runs are recorded where they vary by more
  than a factor of two.
* Client-side cost dominates the service figures, and the client is PowerShell's
  HTTP stack, not the browser. A service figure is therefore an upper bound and
  is labelled as one; it must not be compared against a browser measurement as
  if they were the same client.
* The 30-second gate of
  [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2 applies to
  the suite. Every command recorded here finished in under a second except the
  100,000-cell setup, which is a data-production step rather than a measurement.
* No figure here was produced with a profiler attached, and none is a
  distribution: these are interactive latencies, where the minimum is the
  meaningful end of the range.

## 6. Scale matrix, measured

Profile `M1`, warm, revision recorded in [testing.md](testing.md) §5.

| Cell | What | Population | Payload | Client | Time |
|---|---|---|---|---|---|
| C1 | The sixteen test files, all cases | — | — | `node --test` | 15.0 s (337 cases; 13.4 s for 292 in the previous revision) |
| C2 | `set` of 5,000 cells | 5,000 | 68,316 B request body | bridge-direct | 221 ms |
| C3 | The same `set` | 5,000 | 68,316 B | service, PowerShell client | 281 ms |
| C4 | `frame` of the whole world, `cells` | 9,096 | 72,768 B response | bridge-direct | 0.54–0.60 ms |
| C5 | The same frame | 9,096 | 72,768 B | service, PowerShell client | 2–3 ms |
| C6 | `frame` `1024 x 1024`, `cells` | 9,096 | 32,768 B | bridge-direct | 0.13–0.26 ms |
| C7 | `frame` `512 x 512`, `cells` | 9,096 | 40 B | service, PowerShell client | 1 ms |
| C8 | `frame` `64 x 64`, `bits` | 4,096 in the rectangle | 512 B | service, PowerShell client | 1 ms |
| C9 | `frame` `4097 x 4097`, `cells`, the admission boundary | 100,000 | 800,000 B | service, PowerShell client | 40 ms |
| C10 | `state` | 9,096 | small | bridge-direct | 0.11–0.21 ms |
| C11 | A language switch | — | — | page, synthetic browser | 0 network requests by construction: every string comes from the table already in memory, and the frame is not repainted because the world did not change |
| C12 | A theme or grid-width change | — | — | page, synthetic browser | 0 network requests by construction |
| C13 | `GET /api/history` | 20 generations | small | service, real store | 1 request, one indexed read per generation row; the **cost at thousands of generations is unmeasured** |
| C14 | `POST /api/rollback` | 20 generations | small | service, real store | one replay from the newest keyframe at or before the target; the **cost at a long chain is unmeasured** |
| C15 | `POST /api/archive` | 20 generations | a few KiB of JSON Lines | service, real store | one file write; the **cost at thousands of generations is unmeasured** |

What the rows say, and what they do not:

* **C4 and C5 are the module's central performance claim.** The whole
  `65536 x 65536` world — 4.29e9 cells — is viewable while it holds thousands of
  live cells, because the encoder's `cells` path costs eight bytes per live cell
  and never builds a grid. 72,768 bytes, well under a millisecond inside the
  bridge.
* **C8 is the other encoding.** A dense `64 x 64` rectangle takes the `bits`
  path and costs 512 bytes whatever the population: `ceil(64 / 8) * 64`.
* **C9 is the largest frame the module would ever allow near the boundary**, and
  it is the case that distinguishes the corrected admission rule from the
  superseded one ([implementation.md](implementation.md) §3.3). 800,000 bytes is
  `8 x 100,000`, and 40 ms is dominated by the payload rather than by routing.
* **C1 is a floor on the suite, not on the module.** Four of its cases are round
  trips through a real core process, one suite starts a real server and reads a
  real event stream, and one executes the page's own script against a synthetic
  browser. The pure-logic suites (theme, viewport, events) add about 1.2 s
  between them.
* **The event stream adds no measured cost of its own.** A pushed frame is the
  same `frame` request the REST route makes (C4–C6), issued by the hub instead of
  by a client, and the stream's overhead is one open response per subscriber. That
  is a structural claim: no measurement isolates the stream from the request it
  carries.
* These rows do **not** show a browser: no decode, no paint, no fetch. §7 lists
  what that leaves unmeasured, and the transport's share should be read from the
  C4/C5 pair only as an upper bound, for the reason in §5.

## 7. Not measured

* **Any browser-side cost**: `fetch`, base64 decode, `ImageData` fill, canvas
  paint, gesture handling. The page suite executes the paths and asserts what
  they asked the canvas to draw, and time is still not measured: a recorded call
  is not a rasterised one.
* **The cost of a representation switch**: the export payload, the process
  start-up and the import, at a population large enough for the payload to
  dominate. The suite switches a five-cell world. On millions of live cells this
  is the pause a person would notice, and its length is unknown
  ([risks.md](risks.md) VWR-13).
* **The stream's heartbeat**, whose 15-second interval no case waits out
  ([risks.md](risks.md) VWR-11), and **a client whose first frame never arrives**
  ([risks.md](risks.md) VWR-12).
* **The stream under sustained ticks at 60 per second**, which is the case
  coalescing exists for: the hub suite holds one frame open to prove the flag
  works, and the wall time of a minute of real ticks is not recorded.
* **The `bits` path at a scale where its allocation matters.** C8 is 64 x 64.
  The largest admissible `bits` rectangle is `MAX_FRAME_CELLS` cells, whose
  payload is 2 MiB and whose transient allocation inside the core is 16 MiB;
  that case has not been driven.
* **A page running on a second client.** Several subscribers share one world and
  one bridge, and the second client's cost against the first has not been
  recorded.
* **Cold start**: the time from `node src/viewer/server.mjs` to the first
  successful `/api/state`, which includes spawning the Python core. The suite
  starts servers, but does not record that interval as a measurement.
* **Relocated checkouts, other operating systems and other Node versions.**
* **Memory**: neither the service's nor the page's working set was recorded.
* **The cost of a theme change on the page**: the three `getComputedStyle` reads
  and the colour parsing are `O(1)` and happen once per change rather than once
  per frame ([implementation.md](implementation.md) §3.8), but the wall time has
  not been taken, because no browser runs in this environment.
* **The grid at its thickest setting on a large viewport**: `drawGrid` issues one
  path with a segment per column and per row; at four device pixels on a wide
  viewport that is more work than the three-pixel case, and no measurement
  separates them.
* **Whether the suite's own 15 s budget still fits the suite.** It was set when
  the suite was smaller, and §2 now measures the suite at that number rather than
  under it: 337 cases in 15.03 s. The budget is this module's own and is not a
  gate in `scripts/verify.ps1`, so nothing fails while it is exceeded; the question
  is whether the number should be raised, or the suite made cheaper — its two
  process-spawning suites, `bridge` and `server`, are what dominate, and no
  decomposition of the 15 s has been taken.

## 8. Candidates, and what happened to them

| Candidate | Status | Outcome |
|---|---|---|
| A: the `bits` decoder tests every bit | Rejected | A zero byte is skipped whole, so a sparse or empty bitmap costs one comparison per eight cells instead of one per cell. The condition is `byte === 0`, one branch, and the win is proportional to sparsity |
| B: `decodeBits` allocates a `width * height` grid for the `bits` path | Rejected for the page, kept as an export | The page fills its `ImageData` directly through `forEachLiveBit`; building a `Uint8Array` of the rectangle first would double the allocation for no benefit. The export stays for callers that want a grid |
| C: fetching a frame per animation frame | Rejected | It would issue requests faster than the core answers and make the load a function of the display's refresh rate rather than of the tick rate. The page polls at the tick rate and coalesces |
| D: allowing several requests in flight | Rejected | Replies could interleave at the core, a slow frame could be overtaken, and the core's concurrent work would no longer be bounded to one rectangle. The queue costs a promise chain |
| E: applying the admission rule with a fixed area cap | Rejected | It refuses the whole-world sparse view, which is the reason the sparse representation exists. The cap is the fallback for the dense path, not the rule |
| F: an unbounded restart policy | Rejected | A core that dies on start-up would be respawned once per poll, for ever. The counter and the limit are what make the failure visible instead |
| G: measuring the service with the browser as the client | Not available in this environment | The recorded service figures use PowerShell's HTTP client and are labelled as upper bounds. A browser measurement would need a browser-driving harness, which the phase does not have |
| H: resolving "follow the system" with a `prefers-color-scheme` media query in the stylesheet | Rejected | It duplicates the precedence rule and the light palette, and it still cannot serve the canvas, which has no access to CSS. The rule would exist twice and the canvas would need its own copy anyway |
| I: keeping the canvas colours as JavaScript constants beside the stylesheet | Rejected | Two definitions of one theme, and the copy the canvas paints with is the one nobody reads. This is not hypothetical here: the `bits` path kept a reference to a deleted colour constant and threw on every dense frame ([testing.md](testing.md) §7) |
| J: reading `getComputedStyle` per frame | Rejected | It puts a style recalculation in the render loop for a value that changes when a person clicks a button. The cache costs three reads per theme change and nothing per frame |
| K: snapping grid lines in CSS pixels | Rejected | At a fractional device pixel ratio the stroke covers a fraction of a device pixel on each side, and the rasteriser draws two grey rows where one line was intended. Snapping in device pixels is the whole point of the conversion |
| L: falling back to the smallest grid width when a stored value is not a number | Rejected | A corrupted value would become the thinnest, least visible line, and "no choice" and "bad choice" would look identical. The default is 2 px and it is not the minimum |
| M: painting a default colour when a palette value cannot be parsed | Rejected | It converts a stylesheet defect into an unreadable canvas. Keeping the previous colour leaves the page legible and the defect visible |
| N: storing the resolved theme rather than the explicit choice | Rejected | The first start-up would freeze the operating system's answer, and a later change of system preference would be ignored for ever |
| O: a WebSocket instead of Server-Sent Events | Rejected | The channel is one-way: the stream carries frames and ticks, and a gesture is a small POST. A WebSocket would add a handshake, its own framing, a reconnect protocol and a second authentication surface to carry data that only travels in one direction |
| P: queueing a frame per change for a slow subscriber | Rejected | The queue would grow at the tick rate and its length would become the lag, against a bridge that issues one request at a time. Coalescing keeps one frame in flight and discards the intermediate ones, which are frames nobody will ever see |
| Q: reconnecting the stream on every viewport change | Rejected | Server-Sent Events are one-way, so the alternative to a POST is a new connection. A wheel gesture produces several events per second, and each reconnect would pay a connection and a `hello` |
| R: driving the page with a real headless browser | Not available in this environment, and rejected on cost | It is the thorough answer and it costs a dependency, a browser download and a second runtime to keep in step, in a module whose value includes having no dependency. The synthetic browser covers the wiring and not the rasteriser, which is recorded as `VWR-10` rather than presented as covered |
| S: letting the service hold the last frame so a new subscriber is answered without asking the core | Rejected | It would make the service hold world state, which is the one thing it must not do, and a cached frame is indistinguishable from a fresh one to the client that receives it |
