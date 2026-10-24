# world — performance

> This file owns the module's performance record: the oracle, the measurement
> method, the candidate set, the frontier, the cost of a rule, the query cost, the
> phase profile, the noise policy and what is unmeasured. Machine profiles and the
> measurement workflow are owned by
> [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md); the
> algorithms are owned by [implementation.md](implementation.md); the gaps this
> file records are risks WLD-01, WLD-06, WLD-10 and WLD-13 in [risks.md](risks.md).

## 1. Is there a performance contract?

Not yet, and the reason has changed.

A performance contract would be an admission floor for a step at a stated scale
and shape. The representation that could meet one now exists: the tiled world
costs time per active tile rather than per live cell, and §6 shows it beating the
sparse world by up to fifty-five times on a clustered population. What is
missing is not a fast candidate but an agreed **shape and scale** to state the
floor against, because the measurement says the answer depends on both: the same
two representations swap places when the population is scattered rather than
clustered (§5).

So this file still records a **frontier** rather than a floor, and now it
records it over two population shapes. A floor is definable; it is not yet
defined, and **no milestone owns setting one** — the milestone that declared the
representation choice shipped the choice and not the shape decision that would
have followed from it. See [risks.md](risks.md) §3. Until then, no step-time
budget may be quoted from this module.

The recorded timeline adds work this file does not yet quantify: a core with a
history steps one generation at a time, records it, and answers `history`,
`select`, `rollback`, `archive` and `open`. §10 lists what none of that has
been measured against. The admission floors below therefore say nothing about a
recorded core, and a figure taken from an unrecorded one must not be presented
as if it covered both.

## 2. Admission floors

| Surface | Floor | Status |
|---|---|---|
| Sparse step, clustered population, 1024 x 1024 | none | Unvalidated: recorded as a frontier, not as a gate |
| Tiled step, clustered population, 1024 x 1024 | none | Unvalidated: the candidate exists and is measured; the floor awaits a shape decision (§1) |
| Sparse or tiled step at the design scale | none | Unvalidated: every figure at that scale in §6 is arithmetic from a 1024 x 1024 measurement |
| Protocol request round trip | none | Unvalidated for most commands; `state` and a 1024 x 1024 `frame` are measured in §7 |

No floor has been established, and none may be quoted as if it had been. A floor
is added to [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5
only together with the command, the configuration and the observed result that
produced it.

## 3. The oracle

Two different questions need two different oracles.

**For correctness**, the oracle is `DenseWorld`: the same rule computed by a
completely different algorithm, sharing nothing with either of the other two
below the rule object. The three representations agree on randomised states
**and on the change count each step reports**, which is a stronger claim than
state agreement and was added because state agreement alone let a wrong count
through ([testing.md](testing.md) §6.3). That oracle and its results are owned by
[testing.md](testing.md) §4.

**For speed**, there is no single oracle, and that is the finding. The dense
reference is the flat baseline: it is the representation a reader will ask about
first, it is measured on the same machine in the same process in the same run,
and its cost does not depend on the population, which is what makes a crossover a
meaningful quantity at all. But it is not the comparator that matters for the
target, because it cannot be allocated there. The comparator that matters is the
sparse world, and the measurement says the comparison between the two shippable
representations **has no single answer**: it depends on the population's shape.
A number quoted without its shape is not a measurement of anything.

## 4. The measurement method

```powershell
uv run pytest -m benchmark -s tests/world/test_benchmark.py
```

| Aspect | Value |
|---|---|
| Profile | `M1` ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1.1) |
| World | 1024 x 1024 = 1,048,576 cells |
| State | a still life of 2 x 2 blocks, so the population is exactly four times the block count and does not drift |
| Shapes | `lattice` — blocks packed at a four-cell spacing, so a region fills up and a tile holds many live cells; `scatter` — the same blocks at a thirty-two cell spacing, so every tile holds exactly one |
| Ladders | lattice 400, 4,000, 40,000, 200,000, 260,000 live cells; scatter 400, 4,000, 20,000 (4,096 measured before the last rung) |
| Candidates | sparse, dense, tiled on both shapes; naive-python below 20,000 live cells |
| Lifecycle | warm; one warm-up step, then five timed steps; the reported figure is the mean of the five |
| Unit | milliseconds per step, with live cells per millisecond and the tile count alongside |
| Workers | one process, one thread for the measurement; the module is single-threaded apart from the protocol's reader |
| Duration | about 8.8 s for both shapes |
| Population check | the harness asserts that each candidate's population after the timed steps equals the loaded population, and fails the measurement otherwise |

