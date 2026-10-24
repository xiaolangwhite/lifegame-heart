# phase-03-service-and-ui — tasks

> **Authority.** This file owns the work breakdown. A task is not a promise: it
> is a unit small enough to be reviewed, and the milestone it belongs to is named
> in [milestones.md](milestones.md).

## M00 — localisation, one source per value, and a history timeline

| Id | Task | Depends on |
|---|---|---|
| T45 | Advertise the enforced limits in the handshake: tick-rate bounds, step limit, coordinate limit, storage choices, and whether a history is recording | — |
| T46 | Let the core record its own history: a store path on the command line, per-generation recording, and the history, rollback and archive commands | T45 |
| T47 | Keep the recorded chain replayable after an edit: a mutation re-keyframes its own generation, because the world it produced was not produced by a step | T46 |
| T48 | One message catalogue for Chinese and English, with a language control, persistence and a system-language fallback | — |
| T49 | Move every user-visible string into the catalogue, including titles, accessible names and units | T48 |
| T50 | Give localised labels to the protocol's error codes, and pass the core's own message through as detail | T48 |
| T51 | Collapse the frame budget and its admission rule into one module that the service and the page both import | — |
| T52 | Replace every copied limit with the value from the handshake | T45, T51 |
| T53 | One layout rule for every control group, one appearance rule for every select, and an audit that no rule is unreachable | — |
| T54 | A timeline panel: generation list, current marker, click to roll back, step back and forward, write an archive | T46 |
| T55 | Service routes for the timeline, and a history enabled by default with a path inside the repository | T46, T54 |

## M02 — the interface as routed pages

| Id | Task | Depends on |
|---|---|---|
| T63 | One route table, and a service that composes a shared layout with a per-route body and a per-route module | — |
| T64 | Stop the page modules importing the shell: the shell announces its context as an event and a page asks for it, so both load orders work and neither depends on a module singleton | T63 |
| T65 | Make the synthetic document honest — an undeclared id returns null rather than being invented — and assert both directions between each page's markup and its script | T63 |
| T66 | Strengthen the style audit to require a class in a class-bearing position, and separately that a `data-panel` rule names a class the stage element bears | — |
| T67 | Draw the history as nodes whose detail is revealed on hover or on focus, with indentation that changes only at a real fork | T63 |
| T68 | Delete `public/index.html` once the routes serve every page | T63 |

## M03 — multi-session service and a pattern library

| Id | Task | Depends on |
|---|---|---|
| T56 | More than one session per service, each with its own core and history | T55 |
| T57 | A pattern file format, and the classic still lifes, oscillators, ships and one gun as data | — |
| T58 | Place a named pattern from the interface | T57 |
| T59 | Continue one recorded session across a representation switch instead of starting a new one | T55 |

## M04 — the UI a second person can use

| Id | Task | Depends on |
|---|---|---|
| T60 | Undo of the last edit, distinct from a rollback | T55 |
| T61 | Name what each control does, and surface the keyboard shortcuts | T54 |
| T62 | Save and load a world from the interface | T55 |
