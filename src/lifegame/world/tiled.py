"""Tiled bit-parallel world: the representation that closes the density gap.

The sparse world in :mod:`lifegame.world.sparse` costs about half a microsecond
per live cell per generation, because it sorts and counts nine times the live
population. That is fine for the interactive case — a few thousand cells — and
far too slow for the design target once a pattern fills any real fraction of it:
one percent of 65536 x 65536 is 43 million live cells.

This module takes the other classical route, described in the G4G13 Life
algorithm survey alongside the sparse set and quadtree memoisation: cut the world
into fixed tiles, keep only non-empty tiles, and advance a tile with
**word-parallel bit operations**, so one 64-bit word carries 64 cells and one
step of a tile costs a few dozen word operations rather than a few thousand
per-cell operations.

The step is vectorised across tiles *and* rows at once, which is what makes it
work in numpy: a tile is 64 rows of one ``uint64`` each, so an active set of
``M`` tiles is an ``(M, 64)`` array and the whole adder tree is a handful of
array operations. Doing it per tile in Python would drown in interpreter
overhead.

Geometry
--------
A tile is 64 x 64 cells and its key is ``(ty << 32) | tx``, with cell
``(x, y)`` in tile ``(x // 64, y // 64)`` at bit ``x % 64`` of row ``y % 64``.
The world is bounded and does not wrap, exactly as in the other two
representations: a missing neighbouring tile contributes zero, which is what
makes the shared contract and the shared oracle hold.

The active set is every non-empty tile plus the neighbours of any tile whose
border is not empty — a birth can only appear in a tile adjacent to a live
cell. Interior tiles of a dense region therefore add no work, and the
neighbours already exist, so the expansion costs nothing there; it costs up to
nine times for isolated tiles, which is precisely the shape where the sparse
representation is the better tool. Which of the two is faster for which shape
is measured, not assumed: see docs/model/world/performance.md.

Complexity, with ``M`` active tiles: the step touches a constant number of
``(M, 64)`` ``uint64`` arrays, so it is ``O(M)`` word operations — 64 cells per
word — rather than ``O(L)`` per-cell operations. Memory is 512 bytes per
non-empty tile, plus the same again for each working array.

The rule is arbitrary, and it is still ``O(M)``. A tile's neighbour counts are
summed bitwise into four count planes — a full-adder chain, one array operation
per adder, never a loop over cells — and the rule is then *compiled* into a
selection network over those planes (see :class:`_SelectionNetwork`). The
network's size depends on the shape of the rule's two sets, not on the number of
cells, and for Conway it is the same three word operations the hand-written
Conway expression used, so generality costs the default rule nothing.

Authority: docs/model/world/interfaces.md, docs/adr/simulation-core/.
"""

from collections.abc import Callable, Iterable, Iterator

import numpy as np

from lifegame.world.change import EMPTY_CELLS, Change
from lifegame.world.errors import OutOfBoundsError
from lifegame.world.rules import CONWAY, COUNT_EIGHT_BIT, LifeRule, require_local_birth

__all__ = ["TILE_BITS", "TILE_CELLS", "TiledWorld"]

TILE_BITS = 64
TILE_CELLS = TILE_BITS * TILE_BITS

_COORD_MASK = (1 << 32) - 1
_ALL_BITS = np.uint64(0xFFFFFFFFFFFFFFFF)
_NEIGHBOUR_OFFSETS = tuple(
    (dx, dy)
    for dy in (-1, 0, 1)
    for dx in (-1, 0, 1)
    if not (dx == 0 and dy == 0)
)
#: The four count planes, least significant first: plane ``k`` holds bit ``k`` of
#: every cell's neighbour count, so the count itself exists only as four bits.
_PLANES = ("p0", "p1", "p2", "p3")
#: What the compiler returns for a set that names no count at all.
_EMPTY = "zero"