Four choices in that method are deliberate.

* **A lattice, not a random fill.** A random fill changes population as it
  evolves, so two candidates would be timed on different populations and the
  comparison would be meaningless. A block lattice is a still life: the
  population is constant by construction and asserted after the fact.
* **Two shapes, not one.** The tiled world pays for a nine-neighbour expansion of
  its tile set and the sparse world does not. That cost is invisible on a
  clustered population and dominant on a scattered one, so a single shape would
  have produced a single answer and a wrong generalisation. The benchmark's
  module docstring states this as the reason the second shape exists.
* **A warm-up step before timing.** The first step pays allocation and
  bytecode-path costs that every later step does not; timing it would measure
  start-up rather than the step.
* **The tile count is reported beside the time.** The tiled step's cost is
  proportional to active tiles and not to live cells, so a tiled row without its
  tile count cannot be compared with a sparse row that has a live-cell count.
  Both units are printed.

## 5. The candidate set, the frontier, and the rule

The rule became a variable in this version: the tiled step no longer holds
Conway's rule as an expression but compiles whatever rule it is given into a
selection network ([implementation.md](implementation.md) §3.4). §5.6 re-measures
the frontier in the session that took the rule measurements, and §5.7 to §5.10
record the rule's own cost. Those are a separate question from §5.1 to §5.5:
there the candidates are representations, and the rule is fixed; here the
representation is fixed and the rule is the candidate.

| Candidate | Where it lives | Status |
|---|---|---|
| `sparse` — packed keys, sort-based counting | [sparse.py](../../../src/lifegame/world/sparse.py) | shipped; the protocol's default |
| `tiled` — 64 x 64 bit-packed tiles, only non-empty tiles stored, one word per 64 cells | [tiled.py](../../../src/lifegame/world/tiled.py) | shipped; selected with `--representation tiled` |
| `dense` — one boolean per cell, eight shifted slices | [dense.py](../../../src/lifegame/world/dense.py) | shipped as the oracle and baseline only; refuses the target scale |
| `naive-python` — a set of coordinates with a dictionary of neighbour counts | [test_benchmark.py](../../../tests/world/test_benchmark.py), not shipped | measured, kept as the obvious first attempt a reviewer will ask about |
| `hashlife` — quadtree memoisation | not written | considered and not adopted; see [implementation.md](implementation.md) §7 |

### 5.1 Clustered: blocks packed together

Recorded on profile `M1` on 2026-10-10; the primary table for this shape.

| Live cells | Tiles | sparse, ms per step | dense, ms per step | tiled, ms per step |
|---|---|---|---|---|
| 400 | 1 | 0.175 | 12.930 | 0.303 |
| 4,000 | 4 | 1.371 | 13.125 | 0.330 |
| 40,000 | 49 | 13.931 | 13.397 | 0.537 |
| 200,000 | 196 | 84.061 | 14.224 | 1.955 |
| 260,000 | 256 | 119.341 | 13.565 | 2.175 |

### 5.2 Scattered: one block per tile

Same profile, same session, same still life; only the spacing differs.

| Live cells | Tiles | sparse, ms per step | dense, ms per step | tiled, ms per step |
|---|---|---|---|---|
| 400 | 32 | 0.175 | 13.430 | 0.652 |
| 4,000 | 256 | 1.402 | 13.234 | 2.003 |
| 4,096 | 256 | 1.430 | 13.296 | 1.984 |

