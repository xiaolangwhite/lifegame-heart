"""Every representation, every rule: the dense oracle is the judge.

`test_oracle_equivalence.py` proves that the three representations agree under
Conway. That proof was only ever about Conway: the tiled world's rule step used
to be the Conway expression written into the step, so a second rule had nothing
to agree with. This file is the same claim for the rules people actually ask for
by name, and it is the assertion the bit-parallel selection network has to
survive — the two ways a compiled network goes wrong are a term that fires on the
wrong neighbour count and a count of eight that slips past its guard, and both
are invisible to a test that only ever runs Conway.

The dense world is the oracle for the same reason as there: it computes the same
rule by a completely different algorithm — eight shifted slices over a padded
array — and shares nothing with the other two below the rule object.

Three properties are checked for each rule, and they are not the same property:

* the three representations reach the same live set, the same population, the
  same bounds and the same reported change count;
* the recorded birth and death sets are the same sets, because the history layer
  stores a generation as that delta;
* a world that **switches** to a rule reaches the state a world **built** with
  it reaches, which is what catches a decision table or a compiled plan left
  over from the previous rule.

Authority: docs/model/world/interfaces.md, docs/model/world/testing.md.
"""

import random

import pytest

from lifegame.world import CONWAY, DenseWorld, LifeRule, SparseWorld, TiledWorld
from lifegame.world.tiled import _SelectionNetwork

#: The rules the equivalence claim is made for. Conway and HighLife are the two
#: the preset list leads with; Maze, Seeds and the two edge rules are the shapes
#: that stress the network differently — a set that spans every group, a set with
#: no survival at all, a set with no birth at all, and a rule where birth and
#: survival are the same set, which the compiler collapses to one word.
RULES = [
    "B3/S23",
    "B36/S23",
    "B3/S12345",
    "B2/S",
    "B/S012345678",
    "B3/S012345678",
    "B/S",
    "B3/S",
    "B/S23",
    "B3678/S34678",
    "B1357/S1357",
    "B12345678/S",
    "B8/S0",
    "B1/S1",
]

REPRESENTATION_NAMES = ["sparse", "dense", "tiled"]


def build(width: int, height: int, rule: LifeRule) -> tuple[SparseWorld, DenseWorld, TiledWorld]:
    return (
        SparseWorld(width, height, rule),
        DenseWorld(width, height, rule),
        TiledWorld(width, height, rule),
    )


def assert_agree(sparse: SparseWorld, dense: DenseWorld, tiled: TiledWorld, context: str) -> None:
    """The shared oracle assertion: three algorithms, one live set."""
    assert sparse.generation == dense.generation == tiled.generation, context
    assert sparse.population == dense.population == tiled.population, context
    expected = sorted(sparse.live_cells())
    assert sorted(dense.live_cells()) == expected, f"{context}: dense diverged"
    assert sorted(tiled.live_cells()) == expected, f"{context}: tiled diverged"
    assert sparse.bounds() == dense.bounds() == tiled.bounds(), context


def seed_state(
    rng: random.Random,
    worlds: tuple[SparseWorld, DenseWorld, TiledWorld],
    width: int,
    height: int,
    cells: int,
) -> None:
    for _ in range(cells):
        x, y = rng.randrange(width), rng.randrange(height)
        for world in worlds:
            world.toggle(x, y)


@pytest.mark.parametrize("rule_text", RULES)
@pytest.mark.parametrize("seed", [0, 1, 2])
def test_every_rule_evolves_identically_in_all_three_representations(
    rule_text: str,
    seed: int,
) -> None:
    """The states, the populations and the reported change counts all agree.

    The world is 70 x 70, which is not a multiple of the 64-cell tile, crosses a
    seam on both axes, and leaves a partial tile at each edge — the geometry where
    the tiled halo and the bounds mask interact with the rule.
    """
    rule = LifeRule.parse(rule_text)
    rng = random.Random(seed)
    width = height = 70
    sparse, dense, tiled = build(width, height, rule)
    seed_state(rng, (sparse, dense, tiled), width, height, 220)

    for generation in range(6):
        counts = (sparse.step(), dense.step(), tiled.step())
        assert counts[0] == counts[1] == counts[2], f"{rule_text}: changed counts {counts}"
        assert_agree(sparse, dense, tiled, f"{rule_text}, generation {generation}")


