# world — responsibilities

> This file owns the claims the `world` module makes, the boundary against every
> peer it touches, the behaviour required when it fails, and the things it must
> never do. The mechanism is owned by [interfaces.md](interfaces.md) and
> [implementation.md](implementation.md); the failure modes' evidence is owned by
> [testing.md](testing.md).

## 1. Claims this module owns

| Id | Claim | Where it is decided |
|---|---|---|
| W1 | A bounded life world of the design target, 65536 x 65536, can be constructed, and its memory is proportional to the live population rather than to the world's area. | [sparse.py](../../../src/lifegame/world/sparse.py) and [tiled.py](../../../src/lifegame/world/tiled.py) constructors; B1 in [acceptance.md](../../plan/phase-02-simulation-core/acceptance.md) |
| W2 | The rule is applied identically by three independently written representations, cell for cell, on randomised states and several world sizes, including states that straddle tile seams. The claim is made for the fourteen rules the equivalence suite names, and for a world that **switches** to a rule against one built with it. | [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py); B2 |
| W3 | The world is bounded: a cell outside the bounds is permanently dead and contributes no neighbours, in all three representations. | [ADR 0008](../../adr/simulation-core/0008-the-world-is-bounded-and-does-not-wrap.md); [test_patterns.py](../../../tests/world/test_patterns.py); B3 |
| W4 | Published Life behaviours hold: a block is a still life, a blinker has period two, a glider returns after four generations displaced by one cell diagonally. | [test_patterns.py](../../../tests/world/test_patterns.py); B3 |
| W5 | All three representations expose one public surface, so a caller may hold any of them without knowing which. | [test_world_contract.py](../../../tests/world/test_world_contract.py) |
| W6 | Rule objects are immutable values with a `B<digits>/S<digits>` notation, an inverse `parse`, a nine-entry decision table and a packed mask for each set, validated against the eight-cell Moore neighbourhood. | [rules.py](../../../src/lifegame/world/rules.py) |
| W7 | The line protocol is defined here, serves every documented command, reports every documented error code, ends cleanly on `quit` or on end of input, and answers identically under either selectable representation. | [bridge.py](../../../src/lifegame/world/bridge.py); B4 |
| W8 | A single malformed request never ends the process and never leaves a request unanswered. | [bridge.py](../../../src/lifegame/world/bridge.py) dispatch; [test_bridge.py](../../../tests/world/test_bridge.py) |
| W9 | The frontier between the representations is measured over more than one population shape, and the measurement states its profile, its lifecycle and its noise policy. | [performance.md](performance.md); B6 |
| W10 | A performance gap the module cannot close is named, assigned to an owning version and left visible rather than argued away. | [ADR 0009](../../adr/simulation-core/0009-sort-based-sparse-does-not-scale-to-the-target.md); [risks.md](risks.md) WLD-01 |
| W11 | The tiled world's step cost is proportional to the number of **active tiles** and not to the number of live cells: one word operation carries 64 cells, and a birth appears only in a tile adjacent to a live cell. | [tiled.py](../../../src/lifegame/world/tiled.py) active set and step; [performance.md](performance.md) §5 |
| W12 | `step` reports the number of changed **cells**, and all three representations report the same number for the same transition. | `assert_same_change_count` in [test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py) |
| W13 | A world whose size is not a multiple of the tile size keeps every cell inside its own bounds; the padding of a partial tile is never live. | [test_tiled.py](../../../tests/world/test_tiled.py) |
| W14 | `advance` names **which** cells were born and which died, and all three representations agree on those sets as well as on the count. Naming them costs a comparison of two masks rather than a rescan, and a caller that does not want them pays nothing. | [change.py](../../../src/lifegame/world/change.py); the born/died assertions in [test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py); B4 |
| W15 | `restore` replaces the live set **and** sets the generation counter, so a saved generation cannot be restored under the wrong label. | [sparse.py](../../../src/lifegame/world/sparse.py), [tiled.py](../../../src/lifegame/world/tiled.py), [dense.py](../../../src/lifegame/world/dense.py); [test_world_contract.py](../../../tests/world/test_world_contract.py) |
| W16 | `export` returns the whole live set as coordinates and `import` replaces the world from one, so a world moves between processes and between representations without loss. | [bridge.py](../../../src/lifegame/world/bridge.py); [test_bridge.py](../../../tests/world/test_bridge.py); B4 |
| W17 | The rule can be replaced at any time with `set_rule`, or over the protocol, without touching the cells or the generation counter; the decision tables and the compiled plan are rebuilt rather than patched, so a step after a switch cannot read the previous rule's decision. | the three representations' `set_rule`; [bridge.py](../../../src/lifegame/world/bridge.py); `test_a_rule_switch_reaches_the_state_a_fresh_world_reaches` in [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py) |
| W18 | A rule the two locality-based representations cannot run — one whose birth set contains zero — is **refused** with a reason rather than answered with the cells they happened to look at. The dense oracle runs it. | [rules.py](../../../src/lifegame/world/rules.py) `require_local_birth`; [interfaces.md](interfaces.md) §3.1; `test_a_rule_that_cannot_be_local_is_refused_rather_than_answered` in [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py); WLD-13 in [risks.md](risks.md) |