### 5.3 A second run, for the spread

The same ladder was re-run first-hand while this file was written. It agrees on
every conclusion and differs in the way a shared machine makes measurements
differ:

| Shape | Live cells | sparse | dense | tiled |
|---|---|---|---|---|
| lattice | 400 | 0.177 | 12.984 | 0.314 |
| lattice | 4,000 | 1.266 | 13.135 | 0.360 |
| lattice | 40,000 | 13.315 | 13.578 | 0.612 |
| lattice | 200,000 | 83.913 | 13.705 | 1.782 |
| lattice | 260,000 | 118.394 | 13.228 | 1.907 |
| scatter | 400 | 0.175 | 13.451 | 0.490 |
| scatter | 4,000 | 1.317 | 13.598 | 2.399 |
| scatter | 4,096 | 1.411 | 13.809 | 2.135 |

Both runs are kept. The conclusions below are drawn only from what they share,
and any per-cell or per-tile constant is stated as a range across them.

### 5.4 What the runs agree on

* **Dense is flat.** 12.6 to 14.3 ms per step across both runs, both shapes and
  every population, because it scans the world's area and nothing else. It is the
  only candidate whose cost does not depend on the population.
* **Sparse is linear in the live population**, at **0.31 to 0.53 microseconds per
  live cell** across the two runs, and it does not care about the shape: its row
  at 400 live cells is identical to three decimal places on both.
* **Tiled is linear in the number of non-empty tiles**, at roughly **7.5 to 8.5
  microseconds per tile** over the clustered ladder above 4,000 live cells. Its
  cost barely notices how many live cells a tile holds; it notices how many tiles
  there are.
* **On a clustered population the tiled world wins, and wins big.** It is ahead
  of sparse from about 4,000 live cells — the two are within noise at 400 — and
  at 260,000 it is **55 times faster** (2.175 ms against 119.341 ms). Against the
  dense reference it is 6 times faster at 260,000 and 43 times faster at 40,000.
* **On a scattered population the sparse world wins.** At 4,096 live cells
  spread one block per tile, sparse is 1.430 ms against tiled 1.984 ms: the tiled
  world is paying to expand 256 tiles into their neighbours for no gain. This is
  the measurement that makes the shape part of the record rather than a footnote.
* **The crossover for sparse against dense is about 40,000 live cells**, roughly
  four percent of a 1024 x 1024 world. The theoretical crossover — a
  neighbour-counting step should win while the live set is below about one cell
  in nine, which would be about 116,000 cells here — is roughly three times too
  high, because the sparse step's constant factor is much larger than the dense
  step's.
* **The naive Python candidate loses on both axes.** It is 3.8 to 6 times slower
  than sparse at 400 and 4,000 live cells and its slope is steeper, which is the
  measured version of "a dictionary of neighbour counts is the first thing anyone
  writes, and it is not the answer".

### 5.5 What the runs disagree on

Everything except the shape and the ranking. The second run is consistently
faster above 4,000 live cells — 1.907 against 2.175 ms for the tiled world at
260,000, 13.315 against 13.931 for sparse at 40,000 — while the 400-cell rows are
identical. The most plausible explanation is machine load during the first run,
which is exactly the failure this module's noise policy exists for (§9). The two
runs differ by up to about a quarter on the per-cell and per-tile constants, and
by nothing at all in the ordering of the representations.

The one row where the two runs disagree about a conclusion is the sparse-versus-
dense crossover: one run has sparse behind dense at 40,000 by seven percent and
the other has them level. That is why §5.4 states the crossover as "about 40,000"
rather than naming a rung, and why §10 records the exact rung as an open
question.

### 5.6 The frontier re-measured, in the session that priced the rule

Same profile, same ladder, same lifecycle and the same 2 x 2 block still life as
§5.1 and §5.2; a third run, taken first-hand in the session that produced §5.7 to
§5.10, so that the rule's cost and the frontier it sits on come from one machine
state.

