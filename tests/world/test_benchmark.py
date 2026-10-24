"""Measurement harness for the representation frontier.

Excluded from the default test run by the ``benchmark`` marker, because it
measures rather than asserts. Run it explicitly:

    uv run pytest -m benchmark -s tests/world/test_benchmark.py

Three candidates, two shapes
----------------------------
The three representations are the ones the module ships: a sparse sorted key
array, a dense boolean grid, and bit-packed 64 x 64 tiles. Dense cannot exist at
the design target of 65536 x 65536 (one byte per cell is 4.29 GB), so it is here
as the correctness oracle and as the flat baseline the other two have to beat.
The pure-Python dictionary implementation is not shipped either; it is measured
because it is the first thing anyone writes, and "it is slower" should be a
number rather than an opinion.

The shape of the population decides which of the two shippable representations
wins, and that is the point of measuring two shapes:

``lattice``
    blocks packed into a contiguous region, so a tile holds many live cells and
    the tiles that exist are the tiles that must be stepped.
``scatter``
    the same still lifes spread far enough apart that every tile holds exactly
    one block, which is the shape where the tiled world pays its nine-neighbour
    expansion for nothing.

Both are still lifes of 2 x 2 blocks, so the population is exactly four times
the block count and does not move during a measurement. The harness asserts
that, so a measurement taken on a drifting population fails instead of being
reported.

The rule frontier
-----------------
`test_measure_the_frontier` prices the representations under Conway. Two more
measurements price the *rule*, because a tiled step now compiles an arbitrary
rule into a selection network instead of running the Conway expression:

``test_measure_the_frontier_under_other_rules``
    the whole step, same ladder, same lifecycle, under rules whose 2 x 2 block
    lattice is still a still life — plus the Conway expression as it was written
    by hand before the rule became general, kept as a measured candidate rather
    than deleted, so the comparison has a visible baseline instead of a memory.
``test_measure_the_cost_of_a_rule``
    the rule application alone, over every rule the viewer offers, on a fixed
    set of count planes. This one can price ``B2/S``, whose population cannot
    hold still for a whole-step measurement, and it separates the part of a step
    that depends on the rule from the geometry that does not.

Authority: docs/model/world/performance.md,
docs/plan/PERFORMANCE_ACCEPTANCE.md §2 and §3.
"""

import math
import time
from collections.abc import Callable, Iterable
from functools import partial

import numpy as np
import pytest

from lifegame.world import DenseWorld, LifeRule, SparseWorld, TiledWorld
from lifegame.world.tiled import _ALL_BITS

pytestmark = pytest.mark.benchmark

WIDTH = HEIGHT = 1024
GENERATIONS = 5
LATTICE_LADDER = (400, 4_000, 40_000, 200_000, 260_000)
SCATTER_LADDER = (400, 4_000, 20_000)
NAIVE_LIMIT = 20_000
BLOCK_SPACING = 4
SCATTER_SPACING = 32

#: The rules the whole-step frontier is measured under. Each one is verified to
#: leave the 2 x 2 block lattice where it is before it is timed, because a
#: drifting population makes the comparison meaningless.
FRONTIER_RULES = ("B3/S23", "B36/S23", "B3/S12345")
#: Every rule the viewer's preset list offers, in its order. Listed here as
#: strings rather than imported: the viewer is JavaScript, and a benchmark that
#: could not run without it would be a benchmark nobody runs.
PRESET_RULES = (
    "B3/S23",
    "B36/S23",
    "B3/S12345",
    "B2/S",
    "B/S012345678",
    "B3678/S34678",
    "B1357/S1357",
    "B3/S012345678",
)
#: Planes of eight words per cell row: the shape one active tile of a step
#: produces, so the rule cost is priced on the arrays a real step hands it.
PLANE_TILES = 256


def blocks_at(
    positions: Iterable[tuple[int, int]],
    width: int,
    height: int,
) -> list[tuple[int, int]]:
    cells: list[tuple[int, int]] = []
    for bx, by in positions:
        if bx + 1 < width and by + 1 < height:
            cells.extend([(bx, by), (bx + 1, by), (bx, by + 1), (bx + 1, by + 1)])
    return cells


