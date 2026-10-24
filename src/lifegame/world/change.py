"""What one step changed, cell by cell.

A world's ``step`` reports how many cells changed. That number is enough for a
protocol but not for a history: to store a generation as a difference from the
one before it — and therefore to be able to roll back to either — a consumer
needs to know *which* cells were born and which died.

Both representations already compute this while stepping: the sparse step holds
``was_alive`` and ``next_alive`` side by side, and the tiled step holds the
previous and next row words side by side. Exposing it costs a comparison of two
masks, where re-deriving it from two snapshots would cost a full scan of the
live population per step.

The coordinates are ``(M, 2)`` ``int32`` arrays of ``x`` then ``y``, which is the
same shape and the same order the protocol's frame encoding uses. Nothing here
is representation-specific, so the history layer can store a sparse world's
generation and replay it into a tiled one.
"""

from dataclasses import dataclass, field

import numpy as np

__all__ = ["EMPTY_CELLS", "Change"]

#: A shared empty coordinate array, so a step with nothing to report allocates
#: nothing. Never mutated: every producer builds a new array.
EMPTY_CELLS = np.empty((0, 2), dtype=np.int32)


@dataclass(frozen=True, slots=True)
class Change:
    """The difference one `advance` call produced.

    ``born`` and ``died`` are empty when the call was made without recording;
    that is not the same as "nothing changed", which is what ``changed == 0``
    says. A consumer that needs the cells must ask for them, because collecting
    them is the only part of a step that a caller can opt out of.
    """

    changed: int
    generation: int
    born: np.ndarray = field(default_factory=lambda: EMPTY_CELLS)
    died: np.ndarray = field(default_factory=lambda: EMPTY_CELLS)

    @property
    def recorded(self) -> bool:
        """Whether the caller asked for the cells rather than only the count."""
        return self.born.shape[0] > 0 or self.died.shape[0] > 0 or self.changed == 0

    @property
    def bytes(self) -> int:
        """How much a stored delta of this change would occupy."""
        return int(self.born.nbytes + self.died.nbytes)

    def __str__(self) -> str:
        return (
            f"Change(generation={self.generation}, changed={self.changed}, "
            f"born={self.born.shape[0]}, died={self.died.shape[0]})"
        )
