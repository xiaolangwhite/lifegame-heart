# world — testing

> This file owns what the module tests, how to run it, which failure modes are
> covered, and the exact commands that produced the last recorded results.
> Performance measurement is owned by [performance.md](performance.md); the
> claims under test are owned by [responsibilities.md](responsibilities.md).

## 1. What is tested

| Test file | Subject | Items |
|---|---|---|
| [test_rules.py](../../../tests/world/test_rules.py) | The rule object: the text form and its inverse, digit ordering, validation, the packed masks and decision tables, the transition it defines, immutability, and the locality policy its callers enforce | 26 |
| [test_world_contract.py](../../../tests/world/test_world_contract.py) | The shared contract, parameterised over **all three** representations | 70 |
| [test_patterns.py](../../../tests/world/test_patterns.py) | Published Life behaviours and the boundary condition, over all three representations | 18 |
| [test_tiled.py](../../../tests/world/test_tiled.py) | What the tiled representation promises beyond the shared contract: tile granularity, seam births, reclamation, partial tiles, row layout | 13 |
| [test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py) | All three against each other on randomised states, viewports, reported change counts, and the cells each `advance` names as born or dying | 46 |
| [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py) | Every shipped rule against the dense oracle: the live set, the population, the bounds and the reported change count; the born and died sets; a state that straddles a tile seam; a world that **switches** to a rule against one built with it; four switches in one world; the edge rules; the refusal of a rule that cannot be local; and the compiled plan's size | 149 |
| [test_bridge.py](../../../tests/world/test_bridge.py) | The line protocol, against a real child process, under both selectable representations, including the whole-world `export` and `import` payloads, the `set_rule` exchange, and the atomic `patch` with its refusals and its single recorded edit | 64 |
| [test_benchmark.py](../../../tests/world/test_benchmark.py) | The measurement harness over two population shapes and, since the rule became a variable, over several rules; excluded from the default run | 3, deselected |

That is **386 items for this module**, plus the three deselected benchmark
cases. That total was counted rather than quoted: `uv run pytest --collect-only -q
tests/world` reports `386/389 tests collected (3 deselected)`, and the per-file
figures above are that collection grouped by file. The previously recorded run of
this module collected 177, which is the figure the block in §5 belongs to; the
counts above are the ones this revision collects, and the run that passed them is
recorded in [dev-log/](../../../dev-log/). The full default suite's total
additionally collects the [store](../store/testing.md) and
[environment](../environment/testing.md) modules, whose counts those modules own.
A claim about this module must use the 386.

## 2. How to run it

```powershell
uv run pytest -q                                     # everything, benchmarks excluded
uv run pytest -q tests/world                         # this module only
uv run pytest -q tests/world/test_oracle_equivalence.py
uv run pytest -q tests/world/test_rule_equivalence.py         # every rule against the oracle
uv run pytest -m benchmark -s tests/world/test_benchmark.py   # the frontier measurement
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1   # every gate, one command
```

The benchmark marker is declared in
[pyproject.toml](../../../pyproject.toml) and excluded by the default `addopts`,
because it measures rather than asserts and takes seconds.

## 3. Fixture layout

There are no fixture files. Everything the tests need is either constructed in
the test or spawned as a process:

| Fixture | Scope | What it provides |
|---|---|---|
| `make`, in [test_world_contract.py](../../../tests/world/test_world_contract.py) | function, parameterised `sparse` / `dense` / `tiled` | The class under test. All three representations run every case in the file, which is what makes it a *contract* test rather than three test suites |
| `make`, in [test_patterns.py](../../../tests/world/test_patterns.py) | function, parameterised `sparse` / `dense` / `tiled` | The same idea for the named patterns |
| `build_all`, in [test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py) | per test | All three representations over one size, so a case compares them against each other rather than against a stored expectation |
| `RULES`, in [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py) | module | The **fourteen** rules the equivalence claim is made for. They are chosen so the compiled network is stressed differently by each: a set that spans every count group, a set with no survival, a set with no birth, a rule whose two sets are equal, and the rules that sit on the count-of-eight edge |
| `bridge`, in [test_bridge.py](../../../tests/world/test_bridge.py) | module | A real `python -m lifegame.world` child process on pipes, killed in teardown |
| In-code constants | — | `BLOCK`, `BLINKER_HORIZONTAL`, `BLINKER_VERTICAL`, `GLIDER`; `SIZES` and `SEEDS` for the randomised cases; `LATTICE_LADDER` and `SCATTER_LADDER` for the measurement; `TILE_BITS` and `TILE_CELLS` for the tile geometry |