| Shape | Live cells | sparse, ms per step | dense, ms per step | tiled, ms per step |
|---|---|---|---|---|
| lattice | 400 | 0.191 | 13.261 | 0.309 |
| lattice | 4,000 | 1.207 | 13.744 | 0.372 |
| lattice | 40,000 | 14.631 | 13.393 | 0.556 |
| lattice | 200,000 | 97.707 | 13.405 | 1.891 |
| lattice | 260,000 | 115.432 | 13.298 | 1.995 |
| scatter | 400 | 0.178 | 13.326 | 0.488 |
| scatter | 4,000 | 1.251 | 13.230 | 1.989 |
| scatter | 4,096 | 1.395 | 13.483 | 2.094 |

**Every row except one falls inside the swing the first two runs already
recorded, and the ordering is unchanged in all of them.** The tiled row at
260,000 live cells is 1.995 ms, which sits between the 2.175 ms of §5.1 and the
1.907 ms of §5.3, and the scatter rows land between their two predecessors in the
same way.

**The one row outside the swing is sparse at 200,000 live cells**, at 97.707 ms
against the 84.061 ms of §5.1 and the 83.913 ms of §5.3 — about sixteen percent
worse than either. That is stated as a measurement and not explained away, and
three facts bound what it can mean:

* the sparse step's hot path is **unchanged** in the version that took this run;
  what changed is where its two decision tables come from, which is the same work
  in the same order;
* the same rule's sparse rows at 40,000 and 260,000 are faster than in §5.1 and
  slower than in §5.3, which is the ordinary scatter of load rather than a
  one-directional regression;
* sparse's cost is linear in the live population, so the 260,000 rung is the one
  to judge it on, and there it agrees with both earlier runs to within three
  percent.

So the row is recorded as machine noise on that rung, with the caveat attached
rather than removed: no single reading of it should be quoted, and §5.4's
per-cell range is drawn from the two runs that agree.

**The 40,000 rung must not be read as a single point either.** It is the rung
where sparse and dense are closest, the residual spread across the three runs is
about a fifth of the value, and the two earlier runs already disagree about which
of the two is ahead there (§5.5). A single reading on that rung is not evidence
for either ordering; the crossover stays stated as "about 40,000".

### 5.7 The method for a rule comparison: three interleaved rounds

The rule measurements use the same configuration, the same still life and the
same lifecycle as §5.1 — one warm-up call, then five timed calls — with one
change: **the candidates are interleaved and each figure is the mean of three
rounds**, rather than each candidate being measured to completion in turn.

| Aspect | Value |
|---|---|
| Rounds | `3`, each round measuring every candidate once |
| Per round, per candidate | one warm-up call, then `5` timed calls; the round's figure is the mean of the five |
| Reported figure | the mean of the three round figures |
| Order | every candidate is measured in every round, so each candidate is first, middle and last once |
| Configuration | unchanged from §4: profile `M1`, 1024 x 1024, one process and one thread, warm |

**Why interleaving is not a refinement but a requirement here.** Measured
sequentially, the candidate that happens to be measured **first** is consistently
the fastest, and the gap between the first and the last candidate is larger than
the true difference between the two paths being compared. The mechanism is the
same one §9 records from the `numpy.unique` incident — a shared machine gets
busier as the run goes on — and it matters here because the whole question is
whether two nearly equal paths differ at all. An ordered run would answer "which
was measured first", and it would answer it in the right direction often enough to
look like a result.

The rule measurements therefore are not comparable with the §5.1 to §5.3 rows,
which were taken sequentially. Comparisons are made **inside** §5.8 and inside
§5.9, where every row was measured under the same interleaved rule.

### 5.8 The whole step under other rules

Lattice, 1024 x 1024, 200,000 live cells, tiled world, interleaved and averaged
over three rounds. `ops` is the compiled plan's size for the first column; the
inlined row is the hand-written Conway expression the version before this one
ran, kept as a measured candidate rather than deleted, so the comparison has a
visible baseline instead of a memory
([test_benchmark.py](../../../tests/world/test_benchmark.py)).

