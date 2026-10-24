"""Which rule the core is running, and whether the history says the same thing.

The failure these tests exist for is silent. A bridge that keeps its own copy of
the rule answers ``hello`` with a rule no generation will ever run, and nothing
downstream can tell: the reply looks exactly like a correct one. So the rule is
read from the world here, every time, and the tests build a world on a rule that
is not the default before they build a bridge over it.

They live under ``tests/store`` because the change they cover is the store and one
file of the bridge; the bridge half is kept with the history half so one feature's
tests are in one place.
"""

import base64
import inspect
import io
import json
from pathlib import Path
from typing import Any

from lifegame.store import DEFAULT_RULE, Store
from lifegame.world import Change, SparseWorld
from lifegame.world.bridge import Bridge
from lifegame.world.rules import LifeRule

GLIDER = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)]
HIGHLIFE = "B36/S23"


def ask(world: Any, history: Any = None, **payload: Any) -> dict[str, Any]:
    """Run one request through a real bridge and return its one reply.

    A fresh bridge per request on purpose: the world carries the rule and the
    session carries the history, so a bridge that remembered a rule of its own
    would have nothing to remember it *across*, and would answer with whatever it
    was handed.
    """
    payload.setdefault("id", 1)
    writer = io.StringIO()
    Bridge(world, io.StringIO(json.dumps(payload) + "\n"), writer, history=history).serve()
    lines = writer.getvalue().splitlines()
    assert len(lines) == 1, f"expected exactly one reply, got {lines}"
    return json.loads(lines[0])


def test_the_bridge_keeps_no_copy_of_the_rule() -> None:
    """The trap itself, as a contract: there is no second place for a rule to live."""
    assert "rule" not in inspect.signature(Bridge.__init__).parameters
    bridge = Bridge(SparseWorld(4, 4), io.StringIO(), io.StringIO())
    assert not hasattr(bridge, "_rule"), "the rule belongs to the world, not the bridge"


def test_hello_reports_the_rule_the_world_was_built_with() -> None:
    """A world on a non-default rule must not be reported as the default."""
    world = SparseWorld(32, 32)
    world.set_rule(LifeRule.parse(HIGHLIFE))

    hello = ask(world, cmd="hello")
    assert hello["ok"] is True
    assert hello["rule"] == HIGHLIFE
    assert ask(world, cmd="state")["rule"] == HIGHLIFE
    assert ask(world, cmd="export")["export"]["rule"] == HIGHLIFE


def test_a_rule_change_keeps_the_protocol_and_the_history_agreeing(tmp_path: Path) -> None:
    """One change, two records: the world runs it and the session says so."""
    with Store.open(tmp_path / "bridge.db") as store:
        world = SparseWorld(32, 32)
        world.load(GLIDER)
        session = store.create_session(world)
        session.record(world, Change(changed=0, generation=0))
        assert ask(world, history=session, cmd="step")["ok"] is True

        reply = ask(world, history=session, cmd="set_rule", rule="b36/s23")
        assert reply["ok"] is True
        assert reply["rule"] == HIGHLIFE, "the core answers with its canonical text"
        assert session.info.rule == HIGHLIFE, "the session is running it too"
        assert session.info.rule_known is True

        assert ask(world, history=session, cmd="step")["ok"] is True
        assert session.rule_changes() == [(0, "B3/S23"), (2, HIGHLIFE)]
        tree = ask(world, history=session, cmd="history")
        assert [row["rule"] for row in tree["generations"]] == ["B3/S23", "B3/S23", HIGHLIFE]


def test_import_restores_the_rule_the_payload_names() -> None:
    """Export carries the rule; import adopts it. Without this the switch loses it."""
    source = SparseWorld(32, 32)
    source.load(GLIDER)
    source.set_rule(LifeRule.parse(HIGHLIFE))
    exported = ask(source, cmd="export")["export"]

    destination = SparseWorld(32, 32)
    assert ask(destination, cmd="state")["rule"] == "B3/S23"
    reply = ask(
        destination,
        cmd="import",
        format=exported["format"],
        data=exported["data"],
        generation=exported["generation"],
        rule=exported["rule"],
    )
    assert reply["ok"] is True
    assert reply["rule"] == HIGHLIFE
    assert ask(destination, cmd="state")["rule"] == HIGHLIFE
    assert sorted(destination.live_cells()) == sorted(source.live_cells())
    assert destination.generation == source.generation