The bridge fixture is the only one with an external dependency, and it is the
reason the protocol tests can claim to exercise what the service does: they
speak one JSON object per line to a child process, not to a mock.

## 4. Failure modes covered

| Failure mode | Where it is covered | Phase criterion |
|---|---|---|
| The three representations drift apart on a rule change | [test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py): five seeds over five world sizes — including `64 x 64` and `65 x 63`, which straddle a tile boundary — plus a 42 percent density cloud, plus a cloud deliberately concentrated along the tile seams, plus viewport comparison | B2 |
| Two representations agreeing on **state** while disagreeing on what `step` reports | `assert_same_change_count` in [test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py): all three step counts must be equal, generation for generation. This is the check the change-count defect slipped past state comparison for | B2 |
| Two representations agreeing on the count while disagreeing on **which** cells changed | The same file compares the `born` and `died` sets each representation's `advance` returns, and checks that the two together explain both the population change and the reported count. A delta that named the wrong cells would pass a count-only check | B2 |
| A whole-world payload that does not survive a round trip | [test_bridge.py](../../../tests/world/test_bridge.py): `export`, then `import` into a fresh core, must restore every cell and the generation counter | B4 |
| A malformed export payload truncated instead of refused | [test_bridge.py](../../../tests/world/test_bridge.py): a payload whose length is not a multiple of eight is refused, because a truncated coordinate places a cell somewhere it never was | B4 |
| A birth that crosses a tile seam, or a diagonal seam, where a bit-parallel step goes wrong | [test_tiled.py](../../../tests/world/test_tiled.py): a vertical three-cell line in the last column of one tile must bring the first column of the next to life, and three cells in three tiles must bring the fourth tile's corner to life | B2 |
| A tile that dies and is not reclaimed | [test_tiled.py](../../../tests/world/test_tiled.py): a lone cell leaves one tile, the step kills it, and the tile must be gone | B3 |
| A world whose size is not a multiple of the tile size letting a padding cell become live | [test_tiled.py](../../../tests/world/test_tiled.py): `TiledWorld(70, 65)` and `TiledWorld(65, 65)` step repeatedly and must keep every cell inside the world; the padding of a partial tile is never a cell | B3; claim W13 in [responsibilities.md](responsibilities.md) §1 |
| The two selectable representations answering the protocol differently | [test_bridge.py](../../../tests/world/test_bridge.py): the same glider in a 64 x 64 world, stepped four generations under `sparse` and under `tiled`, must report the same bounds, and a `patch` at that generation must apply the same born and died cells in both | B4 |
| A representation whose rows are not laid out as documented | [test_tiled.py](../../../tests/world/test_tiled.py): the stored words are read directly and must be `uint64`, one per row, with bit *c* of row *r* being cell column *c* | B1 |
| A wrong boundary condition (wrapping where it should not) | [test_patterns.py](../../../tests/world/test_patterns.py): a blinker at the top edge and at the left edge, each asserting that the cell which would have been outside is absent **and** that it does not reappear on the opposite edge | B3 |
| A subtly wrong rule that random states cannot see | [test_patterns.py](../../../tests/world/test_patterns.py): a block is a still life, a blinker has period two, a glider returns displaced by one cell diagonally after four generations | B3 |
| A compiled plan that fires on the wrong neighbour count, or that lets a count of eight past its guard | [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py): each of the fourteen rules is stepped four to six generations in all three representations and the live sets compared cell for cell against the dense oracle, on a 70 x 70 world that crosses a tile seam on both axes and leaves a partial tile at each edge. Two rules that random states cannot exercise are named directly instead: HighLife's birth on six must happen where Conway's does not, and the count-of-eight cases are `B/S012345678`, `B3/S012345678` and `B8/S0` | B2 |
| A rule switch that reuses the previous rule's decision table or compiled plan | [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py): a world is stepped under Conway, switched, and stepped again; it must reach the state a world **built** with the new rule reaches from the same midpoint, in all three representations, and a second case judges the switch against the oracle rather than against another sparse world. `test_a_rule_may_be_switched_more_than_once` repeats it four times in one world | B2 |
| A rule that cannot be local being answered instead of refused | [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py) `test_a_rule_that_cannot_be_local_is_refused_rather_than_answered`: both locality-based representations must raise `ValueError` from the constructor with a message naming the reason, and the dense oracle must still run the rule and change a cell. This is the regression test for §6.5 | B4 |
| A compiled plan whose size grows with the number of counts the rule names | [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py) `test_no_rule_compiles_to_more_than_sixteen_word_operations`: all 512 single sets must compile to at most sixteen word operations — the bound the complexity claim uses — and each of the fourteen rules must compile to at most sixteen as a pair | B1 |
| The default rule losing the expression it replaced | [test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py) `test_conway_compiles_to_the_expression_it_replaced`: `B3/S23` must compile to exactly three word operations, which is what the hand-written Conway expression cost. The assertion is on the number, because there is no `if rule == CONWAY` branch to assert the absence of | B1 |
| A `set_rule` reply that echoes what was sent instead of what the core took, or a refusal that changes the running rule | [test_bridge.py](../../../tests/world/test_bridge.py): `b36/s32` must come back as `B36/S23` with `birth` and `survival` ascending, and a `bad_rule` refusal must leave the next `state` reporting the rule that was in force before it | B4 |
| A representation-specific bug in the shared surface | [test_world_contract.py](../../../tests/world/test_world_contract.py): every case runs against both classes | B1 |
| A rule count outside the Moore neighbourhood | [test_rules.py](../../../tests/world/test_rules.py) | B1 |
| A dense world constructed at the target scale | [test_world_contract.py](../../../tests/world/test_world_contract.py): `DenseWorld(65536, 65536)` must raise and name the limit | B1 |
| A coordinate or rectangle outside the world | [test_world_contract.py](../../../tests/world/test_world_contract.py), both classes | B4 |
| A malformed protocol line, an unknown command, a wrongly typed argument, an out-of-range value, an out-of-bounds request | [test_bridge.py](../../../tests/world/test_bridge.py), each asserting the specific error code and that the process survives | B4 |
| **A patch that would be half-applied because a later cell is out of bounds** | [test_bridge.py](../../../tests/world/test_bridge.py): a patch whose valid cells come first and whose last cell is outside the world is refused with `out_of_bounds`; the export's `data` bytes and the `state` reply are compared before and after, so either part of the patch being applied fails the case | B4 |
| A patch built against a generation the world has left | [test_bridge.py](../../../tests/world/test_bridge.py): `expectGeneration` one past the current generation is refused with `stale_generation`, and the export's `data` is unchanged | B4 |
| A patch that marks one cell as both born and died, or whose lists or generation are malformed | [test_bridge.py](../../../tests/world/test_bridge.py): a cell in both lists, a missing list, a non-list value, a non-integer generation, a pair of the wrong length and a boolean or float coordinate are each refused with `bad_arguments`; a malformed entry after a valid one must not apply the valid one | B4 |
| A patch whose counts include cells already in the requested state | [test_bridge.py](../../../tests/world/test_bridge.py): a born cell that is already alive and a died cell that is already dead apply without being counted, so `bornCount` and `diedCount` report actual changes only; the exported live set, the population and the unchanged generation are asserted too | B4 |
| A transaction recorded as one edit per cell instead of one edit | [test_bridge.py](../../../tests/world/test_bridge.py): one patch of four cells must call the history's amend path exactly once and append no generation, observed in process because an amended generation looks the same in the protocol reply either way | B4; E2 |
| A protocol request that is refused must not corrupt the session | [test_bridge.py](../../../tests/world/test_bridge.py): after an unknown command, a following `state` must still succeed | B4 |
| The process must end cleanly on `quit` and on end of input | [test_bridge.py](../../../tests/world/test_bridge.py), asserting exit code `0` | B4 |
| A client keeping its own copy of a limit the core enforces | [test_bridge.py](../../../tests/world/test_bridge.py): `hello`'s `limits` object must equal the module constants the enforcement uses, field by field, and `history` must be `false` on a core that records nothing | B4 |
| A recorded timeline that does not describe what the world did | [test_bridge.py](../../../tests/world/test_bridge.py): a glider set and stepped four times must appear as generations `0..4`, with generation `0` a keyframe whose population is the world **after** the edit | B4 |
| A rollback that does not restore, or that appends to a future it discarded | [test_bridge.py](../../../tests/world/test_bridge.py): rolling back to generation 1 then stepping twice must leave a chain of `0..3`, not `0..6`, because the discarded generations descend from a state that no longer happened | B4 |
| **An edit between two generations making the chain unreplayable** | [test_bridge.py](../../../tests/world/test_bridge.py) `test_an_edit_between_generations_keeps_the_chain_replayable`: after a `toggle` the current generation must be a keyframe, and every generation up to the current one must still roll back. This is the regression test for §6.4 | B4 |
| An archive that cannot be read back | [test_bridge.py](../../../tests/world/test_bridge.py): a written archive is imported into a fresh store and must carry every generation | B4 |
| The timeline commands answering a core that records nothing | [test_bridge.py](../../../tests/world/test_bridge.py): `history`, `rollback` and `archive` are each refused with `bad_arguments` and a message naming `--history`. `select` and `open` are refused by that same check at the head of their handlers, and they are the two commands this case does not assert | B4 |
| An archive written without a path | [test_bridge.py](../../../tests/world/test_bridge.py): a missing or empty `path` is refused rather than writing somewhere | B4 |
| A measurement taken on a drifting population | [test_benchmark.py](../../../tests/world/test_benchmark.py) asserts the population after the timed steps, so a drifting lattice fails instead of being reported | B6 |