| Candidate | Rule | `ops` | ms per step | Against inlined | Against generic Conway |
|---|---|---|---|---|---|
| conway (inlined) | `B3/S23` by the old expression | 7 | 2.024 | 1.00x | — |
| conway (generic) | `B3/S23` by the compiled plan | 3 | 2.040 | 1.01x | 1.00x |
| `B36/S23` | HighLife | 7 | 2.394 | 1.18x | **1.17x** |
| `B3/S12345` | Maze | 9 | 2.440 | 1.21x | **1.20x** |

**Two conclusions, and they are different in kind.**

* **The default rule's generality is free.** A generic `B3/S23` step is 1.01x the
  hand-written Conway step, which is inside the noise of the interleaved method:
  the compiled plan for Conway is three word operations and the expression it
  replaced was seven, so there was nothing left to lose.
* **A rule that is genuinely more expensive is still cheap in a step.** The rule
  application costs 5.2 to 7.8 times more in isolation for these two rules
  (§5.9), and the whole step grows by **17 to 20 percent**, because the step is
  geometry plus rule and the geometry is the larger part.

### 5.9 The rule application alone

Everything except the rule held fixed: the same count planes, the same number of
tiles (256 tiles, 16,384 cells per plane), and only `_apply_rule` timed
([test_benchmark.py](../../../tests/world/test_benchmark.py)). This is the
measurement that separates the part of a step the rule decides from the geometry
it does not, and the only one that can price `B2/S`, whose population cannot hold
still for a whole-step measurement.

| Rule | `ops` | us per call | Against inlined |
|---|---|---|---|
| `B3/S23`, inlined expression | 7 | 62.9 | 1.00x |
| `B3/S23`, compiled plan | 3 | 79.5 | 1.27x |
| `B36/S23` | 7 | 324.7 | 5.17x |
| `B3/S12345` | 9 | 488.2 | 7.77x |
| `B2/S` | 4 | 49.9 | **0.79x** |
| `B/S012345678` | 10 | 308.6 | 4.91x |
| `B3678/S34678` | 13 | 597.9 | 9.51x |
| `B1357/S1357` | 13 | 634.4 | 10.09x |
| `B3/S012345678` | 11 | 733.2 | 11.67x |

Three readings of that table are the findings, and one of them is a negative
result about the metric itself.

* **The plan's size is a bound and not a cost model.** The ranking is not
  monotone in `ops`: `B3/S012345678` at 11 operations is the most expensive row
  while `B1357/S1357` at 13 is cheaper. Each plan step is one numpy traversal of
  an `(M, 64)` array and the plan is walked in Python, so what a plan costs
  depends on how many distinct arrays it materialises and in what order as well as
  on how many operations it takes. No profile decomposes that further, and §10
  records it as unmeasured rather than guessed.
* **The compiled Conway is slower than the expression it replaced, at this
  scale** — 79.5 us against 62.9 us — because the seven-operation expression is
  evaluated straight through by numpy while the three-operation plan is interpreted
  step by step. That is the Python-level plan walk, and it does not disappear at a
  whole step's scale only because the geometry around it is larger (§5.8).
* **`B2/S` is faster than the hand-written Conway expression.** It names no
  survival counts at all, so the mix with the current state reduces to
  `~alive & born`: fewer arrays are materialised than the expression's own
  channel. A rule's plan size and a rule's cost are therefore not the same
  quantity in either direction.

### 5.10 Where the rule's cost is, and what it does not touch

**The cost is in the rule application itself, and its two parts are the array
traversals and the plan walk.** Every plan step is one numpy pass over an
`(M, 64)` array, and the plan is interpreted in Python; at 256 tiles that
interpretation alone is about 17 us per call, which is visible as the 79.5 us of
a three-operation plan against the 62.9 us of a seven-operation expression.