class _PlanBuilder:
    """Emits one selection network, sharing every operand the two sets share.

    Steps are named ``t1``, ``t2``, ... in creation order and execute in creation
    order, because an operand is always emitted before the step that reads it.
    Two calls that ask for the same operation get the same name back: that is
    what lets ``B3/S23`` pay for ``p1 & ~p2`` once for both of its sets, and lets
    a rule whose sets overlap pay for the overlap once.
    """

    __slots__ = ("_memo", "_next", "steps")

    def __init__(self) -> None:
        self.steps: list[tuple[str, str, str, str]] = []
        self._memo: dict[tuple[str, ...], str] = {}
        self._next = 0

    def _emit(self, kind: str, left: str, right: str) -> str:
        self._next += 1
        name = f"t{self._next}"
        self.steps.append((kind, name, left, right))
        return name

    def _shared(self, key: tuple[str, ...], make: Callable[[], str]) -> str:
        if key not in self._memo:
            self._memo[key] = make()
        return self._memo[key]

    def invert(self, name: str) -> str:
        return self._shared(("not", name), lambda: self._emit("not", name, ""))

    def and_(self, left: str, right: str) -> str:
        if _EMPTY in (left, right):
            return _EMPTY
        operands = (left, right) if left <= right else (right, left)
        return self._shared(("and", *operands), lambda: self._emit("and", *operands))

    def or_(self, left: str, right: str) -> str:
        if left == _EMPTY:
            return right
        if right == _EMPTY:
            return left
        operands = (left, right) if left <= right else (right, left)
        return self._shared(("or", *operands), lambda: self._emit("or", *operands))

    def select(self, mask: int) -> str:
        """The word that is set exactly where the neighbour count is in ``mask``.

        ``mask`` is the rule object's packed set: bit ``i`` set means count ``i``
        belongs to the set. The counts 0..7 are grouped by the 2s and 4s places of
        the count — group ``g`` holds counts ``2g`` and ``2g + 1`` — because the
        two members of a group differ only in the 1s place. One AND selects the
        group and at most one more picks the even member, the odd member, or
        neither; a group contributes one term however many of its counts the set
        names, which is why naming all nine counts does not cost nine terms.
        """
        if mask == 0:
            return _EMPTY

        terms: list[str] = []
        for group in range(4):
            pair = (mask >> (2 * group)) & 0b11
            if pair == 0:
                continue
            in_group = self.and_(
                "p1" if group & 0b01 else self.invert("p1"),
                "p2" if group & 0b10 else self.invert("p2"),
            )
            if pair == 0b11:
                terms.append(in_group)
            elif pair == 0b01:
                terms.append(self.and_(in_group, self.invert("p0")))
            else:
                terms.append(self.and_(in_group, "p0"))

        selected = _EMPTY
        for term in terms:
            selected = self.or_(selected, term)

        # A count of eight is the one count the pair index cannot place: it sets
        # the 8s plane and leaves the 1s, 2s and 4s planes clear, so it lands in
        # group 0's even term. If eight is in the set, its own plane answers for
        # it; if it is not, a set that contains zero has to be held off that
        # count, and no other group can fire there.
        if mask & COUNT_EIGHT_BIT:
            return self.or_(selected, "p3")
        if mask & 0b1:
            return self.and_(selected, self.invert("p3"))
        return selected