## 5. The last recorded results

**The block below belongs to the revision before the rule work and is kept as
that revision's evidence.** Its counts no longer describe the suite: §1 lists the
372 items this revision collects. Evidence is tied to a revision, so this run is
not reused — the run for the current revision, with its commands and observed
output, is recorded in [dev-log/](../../../dev-log/) at delivery.

Recorded on profile `M1` on 2026-10-10, from the repository root, with the
environment sourced.

| Command | Observed result | Exit |
|---|---|---|
| `uv run pytest -q` | `251 passed, 1 deselected in 4.11s` | 0 |
| `uv run pytest -q tests/world` | `177 passed, 1 deselected in 3.38s` | 0 |
| `uv run pytest -q tests/world/test_rules.py` | `6 passed` | 0 |
| `uv run pytest -q tests/world/test_world_contract.py` | `61 passed` | 0 |
| `uv run pytest -q tests/world/test_patterns.py` | `18 passed` | 0 |
| `uv run pytest -q tests/world/test_tiled.py` | `13 passed` | 0 |
| `uv run pytest -q tests/world/test_oracle_equivalence.py` | `46 passed` | 0 |
| `uv run pytest -q tests/world/test_bridge.py` | `33 passed` | 0 |
| `uv run pytest -m benchmark -s tests/world/test_benchmark.py` | both shapes reproduced; figures in [performance.md](performance.md) §5 | 0 |
| `uv run python -m lifegame.world --bogus` | `error: unrecognized arguments: --bogus` | 2 |
| `uv run ruff check` | `All checks passed!` | 0 |