def test_import_of_a_payload_that_names_no_rule_keeps_the_running_one() -> None:
    """A payload written before the rule travelled must not reset the world."""
    world = SparseWorld(32, 32)
    world.load(GLIDER)
    world.set_rule(LifeRule.parse(HIGHLIFE))

    reply = ask(world, cmd="import", format="cells", data="", generation=4)
    assert reply["ok"] is True
    assert reply["rule"] == HIGHLIFE
    assert ask(world, cmd="state")["rule"] == HIGHLIFE
    assert sorted(world.live_cells()) == [], "the payload's cells replaced the world's"


def test_an_imported_rule_this_core_cannot_run_is_refused_before_anything_moves() -> None:
    """B0 is not a local rule, and a refusal must leave the world where it was."""
    world = SparseWorld(32, 32)
    world.load(GLIDER)

    reply = ask(world, cmd="import", format="cells", data="", generation=7, rule="B0/S23")
    assert reply["error"] == "bad_rule", reply
    assert sorted(world.live_cells()) == sorted(GLIDER)
    assert world.generation == 0, "a refused rule import restores no state either"
    assert ask(world, cmd="state")["rule"] == "B3/S23"


def test_open_restores_the_archived_rule_into_the_core(tmp_path: Path) -> None:
    """Opening an archive is adopting its world *and* the rule it was running."""
    with Store.open(tmp_path / "opened.db") as store:
        world = SparseWorld(32, 32)
        world.load(GLIDER)
        world.set_rule(LifeRule.parse(HIGHLIFE))
        session = store.create_session(world)
        session.record(world, Change(changed=0, generation=0))
        for _ in range(3):
            session.record(world, world.advance())
        path = tmp_path / "highlife.jsonl"
        assert session.archive(path) == 4
        recorded = session.state_at(3)

        live = SparseWorld(32, 32)
        current = store.create_session(live)
        current.record(live, Change(changed=0, generation=0))
        reply = ask(live, history=current, cmd="open", path=str(path))

        assert reply["ok"] is True
        assert reply["rule"] == HIGHLIFE
        assert reply["ruleKnown"] is True
        assert store.session(int(reply["session"])).info.rule == HIGHLIFE
        assert ask(live, cmd="state")["rule"] == HIGHLIFE
        assert sorted(live.live_cells()) == sorted(recorded)
        assert live.generation == 3


def test_open_of_an_archive_that_states_no_rule_reports_it_as_assumed(tmp_path: Path) -> None:
    """An old archive opens on the default, and the reply says the default was ours."""
    payload = base64.b64encode(
        b"".join(int(value).to_bytes(4, "little", signed=True) for value in (3, 4))
    ).decode("ascii")
    header = json.dumps(
        {
            "kind": "header",
            "format": "lifegame-archive",
            "version": 1,
            "session": {"label": "old", "world_width": 8, "world_height": 8},
        }
    )
    line = json.dumps(
        {
            "kind": "generation",
            "generation": 0,
            "storage": "keyframe",
            "population": 1,
            "changed": 1,
            "created_at": "2026-10-10T00:00:00+00:00",
            "born": payload,
            "died": "",
        }
    )
    path = tmp_path / "norule.jsonl"
    path.write_text(header + "\n" + line + "\n", encoding="utf-8", newline="\n")

    with Store.open(tmp_path / "assumed.db") as store:
        world = SparseWorld(8, 8)
        current = store.create_session(world)
        current.record(world, Change(changed=0, generation=0))
        reply = ask(world, history=current, cmd="open", path=str(path))

        assert reply["ok"] is True
        assert reply["rule"] == DEFAULT_RULE
        assert reply["ruleKnown"] is False, "the default was filled in, not recorded"
        assert sorted(world.live_cells()) == [(3, 4)]


def test_open_of_an_archive_rule_this_core_cannot_run_is_refused(tmp_path: Path) -> None:
    """A session whose rule this representation cannot hold is not half-loaded."""
    with Store.open(tmp_path / "b0.db") as store:
        # A dense world can run B0, so a B0 archive can exist for a sparse core
        # to be asked to open.
        from lifegame.world import DenseWorld

        dense = DenseWorld(8, 8)
        dense.set_alive(1, 1)
        dense.set_rule(LifeRule.parse("B0/S23"))
        session = store.create_session(dense, representation="dense")
        session.record(dense, Change(changed=0, generation=0))
        path = tmp_path / "b0.jsonl"
        assert session.archive(path) == 1

        world = SparseWorld(8, 8)
        world.load(GLIDER)
        current = store.create_session(world)
        current.record(world, Change(changed=0, generation=0))
        reply = ask(world, history=current, cmd="open", path=str(path))

        assert reply["error"] == "bad_rule", reply
        assert sorted(world.live_cells()) == sorted(GLIDER), "nothing was loaded"
        assert ask(world, cmd="state")["rule"] == "B3/S23"
