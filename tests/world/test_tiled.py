"""What the tiled representation promises beyond the shared world contract.

The shared contract is exercised for every representation in
`test_world_contract.py`; this file covers the things that are true of the tiled
world in particular: that a tile is the unit of storage, that a birth across a
tile seam is found, that empty tiles are dropped, and that a world whose size is
not a multiple of the tile size keeps its cells inside its own bounds.
"""

import numpy as np
import pytest

from lifegame.world import TILE_BITS, TILE_CELLS, SparseWorld, TiledWorld

BLOCK = [(0, 0), (1, 0), (0, 1), (1, 1)]


def test_a_tile_holds_sixty_four_by_sixty_four_cells() -> None:
    assert TILE_BITS == 64
    assert TILE_CELLS == 4096


def test_one_tile_is_stored_for_a_pattern_inside_it() -> None:
    world = TiledWorld(1024, 1024)
    world.load(BLOCK)
    assert world.tile_count == 1


def test_scattered_cells_occupy_one_tile_each() -> None:
    world = TiledWorld(1024, 1024)
    world.load([(0, 0), (100, 100), (200, 200)])
    assert world.tile_count == 3
    assert world.population == 3


def test_a_tile_is_dropped_when_it_dies() -> None:
    world = TiledWorld(1024, 1024)
    world.set_alive(500, 500)
    assert world.tile_count == 1
    world.step()
    assert world.population == 0
    assert world.tile_count == 0


def test_a_birth_across_a_tile_seam_is_found() -> None:
    """Three cells in one tile can bring a cell in the next tile to life.

    Column 63 is the last column of tile 0, so a vertical three-cell line there
    brings (64, 10) to life -- the first column of tile 1, which held no live
    cell of its own before the step. A step that advanced only non-empty tiles
    would miss it.
    """
    world = TiledWorld(256, 256)
    world.load([(63, 9), (63, 10), (63, 11)])
    assert world.tile_count == 1
    changed = world.step()
    assert changed > 0
    assert world.is_alive(64, 10) is True
    assert world.tile_count == 2, "the neighbouring tile must now exist"


def test_a_birth_across_a_diagonal_seam_is_found() -> None:
    """The three cells sit in three tiles and the birth lands in the fourth."""
    world = TiledWorld(256, 256)
    world.load([(63, 63), (64, 63), (63, 64)])
    assert world.tile_count == 3
    world.step()
    assert world.is_alive(64, 64) is True
    assert world.tile_count == 4, "the diagonal tile must now exist"


def test_a_world_that_is_not_a_multiple_of_the_tile_size_keeps_its_bounds() -> None:
    world = TiledWorld(70, 65)
    world.load([(69, 64), (0, 0), (68, 0)])
    assert all(0 <= x < 70 and 0 <= y < 65 for x, y in world.live_cells())
    for _ in range(5):
        world.step()
        cells = list(world.live_cells())
        assert all(0 <= x < 70 and 0 <= y < 65 for x, y in cells), cells


def test_the_edge_of_a_partial_tile_is_not_alive() -> None:
    """A cell beyond the world inside the last tile must never appear.

    The world is 65 cells wide, so its last tile has exactly one valid column
    and 63 that must stay dead. `is_alive` refuses an out-of-range coordinate by
    contract, so the check is over the live set.
    """
    world = TiledWorld(65, 65)
    world.load([(63, 40), (64, 40)])
    for _ in range(3):
        world.step()
        cells = list(world.live_cells())
        assert all(x < 65 and y < 65 for x, y in cells), cells


def test_population_matches_bit_counting() -> None:
    world = TiledWorld(128, 128)
    world.load([(x, y) for x in range(10) for y in range(10)])
    assert world.population == 100


def test_tiled_and_sparse_agree_on_a_long_run() -> None:
    """Two different algorithms, one long random walk, no divergence."""
    import random

    rng = random.Random(4242)
    width = height = 96
    sparse = SparseWorld(width, height)
    tiled = TiledWorld(width, height)
    for _ in range(40):
        for _ in range(rng.randint(0, 6)):
            x = rng.randrange(width)
            y = rng.randrange(height)
            sparse.toggle(x, y)
            tiled.toggle(x, y)
        sparse.step()
        tiled.step()
        assert sparse.population == tiled.population
        assert sorted(sparse.live_cells()) == sorted(tiled.live_cells())


def test_a_tile_stores_rows_as_sixty_four_bit_words() -> None:
    world = TiledWorld(128, 128)
    world.load([(0, 0), (63, 0), (0, 63)])
    rows = world._rows
    assert rows.dtype == np.uint64
    assert rows.shape == (1, TILE_BITS)
    assert int(rows[0, 0]) == (1 << 63) | 1
    assert int(rows[0, 63]) == 1


def test_the_world_refuses_coordinates_outside_it() -> None:
    from lifegame.world import OutOfBoundsError

    world = TiledWorld(64, 64)
    with pytest.raises(OutOfBoundsError):
        world.toggle(64, 0)
    with pytest.raises(OutOfBoundsError):
        world.is_alive(0, 64)


def test_a_negative_step_count_is_refused() -> None:
    world = TiledWorld(64, 64)
    with pytest.raises(ValueError, match="negative"):
        world.step(-1)
