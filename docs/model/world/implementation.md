# world — implementation

> This file owns how the module is built: its layout, the algorithms that matter
> and their complexity bounds, the environment it requires, its configuration,
> and the reasoning behind its structural choices, including the alternatives
> that were rejected. The contract it implements is owned by
> [interfaces.md](interfaces.md); the measurements by [performance.md](performance.md).

## 1. Layout

```
src/lifegame/world/
  __init__.py     the facade: re-exports the eleven public names and defines __all__
  rules.py        LifeRule, CONWAY, MAX_NEIGHBOURS, require_local_birth — the rule
                  vocabulary, its text form and its packed masks
  errors.py       OutOfBoundsError — the shared error for one condition
  change.py       Change, EMPTY_CELLS — what one advance produced, cell by cell
  sparse.py       SparseWorld — packed keys, sort-based counting
  tiled.py        TiledWorld, TILE_BITS, TILE_CELLS — bit-packed 64 x 64 tiles
  dense.py        DenseWorld, MAX_DENSE_CELLS — the oracle and the measured baseline
  bridge.py       the line protocol: PROTOCOL_VERSION, decode_cells, encode_frame, Bridge, main
  __main__.py     the process entry point for python -m lifegame.world
tests/world/
  test_rules.py               the rule object
  test_world_contract.py      the shared contract, parameterised over all three representations
  test_patterns.py            published Life behaviours and the boundary condition
  test_tiled.py               what the tiled representation promises beyond the contract
  test_oracle_equivalence.py  the three representations against each other
  test_rule_equivalence.py    every shipped rule against the dense oracle
  test_bridge.py              the protocol, against a real child process
  test_benchmark.py           the measurement harness, excluded from the default run
```

Four files carry substance: [sparse.py](../../../src/lifegame/world/sparse.py)
and [tiled.py](../../../src/lifegame/world/tiled.py) carry the two shipped
representations and their steps,
[bridge.py](../../../src/lifegame/world/bridge.py) carries the protocol and the
run loop, and [dense.py](../../../src/lifegame/world/dense.py) is the oracle
those two are checked against. Everything else is small on purpose: the rule
object, the error type and the change record are shared vocabulary, and the
facade is a list of eleven names.

The two shipped representations are **independent below the shared vocabulary**.
They share the rule object, the error type, the change record and the public
contract, and nothing else: no step, no storage layout, no coordinate encoding,
and no call from one to the other. That is what makes the oracle test evidence
about the rule rather than about a shared mistake, and it is enforced as a
structure rather than as an intention in
[internal-components.md](internal-components.md) §2. The three shared pieces are
vocabularies rather than algorithms — a rule, an exception, a dataclass holding
coordinates — and sharing a vocabulary cannot make two implementations agree by
construction.

