"""Sparse world: the representation that makes the target scale possible.

The design target is 65536 x 65536, which is 4.29e9 cells. A dense grid cannot
hold that — one byte per cell is 4.29 GB, one bit per cell is 537 MB and every
step would touch all of it. This module therefore stores **only live cells**, as
one packed 64-bit key each, so memory is 8 bytes per live cell and a step costs
time proportional to the live population rather than to the world's area.

Boundary condition: the world is **bounded, not wrapping**. A cell outside the
bounds is permanently dead, and it contributes no neighbours. That is a choice,
not an accident — it is recorded in
docs/adr/simulation-core/ and it is what the dense reference implementation
reproduces exactly, so the two can be compared cell for cell.

Coordinate encoding: ``key = (y << 32) | x``. Both coordinates must be
non-negative and fit in 32 bits, which the constructor enforces. Addition of a
neighbour offset is therefore applied to the low half and never carries into the
high half.

Complexity, per step, with ``L`` live cells:

* candidate construction: ``O(L)`` vectorised work over nine arrays;
* candidate ordering and counting: ``O(L log L)``, the sort inside
  :func:`numpy.unique`;
* membership of a candidate in the live set: ``O(L log L)`` search over the
  sorted live keys;
* memory: ``O(L)``, about 8 bytes per live cell plus one temporary of the same
  order during a step.

The ``log`` factor comes from sorting. Removing it needs a hash table or a
quadtree; both are recorded as candidates in
docs/model/world/performance.md with their measured status.

Authority: docs/model/world/interfaces.md, docs/model/world/implementation.md.
"""

from collections.abc import Iterable, Iterator

import numpy as np

from lifegame.world.change import EMPTY_CELLS, Change
from lifegame.world.errors import OutOfBoundsError
from lifegame.world.rules import CONWAY, LifeRule, require_local_birth

__all__ = ["SparseWorld"]

_COORD_BITS = 32
_COORD_MASK = (1 << _COORD_BITS) - 1
_OFFSETS = tuple(
    (dx, dy)
    for dy in (-1, 0, 1)
    for dx in (-1, 0, 1)
    if not (dx == 0 and dy == 0)
)