**What it does not touch is the geometry, and the geometry dominates a step.** A
step is eight gathers of neighbouring tiles, a ripple-carry adder over eight
neighbour bit planes (four levels of `xor` and `and` each, 32 full adders, 64 word
operations per tile), the rule, the bounds mask and the change count
([implementation.md](implementation.md) §3.3). Only the rule's part depends on
which rule is in force, so the whole step moves by 17 to 20 percent while the rule
application moves by a factor of up to twelve.

**The complexity is unchanged: `O(active tiles)`, with the rule adding a bounded
constant.** One set alone compiles to at most sixteen word operations, and the
two sets share every operand they have in common, so no rule multiplies the step
by a factor that grows with the world. Which rules were actually checked against
the oracle, and which part of the rule space is covered only by the compile-time
bound, is §10's business; the risk it leaves open is WLD-14 in
[risks.md](risks.md).

## 6. Where the tiled world wins, and where it does not

The version this file replaces recorded one gap: the shipping representation
could not run the design target at realistic density. That gap is now **closed
for one shape and open for another**, and the two cases differ by a factor of a
hundred. Stating only the first would be a claim the measurement does not
support.

The adoption is
[ADR 0010](../../adr/simulation-core/0010-tiled-bit-parallel-representation.md),
which closes — for clustered populations — the gap
[ADR 0009](../../adr/simulation-core/0009-sort-based-sparse-does-not-scale-to-the-target.md)
recorded.

Everything below is **arithmetic from the measured constants, not a measurement
at that scale**. The ladder has never been run above 1024 x 1024.

### 6.1 Clustered: the gap is closed

One percent of the target is 43 million live cells. If they are packed together,
as the clustered ladder's blocks are, they occupy about 10,500 tiles at close to
full density. At the measured 7.5 to 8.5 microseconds per tile that is about
**0.08 to 0.09 seconds per generation**, against **17 to 23 seconds** for the
sparse world at 0.39 to 0.53 microseconds per live cell. The tiled representation
is roughly two hundred times faster, and the gap that made this module have a
performance record instead of a contract is closed in this shape.

For the intermediate case — the same 43 million cells at the density the
clustered ladder actually measures, about a quarter of each occupied tile — the
tile count is about 42,000 and the projection is 0.3 to 0.4 seconds.

### 6.2 Diffuse: the gap is open

If the same 43 million live cells are spread evenly over the whole target at one
percent per tile, then essentially every tile is non-empty: 1024 x 1024 tiles, or
**1,048,576 tiles**, and the projection is **7.8 to 8.9 seconds per generation**.
The sparse world on the same population projects to 17 to 23 seconds. The tiled
representation is still ahead, by about two times rather than two hundred.

So the honest summary is: **the tiled representation's advantage comes from
spatial compactness, not from population size.** A world that is dense somewhere
can be run; a world that is thinly spread everywhere still cannot. Neither
shipped representation fixes that, and no planned version names one that does —
recorded as WLD-01 and as a record gap in [risks.md](risks.md) §3.

### 6.3 The dense reference is not an answer to either case

Its cost is flat at 12.6 to 14.3 ms per 1024 x 1024 world. The target's area is
4096 times larger, so the same per-cell cost would put it near **50 seconds per
step** — and it cannot be allocated at that size at all. Dense is faster than
sparse in a band on a small world; it is not a candidate at the target.

## 7. The query cost reversal

Stepping and querying do not agree about which representation is better, and the
viewer does both. Measured at 260,000 live cells on a clustered population:

| Operation | sparse | tiled | Ratio |
|---|---|---|---|
| `state` | 1.27 ms | 9.41 ms | tiled is 7.4 times slower |
| `frame`, 1024 x 1024 | 3.75 ms | 12.00 ms | tiled is 3.2 times slower |

The reason is that a query has to unpack the bit store: the tiled world keeps 64
cells per word, and turning that into coordinates or into a boolean viewport costs
a decode that the sparse world does not pay, because its storage is already a
list of coordinates.

