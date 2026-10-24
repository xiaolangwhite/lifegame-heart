"""The life world: representation and rule evaluation.

The public surface is exactly what :data:`__all__` names. Everything else in
this package is a private category and is not imported from outside.

Authority: docs/model/world/interfaces.md.
"""

from lifegame.world.change import EMPTY_CELLS, Change
from lifegame.world.dense import MAX_DENSE_CELLS, DenseWorld
from lifegame.world.errors import OutOfBoundsError
from lifegame.world.rules import CONWAY, LifeRule
from lifegame.world.sparse import SparseWorld
from lifegame.world.tiled import TILE_BITS, TILE_CELLS, TiledWorld

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
