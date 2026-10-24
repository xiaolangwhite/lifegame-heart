# world — interfaces

> This file owns the module's public surface: the Python import surface, the
> world contract all three representations satisfy, and the line protocol in
> full. The protocol's authoritative definition is the module docstring of
> [bridge.py](../../../src/lifegame/world/bridge.py); this file restates it
> completely and must stay consistent with it. Claims are owned by
> [responsibilities.md](responsibilities.md); mechanism by
> [implementation.md](implementation.md).

## 1. Surface inventory

There are **two** public surfaces, and they are entered differently.

| Surface | Entered by | Defined by |
|---|---|---|
| Python import surface | `from lifegame.world import ...` | [src/lifegame/world/__init__.py](../../../src/lifegame/world/__init__.py) and its `__all__` |
| Line protocol | `python -m lifegame.world` | [src/lifegame/world/bridge.py](../../../src/lifegame/world/bridge.py) |

The import surface is exactly eleven names:

```python
__all__ = [
    "CONWAY",
    "EMPTY_CELLS",
    "MAX_DENSE_CELLS",
    "TILE_BITS",
    "TILE_CELLS",
    "Change",
    "DenseWorld",
    "LifeRule",
    "OutOfBoundsError",
    "SparseWorld",
    "TiledWorld",
]
```

`bridge.py` is **not** one of them. The protocol is a process interface, not an
import surface, and exporting its Python internals would freeze a shape that is
not promised. `bridge.py` declares its own `__all__` for the entry point and the
one helper a consumer may want:
`PROTOCOL_VERSION`, `Bridge`, `decode_cells`, `encode_frame`, `main`.

## 2. The world contract

All three representations expose the same surface, so a caller may hold any of
them without knowing which. This is claim W5 in
[responsibilities.md](responsibilities.md) §1 and the shared contract test is
its enforcement.

### 2.1 Construction

```python
SparseWorld(width: int = 65536, height: int = 65536, rule: LifeRule = CONWAY) -> SparseWorld
TiledWorld(width: int = 65536, height: int = 65536, rule: LifeRule = CONWAY) -> TiledWorld
DenseWorld(width: int, height: int, rule: LifeRule = CONWAY) -> DenseWorld
```

| Aspect | `SparseWorld` | `TiledWorld` | `DenseWorld` |
|---|---|---|---|
| Default size | 65536 x 65536 — the design target | 65536 x 65536 — the design target | none; both dimensions are required |
| Accepted dimensions | `1 <= width, height <= 2^32 - 1` | same range | `width * height <= MAX_DENSE_CELLS`, both positive |
| Rejected | non-positive, or above the coordinate limit, with a `ValueError` naming the range | same range, named the same way | non-positive area, or area above the limit, with a `ValueError` naming it and pointing at `SparseWorld` |
| Storage | one packed 64-bit key per live cell | one 64-cell word per tile row, for non-empty tiles only | one byte per cell, allocated in full at construction |
| Memory | about 8 bytes per live cell | 512 bytes per non-empty tile, plus the same order again while stepping | one byte per cell, in full |
| Step cost | proportional to the live population | proportional to the number of **active tiles**; 64 cells per word operation | proportional to the world's area, whatever the population |

A new world is empty: population `0`, generation `0`, no bounds.

The `rule` argument is the one constructor argument that can also be refused for
what it says rather than for the size it asks for, and the two locality-based
representations refuse different rules than the oracle does:

| Representation | A rule whose birth set contains `0` |
|---|---|
| `SparseWorld`, `TiledWorld` | **refused.** The constructor raises `ValueError` naming the reason (§3.1), because the rule is not local and neither representation can hold its output |
| `DenseWorld` | accepted. It scans the world's area by construction, so a birth on a count of zero is a state it can compute, and it is the representation a `B0` rule is run in |

Everything else about the rule argument is shared: the default is `CONWAY`, the
value is validated against the eight-cell Moore neighbourhood by the rule object
itself, and a count outside `0..8` raises `ValueError` naming the count and the
set it was in (§3).

### 2.2 Properties

```python
width: int          # the world's width, fixed for its lifetime
height: int         # the world's height, fixed for its lifetime
rule: LifeRule      # the rule in force, from the constructor or the last set_rule()
generation: int     # steps applied since construction or the last clear()
population: int     # number of live cells
```

`rule` is the one property that is not fixed for the world's lifetime, and the
call that replaces it is part of the shared contract:

```python
set_rule(rule: LifeRule) -> None
```

**A rule is not a state, and switching one is not an edit.** The cells and the
generation counter are left exactly where they were, so a rule change cannot be
mistaken for a `load`, a `clear` or an undo, and the next `step` applies the new
rule to the world as it stands. A world that is running keeps running: the change
is applied from the next generation rather than by restarting anything. The
subscription is the same call on all three representations, and it is the method
the protocol's `set_rule` command calls (§4.2).

The two lookup tables a representation steps with are **rebuilt from the new
rule** rather than patched, and the tiled world recompiles its plan (§3.1), so a
step after a switch cannot read a decision that belonged to the previous rule.
That property is asserted directly: a switched world is compared against a world
built with the rule in the first place
([test_rule_equivalence.py](../../../tests/world/test_rule_equivalence.py)).

A refused rule leaves the world's rule **unchanged**, which is what lets a caller
keep a running world while it decides what to ask for next:

| Refusal | Raised by |
|---|---|
| A rule that is not local — its birth set contains `0` | `SparseWorld.set_rule` and `TiledWorld.set_rule`, with `ValueError`; `DenseWorld.set_rule` accepts it |

`TiledWorld` adds one property that the others do not have:

```python
TiledWorld.tile_count: int   # number of non-empty tiles currently stored
```

It is the unit its step cost is proportional to, so it is what a measurement or
a diagnostic needs in order to say anything about the tiled world's behaviour;
the same reasoning that justifies `SparseWorld.keys()` justifies it.