The counts are from one session on profile `M1`, taken after the store module and
the recorded timeline landed. The suite is fast enough that a run takes about
four seconds; the benchmark is excluded from it and takes about eight.

The full-suite figure includes the store module's 60 and the environment module's
14; this module's own figure is the 177. The seven cases added in the round that
added the recorded timeline are all in the protocol file, and they are named in
§4: the advertised limits, a recorded core's timeline, rollback and continuing,
the edit that keeps the chain replayable, the archive round trip, the refusal
without a history, and the archive that needs a path.

### 5.1 The target-scale protocol smoke

The constructor accepting 65536 x 65536 is not the same claim as the protocol
working there. One session drove a real child process at the design size, under
the default `sparse` representation, **with a recorded history**, and sent one
request of each kind. The observed replies, with the long fields truncated and
the request lines built as JSON rather than by hand:

```
{"ok":true,"protocol":1,"world":{"width":65536,"height":65536},"rule":"B3/S23",
 "running":false,"tps":10,"limits":{"ticksPerSecond":{"min":1,"max":60},
 "stepsPerRequest":100000,"maxCoordinate":4294967295,"representations":["sparse","tiled"]},
 "history":true,"id":1}
{"ok":true,"changed":6,"population":6,"id":2}
{"ok":true,"generation":2,"population":5,"changed":4,"id":3}
{"ok":true,"world":{"width":65536,"height":65536},"rule":"B3/S23","generation":2,
 "population":5,"bounds":[0,1,2,3],"running":false,"tps":10,"id":4}
{"ok":true,"session":1,"current":2,"count":3,"generations":[
 {"generation":0,"kind":"keyframe","population":6,"changed":6,"born":6,"died":0,
  "at":"2026-10-10T08:14:57+00:00"},
 {"generation":1,"kind":"delta",...}],"id":5}
{"ok":true,"generation":0,"population":6,"bounds":[0,0,65535,65535],"id":6}
{"ok":true,"path":"...\\smoke2.jsonl","generations":3,"id":7}
{"ok":false,"error":"out_of_bounds","message":"(65536, 0) is outside a 65536 x 65536 world","id":8}
{"ok":true,"bye":true,"id":9}
```

