"""Sparse, dense and tiled must agree, cell for cell.

This is the oracle test, and it is the reason the dense world is shipped at all.
The three representations share the rule object and nothing else below it: the
dense world sums eight shifted slices over a padded array, the sparse world
sorts packed 64-bit keys, and the tiled world runs a bit-parallel adder tree over
64-cell words. Agreement between all three on randomised states is real evidence
about the rule, the boundary condition and the coordinate encoding.

It has earned its keep twice. The first version of the sparse step subtracted
the self-entry from every candidate's occurrence count instead of only from the
live ones, which undercounted every birth. The first version of the tiled step
was written against the same contract and passed on the first run, which is only
meaningful because this file already existed.
"""

import random

import pytest

from lifegame.world import DenseWorld, SparseWorld, TiledWorld

SIZES = [(8, 8), (17, 11), (32, 32), (64, 64), (65, 63)]
SEEDS = [0, 1, 2, 3, 4]


def build_all(width: int, height: int) -> tuple[SparseWorld, DenseWorld, TiledWorld]:
    return SparseWorld(width, height), DenseWorld(width, height), TiledWorld(width, height)


def assert_agree(sparse: SparseWorld, dense: DenseWorld, tiled: TiledWorld, context: str) -> None:
    assert sparse.generation == dense.generation == tiled.generation, context
    assert sparse.population == dense.population == tiled.population, context
    expected = sorted(sparse.live_cells())
    assert sorted(dense.live_cells()) == expected, context
    assert sorted(tiled.live_cells()) == expected, context
    assert sparse.bounds() == dense.bounds() == tiled.bounds(), context


def assert_same_change_count(
    sparse: SparseWorld, dense: DenseWorld, tiled: TiledWorld, context: str
) -> None:
    """`step` must report the same number of changed *cells* everywhere.

    The tiled world stores one 64-cell word per array element, so a change count
    taken over elements rather than over bits is silently wrong: four changed
    cells inside three words read as three. This check is what catches that, and
    it was added because it happened.
    """
    counts = (
        sparse.step(),
        dense.step(),
        tiled.step(),
    )
    assert counts[0] == counts[1] == counts[2], f"{context}: changed counts {counts}"


@pytest.mark.parametrize("size", SIZES, ids=[f"{w}x{h}" for w, h in SIZES])
@pytest.mark.parametrize("seed", SEEDS)
def test_random_states_evolve_identically(size: tuple[int, int], seed: int) -> None:
    rng = random.Random(seed)
    width, height = size
    sparse, dense, tiled = build_all(width, height)

    for round_index in range(6):
        for _ in range(rng.randint(0, 16)):
            x = rng.randrange(width)
            y = rng.randrange(height)
            alive = rng.random() < 0.6
            sparse.set_alive(x, y, alive)
            dense.set_alive(x, y, alive)
            tiled.set_alive(x, y, alive)
        assert_agree(sparse, dense, tiled, f"mutation round {round_index}")

        sparse.step()
        dense.step()
        tiled.step()
        assert_agree(sparse, dense, tiled, f"generation {round_index}")


@pytest.mark.parametrize("seed", SEEDS)
def test_the_reported_change_count_agrees_too(seed: int) -> None:
    rng = random.Random(3000 + seed)
    width = height = 70
    sparse, dense, tiled = build_all(width, height)
    for _ in range(60):
        x = rng.randrange(width)
        y = rng.randrange(height)
        sparse.toggle(x, y)
        dense.toggle(x, y)
        tiled.toggle(x, y)

    for generation in range(6):
        assert_same_change_count(sparse, dense, tiled, f"generation {generation}")
        assert_agree(sparse, dense, tiled, f"generation {generation}")