### 2.3 Reading

```python
is_alive(x: int, y: int) -> bool
live_cells() -> Iterator[tuple[int, int]]
bounds() -> tuple[int, int, int, int] | None
viewport(x0: int, y0: int, width: int, height: int) -> numpy.ndarray
live_cells_in(x0: int, y0: int, width: int, height: int) -> numpy.ndarray
```

| Call | Returns | Ownership and lifetime |
|---|---|---|
| `is_alive` | a Python `bool` | a value; nothing to release |
| `live_cells` | an iterator of `(x, y)` Python ints, ascending `y` then ascending `x` | generated lazily; a snapshot, unaffected by later mutations |
| `bounds` | `(min_x, min_y, max_x, max_y)`, or `None` when the world is empty | a tuple; a value |
| `viewport` | a fresh `bool` array of shape `(height, width)`; the caller owns it and may write to it | a copy in all three representations — a caller cannot corrupt the world through it |
| `live_cells_in` | a fresh `int32` array of shape `(M, 2)`, columns `x` then `y`, **absolute** coordinates; empty is `(0, 2)`, never `None` | the caller owns it |

Two representations add one read each that the others do not have:

```python
SparseWorld.keys() -> numpy.ndarray   # read-only view of the packed live-cell keys
TiledWorld.tile_count -> int          # number of non-empty tiles currently stored
```

They are the two asymmetries in the shared surface, and both are deliberate.
The packed encoding is how the sparse world stores its cells, so exposing it lets
the measurement harness and any future persistence path work without decoding to
Python integers. The tile count is the unit the tiled world's step cost is
proportional to, so exposing it is what lets a measurement state the cost
against the thing that causes it. `DenseWorld` has no equivalent because it has
neither a packed encoding nor a sparse unit of work.

**Lifetime of `keys()`.** The returned array is a *view* into the world's live
array, marked non-writeable. Every mutating operation replaces that array rather
than editing it in place, so the view stays readable and valid, but it stops
tracking the world at the next mutation. A caller that needs a durable snapshot
must copy it. Mutating the returned array is a programming error and is refused
by numpy because the view is read-only.

### 2.4 Writing

```python
toggle(x: int, y: int) -> bool
set_alive(x: int, y: int, alive: bool = True) -> bool
load(cells: Iterable[tuple[int, int]]) -> int
restore(cells: Iterable[tuple[int, int]], generation: int = 0) -> int
clear() -> None
```

| Call | Returns | Notes |
|---|---|---|
| `toggle` | the cell's **new** state | refuses an out-of-bounds coordinate |
| `set_alive` | whether the call **changed** anything | setting an already-live cell to alive returns `False` |
| `load` | the number of cells that were **newly** added | duplicates inside the argument and cells already alive do not count |
| `restore` | the number of cells loaded | replaces the live set **and sets the generation counter**, which `load` cannot do |
| `clear` | nothing | removes every cell **and resets the generation counter to 0** |

**`restore` exists because `load` cannot express a saved state.** Loading a
pattern into an existing world leaves the generation counter where it was, so a
caller restoring generation 400 into a world sitting at generation 7 would get a
world whose cells are generation 400's and whose counter says 7. Nothing would
report the discrepancy, and the next recorded delta would claim the wrong parent.
`restore` sets both, and it is the method the protocol's `import` command and the
history layer's rollback both call.

`restore` clears first, so it is a replacement rather than a merge: a cell that
is live in the world and absent from `cells` is dead afterwards. A negative
`generation` raises `ValueError`. The default of `0` is the generation a
freshly-loaded pattern has.

Each of these maintains the representation's own invariant, and the invariant is
what makes the step cheap:

| Representation | Invariant a mutation must restore | What it buys |
|---|---|---|
| `SparseWorld` | the live keys stay sorted and unique | the step can count neighbours with a sort instead of a hash table |
| `TiledWorld` | only non-empty tiles exist, keys stay sorted, and a partial tile stays masked to the world's bounds | the step's active set is the set of tiles that can change, and no padding cell can become live |
| `DenseWorld` | none; every cell of the area is stored | nothing; that is the point of the oracle |

Mutation is linear in the population for the sparse world and linear in the tile
count for the tiled world, because both keep their keys in a sorted array and a
mutation is a memory move rather than a rehash.

### 2.5 Evolution

```python
advance(count: int = 1, *, record: bool = True) -> Change
step(count: int = 1) -> int
```

`step` is `advance(count, record=False).changed`. It applies the rule `count`
times and returns the number of **cells** that changed in the last application.
Generation advances by `count`. A change is a cell whose state differs between
the previous generation and the new one; a cell outside the candidate set — that
is, a dead cell with no live neighbour — cannot change by definition and is not
examined. A negative `count` raises `ValueError`. `count = 0` is accepted and
changes nothing.

`advance` is the same operation with the difference described: it returns a
`Change` naming **which** cells were born and which died. `record=False` is the
opt-out, and it is the only part of a step a caller can decline to pay for:
naming the cells costs a comparison of two boolean arrays in the sparse world and
of two row words in the tiled world, and nothing at all when a cell's state did
not change.

**The count is part of the contract, not an implementation detail.** All three
representations return the same number for the same transition, and that is
asserted directly (`assert_same_change_count` in
[test_oracle_equivalence.py](../../../tests/world/test_oracle_equivalence.py)).
It is stated here because it was once wrong in a way that state comparison could
not see: the tiled world stores one 64-cell word per array element, so a count
over elements reports "three" where four cells changed. The world's *state* was
correct throughout; only the number the API returned was wrong. State
equivalence is not API equivalence, and this is the example that proves it.

### 2.6 The change record

```python
Change(
    changed: int,
    generation: int,
    born: np.ndarray = EMPTY_CELLS,   # (M, 2) int32, x then y
    died: np.ndarray = EMPTY_CELLS,   # (M, 2) int32, x then y
)                                     # frozen, slots
EMPTY_CELLS: np.ndarray               # shape (0, 2), int32; shared, never mutated
```

