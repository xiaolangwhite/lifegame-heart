"""Recording, keyframe policy, rollback and the validation that guards it.

The load-bearing test here is the rollback equivalence: a world restored to
generation *g* must equal a world that was stepped to *g* independently. Nothing
weaker checks the chain, because a chain that stores the wrong deltas still
produces *a* world.
"""

import random
import sqlite3
from pathlib import Path

import numpy as np
import pytest

from lifegame.store import (
    CURRENT_SCHEMA_VERSION,
    KEYFRAME_INTERVAL,
    SessionNotFound,
    Store,
    StoreError,
    salvage,
)
from lifegame.store.delta import encode_cells
from lifegame.world import Change, DenseWorld, SparseWorld, TiledWorld
from lifegame.world.rules import LifeRule

GLIDER = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)]
BLOCK = [(0, 0), (1, 0), (0, 1), (1, 1)]
HIGHLIFE = "B36/S23"


def seed_world(world: SparseWorld | TiledWorld, cells: list[tuple[int, int]]) -> None:
    world.load(cells)


def record_generations(
    store: Store,
    world: SparseWorld | TiledWorld,
    steps: int,
    **kwargs: object,
) -> object:
    """Record generation 0 and then one delta per step."""
    session = store.create_session(world, **kwargs)  # type: ignore[arg-type]
    session.record(world, Change(changed=0, generation=0))
    for _ in range(steps):
        change = world.advance()
        session.record(world, change)
    return session


@pytest.fixture()
def store(tmp_path: Path) -> Store:
    with Store.open(tmp_path / "history.db") as opened:
        yield opened


def test_a_store_creates_its_schema_on_first_open(tmp_path: Path) -> None:
    path = tmp_path / "fresh.db"
    assert not path.exists()
    with Store.open(path) as store:
        assert store.dialect == "sqlite"
        assert store.sessions() == []
    assert path.exists(), "the store must have written its file"


def test_reopening_a_store_keeps_its_sessions(tmp_path: Path) -> None:
    path = tmp_path / "kept.db"
    with Store.open(path) as store:
        world = SparseWorld(32, 32)
        seed_world(world, GLIDER)
        session = record_generations(store, world, 3, label="glider")
        identifier = session.id
    with Store.open(path) as reopened:
        sessions = reopened.sessions()
        assert [info.id for info in sessions] == [identifier]
        assert sessions[0].label == "glider"
        assert len(reopened.session(identifier).generations()) == 4


def test_a_rollback_equals_a_world_stepped_independently(store: Store) -> None:
    """The whole point of the layer: any recorded generation can be restored.

    The walk is descending because a rollback **moves the session's head** onto
    the node it loads. That is deliberate — the head is what the next record
    appends to, so moving it is what makes an edit after a look at history a new
    branch instead of an append to the old one. A consequence is that a rollback
    can only reach a node on the path from the root to the current head, which is
    why asking for generation 1 after generation 0 is refused rather than
    answered.
    """
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 12)

    for generation in range(12, -1, -1):
        reference = SparseWorld(64, 64)
        seed_world(reference, GLIDER)
        reference.step(generation)

        restored = SparseWorld(64, 64)
        assert session.rollback(restored, generation) == generation
        assert restored.generation == generation
        assert sorted(restored.live_cells()) == sorted(reference.live_cells()), (
            f"generation {generation} did not round trip"
        )
        assert restored.population == reference.population


def test_reading_a_generation_does_not_move_the_working_point(store: Store) -> None:
    """Reading and working on a generation are two operations, and this is why.

    A rollback that also moved the head would make looking at history
    destructive: the next step would branch from the state that was merely being
    inspected. Only a select moves the working point, and only a select makes the
    next record a sibling.
    """
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 4)

    assert session.rollback(world, 0) == 0
    assert world.generation == 0
    head = session.head()
    assert head is not None and head.generation == 4, "reading must not move the head"

    # A select does move it, and then a sibling's generation is unreachable.
    assert session.checkout(world, session.node_at_generation(2).id) == 2
    assert session.head().generation == 2
    with pytest.raises(SessionNotFound, match="current branch"):
        session.rollback(world, 4), "generation 4 is not on the path to generation 2"


def test_a_rollback_works_across_a_keyframe_boundary(store: Store) -> None:
    world = SparseWorld(96, 96)
    seed_world(world, BLOCK)
    world.set_alive(50, 50)
    session = record_generations(store, world, KEYFRAME_INTERVAL + 5)

    kinds = [info.kind for info in session.generations()]
    assert kinds.count("keyframe") >= 2, "the interval must have produced a second keyframe"

    # Descending, because each rollback moves the head onto the node it loads.
    for generation in (
        KEYFRAME_INTERVAL + 4,
        KEYFRAME_INTERVAL,
        KEYFRAME_INTERVAL - 1,
        1,
        0,
    ):
        reference = SparseWorld(96, 96)
        seed_world(reference, BLOCK)
        reference.set_alive(50, 50)
        reference.step(generation)
        restored = SparseWorld(96, 96)
        session.rollback(restored, generation)
        assert sorted(restored.live_cells()) == sorted(reference.live_cells()), generation