W10 is a claim about the record rather than about the code, and it is the reason
[performance.md](performance.md) §6 exists.

W12 exists because the claim was false once. The tiled world stores one 64-cell
word per array element, so a change count taken over elements rather than over
bits reported "three" where four cells had changed. The state was always right;
only the number the API returned was wrong, which is why the change count is now
part of the shared contract and not a detail of one implementation. W14 is the
same claim one level down: a count can be right while the cells it counts are
wrong, so the sets are compared too.

W15 exists because the world's older `load` could not express it. Loading a saved
pattern into a world left the generation counter wherever it was, so a restored
generation 400 in a world sitting at 7 would report 7 — silently, and with the
next recorded delta claiming the wrong parent. The claim is not that `load` was
wrong; it is that a state has two halves and only one of them could be set.

W16 is what makes the representation choice reversible. Without it, a world
recorded under one representation could not be moved to the other, and the
measurement that says each representation wins on a different shape would be
advice a user could not act on.

W17 is what makes the rule a setting rather than a property of the world. It is
the claim the interface depends on: a rule can be changed while the world runs,
and nothing about the world's contents or its generation moves when it is. W18 is
the boundary of that claim, and it is deliberately a refusal rather than a
best-effort answer — the defect §6.5 of [testing.md](testing.md) records is that
the best-effort answer existed and was silently wrong.

## 2. Boundary against each peer

### 2.1 The viewer module — the protocol is ours, the picture is theirs

| Aspect | `world` owns | `viewer` owns |
|---|---|---|
| The command set, its arguments, its replies, its events, its error codes and its exit codes | yes | no |
| The frame encodings and the rule that chooses between them | yes | no |
| Rendering, zoom, pan, click handling, the browser page and its transport | no | yes |
| Deciding when to step | only when asked, by `step` or by the `run` timer | when to ask |

The service never advances a generation itself and never reads the core's
memory; it sends requests and renders what comes back. A malformed request is
answered with an error object, not with a crash, so a service bug cannot take
the core down.

### 2.2 The environment module — we consume locations, we define none

The world module writes no file, reads no configuration file and creates no
directory. It inherits the interpreter, the virtual environment and the
temporary locations the environment module defines, and it has no opinion about
them. A tool that needed a new location would extend that module, not this one.

### 2.3 The documentation module — it checks us, it does not define us

The contract in these nine files is checked by
[tools/documentation/validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1).
That tool owns the check codes; this module owns the claims the codes are
applied to. A check failure is a defect in this directory, not a reason to
change a check.

### 2.4 numpy — a substrate, not a wrapper

Every array in all three representations is a numpy array. The measured steps
are built on `numpy.unique` and `numpy.searchsorted` for the sparse world, on
shifted slices for the dense world, and on a bit-parallel adder tree for the
tiled world
([ADR 0006](../../adr/simulation-core/0006-numpy-is-the-vectorised-substrate.md)).
The module does **not** wrap numpy's behaviour: an invalid argument that numpy
rejects is not translated into a world-specific error, and at the protocol edge
it is classified `internal`. The one deliberate exception is
`OutOfBoundsError`, which is raised before numpy is reached.

### 2.5 The rule object, the error type and the change record — internal, and all that is shared

These three are components of this module
([internal-components.md](internal-components.md)), not peer modules. They are the
only things the three representations share below their public surface, which is
what makes the oracle test evidence about the representations rather than about a
shared bug. The representations do not share a step, a storage layout or a
coordinate encoding, and [internal-components.md](internal-components.md) §2
records that there is no edge between them.

Each of the three is a vocabulary rather than an algorithm: a rule, an exception,
and a dataclass holding coordinates. That distinction is the reason sharing them
is safe. Two implementations that share a vocabulary can still disagree — and
that disagreement is what the oracle test looks for. Two implementations that
shared a step could not disagree, and the test would then be measuring nothing.