| Member | Meaning |
|---|---|
| `changed` | how many cells changed, the same number `step` returns |
| `generation` | the world's generation **after** the advance |
| `born` | the cells that were dead and are now alive |
| `died` | the cells that were alive and are now dead |
| `recorded` | whether the caller asked for the cells rather than only the count |
| `bytes` | how much a stored delta of this change would occupy: `born.nbytes + died.nbytes` |

`born` and `died` are empty when the call was made without recording. That is
**not** the same as "nothing changed", which is what `changed == 0` says, and the
`recorded` property distinguishes the two: it is true when either array has rows
or when nothing changed at all. A consumer that needs to know what changed must
ask for it.

The coordinates are `(M, 2)` `int32`, `x` then `y`, absolute world
coordinates — the same shape and order the protocol's `cells` frame encoding and
the history layer's stored payload both use. Nothing in the record is
representation-specific, which is what lets a history recorded from a sparse
world restore into a tiled one
([store/interfaces.md](../store/interfaces.md) §2.4).

`EMPTY_CELLS` is a single shared array, so an advance with nothing to report
allocates nothing. It is never mutated: every producer builds a new array. A
caller must not write to it, and a caller that wants a durable copy of a
`Change`'s coordinates must copy them, because the arrays belong to the value
that produced them.

### 2.7 Exceptions raised

| Exception | When |
|---|---|
| `OutOfBoundsError` | a coordinate or a rectangle outside the world, from any of the three representations |
| `ValueError` | invalid construction (size, area limit, rule counts), a rule the representation cannot run (§3.1), a negative step count, or a viewport of non-positive area |

`OutOfBoundsError` is the module's one error type for one condition, and it
derives from `ValueError`:

```python
class OutOfBoundsError(ValueError):
    """A coordinate or rectangle outside the world's bounds was used."""
```

All three representations raise the same type with the same meaning, so a caller
does not have to know which representation it holds.

## 3. The rule object

```python
LifeRule(birth: frozenset[int], survive: frozenset[int]) -> LifeRule   # frozen, slots
CONWAY = LifeRule(birth=frozenset({3}), survive=frozenset({2, 3}))
MAX_NEIGHBOURS = 8
LifeRule.parse(text: str) -> LifeRule             # classmethod; the inverse of notation
```

| Member | Meaning |
|---|---|
| `birth` | the neighbour counts that bring a dead cell to life |
| `survive` | the neighbour counts that keep a live cell alive |
| `notation` | the rule in `B<digits>/S<digits>` form, digits ascending |
| `next_alive(was_alive, neighbours) -> bool` | the next state of one cell |
| `birth_mask`, `survive_mask` | the same two sets packed into a bit mask: bit `i` is set when count `i` is in the set |
| `birth_table`, `survive_table` | the same two sets as a nine-entry `bool` tuple indexed by the neighbour count `0..8` |

Instances are immutable and hashable, so a rule can be a mapping key or a
default argument. A count outside `0..8` raises `ValueError` naming the count
and which set it was in. `CONWAY.notation` is `"B3/S23"`, the notation the Life
community uses.

**The four derived members are precomputed once, and they are the whole point of
this being an object.** Everything a representation needs from a rule is derived
here rather than in each representation, so a representation adopts a new rule by
taking these values again and no representation keeps a second reading of the same
text. They are not constructor arguments and take no part in equality: the counts
are the rule, and the tables are its precomputed form. Two of them serve the two
kinds of step the module has — the per-cell representations index the tables by a
materialised neighbour count, and the tiled step consumes the masks because a
64-cell word cannot be branched per cell
([implementation.md](implementation.md) §3.4).

### 3.1 The text form, and the rules that are refused

`LifeRule.parse(text)` and `notation` are **inverse**: `parse(rule.notation) == rule`
for every rule. The accepted form is `B<digits>/S<digits>` in either case and with
the digits in any order, and the result is normalised — `S32` and `S23` are the
same rule and both print as `S23`, and `b3/s23` prints as `B3/S23`. An empty
section is legal: `B/S` is the rule in which nothing is ever born and nothing
survives.

A rejection names the single fault, because the caller that shows a person why a
rule was refused needs the reason rather than a boolean:

| Refused | Why |
|---|---|
| The empty string | there is no rule in it |
| A separator count other than one | `B3S23` and `B3/S2/3` are not the notation |
| A missing `B` section or a missing `S` section | the notation has both, always, even when one is empty |
| A character that is not an ASCII digit | the counts are digits; the section labels are the only letters |
| A count of `9` | a cell has at most `MAX_NEIGHBOURS` = 8 neighbours, so `9` is not a count any cell can have |
| A digit repeated inside one section | a set, written as a list of its members |
| A value that is not a string at all | the protocol's `set_rule` reports this as `bad_rule` rather than as a parse fault (§4.5) |

**A rule with a zero in its birth set is refused by the two locality-based
representations, and this is the one outward behaviour change this version
makes.** `require_local_birth(rule)` raises `ValueError` when `0 in rule.birth`;
`SparseWorld` and `TiledWorld` call it from their constructors and from
`set_rule`, and `DenseWorld` does not call it at all.

The rule is refused rather than answered because of what it means. A dead cell
with **no** live neighbour has a neighbour count of zero, so a birth on zero
brings *every* dead cell in the world to life, wherever it is:

```
a 65536 x 65536 world holds 4.29e9 cells
a B0 rule turns every one of the 4.29e9 into a live cell on the first step
```

Both locality-based representations are built on the fact that such a cell cannot
change: the sparse world only ever counts neighbours of cells next to a live one,
and the tiled world only steps tiles that hold or touch one. A `B0` rule falsifies
that fact, so the next state would depend on the world's *area* — the one quantity
neither representation can afford to visit — and the answer they can produce is
the cells near live ones, which is not the answer.