@pytest.mark.parametrize("seed", SEEDS)
def test_the_born_and_died_cells_agree(seed: int) -> None:
    """A recorded change must name the same cells in every representation.

    The history layer stores a generation as the cells that were born and died
    relative to the one before it, so a representation that agrees on the state
    but not on the difference would corrupt a rollback while every state
    comparison still passed. Order is not part of the contract; the set is.
    """
    rng = random.Random(5000 + seed)
    width = height = 72
    sparse, dense, tiled = build_all(width, height)
    for _ in range(70):
        x = rng.randrange(width)
        y = rng.randrange(height)
        sparse.toggle(x, y)
        dense.toggle(x, y)
        tiled.toggle(x, y)

    for generation in range(5):
        before = sparse.population
        changes = (sparse.advance(), dense.advance(), tiled.advance())
        assert changes[0].changed == changes[1].changed == changes[2].changed
        born = {tuple(cell) for cell in changes[0].born.tolist()}
        died = {tuple(cell) for cell in changes[0].died.tolist()}
        for index, change in enumerate(changes[1:], start=1):
            assert {tuple(cell) for cell in change.born.tolist()} == born, (
                f"generation {generation}, representation {index}: born differs"
            )
            assert {tuple(cell) for cell in change.died.tolist()} == died, (
                f"generation {generation}, representation {index}: died differs"
            )
        # The delta has to explain the state change it claims to describe: every
        # birth adds one to the population and every death removes one. Without
        # this the sets could agree and still be the wrong sets.
        assert len(born) - len(died) == sparse.population - before, (
            f"generation {generation}: the delta does not explain the population"
        )
        assert len(born) + len(died) == changes[0].changed, (
            f"generation {generation}: the delta does not explain the change count"
        )
        assert not (born & died), f"generation {generation}: a cell both born and died"
        assert_agree(sparse, dense, tiled, f"generation {generation}")


@pytest.mark.parametrize("seed", SEEDS)
def test_a_dense_random_cloud_evolves_identically(seed: int) -> None:
    rng = random.Random(1000 + seed)
    width = height = 24
    sparse, dense, tiled = build_all(width, height)

    for y in range(height):
        for x in range(width):
            if rng.random() < 0.42:
                sparse.set_alive(x, y)
                dense.set_alive(x, y)
                tiled.set_alive(x, y)

    assert_agree(sparse, dense, tiled, "initial cloud")
    for generation in range(5):
        sparse.step()
        dense.step()
        tiled.step()
        assert_agree(sparse, dense, tiled, f"generation {generation}")


@pytest.mark.parametrize("seed", SEEDS)
def test_a_cloud_straddling_tile_boundaries_evolves_identically(seed: int) -> None:
    """The tiled world's halo is where a bit-parallel step goes wrong."""
    rng = random.Random(2000 + seed)
    width = height = 160
    sparse, dense, tiled = build_all(width, height)

    for y in range(height):
        for x in range(width):
            # Dense across the seams at x = 64, 128 and y = 64, 128, sparse
            # elsewhere: the seams are the interesting part.
            near_seam = min(x % 64, 63 - (x % 64), y % 64, 63 - (y % 64)) <= 2
            if rng.random() < (0.55 if near_seam else 0.12):
                sparse.set_alive(x, y)
                dense.set_alive(x, y)
                tiled.set_alive(x, y)

    assert_agree(sparse, dense, tiled, "seam cloud")
    for generation in range(4):
        sparse.step()
        dense.step()
        tiled.step()
        assert_agree(sparse, dense, tiled, f"seam generation {generation}")


def test_viewports_agree_everywhere_in_a_random_state() -> None:
    rng = random.Random(99)
    width = height = 20
    sparse, dense, tiled = build_all(width, height)
    for _ in range(80):
        x = rng.randrange(width)
        y = rng.randrange(height)
        sparse.toggle(x, y)
        dense.toggle(x, y)
        tiled.toggle(x, y)

    for _ in range(3):
        sparse.step()
        dense.step()
        tiled.step()
        for x0 in range(0, width, 5):
            for y0 in range(0, height, 5):
                w = min(5, width - x0)
                h = min(5, height - y0)
                expected = sparse.viewport(x0, y0, w, h).tolist()
                assert dense.viewport(x0, y0, w, h).tolist() == expected
                assert tiled.viewport(x0, y0, w, h).tolist() == expected, (
                    f"tiled viewport at ({x0}, {y0}) diverged"
                )