The rule component carries one thing that is closer to policy than to vocabulary:
`require_local_birth`, the refusal of a rule whose birth set contains zero. It
lives beside the rule rather than in either representation because it is a
statement about rules, and both locality-based representations must make exactly
the same one ([interfaces.md](interfaces.md) §3.1, W18). The tiled world's
*compiler* is not shared: it lives in
[tiled.py](../../../src/lifegame/world/tiled.py) and the other two representations
do not know it exists, which is what keeps the oracle independent of the step it
checks.

### 2.6 The store module — a consumer that reads through our contract

The [store](../store/overview.md) module records a world generation by
generation and restores it. It consumes exactly two things from here:

| What it takes | Why it exists | Contract |
|---|---|---|
| `advance()` and the `Change` it returns | A generation is stored as the cells that changed, so the history needs to know which cells were born and which died | W14 |
| `restore(cells, generation)` | A recorded generation has cells and a counter, and both must come back together | W15 |

It also reads `width`, `height`, `rule.notation`, `population`, `generation` and
`live_cells_in()` off the world it is handed. **It does not import this module**;
the coupling is a shape, and the store documents it as such
([store/responsibilities.md](../store/responsibilities.md) §2.1).

Which rule generated a recorded generation is a question the store has to answer
for a session whose rule changed mid-run. That is the store's own work in this
version and it is carried by another work item; nothing about it is concluded
here.

The two directions are not symmetric, and saying only one of them would now be
false:

* **The world does not know the store exists.** No representation, and not the
  change record, names the store, imports it, or holds a session. A world is
  stepped and restored; where the result is written is not its business.
* **The protocol does, in one narrow way.** `Bridge` accepts a session as an
  argument and calls `record`, `amend_head`, `set_rule`, `nodes`, `head`, `id`,
  `node_at_generation`, `checkout`, `rollback`, `archive` and `open_archive` on
  it, and asks an archive it has opened for `info`, `latest` and `state_at` —
  which is how `history`, `select`, `rollback`, `archive` and `open` work. It
  never names the session's type and it does not import the store: the import
  lives in the console entry point, because the store already imports this
  module and a module-scope import here would be a cycle. The prohibition is
  written into [internal-components.md](internal-components.md) §1.1.

So there are two boundaries to keep, not one: the shape between the world and
the store, and the injection between the protocol and the store. The first is a
promise about three names; the second is a promise about the session surface
above, and only the protocol's own tests check it ([risks.md](risks.md) WLD-11).

The boundary that matters for both is that a change to `advance`, to `Change`, or
to `restore` is a change to what the store can promise. Removing or renaming a
field of `Change` would break the history layer without touching a line of its
code, so those three are in the compatibility policy in
[interfaces.md](interfaces.md) §8 rather than being treated as internal detail.

There is a third consumer, and it is a test rather than a module: `export` and
`import` exist so that a world recorded under one representation can be moved to
the other, which is what makes the measured representation choice actionable
(W16) and what the viewer's representation switch is built on.

## 3. Required behaviour when it fails

### 3.1 Out-of-bounds

A coordinate or a rectangle outside `0 <= x < width` and `0 <= y < height`
raises `OutOfBoundsError`, from all three representations, named identically. It
derives from `ValueError` so a caller that only cares that the argument was
wrong can catch the built-in type.

A cell inside a **partial tile** is inside the world's array but outside its
bounds, and it must never become live. It is not an error — the padding simply
does not exist as far as a caller is concerned — and
[test_tiled.py](../../../tests/world/test_tiled.py) is what holds the line.

### 3.2 Invalid construction or argument

| Condition | Behaviour |
|---|---|
| Sparse width or height outside `1..2^32 - 1` | `ValueError` naming the permitted range |
| Tiled width or height outside `1..2^32 - 1` | `ValueError` naming the permitted range, as the sparse world does |
| Dense width or height not positive | `ValueError` naming the area |
| Dense area above `MAX_DENSE_CELLS` | `ValueError` naming the limit and pointing at `SparseWorld` |
| A rule count outside `0..8` | `ValueError` naming the offending count |
| A rule the sparse or the tiled world cannot run — its birth set contains zero | `ValueError` naming the rule, the reason and the representation that can run it, from the constructor and from `set_rule`; the dense world accepts it (W18) |
| A negative step count | `ValueError` containing `negative` |
| A viewport, or a frame rectangle, of non-positive area | `ValueError` containing `positive area` |
| A protocol argument of the wrong type | the `bad_arguments` error object |

### 3.3 Degenerate but valid states

| State | Behaviour |
|---|---|
| An empty world | `step()` returns `0`, the generation still advances, the population stays zero, `bounds()` returns `None` |
| No live cell has a neighbour inside the world | the sparse step takes its fast path: every live cell has zero neighbours and dies, which is exactly `population` changes |
| A live-cell query inside the bounds but off the live set | `is_alive` returns `False`; `live_cells_in` returns an empty `(0, 2)` array, never `None` |
| A frame of an empty rectangle | `format` is `cells` and `data` is the empty string |