| Representation | A `B0`-class rule | Why |
|---|---|---|
| `SparseWorld`, `TiledWorld` | `ValueError` from the constructor and from `set_rule`; the message names the rule and points at `DenseWorld` | Their candidate sets are the neighbour sets of live cells, so a birth on zero is outside what they compute |
| `DenseWorld` | accepted and run | It scans the area by construction, so it is the representation that can hold the answer and the oracle a `B0` rule is checked with |

**What the refusal replaces is worth keeping in the record: the old behaviour was
not an exception, it was a wrong number.** Before this version the two
representations accepted a `B0` rule and applied it over their candidate sets. The
measured example is an 8 x 8 world holding one live cell under `B012345678/S`: the
correct next population is **63** and the sparse step reported **39**. The state
the caller got back was a plausible subset of the correct one and nothing in the
reply said so, which is why the response is a refusal and not a warning. The
consequence, its scope and what remains uncovered are WLD-13 in
[risks.md](risks.md).

The oracle was the instrument that made this visible, and it is the reason the
`B0` case is a tested property rather than a paragraph:
[test_a_rule_that_cannot_be_local_is_refused_rather_than_answered](../../../tests/world/test_rule_equivalence.py)
asserts that both locality-based representations raise on construction, that the
message names the reason, and that the dense oracle still runs the rule and
changes a cell.

### 3.2 The rule is compiled, not specialised

The tiled step does not evaluate a rule cell by cell and it does not hold an
expression for one particular rule. `set_rule` compiles the rule once into a
**selection network** over the four neighbour-count bit planes, and the compiled
plan is what a step executes
([implementation.md](implementation.md) §3.4). Two consequences are part of this
contract rather than of the mechanism:

* **The plan's size is a constant that depends on the shape of the two sets and
  not on the number of cells.** One set alone compiles to at most sixteen word
  operations, measured over all 512 subsets; the two sets share every operand they
  have in common. The step remains `O(active tiles)`.
* **There is no `if rule == CONWAY` branch anywhere in the module.** `B3/S23`
  compiles to three word operations, which is what the hand-written Conway
  expression cost, so the default rule pays nothing for the generality. A test
  asserts that number rather than the branch
  ([test_conway_compiles_to_the_expression_it_replaced](../../../tests/world/test_rule_equivalence.py)).

## 4. The line protocol

The core is the authority for the world. The service never computes a generation
itself and never reads the core's memory; it sends requests and renders what
comes back. The protocol is therefore owned by this module.

### 4.1 Transport

* One JSON object per line, UTF-8, on standard input and standard output.
* Requests carry an `id` and are answered with the same `id`.
* Unsolicited events carry an `event` field and no `id`.
* Every response is a single line, flushed immediately, so the service can
  pipeline.

### 4.2 Requests