This matters because the viewer polls frames while a world runs. A representation
chosen for its step — the clustered case, where the tiled world is 55 times
faster — can be several times slower for the workload the viewer actually
generates between steps. Both halves are recorded here so the choice is made
against the whole workload rather than one half of it. Where the 12 ms goes is
not decomposed; §10 records that.

The reversal is WLD-10 in [risks.md](risks.md).

## 8. The phase profile of one sparse step

Measured at 262,144 live cells on profile `M1`, in the session that produced the
first run. This file is the record's home: neither
[ADR 0009](../../adr/simulation-core/0009-sort-based-sparse-does-not-scale-to-the-target.md)
nor the frontier table in
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5 carries the
phase profile.

| Stage | Time |
|---|---|
| Candidate construction: eight masked neighbour arrays and the concatenation | about 42 ms |
| Counting, including the candidate array | about 91 ms |
| `numpy.unique` on its own | about 49 ms |
| `numpy.sort` on the same data | about 37 ms |
| `numpy.searchsorted` into the live keys | about 21 ms |
| The complete `step()` | 119 to 130 ms |

The rows overlap rather than add up: `numpy.unique` contains the sort, and the
counting row contains the unique call. The useful reading is the ranking —
**sorting and counting dominate**, membership search is a fifth of the step, and
candidate construction is the smallest of the three. It is also the reason the
representation that closed the clustered gap is one that does not sort at all:
the tiled step replaces the sort with a bit-parallel adder tree, which is why its
cost follows tiles and not live cells.

No equivalent profile has been taken of a tiled step. §10 records that.

## 9. Noise policy

* **State the profile, the lifecycle, the shape and the unit before the run.**
  Every figure here is on `M1`, warm, as milliseconds per step, mean of five
  timed steps after one warm-up, with the population shape named.
* **Assert the population.** A measurement taken on a drifting population is
  void, and the harness fails rather than reporting it.
* **Report the unit the cost follows.** A tiled figure without its tile count, or
  a sparse figure without its live-cell count, cannot be compared with anything.
* **Never trust a single reading.** The module learned this the hard way: on a
  loaded machine, a standalone timing of `numpy.unique` over the eight neighbour
  arrays read **444 ms**, while a complete `step()` on the same data read
  **127 ms**. A component cannot cost more than the whole, so at least one of
  those readings was contaminated by load. Re-measured with the machine
  controlled and the candidates interleaved rather than measured in sequence, the
  same call reads about **49 ms**, which is consistent with the 119 to 130 ms
  step. The conclusion is not "unique is fast"; it is that an uncontrolled
  single-point timing of a small stage on a shared machine is not evidence, and
  that candidates for the same claim must be interleaved so that load hits them
  alike. The two runs in §5 are the same lesson at the scale of a whole ladder:
  they differ by up to a quarter and agree on every ordering.
* **The rule comparisons apply that policy literally.** §5.7 to §5.10 were taken
  as three interleaved rounds, each round the mean of five timed calls after one
  warm-up, because there the candidates differ by less than the order effect
  does. The figures in §5.8 and §5.9 are mean-of-three-rounds figures, and they
  are compared only with each other — never with the sequential rows of §5.1 to
  §5.3.
* **The 30-second gate does not apply to this harness.** The default gate set is
  for feedback on an edit; a measurement run is scheduled explicitly and records
  its own bounds
  ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2).
* **Keep the loser.** The naive Python candidate, the dense reference, every
  figure from both runs and every shape stay in this record, including the rows
  where a shipped representation loses.

## 10. What has not been measured

Every owner below that reads **unowned** was named to the version that carried
phase 02 milestone 02, which was delivered without these items; the reason and
the decision they need are in [risks.md](risks.md) §3. They are not reassigned
here, because version state is not this file's to set.