@pytest.mark.parametrize("rule_text", RULES)
@pytest.mark.parametrize("seed", [0, 1])
def test_the_born_and_died_cells_agree_under_every_rule(rule_text: str, seed: int) -> None:
    """The delta, not only the state: a history replay depends on the sets."""
    rule = LifeRule.parse(rule_text)
    rng = random.Random(100 + seed)
    width = height = 72
    sparse, dense, tiled = build(width, height, rule)
    seed_state(rng, (sparse, dense, tiled), width, height, 240)

    for generation in range(3):
        changes = (sparse.advance(), dense.advance(), tiled.advance())
        assert changes[0].changed == changes[1].changed == changes[2].changed
        born = {tuple(cell) for cell in changes[0].born.tolist()}
        died = {tuple(cell) for cell in changes[0].died.tolist()}
        for index, change in enumerate(changes[1:], start=1):
            assert {tuple(cell) for cell in change.born.tolist()} == born, (
                f"{rule_text}, representation {index}, generation {generation}: born differs"
            )
            assert {tuple(cell) for cell in change.died.tolist()} == died, (
                f"{rule_text}, representation {index}, generation {generation}: died differs"
            )
        assert not (born & died)
        assert_agree(sparse, dense, tiled, f"{rule_text}, generation {generation}")


@pytest.mark.parametrize("rule_text", RULES)
def test_the_tiled_network_matches_the_dense_oracle_across_tile_seams(rule_text: str) -> None:
    """The bit-parallel path against the oracle, on the geometry that breaks it.

    A dense band straddles x = 64 and y = 64, so most of the live cells sit in a
    tile whose horizontal and vertical neighbours are occupied, and the count
    planes carry carries out of the tile on every row. This is the test the
    halo, the bounds mask and the selection network are checked against together.
    """
    rule = LifeRule.parse(rule_text)
    rng = random.Random(11)
    width = height = 160
    dense_world = DenseWorld(width, height, rule)
    tiled = TiledWorld(width, height, rule)

    for y in range(height):
        for x in range(width):
            near_seam = min(x % 64, 63 - (x % 64), y % 64, 63 - (y % 64)) <= 2
            if rng.random() < (0.55 if near_seam else 0.12):
                dense_world.set_alive(x, y)
                tiled.set_alive(x, y)

    for generation in range(4):
        assert tiled.step() == dense_world.step(), f"{rule_text}, generation {generation}"
        assert sorted(tiled.live_cells()) == sorted(dense_world.live_cells()), (
            f"{rule_text}: the tiled step diverged from the oracle at generation {generation}"
        )
    assert tiled.population == dense_world.population


@pytest.mark.parametrize("rule_text", RULES)
@pytest.mark.parametrize("representation", REPRESENTATION_NAMES)
def test_a_rule_switch_reaches_the_state_a_fresh_world_reaches(
    rule_text: str,
    representation: str,
) -> None:
    """Switching must not reuse the previous rule's table or plan.

    Three worlds start from the same cells under Conway and run two generations.
    One switches to the new rule and runs three more; one is built with the new
    rule and runs three from the state the switch started at; one is the dense
    oracle doing exactly what the first did. If a decision table or a compiled
    plan survived the switch, the first and second would part company.
    """
    rule = LifeRule.parse(rule_text)
    rng = random.Random(7)
    width = height = 70
    cells = {
        (rng.randrange(width), rng.randrange(height))
        for _ in range(200)
    }

    maker = {"sparse": SparseWorld, "dense": DenseWorld, "tiled": TiledWorld}[representation]
    switched = maker(width, height, CONWAY)
    switched.load(cells)
    switched.step(2)
    midpoint = sorted(switched.live_cells())

    switched.set_rule(rule)
    switched.step(3)

    fresh = maker(width, height, rule)
    fresh.restore(midpoint, generation=2)
    fresh.step(3)

    assert sorted(switched.live_cells()) == sorted(fresh.live_cells()), (
        f"{rule_text}: a switched {representation} world diverged from one built with the rule"
    )
    assert switched.generation == fresh.generation == 5
    assert switched.population == fresh.population