def lattice(count: int, width: int, height: int) -> list[tuple[int, int]]:
    """Blocks packed into a contiguous region."""
    blocks = count // 4
    per_row = math.isqrt(blocks) + 1
    positions = (
        ((index % per_row) * BLOCK_SPACING, (index // per_row) * BLOCK_SPACING)
        for index in range(blocks)
    )
    return blocks_at(positions, width, height)


def scatter(count: int, width: int, height: int) -> list[tuple[int, int]]:
    """The same blocks, one per tile, spread across the whole world."""
    blocks = count // 4
    per_row = max(1, width // SCATTER_SPACING)
    positions = (
        ((index % per_row) * SCATTER_SPACING, (index // per_row) * SCATTER_SPACING)
        for index in range(blocks)
    )
    return blocks_at(positions, width, height)


def naive_step(alive: set[tuple[int, int]], width: int, height: int) -> set[tuple[int, int]]:
    """The first implementation anyone writes: count neighbours in a dict."""
    counts: dict[tuple[int, int], int] = {}
    for x, y in alive:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx = x + dx
                ny = y + dy
                if 0 <= nx < width and 0 <= ny < height:
                    counts[(nx, ny)] = counts.get((nx, ny), 0) + 1
    nxt: set[tuple[int, int]] = set()
    for cell, neighbours in counts.items():
        if cell in alive:
            if neighbours in {2, 3}:
                nxt.add(cell)
        elif neighbours == 3:
            nxt.add(cell)
    return nxt


def timed(step: Callable[[], object], generations: int = GENERATIONS) -> float:
    """Seconds per step: one warm-up step, then a timed run of ``generations``."""
    step()
    started = time.perf_counter()
    for _ in range(generations):
        step()
    return (time.perf_counter() - started) / generations


def timed_naive(cells: Iterable[tuple[int, int]], generations: int = GENERATIONS) -> float:
    alive = set(cells)
    naive_step(alive, WIDTH, HEIGHT)
    started = time.perf_counter()
    for _ in range(generations):
        alive = naive_step(alive, WIDTH, HEIGHT)
    return (time.perf_counter() - started) / generations


def report(name: str, live: int, tiles: str, seconds: float) -> None:
    print(
        f"{name:<16}{live:>12,}{tiles:>10}{seconds * 1e3:>14.3f}"
        f"{live / (seconds * 1e3):>12.1f}"
    )


def measure_shape(
    name: str,
    make_cells: Callable[[int], list[tuple[int, int]]],
    ladder: Iterable[int],
) -> None:
    print(f"\n--- {name} ---")
    print(
        f"{'representation':<16}{'live cells':>12}{'tiles':>10}"
        f"{'ms per step':>14}{'cells/ms':>12}"
    )
    print("-" * 64)

    for target in ladder:
        cells = make_cells(target)
        live = len(cells)

        sparse = SparseWorld(WIDTH, HEIGHT)
        sparse.load(cells)
        report("sparse", live, "-", timed(sparse.step))
        assert sparse.population == live, "the pattern is not stable; the measurement is void"

        dense = DenseWorld(WIDTH, HEIGHT)
        dense.load(cells)
        report("dense", live, "-", timed(dense.step))
        assert dense.population == live, "the pattern is not stable; the measurement is void"

        tiled = TiledWorld(WIDTH, HEIGHT)
        tiled.load(cells)
        report("tiled", live, f"{tiled.tile_count:,}", timed(tiled.step))
        assert tiled.population == live, "the pattern is not stable; the measurement is void"

        if live <= NAIVE_LIMIT:
            report("naive-python", live, "-", timed_naive(cells))


def test_measure_the_frontier() -> None:
    print(
        f"\nworld {WIDTH} x {HEIGHT} = {WIDTH * HEIGHT:,} cells; still lifes of 2 x 2 blocks; "
        f"one warm-up step then {GENERATIONS} timed steps; profile M1"
    )
    measure_shape(
        "lattice: blocks packed together",
        lambda n: lattice(n, WIDTH, HEIGHT),
        LATTICE_LADDER,
    )
    measure_shape(
        "scatter: one block per tile",
        lambda n: scatter(n, WIDTH, HEIGHT),
        SCATTER_LADDER,
    )


class _ConwaySpecialized(TiledWorld):
    """The rule application as it was written before rules were general.

    ``(~p3) & (~p2) & p1 & (alive | p0)``: the Conway expression inlined into the
    step. It is kept here as a *measured candidate* rather than deleted, because
    a comparison against a number remembered from a document is not a
    comparison: the generic path and this one run in the same process, on the
    same arrays, in the same run. Everything except the rule application is
    inherited, so the difference between the two rows is the rule and nothing
    else.
    """

    __slots__ = ()

    def _apply_rule(self, alive: np.ndarray, planes: list[np.ndarray]) -> np.ndarray:
        count_two_or_three = (~planes[3]) & (~planes[2]) & planes[1] & _ALL_BITS
        return count_two_or_three & (alive | planes[0])


def timed_interleaved(
    candidates: dict[str, Callable[[], object]],
    rounds: int = 3,
) -> dict[str, float]:
    """Seconds per call for each candidate, measured in alternating order.

    The noise policy in docs/model/world/performance.md records why: on a shared
    machine a candidate measured on its own read several times its cost, and the
    fix is that "candidates for the same claim must be interleaved so that load
    hits them alike". It is not a theoretical concern here — measured in
    sequence, the *first* candidate of each claim read fastest in this run, by
    more than the whole difference between the two rule paths.

    Each round is one warm-up call and then `GENERATIONS` timed calls, exactly
    the lifecycle the rest of this file uses; the reported figure is the mean of
    the rounds.
    """
    totals = dict.fromkeys(candidates, 0.0)
    for _ in range(rounds):
        for name, call in candidates.items():
            totals[name] += timed(call)
    return {name: total / rounds for name, total in totals.items()}


def test_measure_the_frontier_under_other_rules() -> None:
    """The whole step under several rules, against the hand-written Conway one.

    Same world, same ladder, same lifecycle as `test_measure_the_frontier` — one
    warm-up call and five timed calls — but the candidates are interleaved and
    each figure is the mean of three rounds, because the claim is a comparison
    *between* candidates and the noise policy says a comparison must not be a
    sequence. Every rule here leaves the 2 x 2 block lattice unchanged, which the
    harness asserts after the timed run, so the rows are comparable with each
    other and with the Conway table in docs/model/world/performance.md.
    """
    print(
        f"\nworld {WIDTH} x {HEIGHT}; lattice of 2 x 2 blocks; one warm-up then "
        f"{GENERATIONS} timed steps, three interleaved rounds, mean of the rounds; "
        "tiled representation; profile M1"
    )
    print("\n--- whole step, by rule ---")
    print(
        f"{'rule':<18}{'live cells':>12}{'tiles':>8}{'ops':>5}"
        f"{'ms per step':>14}{'vs Conway':>12}"
    )
    print("-" * 69)

    for target in (40_000, 200_000):
        cells = lattice(target, WIDTH, HEIGHT)
        live = len(cells)
        worlds: dict[str, TiledWorld] = {
            "conway (generic)": TiledWorld(WIDTH, HEIGHT, LifeRule.parse("B3/S23")),
            "conway (inlined)": _ConwaySpecialized(WIDTH, HEIGHT, LifeRule.parse("B3/S23")),
        }
        for text in FRONTIER_RULES[1:]:
            worlds[text] = TiledWorld(WIDTH, HEIGHT, LifeRule.parse(text))
        for world in worlds.values():
            world.load(cells)

        seconds = timed_interleaved({name: world.step for name, world in worlds.items()})

        baseline = seconds["conway (generic)"]
        for name, world in worlds.items():
            assert world.population == live, "the pattern is not stable; the measurement is void"
            operations = (
                7 if name == "conway (inlined)" else world._network.operations
            )
            print(
                f"{name:<18}{live:>12,}{world.tile_count:>8,}{operations:>5}"
                f"{seconds[name] * 1e3:>14.3f}{seconds[name] / baseline:>11.2f}x"
            )


def test_measure_the_cost_of_a_rule() -> None:
    """The rule application alone, over every rule the viewer offers.

    A step is geometry plus rule: the halo, eight gathers and the adder chain
    cost the same whatever the rule says, and the selection network's size
    depends on the shape of the rule's two sets. This measurement holds the
    geometry — and therefore the count planes — fixed and prices only the rule,
    which is also the only way to price ``B2/S``: its block lattice collapses in
    one generation, so it can never satisfy a whole-step stability check.
    """
    words = PLANE_TILES
    generator = np.random.default_rng(20261016)
    planes = [
        np.frombuffer(generator.bytes(words * 64 * 8), dtype=np.uint64).reshape(words, 64).copy()
        for _ in range(4)
    ]
    alive = (
        np.frombuffer(generator.bytes(words * 64 * 8), dtype=np.uint64).reshape(words, 64).copy()
    )

    candidates: dict[str, Callable[[], object]] = {}
    specialized = _ConwaySpecialized(WIDTH, HEIGHT, LifeRule.parse("B3/S23"))
    candidates["conway (inlined)"] = partial(specialized._apply_rule, alive, planes)
    words_per_rule: dict[str, int] = {"conway (inlined)": 7}
    for text in PRESET_RULES:
        world = TiledWorld(WIDTH, HEIGHT, LifeRule.parse(text))
        candidates[text] = partial(world._apply_rule, alive, planes)
        words_per_rule[text] = world._network.operations

    seconds = timed_interleaved(candidates)
    baseline = seconds["conway (inlined)"]

    print(
        f"\n--- rule application alone: {words} tiles ({words * 64:,} cells per plane), "
        f"one warm-up then {GENERATIONS} timed calls, three interleaved rounds ---"
    )
    print(f"{'rule':<18}{'ops':>5}{'us per call':>14}{'ns per cell':>14}{'vs inlined':>12}")
    print("-" * 63)
    for name, value in seconds.items():
        print(
            f"{name:<18}{words_per_rule[name]:>5}{value * 1e6:>14.3f}"
            f"{value * 1e9 / (words * 64):>14.2f}{value / baseline:>11.2f}x"
        )