Read against the contract: `hello` announces the protocol, the design size, the
rule, **the limits it enforces** and the fact that it is recording; `set` accepts
six cells including the far corner `(65535, 65535)`; `step` advances two
generations and reports four changes in the second; `state` reports the live
extent after the corner cell died; `history` reports one session, the current
generation, three recorded generations, and generation `0` as a **keyframe with
population 6** — the world after the edit, not the empty world the core started
with; `rollback` to generation `0` brings the far corner back, which the bounds
`[0, 0, 65535, 65535]` prove; `archive` writes the session and reports three
generations, and the file has four lines because it carries a header; a toggle
one cell past the edge is refused with `out_of_bounds` and the process keeps
running; `quit` is acknowledged and the process exits `0`.

This is a hand-run smoke, not an automated test, and it is recorded as such. It
is the observation behind the claim that the protocol works at the design size
under the default representation, and that a recorded core works there too. Its
automated counterpart is narrower and stronger where it applies:
`test_both_representations_answer_the_same_protocol` runs the same glider at the
same design size under both representations and asserts that four generations
land on the same bounds, and the recorded-core cases in §4 run at 64 x 64 rather
than at the design size. What no test does is run every command at the design
size, and that is listed in §8.

## 6. Defects found and fixed

### 6.1 The undercounted births (found and fixed)

The first version of the sparse step subtracted one from **every** candidate's
occurrence count to remove the candidate's own entry. That is only correct for
candidates that are live: `candidates` holds a live cell once on its own account
plus once per live neighbour, and a dead candidate once per live neighbour. Dead
candidates were therefore short by one neighbour each, and **every birth was
undercounted by one**, which suppressed births whose only path was a count of
three.

Symptom: a glider, which a hand calculation says is five cells, came out as
three. The random equivalence test caught it immediately; a hand-written pattern
list alone would have needed the right pattern to be present.

The fix is the single line

```python
neighbours = occurrences - was_alive
```

and the reasoning is written into the code beside it, because the wrong version
is the one that looks natural. The regression coverage is
[test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py),
whose module docstring records the story, and the glider case in
[test_patterns.py](../../../tests/world/test_patterns.py).