class _SelectionNetwork:
    """A rule compiled into bit-sliced word operations.

    A tile holds 64 cells per word, so the rule cannot be applied cell by cell
    without giving up the reason this representation exists. What the adder chain
    leaves behind is four planes: bit ``k`` of ``p_k`` is bit ``k`` of one cell's
    neighbour count, and the count exists nowhere else. The rule is a boolean
    function of those four bits, and this network evaluates it at all 64 cells of
    a word simultaneously.

    The obvious implementation — one equality term per count the rule names, each
    term four operations — costs ``4|B| + 4|S|`` operations and is at its worst
    (all nine counts in both sets) 72. The network here is a two-level selection
    over the same information: counts 0..7 are split by the 2s and 4s places into
    four groups, one AND each, and each group then selects its even member, its
    odd member or neither with at most one more operation; the count of eight is
    exactly the 8s plane, folded in with one OR — or guarded out with one AND when
    the set names zero but not eight. A set therefore costs at most sixteen word
    operations, and that count is *exhaustive rather than estimated*: all 512
    single sets were compiled while this was written and none exceeded sixteen.

    Sixteen is the bound **per set**, not per rule. Compiling all 262144
    ``(birth, survive)`` pairs, which a documentation pass measured rather than
    assumed, gives a worst case of twenty-four — ``B13578/S0246`` — and 124240
    pairs above sixteen; the earlier claim here that no pair exceeded sixteen was
    wrong. Nothing depends on the pair bound being smaller: birth and survival
    share every operand they have in common, so Conway — birth on 3, survival on
    2 and 3 — compiles to ``p1 & ~p2`` and ``p1 & ~p2 & p0``: three operations,
    against the five plus two of the hand-written ``(~p3) & (~p2) & p1`` and
    ``& (alive | p0)`` it replaces, so the default rule pays nothing for the
    generality.

    The failure modes this construction is exposed to are the two the oracle
    lives for: a mis-grouped count (a term that fires on the wrong count) and a
    missed count of eight (group 0's even term firing where the 8s plane is set).
    Both are caught by `tests/world/test_rule_equivalence.py`, which checks every
    shipped rule against the dense oracle cell for cell.
    """

    __slots__ = ("_born", "_steps", "_survive", "operations")

    def __init__(self, rule: LifeRule) -> None:
        builder = _PlanBuilder()
        self._born = builder.select(rule.birth_mask)
        self._survive = builder.select(rule.survive_mask)
        self._steps = tuple(builder.steps)
        #: How many word operations one application of the rule costs, over and
        #: above the four final operations that mix birth and survival with the
        #: current state. Exposed so a measurement can compare rules.
        self.operations = len(self._steps)

    def __repr__(self) -> str:
        return (
            f"_SelectionNetwork(born={self._born!r}, survive={self._survive!r}, "
            f"operations={self.operations})"
        )

    def evaluate(self, alive: np.ndarray, planes: list[np.ndarray]) -> np.ndarray:
        """The next state of every cell in the word, from the four count planes."""
        env = dict(zip(_PLANES, planes, strict=True))
        for kind, name, left, right in self._steps:
            if kind == "not":
                env[name] = ~env[left]
            elif kind == "and":
                env[name] = env[left] & env[right]
            else:
                env[name] = env[left] | env[right]

        born = env.get(self._born)
        survive = env.get(self._survive)
        if born is None and survive is None:
            # Neither set names a count: every cell is dead in the next
            # generation, whatever its neighbour count.
            return np.zeros_like(alive)
        if born is None:
            return alive & survive
        if survive is None:
            return ~alive & born
        if self._born == self._survive:
            # The rule does not distinguish a live cell from a dead one.
            return born
        return (alive & survive) | (~alive & born)