| Unmeasured | Why it matters | Owner |
|---|---|---|
| Any step at a world larger than 1024 x 1024 | Every figure here is a 1024 x 1024 statement, and §6 projects from it. The sparse step's cost should not depend on the area and the tiled step's should not either, but neither claim is tested | **unowned** — see [risks.md](risks.md) §3 |
| Any step at the design scale | The arithmetic in §6 is a projection, not a measurement, in both shapes | **unowned** — see [risks.md](risks.md) §3 |
| Which quantity dispatch should use, and at what threshold | §6 shows the deciding number is the ratio of live cells to non-empty tiles, and that ratio is computable in both representations. No threshold has been measured | **unowned** — see [risks.md](risks.md) §3 |
| Where the tiled crossover falls between 400 and 4,000 live cells on a clustered population | The two runs bound it but the rungs are 400, 4,000: at the first sparse is ahead, at the second tiled is | **unowned** — see [risks.md](risks.md) §3 |
| A phase profile of a tiled step | §8 profiles the sparse step because that is where the sort is. What the tiled step spends its 7.5 microseconds per tile on is unknown | **unowned** — see [risks.md](risks.md) §3 |
| Where a tiled query spends its time | §7 measures the reversal but does not decompose it. Whether the 12 ms frame is the unpack, the array construction or the copy decides whether it is reducible | **unowned** — see [risks.md](risks.md) §3 |
| Memory per representation under load | 8 bytes per live cell and 512 bytes per non-empty tile are accounting figures, not measured peaks. A sparse step holds a candidate array of up to `9L` entries; a tiled step holds several `(M, 64)` arrays | **unowned** — see [risks.md](risks.md) §3 |
| Mutation cost: a click on a large world | `toggle` moves the tail of a sorted key array — linear in the live population, or in the tile count. The cost of a click at a million live cells is inferred from the bound, not measured | not scheduled; a viewer that sends many clicks per frame would make it worth mentioning again |
| Protocol cost for anything but `state` and `frame` | `set`, `step` and `run` at a high tick rate have no measurement | **unowned** — see [risks.md](risks.md) §3 |
| The effect of `run` at 60 ticks per second on a large world | The tick loop shares a thread with request handling; whether a slow step starves replies is untested | **unowned** — see [risks.md](risks.md) §3 |
| What `advance(record=True)` adds to a step | The claim is that naming the cells costs a comparison of two masks rather than a rescan, so it should be a small fraction of a step. Neither representation has been timed with and without it, and a caller that records every generation pays it every generation. The store measures what the resulting payload costs, not what producing it costs | **unowned** — see [risks.md](risks.md) §3 |
| The cost of an `export` or an `import` | Both move the whole live set; at a large population the payload is eight bytes per live cell plus its base64 expansion. Neither the time nor the peak memory has been measured | **unowned** — see [risks.md](risks.md) §3 |
| Coverage of any kind | No coverage tool is configured | **unowned** — see [risks.md](risks.md) §3 |
| Whether a carry-save (3:2) adder tree cuts the count cost | **A candidate, not a result — nothing here was measured.** The adder chain is 64 word operations per tile and the largest single part of a step, and a 3:2 tree is *estimated* to bring it to about 34. It was **not adopted**: it would move an already-recorded frontier and confound every comparison against it, and it needs its own correctness proof. It is recorded so that the estimate has an owner rather than being rediscovered (WLD-16) | **unowned** — see [risks.md](risks.md) §3 |
| Where the rule application's time goes, between the array traversals and the plan walk | §5.9 prices the whole application and bounds the Python-level plan walk at about 17 us per call at 256 tiles, but the split between the traversals and the interpretation is not decomposed — and §5.9 shows the cost is not monotone in the plan size, so a model would have to explain that too (WLD-15) | **unowned** — see [risks.md](risks.md) §3 |
| Rules actually checked against the dense oracle | The equivalence suite checks **14**; §5.9 prices eight of those and §5.8 three. The compile-time bound covers all 512 single sets, but over all 262144 `(birth, survive)` pairs the measured maximum is 24 (WLD-14), so the space is covered by a bound that is wider than the assertion, and by behavioural evidence for 14 rules | **unowned** — see [risks.md](risks.md) WLD-14 |