def test_a_rollback_can_cross_representations(store: Store) -> None:
    """The chain stores coordinates, so a sparse history restores into a tiled world."""
    sparse = SparseWorld(64, 64)
    seed_world(sparse, GLIDER)
    session = record_generations(store, sparse, 6, representation="sparse")

    tiled = TiledWorld(64, 64)
    session.rollback(tiled, 6)
    reference = SparseWorld(64, 64)
    seed_world(reference, GLIDER)
    reference.step(6)
    assert sorted(tiled.live_cells()) == sorted(reference.live_cells())
    assert tiled.generation == 6


def test_the_first_generation_is_a_keyframe_and_the_next_are_deltas(store: Store) -> None:
    world = SparseWorld(32, 32)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 3)
    kinds = [info.kind for info in session.generations()]
    assert kinds == ["keyframe", "delta", "delta", "delta"]


def test_a_recording_after_a_gap_is_a_keyframe_not_a_dishonest_delta(store: Store) -> None:
    """Ten steps then one record: a delta would claim a parent it never saw."""
    world = SparseWorld(32, 32)
    seed_world(world, GLIDER)
    session = store.create_session(world)
    session.record(world, Change(changed=0, generation=0))
    world.step(10)
    recorded = session.record(world, Change(changed=4, generation=10))
    assert recorded.kind == "keyframe"
    assert session.state_at(10) == sorted(world.live_cells(), key=lambda cell: (cell[1], cell[0]))


def test_a_keyframe_can_be_forced(store: Store) -> None:
    world = SparseWorld(32, 32)
    seed_world(world, GLIDER)
    session = store.create_session(world)
    session.record(world, Change(changed=0, generation=0))
    change = world.advance()
    recorded = session.record(world, change, force_keyframe=True)
    assert recorded.kind == "keyframe"


def test_recording_after_a_checkout_forks_instead_of_discarding(store: Store) -> None:
    """The request that shaped this version, as a test.

    Looking at an older state and then editing must keep the newer work and show
    the result as a second branch. The old model deleted everything after the
    generation it re-recorded, which made that impossible; the tree keeps it, and
    the fork is visible as two children of one node.
    """
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 4)
    nodes = session.nodes()
    assert [node.generation for node in nodes] == [0, 1, 2, 3, 4]

    # Look at generation 2 and change the world there.
    assert session.checkout(world, nodes[2].id) == 2
    world.set_alive(50, 50)
    forked = session.record(
        world, Change(changed=1, generation=2), force_keyframe=True
    )
    assert forked.parent_id == nodes[2].id
    assert forked.generation == 2, "an edit does not advance the generation"

    branches = session.children(nodes[2].id)
    assert len(branches) == 2, "the fork is two children of one node"
    # Nothing was discarded: the old branch still holds its own generations.
    assert sorted(node.generation for node in session.nodes()) == [0, 1, 2, 2, 3, 4]
    populations = {node.id: len(session.state_at_node(node.id)) for node in branches}
    assert len(set(populations.values())) == 2, "the branches hold different worlds"


def test_a_delta_larger_than_the_snapshot_is_stored_as_a_keyframe(store: Store) -> None:
    """A dense chaotic generation changes nearly everything.

    A delta is only an optimisation while it is smaller than the snapshot it
    replaces; past that it costs more to store *and* makes every later rollback
    walk further. The store decides from the evidence rather than assuming the
    population is sparse.
    """
    world = SparseWorld(40, 40)
    rng = random.Random(7)
    for _ in range(400):
        world.set_alive(rng.randrange(40), rng.randrange(40))
    session = store.create_session(world)
    session.record(world, Change(changed=0, generation=0))

    kinds = []
    for _ in range(6):
        kinds.append(session.record(world, world.advance()).kind)
    assert "keyframe" in kinds, (
        "a chaotic cloud must eventually store a snapshot instead of a larger delta"
    )


# -- which rule ran -----------------------------------------------------------------


def bitmap(cells: list[tuple[int, int]], size: int) -> np.ndarray:
    """The whole area as a bitmap, so two states can be compared bit for bit."""
    world = DenseWorld(size, size)
    world.load(cells)
    return world.viewport(0, 0, size, size)


def test_every_generation_records_the_rule_that_was_in_force(store: Store) -> None:
    """Each node answers "what ran here", and the session answers "what runs now"."""
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 3)
    assert session.info.rule == "B3/S23"
    assert [node.rule for node in session.nodes()] == ["B3/S23"] * 4

    world.set_rule(LifeRule.parse(HIGHLIFE))
    session.set_rule(world.rule)
    for _ in range(2):
        session.record(world, world.advance())

    assert session.info.rule == HIGHLIFE, "the session is running the new rule"
    assert [node.rule for node in session.nodes()] == ["B3/S23"] * 4 + [HIGHLIFE] * 2
    assert [info.rule for info in session.generations()] == ["B3/S23"] * 4 + [HIGHLIFE] * 2


