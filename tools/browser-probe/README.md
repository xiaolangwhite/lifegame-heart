# browser-probe - measure the viewer interface in a real browser

`browser-probe` starts the shipped viewer, drives a real Chromium-family browser against it
over the DevTools Protocol, reports what it measured as JSON and as text, stops everything it
started, and proves that nothing was left behind.

It is a tool. It is not imported by anything under `src/`, it is not on the product's start-up
path, and it needs no package from a registry.

## Why this exists

The viewer's automated tests run in Node against markup, a route table and stub modules. None of
them has a layout engine, a hit-test tree or a canvas. That is not a gap in their quality; it is
what they are. The consequence is that a whole class of defect is invisible to them, and this
interface has been reported blank **three times while every gate was green**.

The last incident is the reason this tool is a directory in the repository instead of a shell
history entry. Four real defects were found by driving Edge against the running service by hand
and reading numbers back out of the page:

| Defect | What only a browser could see |
|---|---|
| The preview painted black after a refresh | the canvas's own pixels, sampled through `getImageData` |
| A click on a generation did not select it | the event sequence a real press produces, and the `/api/select` request that never followed it |
| Hovering the newest row flickered | a press point that lands on the scrollbar band rather than the row |
| A white box was drawn over the head row's label | `elementFromPoint` at the label's own centre returning the overlay instead of the label |

The session that found them was scratch work under `TEMP/`, which this repository ignores. It was
unrepeatable by construction: the next person to suspect the interface would have had to write it
again. This tool is that session, kept: parameterised, self-checked, and honest about what it did
not measure.

## What it measures

| Probe | Reads | Fails when |
|---|---|---|
| `health` | the HTTP status, content type and body size of every routed page, plus one path no route claims | a routed page does not answer 200 with a non-empty HTML body, or an unknown path does not answer 404 |
| `geometry` | `getBoundingClientRect`, `scrollWidth`/`clientWidth`/`clientHeight`, `elementFromPoint`, `document.readyState`, the viewport size, uncaught page errors | a requested element has no match or a zero-sized box; a requested element is not the topmost at its own centre; a point hits nothing; the page did not complete, or threw |
| `interaction` | the real event sequence from `Input.dispatchMouseEvent`, and every `fetch`, `XMLHttpRequest` and `EventSource` the page issued | no press or no release reached the page; the pressed element is covered; a declared `--expect-request` never appeared |

The route list is not written down here. It is read from
[`src/viewer/routes.mjs`](../../src/viewer/routes.mjs), the service's own single route table, so the
probe cannot drift from the service. If that file cannot be read the probe falls back to a
built-in list and says so in a notice.

Only *declared* expectations can fail a run. Measurements that nobody asked about are reported and
carry no verdict, which is why an interaction probe with no `--expect-request` still shows you the
requests the page made.

## Requirements

* **Node 22 or newer** - the client speaks the DevTools Protocol over the `WebSocket` that Node
  ships. There is no npm dependency: `node --check` on this directory is the whole install step.
* **A Chromium-family browser** - Edge, Chrome, Chromium or Brave. It is looked for in this order:
  1. `--browser <path>`;
  2. `$LIFEGAME_BROWSER`;
  3. the usual names on `PATH`;
  4. the installation directories the operating system defines (`ProgramFiles`, `LOCALAPPDATA`,
     `/Applications`, `/usr/bin`).
  Nothing is hard-coded to one machine. When no browser is found the run stops with the two ways
  to name one, and exits 2.

## Layout

```
tools/browser-probe/
  README.md              this file
  run.ps1                the entry point: sources the environment, runs the Node tool, returns its code
  probe.mjs              the command line, the orchestration and the cleanup
  selftest.mjs           proves the instrument works, without this repository's service
  lib/
    errors.mjs           the one deliberate error type, and what it means for the exit code
    paths.mjs            where the tool may write: inside the repository, or nowhere
    service.mjs          start the viewer on a free port, or attach to one already running
    browser.mjs          find a browser, launch it headless, wait for its DevTools endpoint
    cdp.mjs              the DevTools Protocol client, over Node's own WebSocket
    page-agent.js        the recorder injected into the page before any page script
    agent.mjs            reads that file, and the page-side measurement function
    probes.mjs           the three probes
    report.mjs           the check model, the JSON report, the text report, the exit code
    procs.mjs            process attribution, tree termination, and the proof of no leftovers
    processes.ps1        one process snapshot as JSON, written to a file and not to a pipe
```

## Use

Every command begins the way this repository's tooling does:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location '<repo>'
. .\scripts\env.ps1
```

### The default run

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1
```

It starts the viewer on a free port with no history (so it cannot contend for the store an
operator is using), checks every routed page and one unknown path, loads the world page in
headless Edge, and presses and releases at the centre of the viewport. Real output, abridged to
the interesting lines:

