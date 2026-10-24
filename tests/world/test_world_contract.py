"""The contract every world representation promises.

Every test here runs against both representations. That is the point: the two
share one public surface, and a caller may hold either without knowing which.

Authority: docs/model/world/interfaces.md.
"""

import numpy as np
import pytest

from lifegame.world import CONWAY, DenseWorld, LifeRule, OutOfBoundsError, SparseWorld, TiledWorld

REPRESENTATIONS = [SparseWorld, DenseWorld, TiledWorld]
HIGHLIFE = LifeRule.parse("B36/S23")
#: A rule whose births are not confined to the neighbourhood of a live cell.
NON_LOCAL = LifeRule.parse("B0/S23")


@pytest.fixture(params=REPRESENTATIONS, ids=["sparse", "dense", "tiled"])
def make(request: pytest.FixtureRequest) -> type:
    return request.param


def test_a_new_world_is_empty(make: type) -> None:
    world = make(8, 8)
    assert world.population == 0
    assert world.generation == 0
    assert world.bounds() is None
    assert list(world.live_cells()) == []


def test_toggle_reports_the_new_state_and_round_trips(make: type) -> None:
    world = make(8, 8)
    assert world.toggle(3, 4) is True
    assert world.is_alive(3, 4) is True
    assert world.population == 1
    assert world.toggle(3, 4) is False
    assert world.is_alive(3, 4) is False
    assert world.population == 0


def test_set_alive_reports_whether_anything_changed(make: type) -> None:
    world = make(8, 8)
    assert world.set_alive(2, 2) is True
    assert world.set_alive(2, 2) is False
    assert world.set_alive(2, 2, False) is True
    assert world.set_alive(2, 2, False) is False


def test_load_adds_cells_and_reports_only_the_new_ones(make: type) -> None:
    world = make(8, 8)
    assert world.load([(0, 0), (1, 1)]) == 2
    assert world.load([(1, 1), (2, 2)]) == 1
    assert world.population == 3


def test_clear_removes_every_cell_and_resets_the_generation(make: type) -> None:
    world = make(8, 8)
    world.load([(0, 0), (0, 1), (0, 2)])
    world.step()
    assert world.generation == 1
    world.clear()
    assert world.population == 0
    assert world.generation == 0
    assert world.bounds() is None


def test_bounds_grow_and_shrink_with_the_cells(make: type) -> None:
    world = make(16, 16)
    world.load([(4, 5), (9, 11)])
    assert world.bounds() == (4, 5, 9, 11)
    world.set_alive(9, 11, False)
    assert world.bounds() == (4, 5, 4, 5)


def test_live_cells_are_unique(make: type) -> None:
    world = make(8, 8)
    world.load([(1, 1), (1, 1), (2, 2)])
    assert sorted(world.live_cells()) == [(1, 1), (2, 2)]


def test_viewport_is_a_dense_view_of_one_rectangle(make: type) -> None:
    world = make(8, 8)
    world.load([(1, 1), (3, 2)])
    view = world.viewport(1, 1, 3, 2)
    assert view.shape == (2, 3)
    assert view.dtype == np.bool_
    # The window starts at (1, 1), so (1, 1) is its top-left cell and (3, 2)
    # lands two columns right and one row down.
    assert view.tolist() == [[True, False, False], [False, False, True]]


def test_live_cells_in_returns_absolute_coordinates(make: type) -> None:
    world = make(8, 8)
    world.load([(1, 1), (5, 5)])
    inside = world.live_cells_in(4, 4, 4, 4)
    assert inside.tolist() == [[5, 5]]
    assert inside.dtype == np.int32


def test_live_cells_in_returns_an_empty_array_not_none(make: type) -> None:
    world = make(8, 8)
    assert world.live_cells_in(0, 0, 8, 8).shape == (0, 2)