The layout follows [DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §5: one
package directory, a facade that re-exports the documented surface, and one test
package per module. This module has no private sub-package; its files are the
private categories, and a component is a responsibility rather than a directory
([internal-components.md](internal-components.md)).

## 2. Prior art

* **The `B/S` notation** for birth and survive counts, and the naming of the
  Conway rule as `B3/S23`, come from the Life community and are what
  `LifeRule.notation` reports.
* **The algorithm families** for Life — bit-parallel dense, sparse active sets,
  and quadtree memoisation (HashLife), with the last winning only on
  self-similar patterns — are as surveyed in the G4G13 Life algorithm survey and
  recorded in [ADR 0005](../../adr/simulation-core/0005-sparse-representation-at-target-scale.md).
  The module now ships **two** of the three: the sparse active set, and the
  bit-parallel family in the form of fixed tiles. A plain dense grid is kept as
  the correctness oracle.
* **Bit-packed tiles with a halo** are the classical way to run Life fast, and
  the shape this module's tiled representation takes: cut the plane into fixed
  tiles, store a tile as one machine word per row, and advance a whole tile with
  word-parallel boolean algebra. The specific arrangement here — a 66-row window
  built from the tile's own rows plus borrowed edge rows, and a ripple-carry
  counter over eight neighbour bit planes — is the standard "shift and add"
  formulation rather than an invention.
* **Sort-based neighbour counting** is the standard vectorised trick for sparse
  cellular automata when the substrate has no hash map: concatenate each live
  cell's neighbourhood, sort, and read run lengths as neighbour counts. The
  sparse step is that trick, with the bounds mask folded into the concatenation.
* **Implicit lookup tables** — two `bool` arrays of length nine indexed by the
  neighbour count — are the standard way to make an arbitrary rule a single
  gather instead of a chain of comparisons.
* **Separating the count from the decision** is the standard way to evaluate an
  outer-totalistic rule bit-parallel: sum the eight neighbour bit planes into
  planes holding the neighbour count, then derive the two outcomes from those
  planes with a boolean network, so the rule never becomes a per-cell branch.
  The specific network here — a two-level selection over four count groups,
  driven by a packed mask — is this module's form of it, and §3.3 states what it
  costs; the alternative of one equality term per named count is the rejected
  design in §7.

No algorithm here is novel. What is specific to this module is the choice of a
bounded plane at a 65536 x 65536 target, and the measured finding that **neither
family wins everywhere**: the sort-based step's cost follows live cells and the
tiled step's follows non-empty tiles, so the two swap places when the population
changes shape ([performance.md](performance.md) §5). The gap
[ADR 0009](../../adr/simulation-core/0009-sort-based-sparse-does-not-scale-to-the-target.md)
recorded is closed by the second family for a clustered population and open for a
diffuse one ([performance.md](performance.md) §6); the adoption itself is
[ADR 0010](../../adr/simulation-core/0010-tiled-bit-parallel-representation.md).

## 3. Algorithms and complexity

`L` is the live population and `A = width * height` is the world's area.

### 3.1 The sparse step — `O(L log L)` time, `O(L)` memory

| Stage | Work | Bound |
|---|---|---|
| Decode packed keys into `x` and `y` arrays | two vectorised masks | `O(L)` |
| Build the eight neighbour arrays, masking each offset against the bounds | eight vectorised adds and compares, with compaction of the in-bounds entries | `O(L)` |
| Concatenate the live keys with the in-bounds neighbours | one array of at most `9L` entries | `O(L)` |
| Sort and count: `numpy.unique(..., return_counts=True)` | comparison sort | `O(L log L)` |
| Decide survival: `numpy.searchsorted` into the live keys, then compare | binary search per candidate | `O(L log L)` |
| Neighbour count, table gather, change count | three vectorised passes over the candidates | `O(L)` |
| Bind the next live set | one gather | `O(L)` |

The `log` factor comes from sorting, and it is paid twice: once inside
`numpy.unique` and once in the membership search. Memory is `O(L)`: the live
keys plus one candidate array of at most `9L` entries and its intermediate
outputs.

A fast path exists for a world whose live cells have no neighbour inside the
world at all: every such cell has zero neighbours and dies, so the step returns
`population` changes and binds an empty array without sorting anything.

### 3.2 The dense step — `O(A)` time and memory, independent of `L`

Pad the grid with a dead border, add eight shifted slices into a `uint8`
neighbour array, gather from the same two tables, and compare with the previous
grid to count changes. The cost is the world's area, which is exactly why it is
not a candidate at the target — one byte per cell is 4.29 GB — and why it is a
fair oracle: it shares nothing with either shipped step below the rule object.

### 3.3 The tiled step — `O(M)` word operations, `M` active tiles

`M` is the number of **active tiles** and one array element is one 64-cell word,
so a step touches `O(M)` elements and each element advances 64 cells.

| Stage | Work | Bound |
|---|---|---|
| Active set | the non-empty tiles, plus the eight neighbours of any tile whose border is non-empty | `O(M log M)` from one `numpy.unique` over at most `1 + 8M` keys |
| Bind the active rows | allocate `(M, 64)` `uint64`, scatter the stored rows into it | `O(M)` |
| Gather the eight neighbouring tiles' rows | eight binary searches into the active keys | `O(M log M)` worst case, `O(M)` when the active set is almost all neighbours |
| Build the 66-row window | the tile's 64 rows with one borrowed row above and below | `O(M)` |
| Fold the horizontal neighbours in | the left and right tiles' carry bits shifted into the window's ends, with the diagonal tiles supplying the borrowed rows' own horizontal neighbours | `O(M)` |
| Eight neighbour bit planes | eight shifted slices of the window | `O(M)` |
| Count neighbours | a ripple-carry adder over the eight planes, four levels of `xor` and `and` each | `O(8 * 4 * M)` = `O(M)` |
| Apply the rule | the compiled selection network over the four count planes (§3.4) | `O(M)`, with a constant that depends on the shape of the two sets and not on `M` or on the world |
| Mask a partial tile to the world | a column mask and, for the last tile row, a row mask | `O(M)` |
| Change count | `numpy.bitwise_count(after ^ before).sum()` | `O(M)` |
| Drop tiles that died | a row-wise `any` and one compaction | `O(M)` |

The two loops that look expensive are the ones that matter, and both are over a
**constant**: four carry levels per plane, and eight planes. There is no factor
of `L` anywhere in the step, which is the whole point — one word operation
carries 64 cells, so a tile holding a thousand live cells costs the same as a
tile holding four.

**The active set is what makes it correct.** A birth can only appear in a tile
that is adjacent to a live cell, so stepping only the non-empty tiles would miss
every birth across a tile seam. The active set is therefore the non-empty tiles
*plus the eight neighbours of any tile whose border is not empty* — a tile whose
border is empty cannot contribute a neighbour across the seam, so expanding it
would be wasted work. Interior tiles of a dense region have neighbours that are
already active, so the expansion costs nothing there; it costs up to nine times
for an isolated tile, which is precisely the shape where the sparse
representation is the better tool. That trade is the reason the frontier is
measured over two shapes rather than argued from the algorithm's shape
([performance.md](performance.md) §5).

**The window is what makes the shifts legal.** A horizontal shift inside a tile
needs the bit that falls off one end, and that bit belongs to the neighbouring
tile. The step builds a `(M, 66)` window — the tile's own 64 rows, one borrowed
row above and one below — and carries the left and right neighbours' edge bits
into the shift at the window's ends. The borrowed rows' own horizontal neighbours
come from the diagonal tiles, which is why the diagonal tiles are gathered
separately: a cell in the row above and one column to the left is neither in the
tile above nor in the tile to the left.

**Complexity.** `O(M)` word operations per step, where `M` is the active tile
count, against the sparse step's `O(L log L)` per-cell operations. Memory is 512
bytes per non-empty tile for the stored rows, plus several `(M, 64)` working
arrays of the same order during a step. At the design target a tile covers 4096
cells, so the number of tiles a world needs is its occupied area divided by 4096
— not a function of how many cells are live inside them, which is the fact the
whole projection in [performance.md](performance.md) §6 rests on.

### 3.4 The compiled rule — a selection network over the count planes

What the adder chain of §3.3 leaves behind is four planes: bit `k` of plane
`p_k` is bit `k` of one cell's neighbour count, and the count exists nowhere
else. The rule is a boolean function of those four bits, and it has to be
evaluated at all 64 cells of a word at once, so the rule is **compiled** once per
`set_rule` rather than evaluated per cell. Two classes in
[tiled.py](../../../src/lifegame/world/tiled.py) carry this: `_PlanBuilder` emits
the plan and shares its operands, and `_SelectionNetwork` holds the result and
executes it.

| Stage | Work | Cost |
|---|---|---|
| Pack the sets | `rule.birth_mask` and `rule.survive_mask`: bit `i` set when count `i` is in the set | once per rule, not per step |
| Group counts `0..7` | the four counts of a group differ only in their 1s place, so a group is selected by its 2s and 4s bits: `p1` or `~p1`, `p2` or `~p2`, one AND | one AND per named group |
| Select within a group | the even member (`& p0`), the odd member (`& ~p0`), or both (`in_group` itself) | at most one more operation per named group |
| Fold in count `8` | a count of eight sets the 8s plane and leaves the other three clear, so it lands in group 0's even term: if the set names `8`, `\| p3`; if it names `0` but not `8`, `& ~p3` to hold that term off it | at most one operation |
| Share between the two sets | every operand the sets have in common is emitted once (`_PlanBuilder._shared`, keyed by the operation and its operands) | removes the duplicated sub-expressions |
| Mix with the state | `next = (alive & survive) \| (~alive & born)`, with the degenerate cases folded away: one set empty returns `alive & survive` or `~alive & born`, both empty returns all-dead, and equal plans return the plan itself | four operations, or fewer |

Three properties of that construction are what the module's complexity claim
rests on, and each is measured rather than estimated:

* **One set costs at most sixteen word operations.** `_PlanBuilder.select` was
  run over all **512** subsets of `0..8` and none produces more; a test asserts
  it ([test_no_rule_compiles_to_more_than_sixteen_word_operations](../../../tests/world/test_rule_equivalence.py)).
  **A *pair* of sets can cost more than sixteen, because the two sets do not share
  everything**: over all **262144** `(birth, survive)` pairs the measured maximum
  is **24** (for example `B13578/S0246`), and 124240 pairs exceed sixteen. The two
  numbers are different quantities and WLD-14 records the gap between the
  documented bound and the asserted one.
* **Conway compiles to three operations, and nothing special-cases it.** `B3/S23`
  is `p1 & ~p2` for survival and `p1 & ~p2 & p0` for birth, sharing the first two,
  against the seven word operations of the hand-written expression
  `~p3 & ~p2 & p1 & (alive | p0)` this version replaced. **There is no
  `if rule == CONWAY` branch anywhere in the module**; the specialised expression
  is what the compiler produces for that rule, and a test asserts the number
  rather than the branch. The measured plans are `B3/S23` 3, `B2/S` 4, `B36/S23`
  7, `B3/S12345` 9, `B3/S012345678` 11, `B3678/S34678` 13, `B1357/S1357` 13 and
  `B/S` 0 (a plan of no steps, whose next state is all dead).
* **The rule adds a constant and not a factor.** The plan's size depends on the
  shape of the two sets and not on the number of cells, so the step stays `O(M)`
  over active tiles, exactly as it was when the rule was written into the step.
  What the constant costs in practice is measured in
  [performance.md](performance.md) §5.7 to §5.10.

**The two failure modes this construction is exposed to are the ones the oracle
exists for**: a term that fires on the wrong count because a group was mis-read,
and a missed count of eight because group 0's even term fired where the 8s plane
is set. Neither is visible to a test that only ever runs Conway, which is why the
equivalence suite runs fourteen rules — including one whose set spans every
group, one with no survival, one with no birth, one where the two sets are equal,
and the count-of-eight edges — against the dense oracle cell for cell.

**A rule the local representations cannot run is refused before any of this.** A
birth on a count of zero falsifies the candidate-set reasoning the whole tiled
step and the whole sparse step are built on, so `require_local_birth` in
[rules.py](../../../src/lifegame/world/rules.py) raises `ValueError` from the
constructor and from `set_rule`
([interfaces.md](interfaces.md) §3.1, [risks.md](risks.md) WLD-13).

### 3.5 Mutation and the sorted-unique invariant

| Operation | Bound | Why |
|---|---|---|
| `is_alive` | `O(log L)` sparse, `O(log T)` tiled | one binary search, into the live keys or into the tile keys |
| `toggle`, `set_alive` | `O(log n)` to locate, `O(n)` to insert or delete | `numpy.insert`/`numpy.delete` move the tail of the array; `n` is the live population for the sparse world and the tile count for the tiled one |
| `load(n)` | `O((L + n) log(L + n))` sparse, `O((T + n) log(T + n))` tiled | concatenate, then `numpy.unique` |
| `restore(n)` | `load(n)`, plus `O(1)` | `clear` then `load`, then the generation counter is assigned. The bound is `load`'s because clearing is a rebind |
| `clear` | `O(1)` | binds an empty array |
| `bounds` | `O(L)` sparse, `O(M * 64)` tiled | a scan, over cells or over words |
| `viewport`, `live_cells_in` | `O(L + w * h)` sparse, `O(w * h / 64 + hits)` tiled | the tiled world reads whole words and unpacks them, which is the cost behind §7 of [performance.md](performance.md) |

The sparse invariant — sorted, unique, one packed key per live cell — is
maintained by every mutating operation. The tiled invariant is stronger in one
respect and weaker in another: only non-empty tiles are stored and the keys stay
sorted, but a tile's word may hold bits outside the world when the world's size
is not a multiple of 64, so every step re-applies the bounds mask. Both are what
make a click a memory move, and both sides of that trade are measured in
[performance.md](performance.md) §5.

### 3.6 Reporting what changed

`advance` returns a `Change` rather than only a number, and the whole reason it
can is that **both steps already compute it**. Neither representation re-derives
the difference from two snapshots:

| Representation | What it already holds | What naming the cells costs |
|---|---|---|
| sparse | `was_alive` and `next_alive`, two boolean arrays over the candidate set | one `~was_alive & next_alive` and one `was_alive & ~next_alive`, then decode the keys of each |
| tiled | the previous row words and the next row words, side by side | one `next & ~before` and one `before & ~next` per active tile, then unpack the bits |
| dense | the previous grid and the next grid | one comparison of two boolean arrays |

So `record=True` costs a comparison of two masks, and `record=False` costs
nothing: the sparse world returns the shared `EMPTY_CELLS` instead of decoding
keys, and the tiled world returns it instead of unpacking words. That is what
makes the flag an opt-out rather than a mode.

Re-deriving the difference from two full snapshots would have been the obvious
alternative and is the rejected design in §7: it costs a scan of the live
population per generation, which is the same order as the step itself, so it
would double the cost of the feature for every caller including the ones that
never ask.

The coordinate arrays are `(M, 2)` `int32` and are decoded through the same
helper the viewport reads use, so a `Change` and a `cells` frame carry the same
shape and the same order. A step that changes nothing returns the shared empty
array rather than a fresh one, so a settled world allocates nothing per
generation.

### 3.7 The protocol loop

One thread reads standard input and enqueues lines; the serve loop drains the
queue. While running, the loop waits for a request with a deadline of the next
tick, so a request always wins over a tick and the tick rate is maintained by
recomputing the next deadline from the monotonic clock rather than by sleeping a
fixed interval. Every outgoing line is written under one lock and flushed. The
per-request cost is `O(1)` plus the cost of the command itself.

Both `step` and the tick call one method, `Bridge.advance(count)`. With no
history attached it is a single call to the world. With one, it counts
generations one at a time and records each, because a timeline needs the
intermediate states: a single call to the world would leave the history with one
keyframe where ten generations happened. The mutation commands take the other
path — they re-record their own generation as a keyframe, because an edit changes
the world between two generations and the delta that reached the current one no
longer describes where the next step starts
([testing.md](testing.md) §6.4, [interfaces.md](interfaces.md) §4.9).

## 4. Environment

| Requirement | Value | Why |
|---|---|---|
| Python | 3.14 (the project requires `>=3.14`) | `slots=True` dataclasses, `zip(..., strict=True)`, and the type syntax used throughout |
| numpy | `>=2.5`, measured on 2.5.3 | the array substrate and the sort the step is built on ([ADR 0006](../../adr/simulation-core/0006-numpy-is-the-vectorised-substrate.md)) |
| Platform | a 64-bit platform with 64-bit numpy integers | packed keys use the high half for `y` |
| Extras | none | no compiler, no service, no browser is needed to import or test the module |

The module reads no environment variable and writes no file. Its transient
locations are the environment module's business
([scripts/env.ps1](../../../scripts/env.ps1)).

## 5. Configuration and relocation

There is nothing to configure and nothing to relocate.

* **World size** comes from the constructor, or from `--width` and `--height` on
  the entry point, which default to 65536.
* **Rule** comes from the constructor and defaults to `CONWAY`, and it can be
  replaced at any time with `set_rule`, or over the protocol with `set_rule`
  ([interfaces.md](interfaces.md) §4.2.1). It is the one part of a world's
  configuration that is not fixed: the decision tables — and, for the tiled
  world, the compiled plan of §3.4 — are rebuilt from the new rule rather than
  patched, so a step after a switch cannot read the previous rule's decision.
  Nothing else about the world moves: cells, population and the generation
  counter are untouched, and a running core keeps running. A rule the two
  locality-based representations cannot run is refused here, before anything is
  rebuilt ([interfaces.md](interfaces.md) §3.1).
* **Representation** comes from the protocol's `--representation` argument and
  defaults to `sparse`. Both options serve the same protocol, the same commands
  and the same frame encodings; the difference is cost, not behaviour. There is
  no configuration file and no automatic choice — a caller states it
  ([risks.md](risks.md) WLD-09).
* **History** comes from the protocol's `--history PATH` argument and defaults to
  none. A core without it records nothing and refuses the three timeline
  commands; a core with it opens a store at that path and records every
  generation. The path is the only thing in this module that names a file, and
  the module writes none itself — the [store](../store/overview.md) does, through
  the session the bridge was handed. Whether a core records is visible to a
  client as the `history` flag of `hello`.
* **Limits** are module constants and are part of the interface:
  `MAX_DENSE_CELLS`, `TILE_BITS`, `TILE_CELLS`, and the protocol's
  `PROTOCOL_VERSION`, `MIN_TICKS_PER_SECOND`, `MAX_TICKS_PER_SECOND`,
  `DEFAULT_TICKS_PER_SECOND`, `MAX_STEPS_PER_REQUEST`, `DEFAULT_WORLD_SIZE`,
  `DEFAULT_REPRESENTATION`, `REPRESENTATIONS` and `_MAX_COORDINATE`. The ones the
  protocol enforces are advertised in `hello` under `limits`
  ([interfaces.md](interfaces.md) §4.8), so a client does not keep a copy that
  can drift from the value being enforced.
* **No configuration file and no environment variable.** A deployment that needs
  a different world size passes it; a deployment that needs a different rule
  constructs the world in Python or sends `set_rule`.

## 6. Why: the structural choices

| Choice | Reason |
|---|---|
| Sparse cells instead of a dense grid | The design target is 4.29e9 cells; one byte per cell is 4.29 GB before a step runs, so a dense world cannot exist there at all ([ADR 0005](../../adr/simulation-core/0005-sparse-representation-at-target-scale.md)) |
| A second representation rather than one | The measurement says the two cost models are not comparable: the sparse step pays per live cell and the tiled step pays per non-empty tile, so each wins on a different shape. Shipping one would mean shipping a known-wrong default for the other shape ([performance.md](performance.md) §5) |
| 64 x 64 tiles, one `uint64` per row | 64 is the machine word, so one operation carries 64 cells; a square tile keeps the halo symmetric; and expressing a tile as a `(rows, 1)` column of words is what makes the step vectorise across tiles in numpy rather than looping in Python ([performance.md](performance.md) §1) |
| A `(M, 66)` window instead of special-casing the edges | A horizontal shift needs the bit that falls off the end, and that bit belongs to another tile. Borrowing a row above and below and folding the left and right neighbours' carry bits into the ends makes every shift a plain numpy shift, with no branch and no per-edge case |
| A ripple-carry adder over eight bit planes | It is branch-free and vectorised: eight planes, four levels, each level an `xor` and an `and` over `(M, 64)` arrays. Indexing a table by a `uint8` neighbour count would need the count materialised first, which costs more memory traffic than the adder |
| The active set expanded by the border rule, not by all nine neighbours unconditionally | A birth can only appear next to a live cell, and a tile whose border is empty cannot contribute one. Expanding every tile unconditionally would cost nine times on exactly the sparse shape where the tiled world is already the wrong tool |
| Packed keys with `y` in the high 32 bits | One `int64` per cell instead of two coordinates, so the live set is one sortable array; `y` in the high half means a neighbour offset added to the low half cannot carry into `y`, and the key order is row-major, which makes `live_cells()` naturally ordered. The tiled world uses the same packing, so a tile key and a cell key are different things of the same shape |
| A sorted array plus `numpy.unique` instead of a hash table | numpy has no vectorised hash map. A Python `dict` is the alternative and it is the measured naive candidate; sorting is what a vectorised substrate does well |
| Two `bool` tables indexed by neighbour count | An arbitrary `B/S` rule becomes one gather instead of a chain of comparisons, and the rule costs nothing in the inner loop of the two per-cell representations, whose counts are materialised numbers |
| One rule object that carries tables *and* packed masks | The two kinds of step need two forms of the same decision: a per-cell step indexes a table by a count it already has, and a bit-parallel step cannot branch per cell, so it needs the set as a mask it can select with. Deriving both once, in the object, is what lets a rule switch be one call in every representation with no second reading of the same text |
| The rule compiled once per `set_rule`, rather than evaluated per step or per cell | The plan's size is a property of the rule, not of the world, so compiling it once turns an arbitrary rule into a fixed sequence of word operations. Evaluating the rule per step would re-derive the same network every generation, and a per-cell branch is impossible in a 64-cell word |
| A rule that is not local refused rather than answered | A birth on a count of zero makes the next state depend on the world's area, which the two locality-based representations never visit. The answer they can produce is a plausible subset of the correct one — measured at 39 cells against a correct 63 — so there is no reply that is both useful and honest other than a refusal ([interfaces.md](interfaces.md) §3.1) |
| The bounds mask folded into candidate construction | The boundary condition is enforced once per step, in the same vectorised pass that builds the candidates, rather than in a separate correction pass. The tiled world does the same thing with a column mask and a row mask applied to whole words |
| Mutation rebinds the array instead of editing it | A failed operation leaves the world untouched, and a previously returned `keys()` view becomes stale but never corrupt (see [data-flow.md](data-flow.md) §5.1) |
| A dense world kept as an oracle | It shares nothing with either shipped step below the rule object, so agreement on randomised states is evidence about the rule, the boundary condition and the coordinate encoding — not about a shared bug |
| The change count compared as cells, not as storage elements | The tiled world stores 64 cells per array element, so an element count is wrong by up to a factor of 64. It was wrong once ([testing.md](testing.md) §6.2), and the count is now part of the shared contract |
| Reporting what changed as a value the caller opts into | Both steps already hold the previous and the next mask side by side, so naming the cells is a comparison rather than a rescan. A history layer needs the cells and a protocol needs only the count, so the cells are opt-in and the opt-out allocates nothing |
| The protocol defined here, not in the service | The core is the authority for the world; a protocol owned by its consumer would freeze the consumer's assumptions into the core |
| JSON per line, one object per request | Trivially framed and parseable from any language, and readable by hand when something goes wrong. A binary protocol would be faster and would make the module undebuggable at the shell |
| Ticking driven by the request queue's timeout | One thread, no timer thread, and a request always wins over a tick, so a busy service is never starved by the run loop |

## 7. Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| `line-protocol` importing the [store](../store/overview.md) module | The store imports this module, so the edge would be a cycle; and the protocol needs only five methods, not the schema, the backends or the archive format. The session is injected as an argument instead, and only the console entry point imports it — see [internal-components.md](internal-components.md) §2 |
| The protocol holding its own history instead of injecting one | It would have to own a lifetime, a schema and a file format, which is the store's job, and a core started without `--history` would pay for all of it. A core with no history calls the world once per `step` and allocates nothing for recording |
| A pure-Python `set` of coordinates with a `dict` of neighbour counts | Measured, not dismissed: it is correct and obvious, and it loses to the sparse step by roughly 4x at 400 live cells and 6x at 4,000, with a worse slope ([performance.md](performance.md) §5) |
| A dense grid at the target scale | 4.29 GB, and every step touches all of it. The constructor refuses rather than trying |
| A hash-based sparse set in numpy | numpy has no vectorised hash table; the sort is the vectorised alternative |
| Quadtree memoisation (HashLife) | Asymptotically the best answer for self-similar patterns and the wrong general default: a different world model, substantially more complex, and its advantage is pattern-dependent ([ADR 0009](../../adr/simulation-core/0009-sort-based-sparse-does-not-scale-to-the-target.md)) |
| Two coordinate arrays instead of packed keys | Two sorts per step, twice the memory movement, and a lexicographic comparison instead of an integer one |
| Retaining the candidate array between steps | Saves one allocation and keeps `9L` entries alive for the world's lifetime |
| A Python loop over tiles, one tile at a time | The step is a few dozen word operations per tile; in Python the interpreter overhead per tile would dominate them. Vectorising across tiles and rows at once is the reason the representation is expressible in numpy at all |
| Stepping every tile in the world, or every tile in a bounding box | A world at the target has 1,048,576 tiles. Stepping all of them discards the entire advantage; a bounding box is a smaller version of the same mistake, because a diagonal glider pair would still fill it with empty tiles |
| Advancing only the non-empty tiles | It is the obvious optimisation and it is wrong: a birth can appear in a tile that held no live cell before the step, so every birth across a tile seam would be missed. [test_tiled.py](../../../tests/world/test_tiled.py) pins both the straight and the diagonal seam case |
| A per-tile halo recomputed from scratch each step | The stored rows are the compact form; a halo laid out explicitly around every tile would multiply storage by nine for the same information the neighbour lookup already provides |
| A wrapping (torus) world, or a runtime switch between wrapped and bounded | Rejected as a decision in [ADR 0008](../../adr/simulation-core/0008-the-world-is-bounded-and-does-not-wrap.md); a per-instance switch would let the representations disagree, which would make the oracle test meaningless |
| A binary frame encoding | The two current encodings are already compact, and a binary framing would cost the protocol its hand-debuggability |
| Translating numpy errors into module-specific exceptions | The module would have to enumerate numpy's failure modes and keep up with them; the protocol classifies them as `internal` instead |
| Deriving what changed from two whole snapshots | It would cost a scan of the live population per generation — the same order as the step itself — for every caller, including the ones that never ask what changed. Both steps already hold the two masks side by side |
| A save format in this module | Persistence is a compatibility contract of its own and it is not what makes a world buildable or steppable. It now lives in [store](../store/overview.md), which reads a world through `advance` and writes into one through `restore` |
| Recording a generation on the line protocol | The protocol moves a whole world, and `export` and `import` already cover moving one between representations. A history has a lifetime, a database and a file format of its own, and none of those belongs to a protocol that answers requests about one world |
| Choosing the representation automatically | There is no measurement that says which quantity to dispatch on or where the threshold is, and a wrong automatic choice would be silently slow. The choice is explicit until that measurement exists ([risks.md](risks.md) WLD-09) |
| One equality term per neighbour count the rule names | The obvious way to turn a set into word operations: a term that fires where the count equals `c` costs four operations, so a rule costs `4|B| + 4|S|` and the worst rule — all nine counts in both sets — costs 72 against the selection network's at most 16 per set. It also pays twice for the counts the two sets share, where the network emits each shared operand once |
| An `if rule == CONWAY` path beside a general one | The version this replaces had exactly that, in the form of Conway's expression written into the step. Keeping it would mean two code paths to prove equivalent, and the general path reproduces the specialised expression anyway: `B3/S23` compiles to three word operations against the expression's seven, so the branch would buy nothing and could only drift |
| A per-cell decision table inside the tiled step | The step's whole advantage is that one word carries 64 cells. Materialising a neighbour count per cell to index a table by it costs more memory traffic than the adder chain that produces the planes, and it would put a Python-level loop back into the step |
| Making a `B0` rule work in the sparse and tiled worlds | A birth on zero has to be applied to every cell of the world's area, which is 4.29e9 cells at the design target. Computing that inside a representation built on the neighbourhood of live cells means materialising the area — a different representation, not a fix to these two. [DenseWorld](../../../src/lifegame/world/dense.py) is that representation at the sizes it can hold, and it stays the oracle for a `B0` rule |

## 8. Known implementation gaps

| Gap | Where it is recorded | Owner |
|---|---|---|
| A population spread across the target world is still slow under both representations: the tiled step's cost follows non-empty tiles, so a diffuse population fills nearly every tile | [risks.md](risks.md) WLD-01, [performance.md](performance.md) §6 | **unowned** — see [risks.md](risks.md) §3 |
| The representation is chosen by the caller or from the interface, and no shape-aware dispatch exists, so the default is the slower one for a clustered population | [risks.md](risks.md) WLD-09, [performance.md](performance.md) §5.4 | **unowned** — see [risks.md](risks.md) §3 |
| The tiled world wins on stepping and loses on querying, which is a trade-off a viewer pays for | [risks.md](risks.md) WLD-10, [performance.md](performance.md) §7 | **unowned** — see [risks.md](risks.md) §3 |
| The protocol has one implementation and nothing tests an older consumer against a newer core; `export`, `import` and the three timeline commands were all added without a compatibility case | [risks.md](risks.md) WLD-06, phase risk R14 | **unowned** — see [risks.md](risks.md) §3 |
| A recorded timeline does not survive a representation switch: the switch starts a new core, so the timeline restarts at the generation that was carried over | [risks.md](risks.md) WLD-12 | the version naming phase 03 milestone 01 in [VERSIONS.md](../../plan/VERSIONS.md) |
| What recording every generation costs. The claim that naming the changed cells is a mask comparison rather than a rescan is the reason the cells are opt-in, and neither representation has been timed with and without it | [performance.md](performance.md) §10, [testing.md](testing.md) §8 | **unowned** — see [risks.md](risks.md) §3 |
| The mutation path is linear in the representation's unit per click; there is no batched multi-click entry point | [risks.md](risks.md) WLD-04, [performance.md](performance.md) §10 | not scheduled; a viewer that sends many clicks per frame would make it worth measuring |
| The `internal` error code can present a real bug as a protocol-level refusal, and nothing triggers it | [risks.md](risks.md) WLD-07, [testing.md](testing.md) §8 | the version that owns M02 in [VERSIONS.md](../../plan/VERSIONS.md) |
| No coverage measurement exists for the module | [testing.md](testing.md) §8 | the version that owns M02 in [VERSIONS.md](../../plan/VERSIONS.md) |
| The measurement harness is excluded from the default test run, so a regression in it is only found when someone runs the benchmark | [testing.md](testing.md) §2 | the version that owns M01 |
| No phase profile exists for the tiled step; only the sparse step has been decomposed | [performance.md](performance.md) §8 and §10 | the version that names phase 02 milestone 02 |
| A carry-save (3:2) adder tree is an unmeasured candidate for the count chain, the largest single part of a step; it was not built | [performance.md](performance.md) §10, [risks.md](risks.md) WLD-16 | **unowned** — see [risks.md](risks.md) §3 |
| The compile-time plan bound is asserted for one set at a time, not over all `(birth, survive)` pairs, where the measured maximum is 24 rather than 16 | [risks.md](risks.md) WLD-14, [performance.md](performance.md) §10 | **unowned** — see [risks.md](risks.md) §3 |
| The compiled plan is interpreted in Python, which is why a three-operation Conway plan costs more than the seven-operation expression it replaced | [risks.md](risks.md) WLD-15, [performance.md](performance.md) §5.9 | **unowned** — see [risks.md](risks.md) §3 |
| Only fourteen rules have been run against the dense oracle, so the uncovered rule space is bounded by a compile-time argument rather than by behaviour | [risks.md](risks.md) WLD-14, [testing.md](testing.md) §1 | **unowned** — see [risks.md](risks.md) §3 |