```
service  http://127.0.0.1:55717 (started by this tool)
routes   /, /world, /history, /archives [src/viewer/routes.mjs]
browser  %ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe (Edg 155.0.4283.45, source: %ProgramFiles(x86)%)

HEALTH (5 checks)
  PASS  health.page:/                          200, 6968 bytes, text/html; charset=utf-8
  PASS  health.page:/history                   200, 6187 bytes, text/html; charset=utf-8
  PASS  health.unknown:/__browser-probe-unknown-route   status 404
GEOMETRY (2 checks)
  PASS  page.loaded                            readyState complete, viewport 1250x805, body children 6
  PASS  page.errors                            none
INTERACTION (1 check)
  PASS  interaction.press                      pointerdown 1, mousedown 1, pointerup 1, mouseup 1, click 1

CLEANUP
  attributed  5 process(es) to this run
  stopped     5
  left behind 0 (verified)
  profile     released and removed

RESULT  passed: 8 of 8 check(s) (exit 0)
```

### A targeted run

This is the shape that replaces a hand-driven session. It measures three named elements,
requires the theme button to be the topmost at its own centre, and requires a real press on the
step button to produce the API request the page is supposed to make:

```powershell
node tools/browser-probe/probe.mjs --route / `
    --select '#grid' --topmost '#grid' --topmost '#toggle-theme' `
    --container '#canvas-area' --click '#step-once' --expect-request /api/command
```

Abridged output:

```
GEOMETRY (6 checks)
  PASS  geometry.element:#grid            1 match(es), first 851.203125x630.25 at (8, 51.1875)
  PASS  geometry.topmost:#grid            centre (434, 366) hits canvas#grid
  PASS  geometry.topmost:#toggle-theme    centre (60, 757) hits button#toggle-theme
  PASS  geometry.container:#canvas-area   scrollWidth 851, clientWidth 851, clientHeight 630, scrollHeight 630
INTERACTION (3 checks)
  PASS  interaction.press                 pointerdown 1, mousedown 1, pointerup 1, mouseup 1, click 1
  PASS  interaction.topmost:#step-once    centre (107, 704) hits button#step-once
  PASS  interaction.request:/api/command  1 request(s), first POST /api/command
  REQUESTS
    during load (4)
      fetch       GET   200     /api/state
      eventsource GET   200     /api/events
      fetch       GET   200     /api/frame?x0=32761&y0=32763&w=14&h=11
      fetch       POST  200     /api/subscription
    caused by the press (1)
      fetch       POST  200     /api/command
```

The `interaction.request` check is how "the click did not select" becomes a red line: the press
happens, the page is silent, and the request that should have followed it is missing. Compare the
two lists above - what the page did while loading, and what the press caused.

### What a mismatch looks like

```
GEOMETRY (3 checks)
  FAIL  geometry.element:#not-a-real-element
          expected: at least one match with a non-zero, visible box
          actual:   no match
  PASS  page.loaded
  PASS  page.errors

RESULT  mismatch: 1 of 3 check(s) failed (exit 1)
  - geometry.element:#not-a-real-element
```

### Attaching to a service that is already running

```powershell
node tools/browser-probe/probe.mjs --service http://127.0.0.1:8765 --select '#grid'
```

Nothing is started and nothing is stopped, because the process is not this tool's to end. Real
input is **off** in this mode unless `--allow-input` is given: a genuine press on somebody's
running viewer can move their world, and a measurement must not have side effects the person
running that service did not ask for. The interaction probe reports itself as skipped rather than
passed.

### The self-test

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1 -SelfTest
```

It needs no viewer. It serves two pages of its own making and asserts against numbers written in
their own stylesheets:

* a **good page** whose box is at `left: 40px; top: 30px; width: 120px; height: 60px`, with a
  button that issues a request when a real press reaches it;
* a **covered page**, identical except that an opaque element is drawn exactly over that box.

The second page is the point. The instrument must report the covered box as a *failed* topmost
check and name the element that is on top, so the self-test proves the probe can see the defect
class it was built for, not merely that it can report success. Thirteen assertions, and it also
asserts the repository rule below: nothing under `src/` may mention this tool.

```
  PASS  geometry probe: the box is measured where the stylesheet puts it
  PASS  interaction probe: a real press, release and click reach the page
  PASS  interaction probe: the press is followed by the request the handler makes
  PASS  covered page: the topmost check fails and names the element on top
  PASS  repository rule: nothing under src/ mentions the probe

