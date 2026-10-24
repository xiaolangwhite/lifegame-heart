"""Known Life patterns, run against both representations.

These are the tests that would still pass if the rule were subtly wrong in a way
that random-state equivalence could not see — each pattern has a published,
memorable behaviour, so a failure here names the rule rather than an array.

Boundary condition under test: the world is bounded and does not wrap.
"""

import pytest

from lifegame.world import DenseWorld, SparseWorld, TiledWorld

REPRESENTATIONS = [SparseWorld, DenseWorld, TiledWorld]

BLOCK = [(0, 0), (1, 0), (0, 1), (1, 1)]
BLINKER_HORIZONTAL = [(0, 1), (1, 1), (2, 1)]
BLINKER_VERTICAL = [(1, 0), (1, 1), (1, 2)]
GLIDER = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)]


@pytest.fixture(params=REPRESENTATIONS, ids=["sparse", "dense", "tiled"])
def make(request: pytest.FixtureRequest) -> type:
    return request.param


def cells(world: SparseWorld | DenseWorld | TiledWorld) -> list[tuple[int, int]]:
    return sorted(world.live_cells())


def test_a_block_is_a_still_life(make: type) -> None:
    world = make(16, 16)
    world.load(BLOCK)
    for _ in range(4):
        assert world.step() == 0
    assert cells(world) == sorted(BLOCK)


def test_a_blinker_has_period_two(make: type) -> None:
    world = make(16, 16)
    world.load(BLINKER_HORIZONTAL)
    world.step()
    assert cells(world) == sorted(BLINKER_VERTICAL)
    world.step()
    assert cells(world) == sorted(BLINKER_HORIZONTAL)


def test_a_glider_keeps_its_population_and_moves_one_cell_diagonally(make: type) -> None:
    world = make(16, 16)
    world.load(GLIDER)
    for _ in range(3):
        world.step()
        assert world.population == 5
    world.step()
    assert cells(world) == sorted((x + 1, y + 1) for x, y in GLIDER)


def test_the_world_does_not_wrap_at_the_top_edge(make: type) -> None:
    world = make(8, 8)
    world.load([(1, 0), (2, 0), (3, 0)])
    world.step()
    # The next phase wants a cell at y = -1. Bounded, not wrapping, it is
    # simply absent; a torus would have placed it on the bottom row instead.
    assert cells(world) == [(2, 0), (2, 1)]
    assert world.is_alive(2, 7) is False


def test_the_world_does_not_wrap_at_the_left_edge(make: type) -> None:
    world = make(8, 8)
    world.load([(0, 1), (0, 2), (0, 3)])
    world.step()
    assert cells(world) == [(0, 2), (1, 2)]
    assert world.is_alive(7, 2) is False


def test_life_never_grows_outside_the_world(make: type) -> None:
    world = make(6, 6)
    world.load([(0, 0), (5, 5), (2, 3), (3, 3), (2, 2)])
    for _ in range(10):
        world.step()
        for x, y in world.live_cells():
            assert 0 <= x < 6
            assert 0 <= y < 6