class SparseWorld:
    """A bounded life world that stores only its live cells.

    Live cells are held as a sorted, unique array of packed 64-bit keys. The
    invariant is maintained by every mutating operation, which is what lets the
    step routine count neighbours with a sort instead of a hash table.
    """

    __slots__ = (
        "_birth_table",
        "_generation",
        "_height",
        "_keys",
        "_rule",
        "_survive_table",
        "_width",
    )

    def __init__(
        self,
        width: int = 65536,
        height: int = 65536,
        rule: LifeRule = CONWAY,
    ) -> None:
        if not 0 < width <= _COORD_MASK:
            raise ValueError(f"width must be in 1..{_COORD_MASK}, got {width}")
        if not 0 < height <= _COORD_MASK:
            raise ValueError(f"height must be in 1..{_COORD_MASK}, got {height}")
        self._width = int(width)
        self._height = int(height)
        self._keys = np.empty(0, dtype=np.int64)
        self._generation = 0
        self.set_rule(rule)

    def set_rule(self, rule: LifeRule) -> None:
        """Adopt ``rule`` for the generations that follow.

        The live set and the generation counter are untouched: a rule is not a
        state, and switching one must not look like an edit or an undo. Both
        decision tables are replaced, so the previous rule is not left behind in
        a lookup array — which is the defect this method exists to make
        impossible to introduce.
        """
        require_local_birth(rule)
        self._rule = rule
        self._birth_table = np.array(rule.birth_table, dtype=bool)
        self._survive_table = np.array(rule.survive_table, dtype=bool)

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
        """How many steps have been applied since the last :meth:`clear`."""
        return self._generation

    @property
    def population(self) -> int:
        """The number of live cells."""
        return int(self._keys.size)

    def __repr__(self) -> str:
        return (
            f"SparseWorld(width={self._width}, height={self._height}, "
            f"rule={self._rule.notation!r}, population={self.population}, "
            f"generation={self._generation})"
        )

    # -- key helpers ------------------------------------------------------

    def _key(self, x: int, y: int) -> np.int64:
        if not 0 <= x < self._width or not 0 <= y < self._height:
            raise OutOfBoundsError(
                f"({x}, {y}) is outside a {self._width} x {self._height} world"
            )
        return np.int64((int(y) << _COORD_BITS) | int(x))

    def _decode(self, keys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Split packed keys into ``x`` and ``y`` arrays."""
        return (keys & _COORD_MASK), (keys >> _COORD_BITS)

    @staticmethod
    def _cells(keys: np.ndarray) -> np.ndarray:
        """``(M, 2)`` ``int32`` ``x`` then ``y``: the shape a change records."""
        if keys.size == 0:
            return EMPTY_CELLS
        xs, ys = (keys & _COORD_MASK), (keys >> _COORD_BITS)
        return np.stack((xs, ys), axis=1).astype(np.int32)

    # -- reading ----------------------------------------------------------

    def is_alive(self, x: int, y: int) -> bool:
        key = self._key(x, y)
        position = int(np.searchsorted(self._keys, key))
        return position < self._keys.size and bool(self._keys[position] == key)

    def live_cells(self) -> Iterator[tuple[int, int]]:
        """Every live cell, in key order: ascending ``y``, then ascending ``x``."""
        xs, ys = self._decode(self._keys)
        yield from zip(xs.tolist(), ys.tolist(), strict=True)

    def keys(self) -> np.ndarray:
        """A read-only view of the packed live-cell keys.

        Exposed for the measurement harness and for callers that already speak
        the packed encoding; the array must not be mutated.
        """
        view = self._keys.view()
        view.flags.writeable = False
        return view

    def bounds(self) -> tuple[int, int, int, int] | None:
        """``(min_x, min_y, max_x, max_y)`` of the live cells, or ``None``."""
        if self._keys.size == 0:
            return None
        xs, ys = self._decode(self._keys)
        return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))

    def viewport(self, x0: int, y0: int, width: int, height: int) -> np.ndarray:
        """A dense ``(height, width)`` boolean view of one rectangle."""
        self._check_rect(x0, y0, width, height)
        out = np.zeros((height, width), dtype=bool)
        if self._keys.size == 0:
            return out
        xs, ys = self._decode(self._keys)
        inside = (xs >= x0) & (xs < x0 + width) & (ys >= y0) & (ys < y0 + height)
        if inside.any():
            out[(ys[inside] - y0), (xs[inside] - x0)] = True
        return out

    def live_cells_in(self, x0: int, y0: int, width: int, height: int) -> np.ndarray:
        """Live cells inside one rectangle as an ``(M, 2)`` int32 array of x, y."""
        self._check_rect(x0, y0, width, height)
        if self._keys.size == 0:
            return np.empty((0, 2), dtype=np.int32)
        xs, ys = self._decode(self._keys)
        inside = (xs >= x0) & (xs < x0 + width) & (ys >= y0) & (ys < y0 + height)
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
        """Flip one cell and report its new state."""
        key = self._key(x, y)
        position = int(np.searchsorted(self._keys, key))
        if position < self._keys.size and self._keys[position] == key:
            self._keys = np.delete(self._keys, position)
            return False
        self._keys = np.insert(self._keys, position, key)
        return True

    def set_alive(self, x: int, y: int, alive: bool = True) -> bool:
        """Set one cell and report whether the call changed anything."""
        key = self._key(x, y)
        position = int(np.searchsorted(self._keys, key))
        present = position < self._keys.size and self._keys[position] == key
        if alive and not present:
            self._keys = np.insert(self._keys, position, key)
            return True
        if not alive and present:
            self._keys = np.delete(self._keys, position)
            return True
        return False

    def load(self, cells: Iterable[tuple[int, int]]) -> int:
        """Add every listed cell. Returns the number of newly live cells."""
        keys = [int(self._key(x, y)) for x, y in cells]
        if not keys:
            return 0
        candidate = np.array(keys, dtype=np.int64)
        before = self._keys.size
        self._keys = np.unique(np.concatenate((self._keys, candidate)))
        return int(self._keys.size - before)

    def restore(self, cells: Iterable[tuple[int, int]], generation: int = 0) -> int:
        """Replace the live set *and* the generation counter; report cells loaded.

        This is what a stored state needs and `load` cannot express: loading a
        pattern into an existing world leaves the generation wherever it was, so
        restoring a saved generation would silently relabel it. Used by the
        protocol's ``import`` and by the history layer's rollback.
        """
        if generation < 0:
            raise ValueError(f"generation must not be negative, got {generation}")
        self.clear()
        added = self.load(cells)
        self._generation = int(generation)
        return added

    def clear(self) -> None:
        """Remove every live cell and reset the generation counter."""
        self._keys = np.empty(0, dtype=np.int64)
        self._generation = 0

    # -- evolution --------------------------------------------------------

    def advance(self, count: int = 1, *, record: bool = True) -> Change:
        """Apply the rule ``count`` times and describe what the last step changed.

        ``step`` is this call without the cells, and the cells are the only part
        a caller can decline to pay for: the sparse step already holds the mask
        of survivors and the mask of births, so naming them is a comparison of
        two boolean arrays rather than a scan of the population.
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
        """Apply the rule ``count`` times; report how many cells changed last.

        A change is a cell whose state differs between the previous generation
        and the new one. Cells outside the candidate set — that is, dead cells
        with no live neighbour — cannot change by definition and are not
        examined.
        """
        return self.advance(count, record=False).changed

    def _step_once(self, record: bool = False) -> tuple[int, np.ndarray, np.ndarray]:
        keys = self._keys
        if keys.size == 0:
            return 0, EMPTY_CELLS, EMPTY_CELLS

        width = self._width
        height = self._height
        xs, ys = self._decode(keys)

        parts = [keys]
        for dx, dy in _OFFSETS:
            nx = xs + dx
            ny = ys + dy
            inside = (nx >= 0) & (nx < width) & (ny >= 0) & (ny < height)
            if inside.any():
                parts.append((ny[inside] << _COORD_BITS) | nx[inside])

        if len(parts) == 1:
            # No live cell has a neighbour inside the world: every cell has a
            # neighbour count of zero and therefore dies.
            changed = int(keys.size)
            died = self._cells(keys) if record else EMPTY_CELLS
            self._keys = np.empty(0, dtype=np.int64)
            return changed, EMPTY_CELLS, died

        candidates = np.concatenate(parts)
        unique, occurrences = np.unique(candidates, return_counts=True)

        position = np.searchsorted(keys, unique)
        np.minimum(position, keys.size - 1, out=position)
        was_alive = keys[position] == unique

        # `candidates` holds a live cell once on its own account plus once per
        # live neighbour, and a dead candidate once per live neighbour. The
        # self-entry therefore has to be subtracted only where the candidate is
        # alive; subtracting one unconditionally undercounts every birth.
        neighbours = occurrences - was_alive

        next_alive = np.where(
            was_alive,
            self._survive_table[neighbours],
            self._birth_table[neighbours],
        )
        changed = int(np.count_nonzero(next_alive != was_alive))
        if record:
            born = self._cells(unique[~was_alive & next_alive])
            died = self._cells(unique[was_alive & ~next_alive])
        else:
            born = EMPTY_CELLS
            died = EMPTY_CELLS
        self._keys = unique[next_alive]
        return changed, born, died