RESULT  self-test passed: 13 assertion(s) (exit 0)
```

## Exit codes

The same convention as [`scripts/verify.ps1`](../../scripts/verify.ps1):

| Code | Meaning |
|---|---|
| 0 | every check passed. Skipped checks do not fail a run, and the report says which were skipped |
| 1 | the tool ran, and at least one declared expectation did not hold |
| 2 | the tool could not run, or could not finish cleaning up after itself |

A run that could not happen is never reported as a pass. "Not run" and "no problem found" are
different statements, and the difference is the reason the third code exists.

## How it proves it cleaned up

This repository has already paid for this lesson: the viewer's Python core outlived the Node
service that started it, kept holding the history store, and could have become a second writer. A
probe that starts a service *and* a browser inherits that risk twice, so cleanup is measured
rather than asserted.

* **Graceful first.** The browser is asked to close over CDP (`Browser.close`) before anything is
  killed. This is not politeness: a Chromium browser runs some of its children with a restricted
  token, and such a child can survive `taskkill /T` and even report an empty command line to a
  scan. The first version of this tool leaked an Edge `ProfileImport` utility process exactly that
  way; the surviving profile directory is what exposed it.
* **Attributed twice.** Every process is attributed by the parent chain rooted at the pids this
  run started, *and* by a string only this run can contain - its own browser profile directory,
  its own log paths, its own port. Either attribution is enough to own it. This is the same
  technique [`scripts/viewer.ps1`](../../scripts/viewer.ps1) uses to recognise a world core.
* **A second look.** A process can be mid-exit, and a browser can spawn a child while its parent
  is being killed. Anything still attributable is killed again, and only what survives *that* is
  reported.
* **The profile directory is the last witness.** A surviving browser child holds files in it, so a
  profile directory that cannot be removed is evidence of exactly the process class that defeats
  command-line matching. A run that cannot release it exits 2 and says so.
* **An independent second opinion.** [`run.ps1`](run.ps1) records which world cores of this
  repository were running before the probe and which are running after it. A core that appeared
  during the run and is still there afterwards exits 2, even if the probe itself reported success.

## Boundaries

* **It is a tool, not a runtime dependency.** Nothing under `src/` imports it, the service does
  not require it, and the self-test fails if that ever changes. A probe on the product's start-up
  path would put a browser requirement in front of the simulation and add a second reason for the
  service to fail.
* **No browser means "not run", never "pass".** The default telemetry needs a browser, so a
  machine without one exits 2 with a message naming `--browser` and `LIFEGAME_BROWSER`. A run with
  `--mode health` deliberately needs no browser, and it says so in a notice: it measured the HTTP
  surface only, which is a smaller claim than the default run makes.
* **`report.json` is pure ASCII, and that is deliberate.** The measured page's own text can be
  non-ASCII - a title, an error message - and a reader that decodes the file with the machine's
  default code page would produce mojibake *inside a JSON string*, which is enough to make a
  strict parser reject the whole document. Every non-ASCII character is therefore escaped as
  `\uXXXX`, so `Get-Content -Raw report.json | ConvertFrom-Json` works from a default Windows
  PowerShell without an encoding argument. `report.txt` is UTF-8 without a byte-order mark, for
  people.
* **Nothing is written outside the repository.** The report directory and the history path are
  resolved and checked before anything is created; a path outside the tree is refused with exit 2
  and nothing is created. The default location is `TEMP\browser-probe\<stamp>`, which
  [`scripts/env.ps1`](../../scripts/env.ps1) has already pointed inside the tree, and the tool
  refuses to run at all when `TEMP` is unset rather than falling back to the system volume.
* **It never pipes to a child process.** Child output goes to log files and the process snapshot
  is written to a file. A restricted harness can refuse a pipe to a child, which would otherwise
  make the tool fail for a reason unrelated to the interface.
* **Input against a service the tool did not start is opt-in** (`--allow-input`), for the reason
  given above.
* **Windows is the verified platform.** It is the platform this repository runs on. The POSIX
  branch of the process layer is written - `ps` through a shell redirect, `SIGKILL` in place of
  `taskkill /T` - and it has not been run here, so treat it as unproven.
* **It is a measurement, not a gate.** Wiring it into `scripts/verify.ps1` is a separate decision
  with its own cost: it needs a browser, and a gate that needs a browser cannot run everywhere.
  This tool exists so that the measurement is *available* and repeatable.

## Known weak points

* **A locked profile directory is a deliberate false-alarm risk.** If another program (an
  antivirus scanner, a search indexer) holds a file in the profile directory for a moment, the
  removal fails and the run exits 2 even though no process survived. The trade is deliberate:
  a loud false alarm costs a re-run, and a silent orphan is the failure this repository has
  already paid for once.
* **One page per run.** `--route` selects a single page; measuring three routes means three runs,
  each with its own browser. The health probe covers every routed path in one run, so this only
  affects the geometry and interaction probes.
* **The tool cannot know what a click should do.** It records what the page did. Turning that into
  a verdict is the caller's job, through `--expect-request` and `--topmost`. An interaction probe
  with neither will pass while reporting a page that did nothing at all, and it will say so in the
  request list.
* **Attribution depends on the browser's command line.** A build that hides it could evade the
  marker match; the profile-directory check is the backstop, and it is the one that caught the
  original leak.
* **`--script` runs whatever the file says in the page.** It exists so a new question can be asked
  without changing the tool, and it is a body of trusted local code, not a sandbox.