@pytest.mark.parametrize("rule_text", RULES)
def test_a_switch_agrees_with_the_oracle_it_switched_to(rule_text: str) -> None:
    """The same switch, judged by dense rather than by another sparse world."""
    rule = LifeRule.parse(rule_text)
    rng = random.Random(21)
    width = height = 70
    cells = {(rng.randrange(width), rng.randrange(height)) for _ in range(200)}

    sparse = SparseWorld(width, height, CONWAY)
    dense = DenseWorld(width, height, CONWAY)
    tiled = TiledWorld(width, height, CONWAY)
    for world in (sparse, dense, tiled):
        world.load(cells)
        world.step(2)
        world.set_rule(rule)
        world.step(3)

    assert_agree(sparse, dense, tiled, f"{rule_text}: after switching from Conway")


def test_a_rule_may_be_switched_more_than_once() -> None:
    """Four switches, one world, and an oracle that did the same four."""
    sequence = ["B36/S23", "B3/S12345", "B2/S", "B3/S23"]
    rng = random.Random(31)
    width = height = 70
    cells = {(rng.randrange(width), rng.randrange(height)) for _ in range(200)}

    worlds = build(width, height, CONWAY)
    for world in worlds:
        world.load(cells)
    for rule_text in sequence:
        rule = LifeRule.parse(rule_text)
        for world in worlds:
            world.set_rule(rule)
            world.step(2)
        assert_agree(*worlds, f"after switching to {rule_text}")


def test_highlife_finds_the_birth_conway_does_not() -> None:
    """The one count that separates HighLife from Conway, in all three worlds.

    A dead cell with six live neighbours is born under ``B36`` and not under
    ``B3``. Without a case like this the HighLife rows above would pass even if
    the birth set were ignored, because a cloud of a few hundred cells rarely
    puts six neighbours around one empty cell — the rule would be exercised by
    name and not by behaviour.
    """
    centre = (1, 1)
    six_neighbours = [(0, 0), (1, 0), (2, 0), (0, 1), (2, 1), (0, 2)]
    for maker in (SparseWorld, DenseWorld, TiledWorld):
        highlife = maker(16, 16, LifeRule.parse("B36/S23"))
        highlife.load(six_neighbours)
        highlife.step()
        assert highlife.is_alive(*centre) is True, f"{maker.__name__}: six neighbours must be born"

        conway = maker(16, 16, CONWAY)
        conway.load(six_neighbours)
        conway.step()
        assert conway.is_alive(*centre) is False, f"{maker.__name__}: Conway has no B6"


# -- the edge rules -------------------------------------------------------

def test_the_empty_rule_kills_everything_and_then_stays_empty() -> None:
    """``B/S`` names no count at all: nothing is born and nothing survives."""
    cells = [(1, 1), (2, 2), (5, 5)]
    for world in build(32, 32, LifeRule.parse("B/S")):
        world.load(cells)
        assert world.step() == len(cells)
        assert world.population == 0
        assert world.generation == 1
        assert world.step() == 0
        assert world.population == 0
        assert world.bounds() is None