### 3.4 Protocol-level failure

| Condition | Behaviour |
|---|---|
| A line that is not valid JSON | `bad_request`; the process continues |
| A JSON value that is not an object | `bad_arguments`; the process continues |
| A command not in the protocol | `unknown_command`; the process continues |
| A missing or wrongly typed argument | `bad_arguments`; the process continues |
| A rule the core will not run, from `set_rule` | `bad_rule` carrying the reason; the process continues and the running rule is unchanged |
| An out-of-bounds coordinate or rectangle | `out_of_bounds`; the process continues |
| Any other exception while handling one request | `internal` carrying the exception type and message; the process continues |
| End of input | the process exits `0` |
| `quit` | the reply is sent, then the process exits `0` |
| An unrecoverable write error | the process ends; there is no channel left to report on |

The last row is deliberate and is stated in
[bridge.py](../../../src/lifegame/world/bridge.py) as "until `quit`, end of
input, or an unrecoverable write error". A broken stdout cannot be reported to
stdout.

### 3.5 What failure must not do

* It must not leave a request unanswered. Every request that carries an `id`
  gets exactly one reply carrying the same `id`, including error replies.
* It must not silently change state. A refused operation leaves the world
  exactly as it was; `set_alive` and `toggle` report whether they changed
  anything, and the protocol's `changed` counts come from those reports.
* It must not turn a client error into a process exit. Only `quit`, end of
  input and an unrecoverable write error end the process.

## 4. What the module must never do

Even though it technically could:

* It must never compute a generation in the service, or accept a world state
  from it and treat it as authoritative. The core is the authority for the
  world.
* It must never make the boundary condition configurable per instance in a way
  that lets the representations disagree. The oracle test is only evidence
  while all three agree ([ADR 0008](../../adr/simulation-core/0008-the-world-is-bounded-and-does-not-wrap.md)).
* It must never report a change count taken over storage elements rather than
  over cells. The tiled world stores 64 cells per array element, so an element
  count reports three where four cells changed; W12 makes the count part of the
  shared contract for exactly this reason.
* It must never return a change record whose count and whose cells disagree, and
  it must never let one representation name different cells than another for the
  same transition. A count is a summary of the two sets, so a caller holding the
  sets can check it, and W14 is the claim that the sets agree.
* It must never leave the generation counter describing a different generation
  than the cells do. A state has two halves, `restore` sets both, and a world
  whose halves disagree will mislabel the next recorded delta (W15).
* It must never export a bitmap. An export describes the world's **contents**,
  and a bitmap describes the area a caller happened to ask for, so an export is
  always a coordinate list (W16).
* It must never present the dense representation as shippable at the target
  scale. It exists to be an oracle and a baseline.
* It must never claim or imply that one representation is faster than another
  without the shape of the population beside the number. The measurement says
  the winner depends on it: clustered, the tiled world is an order of magnitude
  ahead; scattered, the sparse world is. A number quoted without its shape is a
  claim the record does not support.
* It must never choose a representation silently. The choice is an explicit
  argument with a documented default, so a slow run can be explained
  ([risks.md](risks.md) WLD-09).
* It must never report a measurement taken while the population was drifting.
  The harness asserts stability, and a drifting world must fail the measurement
  rather than be reported.
* It must never report a single timing as a measurement without its profile,
  lifecycle and noise policy ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §3).
* It must never accept a rule it cannot run and answer anyway. A birth on a count
  of zero depends on the world's area, which the sparse and tiled candidate sets
  never visit, so the answer they can produce is a plausible subset of the correct
  one — measured at 39 cells against a correct 63. A rule outside what a
  representation computes is refused, with the reason, every time (W18).
* It must never rebuild a rule's tables or plan in place. A switch either replaces
  every derived value at once or changes nothing, because a step that read a
  decision left over from the previous rule would be wrong in a way no state
  comparison around it could see (W17).
* It must never report the rule it was asked for as the rule it is running. The
  core normalises, so `set_rule` answers with, and `state` keeps reporting, the
  notation the core actually took (W17).
* It must never persist anything, or grow a hidden file format. Persistence is
  the [store](../store/overview.md) module, which reads this one through
  `advance` and writes into it through `restore`; a save format inside the world
  module would be a second compatibility contract owned by the wrong module.
* It must never swallow a numpy error and continue with a corrupt array. Either
  the operation is valid, or it raises.
* It must never decide version state. It links to
  [VERSIONS.md](../../plan/VERSIONS.md).