class TiledWorld:
    """A bounded life world stored as bit-packed 64 x 64 tiles.

    Only non-empty tiles are stored. Tiles are held as a sorted key array plus
    an ``(N, 64)`` ``uint64`` row array, which keeps a step vectorised and makes
    a mutation a memory move rather than a rehash.
    """

    __slots__ = (
        "_generation",
        "_height",
        "_keys",
        "_network",
        "_rule",
        "_rows",
        "_tiles_x",
        "_tiles_y",
        "_width",
    )

    def __init__(self, width: int = 65536, height: int = 65536, rule: LifeRule = CONWAY) -> None:
        if not 0 < width <= _COORD_MASK:
            raise ValueError(f"width must be in 1..{_COORD_MASK}, got {width}")
        if not 0 < height <= _COORD_MASK:
            raise ValueError(f"height must be in 1..{_COORD_MASK}, got {height}")
        self._width = int(width)
        self._height = int(height)
        self._tiles_x = (self._width + TILE_BITS - 1) // TILE_BITS
        self._tiles_y = (self._height + TILE_BITS - 1) // TILE_BITS
        self._keys = np.empty(0, dtype=np.int64)
        self._rows = np.empty((0, TILE_BITS), dtype=np.uint64)
        self._generation = 0
        self.set_rule(rule)

    def set_rule(self, rule: LifeRule) -> None:
        """Adopt ``rule`` for the generations that follow.

        The tiles and the generation counter are untouched: a rule is not a
        state, and switching one must not look like an edit or an undo. The
        compiled selection network is replaced rather than patched, so a step
        after the switch cannot read a plan that belonged to the previous rule.
        """
        require_local_birth(rule)
        self._rule = rule
        self._network = _SelectionNetwork(rule)

    # -- identity ---------------------------------------------------------

    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    @property
    def rule(self) -> LifeRule:
        return self._rule

    @property
    def generation(self) -> int:
        return self._generation

    @property
    def population(self) -> int:
        if self._keys.size == 0:
            return 0
        return int(np.bitwise_count(self._rows).sum())

    @property
    def tile_count(self) -> int:
        """How many tiles are stored. Exposed because it is what a step costs."""
        return int(self._keys.size)

    def __repr__(self) -> str:
        return (
            f"TiledWorld(width={self._width}, height={self._height}, "
            f"rule={self._rule.notation!r}, tiles={self.tile_count}, "
            f"population={self.population}, generation={self._generation})"
        )

    # -- key helpers ------------------------------------------------------

    def _check(self, x: int, y: int) -> None:
        if not 0 <= x < self._width or not 0 <= y < self._height:
            raise OutOfBoundsError(
                f"({x}, {y}) is outside a {self._width} x {self._height} world"
            )

    @staticmethod
    def _tile_key(x: int, y: int) -> int:
        return ((y // TILE_BITS) << 32) | (x // TILE_BITS)

    def _find(self, key: int) -> int:
        if self._keys.size == 0:
            return -1
        position = int(np.searchsorted(self._keys, np.int64(key)))
        if position < self._keys.size and self._keys[position] == key:
            return position
        return -1

    def _border_is_empty(self) -> np.ndarray:
        """Per tile: does it have no live cell on any of its four borders?"""
        if self._keys.size == 0:
            return np.zeros(0, dtype=bool)
        rows = self._rows
        top = rows[:, 0] != 0
        bottom = rows[:, TILE_BITS - 1] != 0
        left = (rows & np.uint64(1)).any(axis=1)
        right = ((rows >> np.uint64(TILE_BITS - 1)) & np.uint64(1)).any(axis=1)
        return ~(top | bottom | left | right)

    # -- reading ----------------------------------------------------------

    def is_alive(self, x: int, y: int) -> bool:
        self._check(x, y)
        position = self._find(self._tile_key(x, y))
        if position < 0:
            return False
        row = self._rows[position, y % TILE_BITS]
        return bool((row >> np.uint64(x % TILE_BITS)) & np.uint64(1))

    @staticmethod
    def _coords_of(keys: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """``(M, 2)`` ``int32`` ``x`` then ``y`` for the set bits of ``rows``.

        Used for both the live set and a change: a change is a bit mask over the
        same words, so the same unpacking answers both.
        """
        if keys.size == 0 or not rows.any():
            return EMPTY_CELLS
        bits = np.unpackbits(rows.view(np.uint8), axis=1, bitorder="little")
        tile_index, flat = np.nonzero(bits)
        if tile_index.size == 0:
            return EMPTY_CELLS
        tile_index = tile_index.astype(np.int64)
        base_x = (keys & np.int64(_COORD_MASK)) * TILE_BITS
        base_y = (keys >> np.int64(32)) * TILE_BITS
        x = base_x[tile_index] + (flat % TILE_BITS)
        y = base_y[tile_index] + (flat // TILE_BITS)
        return np.stack((x, y), axis=1).astype(np.int32)

    def _live_arrays(self) -> tuple[np.ndarray, np.ndarray]:
        """Every live cell as parallel x and y arrays, in tile order.

        One :func:`numpy.unpackbits` over the whole packed store turns it into a
        boolean matrix and :func:`numpy.nonzero` turns that into coordinates,
        with no Python-level loop over cells. The order is tile, then row, then
        column, which is not global order; callers that need global order sort.

        The unpacking relies on two things that are both true here and are
        asserted by the test suite: the store is little-endian, and a row's bit
        ``c`` is column ``c``.
        """
        if self._keys.size == 0:
            return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int64)
        bits = np.unpackbits(self._rows.view(np.uint8), axis=1, bitorder="little")
        tile_index, flat = np.nonzero(bits)
        tile_index = tile_index.astype(np.int64)
        row = (flat // TILE_BITS).astype(np.int64)
        col = (flat % TILE_BITS).astype(np.int64)
        base_x = (self._keys & np.int64(_COORD_MASK)) * TILE_BITS
        base_y = (self._keys >> np.int64(32)) * TILE_BITS
        return base_x[tile_index] + col, base_y[tile_index] + row

    def live_cells(self) -> Iterator[tuple[int, int]]:
        """Every live cell, in ascending ``y`` then ascending ``x``."""
        xs, ys = self._live_arrays()
        if xs.size == 0:
            return
        order = np.lexsort((xs, ys))
        yield from zip(xs[order].tolist(), ys[order].tolist(), strict=True)

    def bounds(self) -> tuple[int, int, int, int] | None:
        xs, ys = self._live_arrays()
        if xs.size == 0:
            return None
        return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))

    def viewport(self, x0: int, y0: int, width: int, height: int) -> np.ndarray:
        self._check_rect(x0, y0, width, height)
        out = np.zeros((height, width), dtype=bool)
        xs, ys = self._live_arrays()
        if xs.size:
            inside = (xs >= x0) & (xs < x0 + width) & (ys >= y0) & (ys < y0 + height)
            if inside.any():
                out[ys[inside] - y0, xs[inside] - x0] = True
        return out

    def live_cells_in(self, x0: int, y0: int, width: int, height: int) -> np.ndarray:
        self._check_rect(x0, y0, width, height)
        xs, ys = self._live_arrays()
        if xs.size == 0:
            return np.empty((0, 2), dtype=np.int32)
        inside = (xs >= x0) & (xs < x0 + width) & (ys >= y0) & (ys < y0 + height)
        if not inside.any():
            return np.empty((0, 2), dtype=np.int32)
        return np.stack((xs[inside], ys[inside]), axis=1).astype(np.int32)

    def _check_rect(self, x0: int, y0: int, width: int, height: int) -> None:
        if width <= 0 or height <= 0:
            raise ValueError(f"viewport must have positive area, got {width} x {height}")
        if x0 < 0 or y0 < 0 or x0 + width > self._width or y0 + height > self._height:
            raise OutOfBoundsError(
                f"viewport ({x0}, {y0}, {width}, {height}) is outside a "
                f"{self._width} x {self._height} world"
            )

    # -- writing ----------------------------------------------------------

    def toggle(self, x: int, y: int) -> bool:
        self._check(x, y)
        bit = np.uint64(1) << np.uint64(x % TILE_BITS)
        key = self._tile_key(x, y)
        position = self._find(key)
        row = y % TILE_BITS
        if position < 0:
            rows = np.zeros((1, TILE_BITS), dtype=np.uint64)
            rows[0, row] = bit
            self._insert(key, rows)
            return True
        self._rows[position, row] ^= bit
        if not self._rows[position].any():
            self._remove(position)
            return False
        return bool((self._rows[position, row] >> np.uint64(x % TILE_BITS)) & np.uint64(1))

    def set_alive(self, x: int, y: int, alive: bool = True) -> bool:
        if self.is_alive(x, y) == bool(alive):
            self._check(x, y)
            return False
        self.toggle(x, y)
        return True

    def load(self, cells: Iterable[tuple[int, int]]) -> int:
        wanted = [(int(x), int(y)) for x, y in cells]
        for x, y in wanted:
            self._check(x, y)
        added = 0
        for x, y in wanted:
            if not self.is_alive(x, y):
                self.toggle(x, y)
                added += 1
        return added

    def restore(self, cells: Iterable[tuple[int, int]], generation: int = 0) -> int:
        """Replace the live set *and* the generation counter; report cells loaded.

        See `SparseWorld.restore`. A restored world must not look like a fresh
        one, because a generation counter that resets is indistinguishable from
        an undo.
        """
        if generation < 0:
            raise ValueError(f"generation must not be negative, got {generation}")
        self.clear()
        added = self.load(cells)
        self._generation = int(generation)
        return added

    def clear(self) -> None:
        self._keys = np.empty(0, dtype=np.int64)
        self._rows = np.empty((0, TILE_BITS), dtype=np.uint64)
        self._generation = 0

    def _insert(self, key: int, rows: np.ndarray) -> None:
        position = int(np.searchsorted(self._keys, np.int64(key)))
        self._keys = np.insert(self._keys, position, np.int64(key))
        self._rows = np.insert(self._rows, position, rows, axis=0)

    def _remove(self, position: int) -> None:
        self._keys = np.delete(self._keys, position)
        self._rows = np.delete(self._rows, position, axis=0)

    # -- evolution --------------------------------------------------------

    def advance(self, count: int = 1, *, record: bool = True) -> Change:
        """Apply the rule ``count`` times and describe what the last step changed.

        The bits that differ between two generations are computed either way to
        answer ``changed``, so naming the cells that were born and that died is
        an unpacking of masks the step already holds.
        """
        if count < 0:
            raise ValueError(f"count must not be negative, got {count}")
        changed = 0
        born = EMPTY_CELLS
        died = EMPTY_CELLS
        for _ in range(count):
            changed, born, died = self._step_once(record)
            self._generation += 1
        if not record:
            born = EMPTY_CELLS
            died = EMPTY_CELLS
        return Change(changed=changed, generation=self._generation, born=born, died=died)

    def step(self, count: int = 1) -> int:
        return self.advance(count, record=False).changed

    def _step_once(self, record: bool = False) -> tuple[int, np.ndarray, np.ndarray]:
        if self._keys.size == 0:
            return 0, EMPTY_CELLS, EMPTY_CELLS

        active_keys, active_rows = self._active_set()
        before = active_rows
        after = self._advance(active_keys, active_rows)
        after = self._mask_to_world(active_keys, after)

        # One array element is a 64-cell word, so the number of cells that
        # changed is the population of the exclusive-or, not the count of
        # elements that differ: four changed cells inside three words would
        # otherwise be reported as three.
        difference = after ^ before
        changed = int(np.bitwise_count(difference).sum())
        if record:
            born = self._coords_of(active_keys, after & difference)
            died = self._coords_of(active_keys, before & difference)
        else:
            born = EMPTY_CELLS
            died = EMPTY_CELLS

        keep = after.any(axis=1)
        self._keys = active_keys[keep]
        self._rows = after[keep]
        return changed, born, died

    def _active_set(self) -> tuple[np.ndarray, np.ndarray]:
        """Non-empty tiles, plus the neighbours of any tile with a live border."""
        keys = self._keys
        empty_border = self._border_is_empty()
        if bool(np.all(empty_border)):
            return keys, self._rows

        interesting = ~empty_border
        candidate = [keys]
        for dx, dy in _NEIGHBOUR_OFFSETS:
            candidate.append(keys[interesting] + np.int64(dx + (dy << 32)))
        active_keys = np.unique(np.concatenate(candidate))
        active_keys = active_keys[self._inside_tile_grid(active_keys)]

        if active_keys.size == keys.size and bool(np.array_equal(active_keys, keys)):
            return keys, self._rows

        rows = np.zeros((active_keys.size, TILE_BITS), dtype=np.uint64)
        position = np.searchsorted(active_keys, keys)
        rows[position] = self._rows
        return active_keys, rows

    def _inside_tile_grid(self, keys: np.ndarray) -> np.ndarray:
        tx = keys & np.int64(_COORD_MASK)
        ty = keys >> np.int64(32)
        return (tx >= 0) & (tx < self._tiles_x) & (ty >= 0) & (ty < self._tiles_y)

    def _gather(
        self,
        active_keys: np.ndarray,
        active_rows: np.ndarray,
        keys: np.ndarray,
    ) -> np.ndarray:
        """Rows of the tiles named by ``keys``, zero where no such tile exists."""
        if active_keys.size == 0:
            return np.zeros((keys.size, TILE_BITS), dtype=np.uint64)
        position = np.searchsorted(active_keys, keys)
        valid = (position < active_keys.size) & (
            active_keys[np.minimum(position, active_keys.size - 1)] == keys
        )
        inside = self._inside_tile_grid(keys)
        valid = valid & inside
        safe = np.where(valid, position, 0)
        gathered = active_rows[safe].copy()
        gathered[~valid] = np.uint64(0)
        return gathered

    def _advance(self, active_keys: np.ndarray, active_rows: np.ndarray) -> np.ndarray:
        """One generation over every active tile at once, 64 cells per word."""
        count = active_keys.size
        left_keys = active_keys - np.int64(1)
        right_keys = active_keys + np.int64(1)
        up_keys = active_keys - np.int64(1 << 32)
        down_keys = active_keys + np.int64(1 << 32)
        up_left = up_keys - np.int64(1)
        up_right = up_keys + np.int64(1)
        down_left = down_keys - np.int64(1)
        down_right = down_keys + np.int64(1)

        up = self._gather(active_keys, active_rows, up_keys)
        down = self._gather(active_keys, active_rows, down_keys)
        left = self._gather(active_keys, active_rows, left_keys)
        right = self._gather(active_keys, active_rows, right_keys)
        up_left_rows = self._gather(active_keys, active_rows, up_left)
        up_right_rows = self._gather(active_keys, active_rows, up_right)
        down_left_rows = self._gather(active_keys, active_rows, down_left)
        down_right_rows = self._gather(active_keys, active_rows, down_right)

        # A 66-row window: the tile's own 64 rows with one borrowed row above and
        # below. Rows 0 and 65 belong to other tiles, so their horizontal
        # neighbours come from the diagonal tiles at their own row index.
        ext = np.zeros((count, TILE_BITS + 2), dtype=np.uint64)
        ext[:, 0] = up[:, TILE_BITS - 1]
        ext[:, 1 : TILE_BITS + 1] = active_rows
        ext[:, TILE_BITS + 1] = down[:, 0]

        left_in = np.zeros((count, TILE_BITS + 2), dtype=np.uint64)
        left_in[:, 0] = up_left_rows[:, TILE_BITS - 1] >> np.uint64(TILE_BITS - 1)
        left_in[:, 1 : TILE_BITS + 1] = left >> np.uint64(TILE_BITS - 1)
        left_in[:, TILE_BITS + 1] = down_left_rows[:, 0] >> np.uint64(TILE_BITS - 1)

        right_in = np.zeros((count, TILE_BITS + 2), dtype=np.uint64)
        right_in[:, 0] = up_right_rows[:, TILE_BITS - 1] & np.uint64(1)
        right_in[:, 1 : TILE_BITS + 1] = right & np.uint64(1)
        right_in[:, TILE_BITS + 1] = down_right_rows[:, 0] & np.uint64(1)

        extended_left = (ext << np.uint64(1)) | left_in
        extended_right = (ext >> np.uint64(1)) | (right_in << np.uint64(TILE_BITS - 1))

        neighbours = (
            extended_left[:, 0:TILE_BITS],
            ext[:, 0:TILE_BITS],
            extended_right[:, 0:TILE_BITS],
            extended_left[:, 1 : TILE_BITS + 1],
            extended_right[:, 1 : TILE_BITS + 1],
            extended_left[:, 2 : TILE_BITS + 2],
            ext[:, 2 : TILE_BITS + 2],
            extended_right[:, 2 : TILE_BITS + 2],
        )
        alive = ext[:, 1 : TILE_BITS + 1]

        # A four-bit counter per cell, incremented once per neighbour: four XOR
        # and four AND array operations per neighbour, 32 adder levels in all,
        # and never a loop over cells. Plane 0 is the 1s place, plane 3 the 8s.
        planes = [np.zeros((count, TILE_BITS), dtype=np.uint64) for _ in range(4)]
        for neighbour in neighbours:
            carry = neighbour
            for level in range(4):
                existing = planes[level]
                planes[level] = existing ^ carry
                carry = existing & carry

        return self._apply_rule(alive, planes)

    def _apply_rule(self, alive: np.ndarray, planes: list[np.ndarray]) -> np.ndarray:
        """One generation of the rule, given the four count planes.

        Kept apart from `_advance` because it is the only part of a step that
        depends on the rule rather than on the geometry of the tiles: a
        measurement can hold the geometry constant and price the rule alone.
        """
        return self._network.evaluate(alive, planes)

    def _mask_to_world(self, active_keys: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """Zero every cell that lies outside the world inside an edge tile."""
        if active_keys.size == 0:
            return rows
        tx = active_keys & np.int64(_COORD_MASK)
        ty = active_keys >> np.int64(32)

        remainder_x = self._width - tx * TILE_BITS
        full_x = remainder_x >= TILE_BITS
        safe_x = np.minimum(remainder_x, TILE_BITS).astype(np.uint64)
        column_mask = np.where(
            full_x,
            _ALL_BITS,
            (np.uint64(1) << safe_x) - np.uint64(1),
        )
        rows = rows & column_mask[:, None]

        remainder_y = self._height - ty * TILE_BITS
        full_y = remainder_y >= TILE_BITS
        if not np.all(full_y):
            offsets = np.arange(TILE_BITS, dtype=np.int64)[None, :]
            keep = full_y[:, None] | (offsets < remainder_y[:, None])
            rows = np.where(keep, rows, np.uint64(0))
        return rows