The general lesson is recorded because it is the module's most transferable one:
**randomised equivalence against an independently written implementation earns
its keep on the first day.** A curated list of published patterns would have
passed with the wrong rule, because the patterns that expose a missing birth are
the ones nobody thought to list.

### 6.2 The frame selection compared bits against bytes (found and fixed)

While writing [interfaces.md](interfaces.md) §4.6, the selection rule was
re-derived from the code and compared with the rule its own docstring states.
They differed by a factor of eight: the comparison multiplied the `cells` payload
by 8 — converting it from bytes to bits — and compared that against a bitmap
already measured in bytes, so the threshold was eight times stricter than the
rationale beside it. `bits` was chosen across the band
`w * h / 512 < live cells <= w * h / 64`, where `cells` would have been between
two and eight times smaller.

The consequence was bandwidth, never correctness: both encodings carry the same
world and the `format` field says which arrived.

The fix is the comparison itself, in
[bridge.py](../../../src/lifegame/world/bridge.py), and the rule is now the one
its docstring describes: `8 * live <= ceil(w / 8) * h`, one live cell per 64. It
is pinned at the boundary, which is the only place the two rules differ:
[test_the_frame_encoding_follows_the_stated_size_rule](../../../tests/world/test_bridge.py)
loads exactly 64 live cells into a 64 x 64 rectangle — a 512-byte bitmap against
a 512-byte coordinate list — asserts `cells`, then loads a 65th cell and asserts
`bits`.

It is recorded here rather than in [risks.md](risks.md) because the code no
longer behaves that way, and it is worth keeping because of how it was found:
**not by a test, but by writing the interface down from the implementation and
checking the arithmetic in the prose.** The two tests that exercised the
encodings used rectangles where both rules agree, so they passed under either.
A rule that is documented and a rule that is implemented are two claims, and
nothing was comparing them.

### 6.3 The tiled step counted changed words instead of changed cells (found and fixed)

The first version of the tiled step reported its change count as
`np.count_nonzero(after != before)`. The tiled world stores one **64-cell word**
per array element, so that counts elements, not cells: four changed cells
falling inside three words were reported as three.

The state was correct throughout. Every cell-for-cell equivalence test passed,
because the world that came out of the step was right; only the number the API
returned was wrong. That is the specific value of the change count being part of
the contract rather than a detail of one implementation.

It was caught by comparing the three representations' `step` return values
directly on one glider: sparse and dense reported a constant 4 while the tiled
world reported 3, 2 and 3 on successive generations. The fix is
`np.bitwise_count(after ^ before).sum()`, and the regression coverage is
`assert_same_change_count` in
[test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py),
which runs all three counts side by side for six generations over five seeds.

The lesson is narrower than §6.1's and worth stating on its own: **state
equivalence is not API equivalence.** An oracle that compares worlds cannot see
a wrong return value, so anything the API promises has to be compared as such.

### 6.4 An edit between two generations broke the recorded chain (found and fixed)

The recorded timeline stores each generation as the cells that were born and the
cells that died relative to the generation before it. That is only sound while
consecutive generations really are consecutive: generation *g* has to be what
stepping generation *g-1* produced.

An **edit** breaks that. `set`, `toggle`, `clear` and `import` all change the
world *between* two generations, so the delta that brought the world to the
current generation no longer describes where the next step starts. The stored
chain then claims a transition that never happened.

It was found on the first end-to-end use, not by a test:

```
set a glider -> step 4 -> rollback 1
{"ok":false,"error":"internal","message":"StoreError: generation 1 kills
 (1, 0), which is not alive; the recorded chain is not a life history"}
```

**The store's own replay validation caught it.** Every delta is checked as it is
replayed — what it kills must have been alive, what it bears must have been dead
— so a chain that does not describe a life world is reported at the point it
stops describing one, instead of quietly producing a world that looks plausible.
What the validation could not do was say *why*: the cause was in the protocol,
not the store, because the protocol mutates the world and told the history
nothing.