def test_a_rule_with_no_survival_keeps_only_the_cells_it_births() -> None:
    """``B3/S``: every live cell dies; a dead cell with three neighbours is born."""
    rule = LifeRule.parse("B3/S")
    blinker = [(1, 1), (2, 1), (3, 1)]
    expected = [(2, 0), (2, 2)]
    for world in build(16, 16, rule):
        world.load(blinker)
        assert world.step() == 5, "three deaths and two births"
        assert sorted(world.live_cells()) == expected


def test_a_rule_with_no_birth_never_adds_a_cell() -> None:
    """``B/S012345678``: every live cell survives whatever its count, nothing is born."""
    rule = LifeRule.parse("B/S012345678")
    cells = [(1, 1), (2, 2), (3, 3), (8, 8)]
    for world in build(16, 16, rule):
        world.load(cells)
        for _ in range(4):
            assert world.step() == 0
        assert sorted(world.live_cells()) == cells


def test_a_rule_that_cannot_be_local_is_refused_rather_than_answered() -> None:
    """``B0`` is the one class of rule the local representations must decline."""
    rule = LifeRule.parse("B0/S23")
    for maker in (SparseWorld, TiledWorld):
        with pytest.raises(ValueError, match="not a local rule"):
            maker(16, 16, rule)
    dense = DenseWorld(16, 16, rule)
    dense.set_alive(0, 0)
    assert dense.step() > 0, "the oracle runs it; only the local representations decline"


# -- the compiled plan ----------------------------------------------------

def test_conway_compiles_to_the_expression_it_replaced() -> None:
    """Generality costs the default rule nothing: three word operations.

    The hand-written Conway expression was ``(~p3) & (~p2) & p1 & (alive | p0)``
    — five operations for the count test and two to mix it with the current
    state. The compiled plan for ``B3/S23`` is ``p1 & ~p2`` for survival and
    ``p1 & ~p2 & p0`` for birth: three, sharing the first two.
    """
    assert _SelectionNetwork(CONWAY).operations == 3


def test_a_single_set_never_compiles_to_more_than_sixteen_word_operations() -> None:
    """The network's size is bounded by the shape of the set, not by the count.

    Sixteen is the bound for a *set*, and it is not a guess: all 512 single sets
    were compiled when the network was written and none exceeded it. Re-checking
    them here is cheap and would catch a change that made a plan grow with the
    number of counts it names.

    The bound for a whole rule is larger, and saying so is the point: over all
    262144 ``(birth, survive)`` pairs the worst case is twenty-four,
    ``B13578/S0246``. An earlier revision of this file claimed sixteen for every
    pair, which was never measured and is false.
    """
    worst = 0
    for mask in range(512):
        birth = frozenset(count for count in range(9) if mask >> count & 1)
        single = _SelectionNetwork(LifeRule(birth=birth, survive=frozenset())).operations
        assert single <= 16
        worst = max(worst, single)
    assert worst == 16, 'the per-set bound is reached, so sixteen is tight'
    for rule_text in RULES:
        assert _SelectionNetwork(LifeRule.parse(rule_text)).operations <= 24


def test_the_worst_pair_costs_twenty_four_word_operations() -> None:
    """The measured worst case over every pair, named so it cannot drift.

    This compiles all 262144 pairs. It is the number the docstring of
    ``_SelectionNetwork`` states, and it is the number this case exists to keep
    honest: a claim about the size of a compiled plan is exactly the kind of claim
    that rots when nobody re-runs it.
    """
    worst = 0
    worst_rule = ''
    for birth_mask in range(512):
        birth = frozenset(count for count in range(9) if birth_mask >> count & 1)
        for survive_mask in range(512):
            survive = frozenset(count for count in range(9) if survive_mask >> count & 1)
            rule = LifeRule(birth=birth, survive=survive)
            size = _SelectionNetwork(rule).operations
            if size > worst:
                worst = size
                worst_rule = rule.notation
    assert worst == 24, f'the worst pair is {worst_rule} at {worst} operations'