| Command | Arguments | Reply on success |
|---|---|---|
| `hello` | none | `protocol`, `world` (`width`, `height`), `rule`, `running`, `tps`, `limits` and `history` (see §4.8) |
| `state` | none | `world`, `rule`, `generation`, `population`, `bounds` (a four-element list or `null`), `running`, `tps` |
| `toggle` | `x`, `y` integers | `x`, `y`, `alive` (the new state), `population` |
| `set` | `cells`: a list of `[x, y]` pairs; `alive`: boolean, default `true` | `changed` (how many cells the call actually changed), `population` |
| `patch` | `born`: a list of `[x, y]` pairs to make alive; `died`: a list of `[x, y]` pairs to make dead; `expectGeneration`: an integer equal to the current generation | `generation`, `population`, `bornCount`, `diedCount` (see §4.2.2) |
| `clear` | none | `generation` (`0`), `population` (`0`) |
| `set_rule` | `rule`: a `B<digits>/S<digits>` string | `rule` (the core's normalised notation), `birth`, `survival` (both ascending lists of counts) |
| `step` | `count`: integer, default `1`, in `0..100000` | `generation`, `population`, `changed` |
| `run` | `tps`: integer, default `10`, in `1..60` | `running` (`true`), `tps`, `generation` |
| `pause` | none | `running` (`false`), `generation` |
| `frame` | `x0`, `y0`, `w`, `h` integers | `frame`: see §4.6 |
| `export` | none | `export`: the whole live set, see §4.7 |
| `import` | `data`: a base64 string; `format`: optional, must be `cells`; `generation`: optional integer, default `0` | `changed`, `population`, `generation` |
| `history` | none | `session`, `current`, `head`, `count`, `generations`: see §4.9 |
| `select` | `node`: integer, the node's row id; or `generation`: integer, on the current branch | `node` (the id selected), `generation`, `population` |
| `rollback` | `generation`: integer | `generation`, `population`, `bounds` |
| `archive` | `path`: a non-empty string | `path`, `generations` (how many were written) |
| `open` | `path`: a non-empty string | `session` (the new session's id), `generation`, `population`, `rule`, `ruleKnown` |
| `quit` | none | `bye` (`true`), after which the process exits `0` |

`history`, `select`, `rollback`, `archive` and `open` need a core that was
started with a recorded history. Without one they are refused with
`bad_arguments` and a message naming `--history`, rather than being absent from
the protocol: a consumer that knows them can ask, and a consumer that does not is
unaffected.

Every successful reply also carries `"ok": true`, and carries `id` when the
request had one.

### 4.2.1 `set_rule`

```json
{"id":7,"cmd":"set_rule","rule":"b36/s32"}
{"ok":true,"id":7,"rule":"B36/S23","birth":[3,6],"survival":[2,3]}
{"id":8,"cmd":"set_rule","rule":"B0/S23"}
{"ok":false,"id":8,"error":"bad_rule","message":"B0/S23 is not a local rule: birth on a count of zero turns every dead cell in the world into a live one, including the cells no live cell is near, so this representation cannot hold the result; use DenseWorld, or a rule without a zero in its birth set"}
```

Four properties of that exchange are contract rather than presentation:

* **`rule` on success is the core's normalised notation, never an echo of the
  request.** `b36/s32` goes out and `B36/S23` comes back, because the core
  normalises what it accepts and a client that displays what it sent displays
  something the core never said. `birth` and `survival` are the same fact in
  numeric form, both ascending, so a client can label a preset without parsing
  the notation again.
* **A refused rule does not change the running rule.** The world keeps the rule it
  had, and a client that reads `rule` from the next `state` gets the rule that is
  actually in force. This is what makes it safe to offer a text field.
* **The command is not an edit.** Cells, population and the generation counter are
  untouched, so `set_rule` is not recorded as a change to the world's contents and
  a running core keeps running under the new rule from its next generation.
* **The reply carries no `generation`, `population` or `bounds`.** Nothing about
  the world changed except the rule, and repeating the world's shape would invite
  a client to treat the reply as a state update.

The refused forms are each answered with the reason rather than with a boolean,
and each is a distinct sentence: an empty string, a separator count other than
one, a missing `B` section, a missing `S` section, a character that is not a
digit, a count of `9`, a repeated digit, a `rule` field that is not a string, and
— for the two locality-based representations — a rule this representation cannot
run, which today means a birth set containing zero (§3.1).

The command is reachable from the viewer's generic command route, so a page
offering a rule control needs no service change
([viewer/interfaces.md](../viewer/interfaces.md) §9).

### 4.2.2 `patch`

`patch` is the atomic editing primitive. It exists because `set` is not atomic:
`set` applies the cells it accepts while it walks its list, so one bad
coordinate can leave a request half-applied, and no reply says which half. A
transaction cannot be expressed that way — it either happens completely or not
at all — so `patch` checks **everything** before it writes **anything**:

* `born` and `died` are lists of `[x, y]` pairs, each coordinate an integer
  inside the world;
* no cell appears in both lists;
* `expectGeneration` is an integer and equals the world's current generation.

A request that fails any check is refused and **no cell is changed**. The
refusal is named: `out_of_bounds` for a coordinate outside the world,
`bad_arguments` for a malformed list or a cell in both lists, and
`stale_generation` when the generation precondition does not hold (§4.5).

On success every `born` cell is set alive and every `died` cell is set dead, the
change is recorded as **one** edit through the same history path as `toggle`,
`set`, `clear` and `import` (§4.9), and the reply reports the world after the
patch:

```json
{"id":9,"cmd":"patch","born":[[1,1],[2,2]],"died":[[3,3]],"expectGeneration":0}
{"ok":true,"id":9,"generation":0,"population":3,"bornCount":2,"diedCount":1,"born":[[1,1],[2,2]],"died":[[3,3]]}
```

`bornCount` and `diedCount` count cells whose state **actually changed**, and the
`born` and `died` arrays name exactly those cells in the order they were applied.
A born cell that is already alive, or a died cell that is already dead, is
applied cleanly, is not counted and is not in the reply's arrays, so a caller can
record the change that happened rather than the candidate it sent. The generation
counter does not move: a patch is an edit between generations, not a step.

The generation precondition is what makes a lost race visible to the core rather
than assumed away by the service. The editing mode pauses the world, so a match
is the common case; `stale_generation` is the running-world case, and a client
that receives it knows the change was built against a world it no longer sees.
`patch` is additive: `set`, `toggle` and `clear` keep their meanings and their
tests ([ADR 0012](../../adr/simulation-core/0012-atomic-patch-in-the-core-protocol.md)).

### 4.3 Events

| Event | Fields | Emitted when |
|---|---|---|
| `tick` | `generation`, `population`, `changed` | after each automatic step while `running` |

A `tick` has no `id`. `changed` has the same meaning as in the `step` reply.

### 4.4 Replies, and the error object

A successful reply is a JSON object with `"ok": true` and the command's fields.
A refused request is a single line:

```json
{"ok":false,"error":"bad_arguments","message":"'count' must be an integer","id":7}
```

The `id` is present exactly when the request carried one. A request that cannot
even be parsed still produces a line; the `id` is simply absent, because there
was none to echo.

### 4.5 Error codes

| Code | Raised when |
|---|---|
| `bad_request` | the line is not valid JSON |
| `unknown_command` | the `cmd` field names a command the protocol does not define |
| `bad_arguments` | a required argument is missing or of the wrong type, a value is outside its documented range, or the JSON value is not an object |
| `bad_rule` | `set_rule` was asked for a rule the core will not run: text it cannot parse, a `rule` field that is not a string, or a rule this representation cannot run (§3.1) |
| `out_of_bounds` | a coordinate, or a frame rectangle, is outside the world |
| `stale_generation` | `patch` carried an `expectGeneration` that is not the world's current generation |
| `internal` | any other exception, carrying its type and message |

`internal` exists so that no single request can end the process. It is reported,
never swallowed.

`stale_generation` is a code of its own for the same reason `bad_rule` is: the
request is well formed and the world, not the line, is what disagrees. A client
branches on it to refresh and rebuild its change rather than retrying the same
request, and the message states both the offered and the actual generation, so
a log does not need the previous value to interpret the refusal.

`bad_rule` is a code of its own rather than a use of `bad_arguments`, and the
reason is that the two answer different questions. `bad_arguments` says *this
request was malformed*; `bad_rule` says *this request was well formed and the
core declines the rule it names*, which is a statement about the world rather
than about the line. A client that shows the two the same way tells a person who
typed a rule that they typed a bad request, and a client that wants to translate
its own label for the refusal has nothing to branch on. The message carries the
reason either way, in English, as a diagnostic
([viewer/interfaces.md](../viewer/interfaces.md) §12.3).

### 4.6 Frame encodings

`frame` returns one rectangle of the world in one of two encodings, chosen by
size rather than by taste:

| `format` | Payload | Cost |
|---|---|---|
| `cells` | base64 of little-endian `int32` pairs, `x` then `y`, absolute coordinates | 8 bytes per live cell in the rectangle |
| `bits` | base64 of row-major packed bits, one bit per cell, most significant bit first, row stride `ceil(width / 8)` bytes | `width * height / 8` bytes regardless of population |

The frame object also carries `x0`, `y0`, `w`, `h`, `generation` and
`population`, so a consumer never has to remember what it asked for.

**The implemented selection rule.** `cells` is chosen when

```
8 * (live cells in the rectangle)  <=  ceil(w / 8) * h
```

Both sides are byte counts: the `cells` payload costs eight bytes per live cell,
and the bitmap costs one bit per cell. For a rectangle whose width is a multiple
of eight that is equivalent to `live cells <= w * h / 64` — one live cell per 64
cells — which is the rule the module docstring states.

**This rule was wrong once, and the way it was wrong is worth keeping.** The
first version multiplied the `cells` payload by eight — converting it from bytes
to bits — and compared that against a bitmap already measured in bytes. The
threshold was therefore eight times stricter than the rationale beside it, and
`bits` was chosen across the band `w * h / 512 < live cells <= w * h / 64`,
where `cells` would have been between two and eight times smaller. The
consequence was bandwidth, never correctness: both encodings carry the same
world and the `format` field says which one arrived.

It was found by review rather than by a test, because the two tests that
exercise the encodings sat on rectangles where the two rules agree. The
correction is pinned at the boundary, which is the only place the rules
differ:
[test_the_frame_encoding_follows_the_stated_size_rule](../../../tests/world/test_bridge.py)
loads exactly 64 live cells into a 64 x 64 rectangle — a 512-byte bitmap against
a 512-byte coordinate list, the point where they meet — and asserts `cells`,
then loads a 65th cell and asserts `bits`.

The defect and its repair are in [testing.md](testing.md) §6, not in
[risks.md](risks.md), because the code no longer behaves that way.

A frame of an empty rectangle is encoded as `cells` with `data` equal to the
empty string.

### 4.7 Whole-world export and import

`export` returns the entire live set as one payload, and `import` replaces the
world with one. Together they are how a world moves between processes **and
between representations**: export from a sparse core, start a tiled core, import.

```json
{"ok":true,"export":{
  "format":"cells",
  "data":"<base64>",
  "population":5,
  "generation":4,
  "world":{"width":65536,"height":65536},
  "rule":"B3/S23"}}
```

| Field | Meaning |
|---|---|
| `format` | Always `"cells"`. **Never a bitmap** |
| `data` | Base64 of the same little-endian `int32` `x`/`y` pairs the `cells` frame encoding carries |
| `population` | The live-cell count at export |
| `generation` | The generation counter at export |
| `world` | Width and height, so a consumer can check it is importing into a world that can hold it |
| `rule` | The rule notation, so a consumer can check it is reproducing the same rule |

**The payload is always coordinates, and that is the point.** A bitmap describes
the world's *area* rather than its *contents*: it is a function of the rectangle
a caller happened to ask for, so exporting one would make the export depend on
how the area is stored rather than on what is alive. An export has to be
independent of the representation, so it is a coordinate list and nothing else.

`import` clears the world and then loads, and it sets the generation counter from
the `generation` argument rather than leaving it where it was. Clearing first is
what makes it a replacement rather than a merge: a cell the world held and the
payload does not is dead afterwards. Its reply carries `changed` (how many cells
were loaded), `population` and `generation`, so a caller can confirm the
round trip without a second request.

`import` refuses `format` values other than `cells`, a missing or non-string
`data`, a `generation` that is not an integer, and a payload that is not valid
base64 or not a whole number of cells. A refusal leaves the world **unchanged**:
the payload is decoded before the world is cleared.

`bridge.decode_cells(data)` is public for the same reason: a consumer that wants
to read an export without driving a protocol can decode it with the module that
defined the layout, and the function refuses a payload whose length is not a
multiple of eight rather than truncating it.

### 4.8 The advertised limits

`hello` carries a `limits` object and a `history` flag:

| Field | Meaning |
|---|---|
| `limits.ticksPerSecond.min`, `.max` | the inclusive range `run` accepts |
| `limits.stepsPerRequest` | the largest `count` one `step` accepts |
| `limits.maxCoordinate` | the largest coordinate any world may hold, and therefore the largest a client may send |
| `limits.representations` | the storage choices a client may ask for at start-up, in a stable order |
| `history` | whether this core is recording a timeline, and therefore whether `history`, `select`, `rollback`, `archive` and `open` will answer |

The numbers are advertised because they were otherwise declared in three places
— the page, the service and this module — while the authority is only here. A
copy kept by a client drifts, and the copy that drifts is always the client's: a
page that offers a rate the core refuses is a page that lies. The reply is built
from the same module constants the enforcement uses, so the advertised bound and
the enforced bound cannot disagree.

`limits.maxCoordinate` is advertised although the module's own name for it is
private: the value is part of the interface, the Python identifier is not.
`limits.representations` is `REPRESENTATIONS`, the same tuple the `--representation`
argument validates against.

### 4.9 The recorded timeline

These commands exist when the core was started with `--history`, and are refused
with `bad_arguments` when it was not. The store module owns what a recorded
generation *is*; this module owns only the five messages that reach it:
`history`, `select`, `rollback`, `archive` and `open`.

`history` lists what is recorded, so a client can offer a timeline without
reading a database:

```json
{"ok":true,"session":1,"current":1,"head":8,"count":2,
 "generations":[
   {"id":7,"generation":0,"parent":null,"kind":"keyframe","rule":"B3/S23",
    "population":5,"changed":5,"born":5,"died":0,
    "at":"2026-10-10T08:00:00+00:00"},
   {"id":8,"generation":1,"parent":7,"kind":"delta","rule":"B3/S23",
    "population":6,"changed":5,"born":3,"died":2,
    "at":"2026-10-10T08:00:01+00:00"}]}
```

`kind` is `keyframe` or `delta`. `born` and `died` are counts of cells, not
lists. The recorded generations are a tree, so each element carries `id` and
`parent` as well as `generation`: `id` is the node's identity, `parent` is the id
of the node it was recorded on top of (`null` at the root), and `generation` is a
label two branches may share. `rule` is the rule in force for that generation, so
the nodes whose rule differs from their parent's are where the rule changed.
`head` is the id of the node the next record appends to, and it is `null` when
nothing is recorded yet. `current` is the world's generation, which is not always
`count - 1`: a world that was rolled back and not stepped on again sits at an
earlier one.

`rollback` loads a recorded generation of the current branch back into the world
and reports where the world now is. It restores the generation counter as well as
the cells, because a rollback that left the counter behind would be
indistinguishable from an undo of the cells alone. **It reads, and it does not
move the working point**: the session's head stays where it was, so every node
recorded after the generation that was loaded is still in the tree, and the next
record appends a node instead of discarding them. A rollback to a generation the
store does not hold is refused; it is never rounded to the nearest one it has.

Reading a generation and *working on* one are two commands, deliberately.
`select` is the second: it addresses a node by its `node` id, or by a `generation`
on the current branch, loads it, and moves the head onto it. Moving the head is
what makes a branch — the node keeps the children it already has, and the next
record becomes their sibling. One command that both loaded a generation and moved
the working point would turn looking at history into editing it: a person who
only wanted to see generation 3 would have destroyed everything recorded after
it.

`archive` writes the session to a portable file at the path the caller names, and
reports how many generations were written. This is the one place in the project
where a process creates a file, and it does so only because whoever is driving
the core asked for that path and sent that command. Nothing is written on
start-up, on a step, or on any other request.

**An edit between two generations is recorded as a keyframe.** `toggle`, `set`,
`patch`, `clear` and `import` all change the world *between* two generations,
which means the delta that brought the world to the current generation no longer
describes where the next step starts. Each of them therefore re-records the
current generation as a keyframe. This is a contract rather than an
implementation detail: any operation that changes the world between two recorded
generations must make its own generation a keyframe, or the chain becomes
unreplayable while every individual reply still looks correct. Because the first
edit usually happens at generation `0`, the recorded generation `0` describes the
world *after* that edit rather than the empty world the core started with.

Recording is counted per generation rather than in one call. A `step` of ten
generations with a history attached records ten generations, because that is what
a timeline needs; without a history it is one call to the world and pays nothing
for recording.

### 4.10 Entry point and exit codes

```
python -m lifegame.world [--width N] [--height N] [--representation sparse|tiled]
                         [--history PATH] [--continue-session ID]
```

| Exit code | When |
|---|---|
| `0` | `quit` was received, or standard input reached end of file |
| `2` | a usage error — an argument the command line does not accept |

`--width` and `--height` default to 65536. `--representation` selects which world
answers the protocol and defaults to `sparse`; both answer the identical
protocol, so a client cannot tell them apart. The measurement that decides which
is faster for which shape of population is in
[performance.md](performance.md) §5.

`--history PATH` records every generation into a store at `PATH`, which creates
the file if it is not there, and enables §4.9. Without it the core records
nothing and the five commands are refused; a core that does not record pays
nothing for the possibility. The store is opened by this entry point and nowhere
else — see §9 and
[internal-components.md](internal-components.md) §2 for why the world module does
not import it.

`--continue-session ID` continues the store's session `ID` instead of creating a
new one, and requires `--history`. It exists for the viewer's representation
switch: the replacement core adopts the session the previous core was recording,
so a switch no longer truncates the timeline at the carried generation. It does
not record an initial generation — the caller's `import` puts the world into the
session — and the core refuses to continue a session whose declared world size
differs from this world's, because restoring into the wrong shape is not a
restoration. The flag is additive: without it the entry point behaves exactly as
it did.

Standard input is read as UTF-8 and standard output is written as UTF-8 with LF
line endings, so the protocol does not depend on the host's console code page.

## 5. Protocol constants

```python
PROTOCOL_VERSION = 1
MIN_TICKS_PER_SECOND = 1
MAX_TICKS_PER_SECOND = 60
DEFAULT_TICKS_PER_SECOND = 10
MAX_STEPS_PER_REQUEST = 100_000
DEFAULT_WORLD_SIZE = 65536
DEFAULT_REPRESENTATION = "sparse"
REPRESENTATIONS = ("sparse", "tiled")
_MAX_COORDINATE = (1 << 32) - 1
```

`PROTOCOL_VERSION` is announced in `hello`. The tick bounds, the step limit, the
coordinate limit and `REPRESENTATIONS` are announced in `hello` under `limits`
(§4.8). `DEFAULT_WORLD_SIZE`, `DEFAULT_TICKS_PER_SECOND` and
`DEFAULT_REPRESENTATION` are defaults of the entry point rather than bounds, and
are not advertised: a client never needs to know what a core would have used if
it had been asked for nothing.

`_MAX_COORDINATE` is private by Python name and public by value. It is the
largest coordinate the packed key encoding can hold, so it is the largest world
dimension and the largest coordinate a client may send; both are enforced, and
the enforced value is what `hello` reports.

## 6. Smoke-run entry points

| What | Command |
|---|---|
| Start the protocol by hand | `uv run python -m lifegame.world --width 64 --height 64` |
| Smoke the protocol from the tests | `uv run pytest tests/world/test_bridge.py` |
| Smoke a recorded core by hand | `uv run python -m lifegame.world --width 64 --height 64 --history TEMP/recorded.db` then send `history`, `select`, `rollback`, `archive` and `open` |
| Smoke the module's whole contract | `uv run pytest tests/world/test_world_contract.py` |
| Smoke every rule against the dense oracle | `uv run pytest tests/world/test_rule_equivalence.py` |
| Smoke the target-scale construction | `uv run python -c "from lifegame.world import SparseWorld; print(SparseWorld(65536, 65536))"` |
| Everything at once | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1` |

The target-scale entry point has been exercised by hand, not only by the
constructor: at `--width 65536 --height 65536` the commands `hello`, `set`,
`step`, `state`, `frame`, an out-of-bounds request and `quit` all behave as
documented. That observation is recorded in [testing.md](testing.md) §5.

## 7. Diagnostics and statistics

Everything a consumer needs to display a session is available without reading
private state:

| Quantity | Where |
|---|---|
| Population | `population`, and every reply that changes it |
| Generation | `generation`, and every reply that advances it |
| Live extent | `bounds()` / the `bounds` field of `state` |
| Rule in use | `rule.notation` / the `rule` field of `hello`, `state` and `export`, and of the `set_rule` reply, which reports the rule the core took rather than the one it was asked for |
| Run state and rate | the `running` and `tps` fields of `hello`, `state`, `run` and `pause` |
| Enforced bounds | the `limits` object of `hello`, which is built from the constants the enforcement uses |
| Whether a timeline exists | the `history` flag of `hello`, and a `bad_arguments` refusal from any §4.9 command |
| The recorded timeline | the `history` command, which lists session, generation, storage kind, population, churn and timestamp without exposing the store |
| Per-step churn | `changed`, from `step` and from the `tick` event |
| Live-cell count and packed size | `population`, and `SparseWorld.keys().size` |

There is no logging, no metrics sink and no timing inside the module. A
measurement is taken by the harness in
[test_benchmark.py](../../../tests/world/test_benchmark.py), not by the module
reporting on itself.

## 8. Compatibility policy

| Surface | Policy |
|---|---|
| The eleven import names | Removing or renaming one is a breaking change and needs a superseding decision recorded as an ADR. Adding a name is not. |
| Every method in §2 | The two shipped representations must stay in step: a method added to one is added to the other in the same change, and the shared contract test is what enforces it. `keys()` and `tile_count` are the accepted asymmetries, and `DenseWorld.advance` is held to the same contract as the other two so the oracle stays an oracle. `set_rule` is the one call whose *acceptance* differs by design: all three have it, and the two locality-based ones refuse a non-local rule while the oracle runs it (§3.1) |
| The `Change` value | Frozen and additive. A field added to it is a new field; removing or renaming one is a breaking change, because the history layer stores what `advance` returns |
| The line protocol | `PROTOCOL_VERSION` is `1`. A change that breaks an existing consumer increments it and is announced in `hello`, so a consumer can refuse to start rather than misbehave. `export` and `import` were added without incrementing it, because a consumer that does not know them is unaffected: an unknown command is answered with `unknown_command` and the process survives. `set_rule` was added for the same reason and under the same argument, so the count of commands grows while the version does not |
| Frame encodings | Additive. The `format` field tells a consumer which encoding arrived, so a third encoding would not break one that understands the first two |
| The export payload | `format` is always `cells` and the layout is the same bytes as a `cells` frame. A second export format would be additive in the same way a third frame encoding is |
| The `hello` limits | Additive. A field added under `limits` is a new field; a consumer that ignores the object is unaffected, and one that reads a field it knows gets a value the core enforces rather than a copy |
| The history commands | Additive, and deliberately not gated by `PROTOCOL_VERSION`: `history`, `select`, `rollback`, `archive` and `open` were added without incrementing it, because a consumer that does not know them is answered with `unknown_command` or `bad_arguments` and the process survives. What a recorded generation *is* belongs to the [store](../store/interfaces.md) contract, not to this one |
| The rule surface | `LifeRule`'s public members, its `parse`/`notation` inverse pair, and the set of rules the two locality-based representations accept. **Adding** a derived member is additive. Renaming a member, changing what a mask bit means, refusing a rule that was accepted, or accepting one that was refused are all breaking: a caller branches on the exception, and `birth_mask` and `survive_mask` are documented as bit `i` meaning count `i`, which is their meaning and not an implementation detail. The refusal of a non-local rule (§3.1) is itself such a change, taken deliberately and recorded in [risks.md](risks.md) WLD-13 |
| Exception types | `OutOfBoundsError` and `ValueError` are the contract. A new exception type for a new condition is a contract change |
| Error codes | The seven codes are the contract. Adding a code is additive; renaming one is breaking |

## 9. Implemented and planned

**Implemented**, and described above: the eleven import names, three world
representations that satisfy one contract, the rule object with its parse, masks
and tables and the two locality-based representations' refusal of a non-local
rule, the error type, the change record, the line protocol with its nineteen
commands (including the atomic `patch`) and its one event, both frame encodings,
the whole-world export and import payload, the advertised limits, the optional
recorded timeline with rollback and archive, and the entry point.

**Planned** — listed separately so that nothing here reads as built:

| Planned item | Owning milestone |
|---|---|
| Choosing the representation from the measured shape of the population, rather than from an argument or from the interface | **not scheduled.** The milestone that made the representation choosable made it choosable by a person, not by measurement, and no milestone declares this; it is recorded here as a gap rather than assigned to a milestone that has not accepted it |
| Resizing a world in place | not scheduled; a world's bounds are fixed at construction in all three representations |

Persistence used to be on this list and is **not** any more: it is the
[store](../store/overview.md) module, which reads a world through `advance` and
writes into one through `restore`. Nothing in the world module persists anything,
and the planned item was removed rather than left to read as pending.

A push transport used to be on this list and was never this module's item: the
core emits `tick` events and always has, and carrying them to a browser is
[viewer](../viewer/overview.md)'s work.

No planned item has a settled Python name, and none may be imported, measured or
documented as if it existed.