The fix is one call after each of the four mutating commands: re-record the
current generation as a keyframe. Recording already replaces any row at or after
the generation it writes, so this is a replacement rather than an append, and the
first edit at generation `0` makes that keyframe describe the world *after* the
edit instead of the empty world the core started with.

The general rule is now part of the protocol contract rather than a detail of
this implementation ([interfaces.md](interfaces.md) §4.9): **any operation that
changes the world between two recorded generations must make its own generation
a keyframe.** The regression coverage is
`test_an_edit_between_generations_keeps_the_chain_replayable`, which toggles a
cell, steps twice, asserts the edit's generation is a keyframe, and then rolls
back to every generation in the chain to prove them all restorable.

The lesson: a validation that reports *that* something is wrong is not the same
as one that reports *where* it went wrong, and a layer that mutates state shared
with another layer owes that layer a notification. Here the notification is a
keyframe.

### 6.5 A `B0` rule was answered rather than refused (found and fixed)

Both locality-based representations are built on one fact: a dead cell with no
live neighbour has a neighbour count of zero and cannot change. The sparse step
only counts neighbours of cells next to a live one, and the tiled step only
steps tiles that hold or touch one. A rule whose birth set contains `0` falsifies
that fact, and until this revision neither representation said so.

It was not a crash. It was a wrong number:

```
an 8 x 8 world, one live cell, rule B012345678/S
correct next population, by the dense oracle   63
population the sparse step reported            39
```

The state that came back was a plausible subset of the correct one — the cells
near the live cell, which is exactly the set the sparse step looks at — so
nothing in the reply was wrong-looking. The defect was found by asking what the
generality the rule editor needs implies about the candidate set, not by a test
and not by a user: the three representations agreed on Conway and on nothing
else, because only Conway had ever been run.

The fix is a refusal rather than a wider candidate set: `require_local_birth`
raises `ValueError` from the constructor and from `set_rule` in both
locality-based representations, and the protocol reports it as `bad_rule`
([interfaces.md](interfaces.md) §3.1). Widening the candidate set to the world's
area is not a fix to these two representations — it is a different one, which is
what `DenseWorld` is, and that is why the oracle keeps running the rule instead
of declining it.

The lesson is the same shape as §6.3's, one level up: **an oracle that is only
ever asked one question proves one answer.** The equivalence suite ran every
representation against the dense world for Conway, and its coverage of "the rule"
was exactly one rule; the fix comes with fourteen
([test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py)).
There is a second, less comfortable half: the wrong answer was reachable through
the protocol for as long as `B0` was accepted, and no test could see it because
nothing asked. The outward behaviour change this refusal makes is WLD-13 in
[risks.md](risks.md).

## 7. Deliberately not tested

| Not tested | Why that is deliberate |
|---|---|
| Quadtree memoisation | Considered and not adopted ([implementation.md](implementation.md) §7) |
| A wrapping boundary condition | Rejected as a decision ([ADR 0008](../../adr/simulation-core/0008-the-world-is-bounded-and-does-not-wrap.md)); testing a mode that does not exist would be a promise |
| Persistence | The module has no save format, deliberately |
| Cross-platform behaviour | The module is measured and tested on one profile, `M1`. The protocol reconfigures its streams to UTF-8 with LF endings, which is the portable choice, but no second platform has been exercised |
| Memory peaks | The per-representation figures — 8 bytes per live cell for the sparse world, 512 bytes per non-empty tile for the tiled one — are accounting figures. A peak working set has not been asserted anywhere |
| The tiled world's query cost | It is measured ([performance.md](performance.md) §7) but not asserted. Turning a measurement into a gate would fix a threshold that the next representation change should be free to move |
| Dispatch between the two representations | There is nothing to test: the choice does not exist yet ([risks.md](risks.md) WLD-09) |
| A `B0` rule inside the sparse or tiled world | The two representations refuse it by design ([interfaces.md](interfaces.md) §3.1), so the behaviour to test is the refusal, which §4 covers. Asserting a result there would be asserting the wrong answer §6.5 records |

## 8. Not tested, and not deliberately