def test_a_rule_change_is_reported_as_the_generation_it_started_at(store: Store) -> None:
    """The timeline has to point at the change, not merely contain both rules."""
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 3)
    world.set_rule(LifeRule.parse(HIGHLIFE))
    session.set_rule(world.rule)
    session.record(world, world.advance())
    world.set_rule(LifeRule.parse("B3/S23"))
    session.set_rule(world.rule)
    session.record(world, world.advance())

    # The first entry is where the timeline's rule started, not a change.
    assert session.rule_changes() == [(0, "B3/S23"), (4, HIGHLIFE), (5, "B3/S23")]


def test_set_rule_moves_the_session_rule_and_a_reopen_agrees(tmp_path: Path) -> None:
    """A rule the core adopts but has not stepped under is still the session's rule."""
    path = tmp_path / "moved.db"
    with Store.open(path) as store:
        world = SparseWorld(32, 32)
        session = record_generations(store, world, 1)
        assert session.set_rule(HIGHLIFE) == HIGHLIFE, "the notation is normalised"
        assert session.info.rule == HIGHLIFE
        assert session.info.rule_known is True
        assert [node.rule for node in session.nodes()] == ["B3/S23", "B3/S23"], (
            "changing the rule writes no generation and rewrites none"
        )
        assert session.rule_changes() == [(0, "B3/S23")]
        identifier = session.id
    with Store.open(path) as reopened:
        counted = reopened.session(identifier)
        assert counted.info.rule == HIGHLIFE
        assert counted.info.rule_known is True
        assert counted.rule_changes() == [(0, "B3/S23")]


def test_set_rule_refuses_text_that_is_not_a_rule(store: Store) -> None:
    world = SparseWorld(32, 32)
    session = record_generations(store, world, 1)
    with pytest.raises(ValueError, match="birth section"):
        session.set_rule("X3/S23")
    assert session.info.rule == "B3/S23", "a refusal changes nothing"


def test_a_history_recorded_across_a_rule_change_replays_bit_for_bit(store: Store) -> None:
    """The rule changed mid-session, and every generation still restores exactly.

    A rollback replays born and died and never re-runs the rule, so the rule
    change cannot affect it — which is precisely why this is asserted instead of
    assumed: the claim is that a session that switched rules is still replayable
    to the bit, and a mis-stored delta is exactly what would look plausible while
    being wrong.
    """
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 4)
    world.set_rule(LifeRule.parse(HIGHLIFE))
    session.set_rule(world.rule)
    for _ in range(4):
        session.record(world, world.advance())

    expected: dict[int, list[tuple[int, int]]] = {}
    reference = SparseWorld(64, 64)
    seed_world(reference, GLIDER)
    expected[0] = sorted(reference.live_cells())
    for step in range(1, 9):
        if step == 5:
            reference.set_rule(LifeRule.parse(HIGHLIFE))
        reference.advance()
        expected[step] = sorted(reference.live_cells())

    for generation in range(8, -1, -1):
        restored = SparseWorld(64, 64)
        assert session.rollback(restored, generation) == generation
        cells = sorted(restored.live_cells())
        assert cells == expected[generation], f"generation {generation} moved"
        assert restored.population == len(expected[generation])
        assert np.array_equal(bitmap(cells, 64), bitmap(expected[generation], 64)), (
            f"generation {generation} is not bit-identical to the world that was recorded"
        )


def test_rewind_counts_backwards_from_the_world(store: Store) -> None:
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 8)
    assert world.generation == 8
    assert session.rewind(world, 3) == 5
    assert world.generation == 5
    reference = SparseWorld(64, 64)
    seed_world(reference, GLIDER)
    reference.step(5)
    assert sorted(world.live_cells()) == sorted(reference.live_cells())


def test_rewinding_past_the_beginning_is_refused(store: Store) -> None:
    world = SparseWorld(32, 32)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 2)
    with pytest.raises(SessionNotFound, match="cannot rewind"):
        session.rewind(world, 99)


def test_truncating_forgets_the_future_and_keeps_the_past(store: Store) -> None:
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 6)
    removed = session.truncate_after(3)
    assert removed == 3
    assert [info.generation for info in session.generations()] == [0, 1, 2, 3]
    assert session.state_at(3)
    with pytest.raises(SessionNotFound):
        session.state_at(4)