@pytest.mark.parametrize("point", [(-1, 0), (0, -1), (8, 0), (0, 8)])
def test_coordinates_outside_the_world_are_refused(make: type, point: tuple[int, int]) -> None:
    world = make(8, 8)
    with pytest.raises(OutOfBoundsError):
        world.toggle(*point)
    with pytest.raises(OutOfBoundsError):
        world.is_alive(*point)


def test_a_rectangle_outside_the_world_is_refused(make: type) -> None:
    world = make(8, 8)
    with pytest.raises(OutOfBoundsError):
        world.viewport(4, 4, 8, 8)
    with pytest.raises(ValueError, match="positive area"):
        world.viewport(0, 0, 0, 4)


def test_an_empty_world_is_stable_forever(make: type) -> None:
    world = make(8, 8)
    for _ in range(3):
        assert world.step() == 0
    assert world.generation == 3
    assert world.population == 0


def test_step_advances_one_generation_per_application(make: type) -> None:
    world = make(8, 8)
    world.load([(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)])
    world.step(3)
    assert world.generation == 3


def test_step_reports_the_number_of_cells_that_changed(make: type) -> None:
    world = make(8, 8)
    # A lone cell has no neighbours: it dies, and that is one change.
    world.set_alive(4, 4)
    assert world.step() == 1
    assert world.population == 0


def test_a_negative_step_count_is_refused(make: type) -> None:
    world = make(8, 8)
    with pytest.raises(ValueError, match="negative"):
        world.step(-1)


def test_the_rule_is_reported(make: type) -> None:
    world = make(8, 8)
    assert world.rule.notation == "B3/S23"
    assert (world.width, world.height) == (8, 8)


def test_a_dense_world_refuses_the_target_scale() -> None:
    with pytest.raises(ValueError, match="above the"):
        DenseWorld(65536, 65536)


# -- changing the rule ----------------------------------------------------

def test_the_rule_can_be_switched_without_touching_the_state(make: type) -> None:
    """A rule is not a state: adopting one changes neither cells nor generation."""
    world = make(16, 16)
    block = [(4, 4), (5, 4), (4, 5), (5, 5)]
    world.load(block)
    world.step()
    cells = sorted(world.live_cells())
    generation = world.generation
    assert world.rule == CONWAY

    world.set_rule(HIGHLIFE)

    assert world.rule.notation == "B36/S23"
    assert world.generation == generation
    assert sorted(world.live_cells()) == cells
    assert world.population == len(cells)


def test_a_switched_rule_is_the_rule_that_runs(make: type) -> None:
    """A block is a still life under Conway and dies where nothing survives."""
    world = make(16, 16)
    world.load([(4, 4), (5, 4), (4, 5), (5, 5)])
    assert world.step() == 0
    assert world.population == 4

    world.set_rule(LifeRule.parse("B/S"))

    assert world.step() == 4
    assert world.population == 0


@pytest.mark.parametrize("make", [SparseWorld, TiledWorld], ids=["sparse", "tiled"])
def test_a_rule_that_is_not_local_is_refused_by_the_local_representations(make: type) -> None:
    """Both store only the region around the live cells, and B0 leaves it.

    A birth on a count of zero turns *every* dead cell in the world into a live
    one, so the answer depends on the world's area — 4.29e9 cells at the design
    scale. Neither representation can hold that, so both refuse the rule rather
    than answering a question they cannot answer.
    """
    with pytest.raises(ValueError, match="not a local rule"):
        make(8, 8, NON_LOCAL)
    world = make(8, 8)
    with pytest.raises(ValueError, match="not a local rule"):
        world.set_rule(NON_LOCAL)
    assert world.rule == CONWAY, "a refused rule must not be adopted"
    assert world.population == 0


def test_the_dense_oracle_runs_the_rule_the_local_representations_refuse() -> None:
    """Which is why the refusal is a boundary and not pedantry: this is the answer."""
    world = DenseWorld(8, 8, LifeRule.parse("B012345678/S"))
    world.set_alive(0, 0)
    # Every one of the 63 dead cells is born; the single live cell dies.
    assert world.step() == 64
    assert world.population == 63