These are coverage gaps, not decisions. Each is a place where the contract says
something that nothing checks:

| Gap | Risk | Owner |
|---|---|---|
| The `internal` error code | The dispatcher's catch-all is the path that keeps a service bug from killing the core, and nothing triggers it | **unowned** — see [risks.md](risks.md) §3 |
| A usage error on the entry point | Exit code `2` was observed by hand, not asserted | **unowned** — see [risks.md](risks.md) §3 |
| A frame rectangle of non-positive area | The contract says `bad_arguments`; nothing checks it | **unowned** — see [risks.md](risks.md) §3 |
| `state` on an empty world returning `null` bounds | Covered at the world level (`bounds()` is `None`) but not at the protocol level | **unowned** — see [risks.md](risks.md) §3 |
| Protocol behaviour under a slow step while `running` | Whether a long step delays replies is unknown | **unowned** — see [risks.md](risks.md) §3 |
| Every command at the design size, under both representations | §5.1 is a hand-run smoke under one representation, and the automated counterpart covers one command pair. A protocol path that only breaks at 65536 x 65536 would be found by hand or not at all | **unowned** — see [risks.md](risks.md) §3 |
| The tiled representation at a world larger than 160 x 160 | The equivalence cases use small worlds; the tile geometry is the same at any size, but the assertion is by construction rather than by test | **unowned** — see [risks.md](risks.md) §3 |
| Any coverage measurement | No coverage tool is configured, so the lists above are by inspection rather than by report | **unowned** — see [risks.md](risks.md) §3 |
| A recorded timeline at the design size | The recorded-core cases in §4 run at 64 x 64. §5.1 drives a recorded core at 65536 x 65536 by hand, but no automated case does, so a timeline that only breaks at scale would be found by hand or not at all | **unowned** — see [risks.md](risks.md) §3 |
| What recording every generation costs | `advance(record=True)` is claimed to cost a comparison of two masks rather than a rescan, and nothing measures it. A caller that records pays it every generation, and the claim is the whole reason the cells are opt-in | **unowned** — see [risks.md](risks.md) §3; [risks.md](risks.md) §4 carries the question |
| An archive path that cannot be written | `archive` refuses a missing or empty path, and nothing checks what it does with a path the filesystem refuses. The core is the one place in this project that writes a file, which makes an unhandled failure here worse than elsewhere | **unowned** — see [risks.md](risks.md) §3 |
| The store boundary from the store's side | The protocol tests now drive a real store through `advance`, `Change` and `restore` ([risks.md](risks.md) WLD-11), but the store's own suite still never sees a protocol-driven world. Which rule generated a recorded generation is recorded by the store, and that is carried by another work item in this version | **unowned** — see [risks.md](risks.md) §3 |
| The compiled plan's size over all `(birth, survive)` pairs | The test asserts the bound for all 512 **single** sets and for the fourteen shipped rules as pairs. Over the whole pair space the measured maximum is 24, not 16 ([risks.md](risks.md) WLD-14), so the documented guarantee is wider than the assertion | **unowned** — see [risks.md](risks.md) §3 |
| Rules other than the fourteen | The equivalence claim is made for fourteen rules. The compile-time bound is an argument about all of them, and an argument is not a test, so a rule outside the fourteen that mis-selects a count would be found by a user rather than by the suite | **unowned** — see [risks.md](risks.md) §3 |
| The rule application's own cost | It is measured ([performance.md](performance.md) §5.9) and not asserted, for the same reason as the tiled query cost: a threshold here would have to move whenever a rule's plan changed, and the measurement already answers the question the assertion would | not scheduled; the measurement is the record |

The automatic ticking path was the first row of this table and is now covered:
[test_bridge.py](../../../tests/world/test_bridge.py) sends `run` at sixty ticks
per second, waits a quarter second, sends `pause`, and reads events until the
reply arrives — asserting that at least one `tick` arrived, that every event is a
`tick`, that the generation advanced, and that the `running` flag is false in
both the reply and a following `state`. It is recorded here rather than deleted
because a coverage gap that closes is worth as much evidence as one that opens.