def test_truncating_a_branch_keeps_a_sibling_it_never_named(store: Store) -> None:
    """The measured STO-17 shape: work off the head's path survives the cut.

    The sibling's ancestry is exactly what truncation removes, so the surviving
    node cannot stay a delta — it is rewritten as a keyframe of its own state and
    loses its parent link. That is what makes "kept" mean replayable rather than
    merely still present in the table, and the sibling's own child stays a delta
    on top of it.
    """
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    session = record_generations(store, world, 3)
    nodes = session.nodes()
    assert [node.generation for node in nodes] == [0, 1, 2, 3]

    # A second line of work from generation 1, with one step of its own.
    assert session.checkout(world, nodes[1].id) == 1
    sibling_state = sorted(world.live_cells(), key=lambda cell: (cell[1], cell[0]))
    sibling = session.record(world, Change(changed=0, generation=1), force_keyframe=True)
    change = world.advance()
    sibling_child = session.record(world, change)
    child_state = sorted(world.live_cells(), key=lambda cell: (cell[1], cell[0]))
    assert sibling.parent_id == nodes[1].id
    assert sibling_child.parent_id == sibling.id

    # Back to the original branch, then discard everything after its root.
    assert session.checkout(world, nodes[3].id) == 3
    removed = session.truncate_after(0)

    assert removed == 3, "only the three nodes on the head's path were removed"
    assert sorted(node.generation for node in session.nodes()) == [0, 1, 2]
    kept = session.node(sibling.id)
    assert kept.parent_id is None, "the discarded ancestry is no longer claimed"
    assert kept.is_keyframe, "a kept branch must be replayable on its own"
    assert session.state_at_node(sibling.id) == sibling_state
    kept_child = session.node(sibling_child.id)
    assert kept_child.parent_id == sibling.id, "the survivor keeps its own descendants"
    assert not kept_child.is_keyframe, "a delta on top of the survivor stays a delta"
    assert session.state_at_node(sibling_child.id) == child_state

    # The kept branch still accepts work, and a record on it stays a child.
    assert session.checkout(world, sibling_child.id) == 2
    appended = session.record(world, world.advance())
    assert appended.parent_id == sibling_child.id
    assert appended.generation == 3


def test_a_corrupted_chain_is_reported_rather_than_applied(store: Store) -> None:
    """A delta that bears a living cell is not a life history.

    A still life is used so the forged cell is genuinely already alive at the
    generation the forged delta applies to; with a glider the cell would have
    moved on and the forgery would be indistinguishable from a real birth.
    """
    world = SparseWorld(32, 32)
    seed_world(world, BLOCK)
    session = record_generations(store, world, 3)
    alive = session.state_at(1)
    assert sorted(alive) == sorted(BLOCK)
    cell = alive[0]
    payload = b"".join(
        int(value).to_bytes(4, "little", signed=True) for value in (cell[0], cell[1])
    )
    store.backend.begin()
    store.backend.execute(
        "UPDATE lifegame_generation SET born = ? WHERE session_id = ? AND generation = ?",
        (payload, session.id, 2),
    )
    store.backend.commit()
    with pytest.raises(StoreError, match="already alive"):
        session.state_at(2)


def test_asking_for_an_unknown_session_or_generation_names_what_is_missing(store: Store) -> None:
    with pytest.raises(SessionNotFound, match="no session with id 99"):
        store.session(99)
    world = SparseWorld(32, 32)
    session = record_generations(store, world, 1)
    with pytest.raises(SessionNotFound, match="no generation 9"):
        session.payload(9)


def test_marking_a_session_archived_survives_a_reopen(tmp_path: Path) -> None:
    path = tmp_path / "archived.db"
    with Store.open(path) as store:
        world = SparseWorld(32, 32)
        session = record_generations(store, world, 1)
        session.mark_archived()
    with Store.open(path) as reopened:
        assert reopened.sessions()[0].archived is True
        assert reopened.sessions(include_archived=False) == []


def test_a_newer_schema_is_refused_rather_than_misread(tmp_path: Path) -> None:
    path = tmp_path / "future.db"
    with Store.open(path) as store:
        store.backend.begin()
        store.backend.execute("DELETE FROM lifegame_schema")
        store.backend.execute(
            "INSERT INTO lifegame_schema (version, applied_at) VALUES (?, ?)",
            (999, "2026-10-10T00:00:00+00:00"),
        )
        store.backend.commit()
    with pytest.raises(StoreError, match="newer build wrote it"):
        Store.open(path)


