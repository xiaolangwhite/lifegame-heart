"""Dense reference world: the correctness oracle.

This is the representation a first implementation reaches for: one boolean per
cell, one pass over the whole grid per step. It is kept for two reasons and for
no others.

1. **Oracle.** It computes the same rule with a completely different algorithm —
   eight shifted slices over a padded array instead of a sort over packed
   keys — so agreement between the two on randomised states is real evidence
   about the rule, the boundary condition and the coordinate encoding.
2. **Measured candidate.** It is the baseline the sparse world has to beat, and
   the crossover where it stops winning is a number the performance record
   needs.

It is **not** a shipping representation: the design target is 65536 x 65536,
which is 4.29e9 cells, and a dense grid of that size cannot be allocated and
would be touched in full on every step. The constructor refuses sizes above
:data:`MAX_DENSE_CELLS` rather than silently consuming the machine.

Authority: docs/model/world/interfaces.md, docs/model/world/performance.md.
"""

from collections.abc import Iterable, Iterator

import numpy as np

from lifegame.world.change import EMPTY_CELLS, Change
from lifegame.world.errors import OutOfBoundsError
from lifegame.world.rules import CONWAY, LifeRule

__all__ = ["MAX_DENSE_CELLS", "DenseWorld"]

# 64 million cells is 64 MB as a boolean grid plus a padded copy and a
# neighbour array per step, which is already about 200 MB of transient work.
MAX_DENSE_CELLS = 64_000_000


class DenseWorld:
    """A bounded life world stored as one boolean per cell.

    The boundary condition matches :class:`lifegame.world.sparse.SparseWorld`
    exactly: the world does not wrap, and a cell outside the bounds is
    permanently dead.
    """

    __slots__ = (
        "_birth_table",
        "_generation",
        "_grid",
        "_height",
        "_rule",
        "_survive_table",
        "_width",
    )

    def __init__(self, width: int, height: int, rule: LifeRule = CONWAY) -> None:
        if width <= 0 or height <= 0:
            raise ValueError(f"world must have positive area, got {width} x {height}")
        if width * height > MAX_DENSE_CELLS:
            raise ValueError(
                f"a {width} x {height} dense world would hold {width * height} cells, above the "
                f"{MAX_DENSE_CELLS} cell limit; use SparseWorld for the target scale"
            )
        self._width = int(width)
        self._height = int(height)
        self._grid = np.zeros((self._height, self._width), dtype=bool)
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
        self._rule = rule
        self._birth_table = np.array(rule.birth_table, dtype=bool)
        self._survive_table = np.array(rule.survive_table, dtype=bool)

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
        return int(np.count_nonzero(self._grid))

    def __repr__(self) -> str:
        return (
            f"DenseWorld(width={self._width}, height={self._height}, "
            f"rule={self._rule.notation!r}, population={self.population}, "
            f"generation={self._generation})"
        )

    def _check(self, x: int, y: int) -> None:
        if not 0 <= x < self._width or not 0 <= y < self._height:
            raise OutOfBoundsError(f"({x}, {y}) is outside a {self._width} x {self._height} world")

    def is_alive(self, x: int, y: int) -> bool:
        self._check(x, y)
        return bool(self._grid[y, x])

    def toggle(self, x: int, y: int) -> bool:
        self._check(x, y)
        self._grid[y, x] = not self._grid[y, x]
        return bool(self._grid[y, x])

    def set_alive(self, x: int, y: int, alive: bool = True) -> bool:
        self._check(x, y)
        if bool(self._grid[y, x]) == bool(alive):
            return False
        self._grid[y, x] = alive
        return True

    def load(self, cells: Iterable[tuple[int, int]]) -> int:
        added = 0
        for x, y in cells:
            if self.set_alive(x, y, True):
                added += 1
        return added

    def restore(self, cells: Iterable[tuple[int, int]], generation: int = 0) -> int:
        """Replace the live set *and* the generation counter; report cells loaded."""
        if generation < 0:
            raise ValueError(f"generation must not be negative, got {generation}")
        self.clear()
        added = self.load(cells)
        self._generation = int(generation)
        return added

    def clear(self) -> None:
        self._grid = np.zeros((self._height, self._width), dtype=bool)
        self._generation = 0

    def live_cells(self) -> Iterator[tuple[int, int]]:
        ys, xs = np.nonzero(self._grid)
        yield from zip(xs.tolist(), ys.tolist(), strict=True)

    def bounds(self) -> tuple[int, int, int, int] | None:
        ys, xs = np.nonzero(self._grid)
        if xs.size == 0:
            return None
        return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))

    def viewport(self, x0: int, y0: int, width: int, height: int) -> np.ndarray:
        if width <= 0 or height <= 0:
            raise ValueError(f"viewport must have positive area, got {width} x {height}")
        if x0 < 0 or y0 < 0 or x0 + width > self._width or y0 + height > self._height:
            raise OutOfBoundsError(
                f"viewport ({x0}, {y0}, {width}, {height}) is outside a "
                f"{self._width} x {self._height} world"
            )
        return self._grid[y0 : y0 + height, x0 : x0 + width].copy()

    def live_cells_in(self, x0: int, y0: int, width: int, height: int) -> np.ndarray:
        window = self.viewport(x0, y0, width, height)
        ys, xs = np.nonzero(window)
        if xs.size == 0:
            return np.empty((0, 2), dtype=np.int32)
        return np.stack((xs + x0, ys + y0), axis=1).astype(np.int32)

    @staticmethod
    def _coords(mask: np.ndarray) -> np.ndarray:
        """``(M, 2)`` ``int32`` ``x`` then ``y`` for a full-world boolean mask."""
        ys, xs = np.nonzero(mask)
        if xs.size == 0:
            return EMPTY_CELLS
        return np.stack((xs, ys), axis=1).astype(np.int32)

    def advance(self, count: int = 1, *, record: bool = True) -> Change:
        """Apply the rule ``count`` times and describe what the last step changed."""
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
        padded = np.zeros((self._height + 2, self._width + 2), dtype=bool)
        padded[1:-1, 1:-1] = self._grid
        neighbours = np.zeros((self._height, self._width), dtype=np.uint8)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                neighbours += padded[
                    1 + dy : 1 + dy + self._height,
                    1 + dx : 1 + dx + self._width,
                ]
        next_grid = np.where(
            self._grid,
            self._survive_table[neighbours],
            self._birth_table[neighbours],
        )
        difference = next_grid != self._grid
        changed = int(np.count_nonzero(difference))
        if record:
            born = self._coords(next_grid & difference)
            died = self._coords(self._grid & difference)
        else:
            born = EMPTY_CELLS
            died = EMPTY_CELLS
        self._grid = next_grid
        return changed, born, died
