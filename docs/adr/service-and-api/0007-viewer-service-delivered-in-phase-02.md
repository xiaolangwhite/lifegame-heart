# ADR 0007 — The viewer service is delivered in phase 02

## Status

Accepted (2026-10-10). Implemented by `src/viewer/` in the version that names
phase 02 milestone 00 in [../../plan/VERSIONS.md](../../plan/VERSIONS.md).

## Context

[ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §1.1 puts the HTTP surface and
web UI delivery in NodeJS, and the phase order in
[../../plan/ROADMAP.md](../../plan/ROADMAP.md) puts the service in phase 03,
after the simulation core.

The world was asked to be observable and editable while it runs — click a cell,
run, pause, step — as part of the first working milestone. That requirement
cannot be met inside the core alone: a Python process serving a line protocol has
no way to be clicked.

Two options were available. A Python-side desktop viewer would have been quicker
to write and would have introduced a UI outside the documented split, needing an
exception for a surface that phase 03 is going to replace anyway. A minimal
NodeJS service keeps the documented split and costs a service that phase 03 will
extend rather than discard.

## Decision

* The smallest conforming slice of phase 03 is delivered in phase 02: a NodeJS
  service that hosts a static page and proxies to the core, and a browser page
  that renders a viewport and sends commands.
* The service holds **no simulation logic**. It does not compute a generation,
  does not read the core's memory, and does not interpret a rule. It forwards
  requests and renders replies.
* The line protocol stays owned by the core module that defines it
  ([docs/model/world/interfaces.md](../../model/world/interfaces.md)); the
  viewer documents itself as a consumer and may not paraphrase the protocol into
  a second authority.
* Phase 03 keeps its remaining scope: streaming rather than polling, session
  orchestration, and any multi-client behaviour.

## Consequences

* The phase order in the roadmap becomes "phase 02 delivers the core and a
  minimal viewer", and phase 03 is described by what it still owns rather than
  by everything it once owned.
* Two modules exist where the phase plan expected one, so the phase carries two
  module contracts.
* The viewer can be replaced without touching the core, because the only thing
  it shares with the core is the line protocol.
* A reviewer can see the world working on the day the core lands, which is what
  makes the representation decision checkable by hand rather than only by a
  benchmark.

## Superseding

None.