def test_a_version_one_store_is_migrated_with_its_history_intact(tmp_path: Path) -> None:
    """The schema changed from a chain to a tree; an old store must survive it.

    Schema 1 identified a generation by its `(session, generation)` pair, which
    cannot express a branch. The migration rebuilds the tables and reconstructs
    the parent links from the generation order, so an existing linear history
    becomes a chain in the new model rather than being refused.
    """
    path = tmp_path / "old.db"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE lifegame_schema (version INTEGER NOT NULL, applied_at TEXT NOT NULL);
        CREATE TABLE lifegame_session (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
            world_width INTEGER NOT NULL, world_height INTEGER NOT NULL, rule TEXT NOT NULL,
            representation TEXT NOT NULL, created_at TEXT NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE lifegame_generation (
            session_id INTEGER NOT NULL, generation INTEGER NOT NULL, kind TEXT NOT NULL,
            born BLOB, died BLOB, population INTEGER NOT NULL, changed INTEGER NOT NULL,
            created_at TEXT NOT NULL, PRIMARY KEY (session_id, generation));
        INSERT INTO lifegame_schema (version, applied_at) VALUES (1, '2026-10-10T00:00:00+00:00');
        INSERT INTO lifegame_session
            (label, world_width, world_height, rule, representation, created_at, archived)
            VALUES ('old', 64, 64, 'B3/S23', 'sparse', '2026-10-10T00:00:00+00:00', 0);
        """
    )
    payload = b"".join(int(v).to_bytes(4, "little", signed=True) for v in (3, 4))
    # A valid little history: a keyframe that holds the cell, a delta that kills
    # it, and a delta that bears it again.
    script = (
        ("keyframe", payload, b"", 1),
        ("delta", b"", payload, 0),
        ("delta", payload, b"", 1),
    )
    for generation, (kind, born, died, population) in enumerate(script):
        connection.execute(
            "INSERT INTO lifegame_generation "
            "(session_id, generation, kind, born, died, population, changed, created_at) "
            "VALUES (1, ?, ?, ?, ?, ?, ?, '2026-10-10T00:00:00+00:00')",
            (generation, kind, born, died, population, 0),
        )
    connection.commit()
    connection.close()

    with Store.open(path) as migrated:
        assert migrated.sessions()[0].label == "old"
        session = migrated.session(1)
        rows = migrated.backend.query(
            "SELECT id, generation, parent_id FROM lifegame_generation "
            "WHERE session_id = 1 ORDER BY generation"
        )
        assert [int(row[0]) for row in rows] == [1, 2, 3]
        assert [row[2] for row in rows] == [None, 1, 2], "the chain must be reconstructed"
        head = migrated.backend.query_one("SELECT head_id FROM lifegame_session WHERE id = 1")
        assert head is not None and int(head[0]) == 3, "the head is the last generation"
        # And the migrated store still answers the questions it answered before.
        assert session.state_at(2) == [(3, 4)]
        # A schema-1 store had one rule per session and nothing per generation;
        # the migration attributes the session's rule to every generation, which
        # for a session that never changed its rule is exact.
        assert [node.rule for node in session.nodes()] == ["B3/S23"] * 3
        assert session.rule_changes() == [(0, "B3/S23")]


#: A schema-2 store's tables, as the build that wrote schema 2 spelled them,
#: foreign keys included. Those foreign keys are load-bearing in this file: an
#: earlier fixture left them out, so no test ever dropped a `lifegame_generation`
#: that referenced itself, and a schema-2 store whose parent chain is deeper than
#: SQLite's trigger limit could pass the whole suite and still fail to migrate on
#: a real one.
_SCHEMA_TWO_DDL = """
CREATE TABLE lifegame_schema (version INTEGER NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE lifegame_session (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
    world_width INTEGER NOT NULL, world_height INTEGER NOT NULL, rule TEXT NOT NULL,
    representation TEXT NOT NULL, created_at TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0, head_id INTEGER);
CREATE TABLE lifegame_generation (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
    generation INTEGER NOT NULL, parent_id INTEGER, kind TEXT NOT NULL,
    born BLOB, died BLOB, population INTEGER NOT NULL, changed INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES lifegame_session (id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES lifegame_generation (id) ON DELETE CASCADE);
CREATE INDEX lifegame_generation_session_id_generation
    ON lifegame_generation (session_id, generation);
CREATE INDEX lifegame_generation_parent_id ON lifegame_generation (parent_id);
INSERT INTO lifegame_schema (version, applied_at) VALUES (2, '2026-10-10T00:00:00+00:00');
"""

_OLD_TIMESTAMP = "2026-10-10T00:00:00+00:00"

#: Every column a schema-2 store and a schema-3 store both have, so the same two
#: statements read either one and the rows compare element by element.
_SESSION_ROWS_SQL = (
    "SELECT id, label, world_width, world_height, rule, representation, created_at, "
    "archived, head_id FROM lifegame_session ORDER BY id"
)
_GENERATION_ROWS_SQL = (
    "SELECT id, session_id, generation, parent_id, kind, born, died, population, "
    "changed, created_at FROM lifegame_generation ORDER BY id"
)


def _open_schema_two_store(path: Path) -> sqlite3.Connection:
    """Create schema 2's tables on a raw connection and hand it back to be filled."""
    connection = sqlite3.connect(path)
    connection.executescript(_SCHEMA_TWO_DDL)
    return connection


def _rows(path: Path, sql: str) -> list[tuple[object, ...]]:
    """Read rows from a store file over a second, read-only connection."""
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        return [tuple(row) for row in connection.execute(sql)]
    finally:
        connection.close()


def _write_version_two_store(path: Path, *, rule: str | None, head: int | None) -> None:
    """A schema-2 store with one still-life session: the shape the migration reads.

    Schema 2 is the tree that schema 3 was added to: row identity, parent links
    and a head are already there, and the only thing missing is the rule a
    generation ran. The history is a block that survives four generations, so the
    migrated session can be replayed and stepped without inventing cells.
    """
    connection = _open_schema_two_store(path)
    connection.execute(
        "INSERT INTO lifegame_session "
        "(label, world_width, world_height, rule, representation, created_at, archived, head_id) "
        "VALUES ('old', 64, 64, ?, 'sparse', ?, 0, ?)",
        ("B3/S23" if rule is None else rule, _OLD_TIMESTAMP, head),
    )
    block = b"".join(
        int(value).to_bytes(4, "little", signed=True)
        for cell in ((10, 10), (11, 10), (10, 11), (11, 11))
        for value in cell
    )
    for generation in range(4):
        connection.execute(
            "INSERT INTO lifegame_generation "
            "(id, session_id, generation, parent_id, kind, born, died, population, "
            "changed, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, 4, 0, ?)",
            (
                generation + 1,
                generation,
                None if generation == 0 else generation,
                "keyframe" if generation == 0 else "delta",
                block if generation == 0 else b"",
                b"",
                _OLD_TIMESTAMP,
            ),
        )
    connection.commit()
    connection.close()


def _write_deep_version_two_store(path: Path, *, generations: int) -> None:
    """A schema-2 store holding a real glider history ``generations`` nodes deep.

    The depth is the point, not the payload. SQLite implements `ON DELETE
    CASCADE` as an internal trigger, and `DROP TABLE` with foreign keys enforced
    performs an implicit `DELETE FROM` first, so a table that references itself
    cascades one level per row and a chain past `SQLITE_MAX_TRIGGER_DEPTH` (1000
    on a default build; measured here as 1000 migrating and 1001 failing) cannot
    be dropped. No four-node fixture reaches that, which is how schema 2 -> 3
    shipped with the defect and a 1300-node real store could not be opened.

    The rows are the shape the recording path writes for that history: one node
    per generation, a keyframe every `KEYFRAME_INTERVAL` generations and a delta
    between them, so the migrated store can be replayed and stepped rather than
    merely opened.
    """
    connection = _open_schema_two_store(path)
    connection.execute(
        "INSERT INTO lifegame_session "
        "(label, world_width, world_height, rule, representation, created_at, archived, head_id) "
        "VALUES ('deep', 64, 64, 'B3/S23', 'sparse', ?, 0, ?)",
        (_OLD_TIMESTAMP, generations),
    )
    world = SparseWorld(64, 64)
    seed_world(world, GLIDER)
    rows = []
    for generation in range(generations):
        change = Change(changed=0, generation=0) if generation == 0 else world.advance()
        if generation % KEYFRAME_INTERVAL == 0:
            cells = world.live_cells_in(0, 0, world.width, world.height)
            kind, born, died, changed = "keyframe", encode_cells(cells), b"", int(cells.shape[0])
        else:
            kind = "delta"
            born = encode_cells(np.asarray(change.born, dtype=np.int32).reshape(-1, 2))
            died = encode_cells(np.asarray(change.died, dtype=np.int32).reshape(-1, 2))
            changed = int(change.changed)
        rows.append(
            (
                generation + 1,
                1,
                generation,
                None if generation == 0 else generation,
                kind,
                born,
                died,
                int(world.population),
                changed,
                _OLD_TIMESTAMP,
            )
        )
    connection.executemany(
        "INSERT INTO lifegame_generation "
        "(id, session_id, generation, parent_id, kind, born, died, population, "
        "changed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    connection.commit()
    connection.close()



def test_a_version_two_store_is_migrated_with_the_session_rule_on_every_generation(
    tmp_path: Path,
) -> None:
    """Schema 3 adds rule provenance; a schema-2 store must survive it.

    Schema 2 recorded one rule per session — the rule the world had when the
    session was created — and nothing per generation. The migration therefore
    attributes that rule to every generation, which is this change's stated
    choice; a session that changed its rule under schema 2 cannot be
    reconstructed, and this asserts the value the choice produces rather than
    leaving it to a column default.
    """
    path = tmp_path / "two.db"
    _write_version_two_store(path, rule="B3/S23", head=4)

    with Store.open(path) as migrated:
        session = migrated.session(1)
        assert session.info.rule == "B3/S23"
        assert session.info.rule_known is True, "the session's rule was stated"
        assert [node.rule for node in session.nodes()] == ["B3/S23"] * 4
        assert session.rule_changes() == [(0, "B3/S23")]
        assert session.head() is not None and session.head().id == 4, (
            "the schema-2 head is still the working point"
        )
        assert session.state_at(3) == [(10, 10), (11, 10), (10, 11), (11, 11)]
        assert migrated.backend.query_one("SELECT version FROM lifegame_schema") == (
            CURRENT_SCHEMA_VERSION,
        )


def test_a_migrated_store_still_records_and_replays_across_a_rule_change(tmp_path: Path) -> None:
    path = tmp_path / "still-two.db"
    _write_version_two_store(path, rule="B3/S23", head=4)

    with Store.open(path) as migrated:
        session = migrated.session(1)
        world = SparseWorld(64, 64)
        assert session.rollback(world, 3) == 3
        assert sorted(world.live_cells()) == [(10, 10), (10, 11), (11, 10), (11, 11)]
        assert world.rule.notation == "B3/S23", (
            "a rollback restores cells; the rule is the world's own"
        )

        world.set_rule(LifeRule.parse(HIGHLIFE))
        session.set_rule(world.rule)
        session.record(world, world.advance())
        # A 2x2 block has three neighbours per live cell, so it is a still life
        # under HighLife too; what matters here is that the generation recorded
        # after the migration replays to the state the world was in.
        assert session.state_at(4) == [(10, 10), (11, 10), (10, 11), (11, 11)]
        assert session.rule_changes() == [(0, "B3/S23"), (4, HIGHLIFE)]
        assert session.info.rule == HIGHLIFE
        restored = SparseWorld(64, 64)
        assert session.rollback(restored, 4) == 4
        assert sorted(restored.live_cells()) == [(10, 10), (10, 11), (11, 10), (11, 11)]


def test_a_version_two_session_that_never_stated_a_rule_is_marked_not_guessed(
    tmp_path: Path,
) -> None:
    """An empty rule is what a schema-2 import wrote when a header named none.

    Filling in the default is the only thing a migration can do, and recording
    that it did so is what keeps the guess from being indistinguishable from a
    fact. The dangling head is the second thing schema 2 could hold — it declared
    no foreign key on `head_id` — and the newest node is the only honest
    replacement for a head that names nothing.
    """
    path = tmp_path / "vague.db"
    _write_version_two_store(path, rule="", head=999)

    with Store.open(path) as migrated:
        session = migrated.session(1)
        assert session.info.rule == "B3/S23", "the default is the best available answer"
        assert session.info.rule_known is False, "and it is recorded as an assumption"
        assert [node.rule for node in session.nodes()] == ["B3/S23"] * 4
        assert session.head() is not None and session.head().id == 4


def test_a_version_two_store_deeper_than_the_trigger_limit_migrates(tmp_path: Path) -> None:
    """A parent chain longer than SQLite's trigger depth must still migrate.

    `lifegame_generation.parent_id` references its own table, and SQLite performs
    an implicit `DELETE FROM` when a table is dropped with foreign keys enforced,
    so the cascade walks the parent chain one level per row: past
    `SQLITE_MAX_TRIGGER_DEPTH` the drop raises "too many levels of trigger
    recursion" and the store cannot be opened at all. The real store this was
    found on has a 1300-node history, which is what this fixture is.

    Everything the migration promises is asserted here rather than "it opened":
    every generation row is compared element for element — id, session, number,
    parent, kind, both payloads, population, changed and timestamp — and so is
    every session row, including the head. `rule` and `rule_known` are new
    columns, so what is asserted of them is the value the migration's stated
    choice produces: schema 2's single rule, stated, on every node.
    """
    generations = 1300  # deeper than the default SQLITE_MAX_TRIGGER_DEPTH of 1000
    path = tmp_path / "deep.db"
    _write_deep_version_two_store(path, generations=generations)
    before_sessions = _rows(path, _SESSION_ROWS_SQL)
    before_generations = _rows(path, _GENERATION_ROWS_SQL)
    assert len(before_generations) == generations, "the fixture must be the deep one"
    assert before_sessions[0][8] == generations, "and its head is the deep tip"

    with Store.open(path) as migrated:
        assert migrated.backend.query_one("SELECT version FROM lifegame_schema") == (
            CURRENT_SCHEMA_VERSION,
        )
        # No data moved: not one byte of any row, the parent chain included.
        assert _rows(path, _GENERATION_ROWS_SQL) == before_generations
        assert _rows(path, _SESSION_ROWS_SQL) == before_sessions
        # The rule provenance schema 3 adds, on every generation.
        session = migrated.session(1)
        assert [node.rule for node in session.nodes()] == ["B3/S23"] * generations
        assert session.info.rule == "B3/S23"
        assert session.info.rule_known is True, "the schema-2 session stated its rule"
        assert session.rule_changes() == [(0, "B3/S23")]
        # The chain survived as a chain, and the head is still its tip.
        assert session.head() is not None and session.head().id == generations
        assert len(session.path_to(generations)) == generations, (
            "the parent links must still lead from the tip to the root"
        )
        # Enforcement is back on, which is the persistent state of a migrated
        # store, and what the rebuild wrote holds no dangling reference.
        assert migrated.backend.pragma("foreign_keys") == 1
        assert migrated.backend.query("PRAGMA foreign_key_check") == []


def test_a_migrated_deep_store_still_records_and_replays(tmp_path: Path) -> None:
    """Opening the deep store is not the same as being able to use it.

    The deepest node replays to the state the glider was in, the next step is
    recorded on top of it rather than beside it, and what was just recorded reads
    back — which is what says the migration left a working store and not just a
    readable one.
    """
    generations = 1300
    path = tmp_path / "deep-use.db"
    _write_deep_version_two_store(path, generations=generations)

    with Store.open(path) as migrated:
        session = migrated.session(1)
        reference = SparseWorld(64, 64)
        seed_world(reference, GLIDER)
        reference.step(generations - 1)

        restored = SparseWorld(64, 64)
        assert session.rollback(restored, generations - 1) == generations - 1
        assert restored.generation == generations - 1
        assert sorted(restored.live_cells()) == sorted(reference.live_cells()), (
            "the deepest node must replay to the state the glider was in"
        )

        node = session.record(restored, restored.advance())
        assert node.parent_id == generations, "a record appends to the deep tip"
        assert node.generation == generations
        assert session.head() is not None and session.head().id == node.id
        reference.advance()
        assert sorted(session.state_at_node(node.id)) == sorted(reference.live_cells())

        assert migrated.backend.pragma("foreign_keys") == 1
        assert migrated.backend.query("PRAGMA foreign_key_check") == []


def test_a_schema_two_store_whose_own_parent_links_dangle_is_refused_untouched(
    tmp_path: Path,
) -> None:
    """A rebuild runs with enforcement off, so its result has to be checked.

    A `parent_id` that names no row is not a chain but a pointer at nothing, and
    schema 2 declared no constraint the migration could trust it to have honoured.
    The migration refuses rather than importing a tree whose links lead nowhere,
    and refusing is the whole transaction rolling back: the file is still the
    schema-2 store it was, with every row in it.
    """
    path = tmp_path / "dangling.db"
    _write_version_two_store(path, rule="B3/S23", head=4)
    connection = sqlite3.connect(path)
    connection.execute("UPDATE lifegame_generation SET parent_id = 99 WHERE id = 4")
    connection.commit()
    connection.close()
    before_sessions = _rows(path, _SESSION_ROWS_SQL)
    before_generations = _rows(path, _GENERATION_ROWS_SQL)
    before_tables = _rows(
        path, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )

    with pytest.raises(StoreError, match="foreign-key violation"):
        Store.open(path)

    assert _rows(path, "SELECT version FROM lifegame_schema") == [(2,)], (
        "the store is still the schema-2 store it was"
    )
    assert _rows(path, _SESSION_ROWS_SQL) == before_sessions
    assert _rows(path, _GENERATION_ROWS_SQL) == before_generations
    assert (
        _rows(path, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        == before_tables
    ), "and it still has the tables it had, not half of a rebuilt schema"


def test_a_dangling_schema_two_store_is_salvaged_into_a_usable_copy(
    tmp_path: Path,
) -> None:
    """The refusal is the right default; this is the path forward for its owner.

    The copy is what is migrated, so the damaged file is not written to. The row
    whose link named nothing starts a branch with no parent, and because its
    payload is a delta that branch cannot be replayed: the store says so with a
    named error rather than inventing a state. The rest of the chain is readable,
    which is the difference between a store that will not open at all and one
    whose damage is bounded and reported.
    """
    source = tmp_path / "dangling.db"
    _write_version_two_store(source, rule="B3/S23", head=4)
    connection = sqlite3.connect(source)
    connection.execute("UPDATE lifegame_generation SET parent_id = 99 WHERE id = 4")
    connection.commit()
    connection.close()
    before = source.read_bytes()

    target = tmp_path / "salvaged.db"
    with salvage(source, target) as store:
        assert store.repaired_dangling == (4,)
        sessions = store.sessions()
        assert [info.id for info in sessions] == [1]
        session = store.session(sessions[0].id)
        nodes = {node.id: node for node in session.nodes()}
        assert nodes[4].parent_id is None, "the dangling link is cleared, not guessed"
        assert len(session.generations()) == 4
        assert session.state_at_node(3), "the intact part of the chain still replays"
        with pytest.raises(StoreError, match="no keyframe on its path to the root"):
            session.state_at_node(4)

    assert source.read_bytes() == before, "the damaged source is untouched"
    with pytest.raises(StoreError, match="foreign-key violation"):
        Store.open(source)
    with Store.open(target) as reopened:
        assert reopened.repaired_dangling == (), "a current store needs no repair"
        assert len(reopened.sessions()) == 1


def test_salvage_refuses_to_overwrite_its_target(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    _write_version_two_store(source, rule="B3/S23", head=4)
    target = tmp_path / "taken.db"
    target.write_bytes(b"not a store")
    with pytest.raises(StoreError, match="already exists"):
        salvage(source, target)
    assert target.read_bytes() == b"not a store"


def test_an_unknown_backend_is_refused() -> None:
    with pytest.raises(StoreError, match="unknown backend"):
        Store.open("ignored", backend="postgres")


def test_opening_sqlite_without_a_path_is_refused() -> None:
    with pytest.raises(StoreError, match="needs a path"):
        Store.open(None)
