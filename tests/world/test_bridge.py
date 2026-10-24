"""The line protocol, exercised against a real bridge process.

The tests speak the protocol exactly as the NodeJS service does — one JSON
object per line on standard input, one per line back — so a change that breaks
the service breaks these tests first. One case runs a bridge in process instead,
because "one patch records one edit" is a call count that no protocol reply
exposes.

Authority: docs/model/world/interfaces.md § protocol.
"""

import base64
import json
import struct
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from lifegame.world.bridge import decode_cells

WIDTH = 64
HEIGHT = 64


@pytest.fixture(scope="module")
def bridge() -> Any:
    process = subprocess.Popen(
        [sys.executable, "-m", "lifegame.world", "--width", str(WIDTH), "--height", str(HEIGHT)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdin is not None
    assert process.stdout is not None
    try:
        yield process
    finally:
        process.kill()
        process.wait(timeout=10)


def request(process: Any, **payload: Any) -> dict[str, Any]:
    payload.setdefault("id", 1)
    process.stdin.write(json.dumps(payload) + "\n")
    process.stdin.flush()
    line = process.stdout.readline()
    assert line, "the bridge closed its output"
    return json.loads(line)


def clear(process: Any) -> None:
    assert request(process, cmd="clear")["ok"] is True


def test_hello_announces_the_protocol_and_the_world(bridge: Any) -> None:
    reply = request(bridge, cmd="hello")
    assert reply["ok"] is True
    assert reply["protocol"] == 1
    assert reply["world"] == {"width": WIDTH, "height": HEIGHT}
    assert reply["rule"] == "B3/S23"


def test_the_request_id_is_echoed(bridge: Any) -> None:
    assert request(bridge, id=4242, cmd="state")["id"] == 4242


def test_toggle_changes_the_state_and_the_population(bridge: Any) -> None:
    clear(bridge)
    reply = request(bridge, cmd="toggle", x=3, y=4)
    assert reply["ok"] is True
    assert reply["alive"] is True
    assert reply["population"] == 1
    assert request(bridge, cmd="state")["population"] == 1


def test_set_adds_a_block(bridge: Any) -> None:
    clear(bridge)
    reply = request(bridge, cmd="set", cells=[[0, 0], [1, 0], [0, 1], [1, 1]], alive=True)
    assert reply["ok"] is True
    assert reply["changed"] == 4
    assert request(bridge, cmd="state")["population"] == 4


def test_patch_applies_born_and_died_and_counts_only_changes(bridge: Any) -> None:
    """A born cell already alive, and a died cell already dead, are not changes."""
    clear(bridge)
    request(bridge, cmd="set", cells=[[1, 1], [3, 3]])
    reply = request(
        bridge,
        cmd="patch",
        born=[[1, 1], [2, 2]],
        died=[[3, 3], [4, 4]],
        expectGeneration=0,
    )
    assert reply == {
        "ok": True,
        "generation": 0,
        "population": 2,
        "bornCount": 1,
        "diedCount": 1,
        "born": [[2, 2]],
        "died": [[3, 3]],
        "id": 1,
    }
    exported = request(bridge, cmd="export")["export"]
    assert sorted(decode_cells(exported["data"]).tolist()) == [[1, 1], [2, 2]]
    state = request(bridge, cmd="state")
    assert state["generation"] == 0, "a patch edits; it does not step"
    assert state["population"] == 2


def test_a_refused_patch_changes_nothing(bridge: Any) -> None:
    """One out-of-bounds cell refuses the whole patch, including its valid cells."""
    clear(bridge)
    request(bridge, cmd="set", cells=[[1, 1]])
    before = request(bridge, cmd="export")["export"]
    before_state = request(bridge, cmd="state")
    reply = request(
        bridge,
        cmd="patch",
        born=[[2, 2], [WIDTH, 0]],
        died=[[1, 1]],
        expectGeneration=0,
    )
    assert reply["ok"] is False
    assert reply["error"] == "out_of_bounds"
    after = request(bridge, cmd="export")["export"]
    assert after["data"] == before["data"], "the born and died cells must not be applied"
    assert after["population"] == before["population"]
    assert request(bridge, cmd="state") == before_state


def test_a_patch_from_a_stale_generation_is_refused(bridge: Any) -> None:
    """The generation precondition is checked before any cell moves."""
    clear(bridge)
    request(bridge, cmd="set", cells=[[1, 1]])
    before = request(bridge, cmd="export")["export"]
    reply = request(
        bridge, cmd="patch", born=[[2, 2]], died=[[1, 1]], expectGeneration=1
    )
    assert reply["ok"] is False
    assert reply["error"] == "stale_generation"
    assert request(bridge, cmd="export")["export"]["data"] == before["data"]


def test_a_cell_in_both_patch_lists_is_refused(bridge: Any) -> None:
    """A cell cannot be both born and died in one transaction."""
    clear(bridge)
    request(bridge, cmd="set", cells=[[1, 1]])
    before = request(bridge, cmd="export")["export"]
    reply = request(
        bridge,
        cmd="patch",
        born=[[2, 2], [5, 5]],
        died=[[5, 5]],
        expectGeneration=0,
    )
    assert reply["ok"] is False
    assert reply["error"] == "bad_arguments"
    assert "both" in reply["message"]
    assert request(bridge, cmd="export")["export"]["data"] == before["data"]


@pytest.mark.parametrize(
    "payload",
    [
        {"cmd": "patch", "died": [], "expectGeneration": 0},
        {"cmd": "patch", "born": [], "expectGeneration": 0},
        {"cmd": "patch", "born": "cells", "died": [], "expectGeneration": 0},
        {"cmd": "patch", "born": [], "died": [], "expectGeneration": "0"},
        {"cmd": "patch", "born": [], "died": [], "expectGeneration": True},
        {"cmd": "patch", "born": [[1, 2, 3]], "died": [], "expectGeneration": 0},
        {"cmd": "patch", "born": [[1, 1], [2, 2, 3]], "died": [], "expectGeneration": 0},
        {"cmd": "patch", "born": [[True, 1]], "died": [], "expectGeneration": 0},
        {"cmd": "patch", "born": [[1.0, 1]], "died": [], "expectGeneration": 0},
    ],
)
def test_malformed_patch_arguments_are_refused_before_anything_is_applied(
    bridge: Any, payload: dict[str, Any]
) -> None:
    clear(bridge)
    before = request(bridge, cmd="export")["export"]
    reply = request(bridge, **payload)
    assert reply["ok"] is False, payload
    assert reply["error"] == "bad_arguments", reply
    assert request(bridge, cmd="export")["export"]["data"] == before["data"]


def test_step_advances_the_generation_counter(bridge: Any) -> None:
    clear(bridge)
    request(bridge, cmd="set", cells=[[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]])
    reply = request(bridge, cmd="step")
    assert reply["ok"] is True
    assert reply["generation"] == 1
    assert reply["population"] == 5
    assert request(bridge, cmd="state")["generation"] == 1


def test_the_frame_encoding_follows_the_stated_size_rule(bridge: Any) -> None:
    """Sixteen bytes per live cell against one bit per cell, both in bytes.

    A 64 x 64 rectangle has a 512-byte bitmap, so the boundary is exactly 64
    live cells: 64 cells cost 512 bytes and are sent as coordinates, and 65
    cells cost 520 bytes and are sent as the bitmap. An earlier version
    compared a bit count against a byte count and crossed over eight times too
    early.
    """
    clear(bridge)
    request(bridge, cmd="set", cells=[[x, y] for y in range(8) for x in range(8)])
    assert request(bridge, cmd="frame", x0=0, y0=0, w=64, h=64)["frame"]["format"] == "cells"

    clear(bridge)
    request(bridge, cmd="set", cells=[[x, y] for y in range(8) for x in range(8)])
    request(bridge, cmd="set", cells=[[x, 8] for x in range(1)])
    assert request(bridge, cmd="frame", x0=0, y0=0, w=64, h=64)["frame"]["format"] == "bits"


def test_run_emits_ticks_and_pause_stops_them(bridge: Any) -> None:
    clear(bridge)
    request(bridge, cmd="set", cells=[[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]])
    assert request(bridge, cmd="run", tps=60)["running"] is True

    time.sleep(0.25)
    bridge.stdin.write(json.dumps({"id": 77, "cmd": "pause"}) + "\n")
    bridge.stdin.flush()

    events: list[dict[str, Any]] = []
    while True:
        line = bridge.stdout.readline()
        assert line, "the bridge closed its output"
        message = json.loads(line)
        if "event" in message:
            events.append(message)
            continue
        assert message.get("id") == 77
        break

    assert events, "running at 60 ticks per second produced no tick in a quarter second"
    assert all(event["event"] == "tick" for event in events)
    assert events[-1]["generation"] >= 1
    assert events[-1]["population"] == 5
    assert message["running"] is False
    assert request(bridge, cmd="state")["running"] is False


def test_clear_resets_generation_and_population(bridge: Any) -> None:
    request(bridge, cmd="set", cells=[[5, 5]])
    request(bridge, cmd="step")
    reply = request(bridge, cmd="clear")
    assert reply == {"ok": True, "generation": 0, "population": 0, "id": 1}


def test_a_sparse_frame_arrives_as_cell_coordinates(bridge: Any) -> None:
    clear(bridge)
    request(bridge, cmd="set", cells=[[3, 4], [10, 20]])
    reply = request(bridge, cmd="frame", x0=0, y0=0, w=32, h=32)
    frame = reply["frame"]
    assert frame["format"] == "cells"
    raw = base64.b64decode(frame["data"])
    pairs = [struct.unpack_from("<ii", raw, offset) for offset in range(0, len(raw), 8)]
    assert sorted(pairs) == [(3, 4), (10, 20)]
    assert (frame["generation"], frame["population"]) == (0, 2)


def test_a_dense_frame_arrives_as_a_bitmap(bridge: Any) -> None:
    clear(bridge)
    cells = [[x, y] for y in range(16) for x in range(16)]
    request(bridge, cmd="set", cells=cells)
    frame = request(bridge, cmd="frame", x0=0, y0=0, w=16, h=16)["frame"]
    assert frame["format"] == "bits"
    raw = base64.b64decode(frame["data"])
    # Row stride is ceil(16 / 8) = 2 bytes, and there are 16 rows.
    assert len(raw) == 2 * 16
    assert all(byte == 0xFF for byte in raw)


def test_the_frame_reports_its_own_rectangle(bridge: Any) -> None:
    clear(bridge)
    frame = request(bridge, cmd="frame", x0=8, y0=16, w=24, h=12)["frame"]
    assert (frame["x0"], frame["y0"], frame["w"], frame["h"]) == (8, 16, 24, 12)
    assert frame["format"] == "cells"
    assert frame["data"] == ""


def test_state_reports_the_bounds_of_the_live_cells(bridge: Any) -> None:
    clear(bridge)
    request(bridge, cmd="set", cells=[[4, 5], [9, 11]])
    assert request(bridge, cmd="state")["bounds"] == [4, 5, 9, 11]


def test_an_unknown_command_is_an_error_not_a_crash(bridge: Any) -> None:
    reply = request(bridge, cmd="teleport")
    assert reply["ok"] is False
    assert reply["error"] == "unknown_command"
    assert request(bridge, cmd="state")["ok"] is True


def test_a_malformed_line_is_an_error_not_a_crash(bridge: Any) -> None:
    bridge.stdin.write("this is not json\n")
    bridge.stdin.flush()
    reply = json.loads(bridge.stdout.readline())
    assert reply["ok"] is False
    assert reply["error"] == "bad_request"


def test_a_coordinate_outside_the_world_is_reported_as_such(bridge: Any) -> None:
    reply = request(bridge, cmd="toggle", x=WIDTH, y=0)
    assert reply["ok"] is False
    assert reply["error"] == "out_of_bounds"


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"cmd": "toggle", "x": "three", "y": 0}, "bad_arguments"),
        ({"cmd": "step", "count": -1}, "bad_arguments"),
        ({"cmd": "run", "tps": 1000}, "bad_arguments"),
        ({"cmd": "frame", "x0": 0, "y0": 0, "w": 4096, "h": 1}, "out_of_bounds"),
        ({}, "bad_arguments"),
    ],
)
def test_bad_arguments_are_named(bridge: Any, payload: dict[str, Any], code: str) -> None:
    reply = request(bridge, **payload)
    assert reply["ok"] is False
    assert reply["error"] == code


@pytest.mark.parametrize("representation", ["sparse", "tiled"])
def test_both_representations_answer_the_same_protocol(representation: str) -> None:
    """A client cannot tell which representation is behind the protocol."""
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "lifegame.world",
            "--width",
            str(WIDTH),
            "--height",
            str(HEIGHT),
            "--representation",
            representation,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdin is not None
    assert process.stdout is not None
    try:
        assert request(process, cmd="hello")["world"] == {"width": WIDTH, "height": HEIGHT}
        glider = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]
        assert request(process, cmd="set", cells=glider)["changed"] == 5
        stepped = request(process, cmd="step", count=4)
        assert stepped["generation"] == 4
        assert stepped["population"] == 5
        state = request(process, cmd="state")
        assert state["bounds"] == [1, 1, 3, 3], representation
        frame = request(process, cmd="frame", x0=0, y0=0, w=16, h=16)["frame"]
        assert frame["generation"] == 4
        patched = request(
            process,
            cmd="patch",
            born=[[10, 10]],
            died=[[3, 3]],
            expectGeneration=4,
        )
        assert patched == {
            "ok": True,
            "generation": 4,
            "population": 5,
            "bornCount": 1,
            "diedCount": 1,
            "born": [[10, 10]],
            "died": [[3, 3]],
            "id": 1,
        }, representation
        assert request(process, cmd="state")["population"] == 5
    finally:
        process.kill()
        process.wait(timeout=10)


def test_export_and_import_round_trip_every_representation() -> None:
    """An export is how a representation switch keeps the world.

    The viewer switches storage by exporting from the running core, starting a
    core on the other representation, and importing. If the round trip lost the
    generation counter, a switch would look like an undo.
    """
    cells = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2], [40, 40], [41, 40], [40, 41], [41, 41]]
    for representation in ("sparse", "tiled"):
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "lifegame.world",
                "--width",
                str(WIDTH),
                "--height",
                str(HEIGHT),
                "--representation",
                representation,
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        assert process.stdin is not None
        assert process.stdout is not None
        try:
            request(process, cmd="set", cells=cells)
            request(process, cmd="step", count=6)
            exported = request(process, cmd="export")["export"]
            assert exported["format"] == "cells"
            assert exported["population"] == len(cells)
            assert exported["world"] == {"width": WIDTH, "height": HEIGHT}

            request(process, cmd="clear")
            assert request(process, cmd="state")["population"] == 0

            restored = request(
                process,
                cmd="import",
                format=exported["format"],
                data=exported["data"],
                generation=exported["generation"],
            )
            assert restored["population"] == len(cells)
            assert restored["generation"] == exported["generation"] == 6

            # The state is compared by exporting it again, not against the input
            # cells: six generations were applied before the export, so the live
            # set has moved. A round trip has to be lossless, not stationary.
            again = request(process, cmd="export")["export"]
            assert again["data"] == exported["data"]
            assert again["population"] == exported["population"]
            assert again["generation"] == exported["generation"]
            assert decode_cells(again["data"]).shape[0] == len(cells)
            state = request(process, cmd="state")
            assert state["generation"] == 6
            assert state["population"] == len(cells)
        finally:
            process.kill()
            process.wait(timeout=10)


def test_import_refuses_a_malformed_payload(bridge: Any) -> None:
    for payload in ("!!!!", base64.b64encode(b"12345").decode("ascii")):
        reply = request(bridge, cmd="import", format="cells", data=payload)
        assert reply["ok"] is False, payload
        assert reply["error"] == "bad_arguments", reply
    unsupported = request(bridge, cmd="import", format="bits", data="")
    assert unsupported["ok"] is False
    assert unsupported["error"] == "bad_arguments"
    missing = request(bridge, cmd="import", format="cells")
    assert missing["ok"] is False
    assert missing["error"] == "bad_arguments"


def test_hello_advertises_the_limits_the_core_enforces(bridge: Any) -> None:
    """A client that offers a rate the core refuses is a client that lies.

    These numbers lived in the page, the service and here. They are advertised
    so that the copies can go away.
    """
    from lifegame.world.bridge import (
        MAX_STEPS_PER_REQUEST,
        MAX_TICKS_PER_SECOND,
        MIN_TICKS_PER_SECOND,
        REPRESENTATIONS,
    )

    hello = request(bridge, cmd="hello")
    limits = hello["limits"]
    assert limits["ticksPerSecond"] == {
        "min": MIN_TICKS_PER_SECOND,
        "max": MAX_TICKS_PER_SECOND,
    }
    assert limits["stepsPerRequest"] == MAX_STEPS_PER_REQUEST
    assert limits["representations"] == list(REPRESENTATIONS)
    assert limits["maxCoordinate"] == (1 << 32) - 1
    assert hello["world"] == {"width": WIDTH, "height": HEIGHT}
    assert hello["history"] is False


@pytest.fixture()
def recorded(tmp_path: Path) -> Iterator[tuple[Any, Path]]:
    """A core with a history, one glider already set and four generations run."""
    store_path = tmp_path / "history.db"
    archive_path = tmp_path / "history.jsonl"
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "lifegame.world",
            "--width",
            str(WIDTH),
            "--height",
            str(HEIGHT),
            "--history",
            str(store_path),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdin is not None
    assert process.stdout is not None
    try:
        request(process, cmd="set", cells=[[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]])
        request(process, cmd="step", count=4)
        yield process, archive_path
    finally:
        process.kill()
        process.wait(timeout=10)


def test_a_recorded_core_reports_its_timeline(recorded: tuple[Any, Path]) -> None:
    process, _ = recorded
    assert request(process, cmd="hello")["history"] is True
    history = request(process, cmd="history")
    assert history["current"] == 4
    assert [entry["generation"] for entry in history["generations"]] == [0, 1, 2, 3, 4]
    # The edit happened at generation 0, so generation 0 must describe the world
    # *after* the edit rather than the empty world the core started with.
    assert history["generations"][0]["kind"] == "keyframe"
    assert history["generations"][0]["population"] == 5


def test_a_recorded_core_rolls_back_and_continues(recorded: tuple[Any, Path]) -> None:
    process, _ = recorded
    rolled = request(process, cmd="rollback", generation=1)
    assert rolled["generation"] == 1
    assert rolled["population"] == 5
    assert rolled["bounds"] == [0, 1, 2, 3]
    state = request(process, cmd="state")
    assert state["generation"] == 1
    # Stepping on from a read generation must append: the generations that came
    # after the one that was read are still there, and the new work sits on top
    # of them. That is the difference between a chain and a tree, and this is the
    # assertion that would fail if the old truncating behaviour came back.
    request(process, cmd="step", count=2)
    again = request(process, cmd="rollback", generation=2)
    assert again["generation"] == 2
    generations = [
        entry["generation"] for entry in request(process, cmd="history")["generations"]
    ]
    assert generations[:5] == [0, 1, 2, 3, 4]
    assert len(generations) > 5, "the new steps must have been appended, not discarded"


def test_an_edit_between_generations_keeps_the_chain_replayable(
    recorded: tuple[Any, Path],
) -> None:
    """A mutation changes the world between two generations.

    The delta that brought the world to the current generation no longer
    describes where the next step starts, so recording it as a delta would make
    the chain unreplayable -- which the replay validation reports as a delta
    that kills a cell which was never alive. This is the test for the fix.
    """
    process, _ = recorded
    request(process, cmd="toggle", x=40, y=40)
    request(process, cmd="step", count=2)
    history = request(process, cmd="history")
    kinds = {entry["generation"]: entry["kind"] for entry in history["generations"]}
    assert kinds[4] == "keyframe", "the edit must have re-keyframed its own generation"
    # Every generation must be restorable, which is what proves the chain.
    for generation in range(history["current"] + 1):
        assert request(process, cmd="rollback", generation=generation)["population"] >= 5


def test_one_patch_records_exactly_one_history_edit() -> None:
    """A transaction is one recorded edit, not one edit per cell.

    The protocol reply cannot show this: an edit amends the current generation
    in place either way. The edit path is therefore observed in process, where
    the calls the bridge makes on the history can be counted directly.
    """
    import io

    from lifegame.world import SparseWorld
    from lifegame.world.bridge import Bridge

    class CountingHistory:
        def __init__(self) -> None:
            self.amended = 0
            self.recorded = 0

        def amend_head(self, world: Any) -> None:
            self.amended += 1

        def record(self, world: Any, change: Any) -> None:
            self.recorded += 1

    world = SparseWorld(8, 8)
    world.load([(1, 1)])
    history = CountingHistory()
    writer = io.StringIO()
    request_line = json.dumps(
        {
            "id": 1,
            "cmd": "patch",
            "born": [[1, 1], [2, 2], [3, 3]],
            "died": [[4, 4]],
            "expectGeneration": 0,
        }
    )
    Bridge(world, io.StringIO(request_line + "\n"), writer, history=history).serve()

    reply = json.loads(writer.getvalue())
    assert reply["ok"] is True
    assert (reply["bornCount"], reply["diedCount"]) == (2, 0)
    assert sorted(world.live_cells()) == [(1, 1), (2, 2), (3, 3)]
    assert history.amended == 1, "one patch is one edit"
    assert history.recorded == 0, (
        "an edit amends the current generation; it does not append a generation"
    )


def test_an_archive_can_be_written_and_read_back(recorded: tuple[Any, Path]) -> None:
    from lifegame.store import Store

    process, archive_path = recorded
    written = request(process, cmd="archive", path=str(archive_path))
    assert written["generations"] == 5
    assert archive_path.is_file()
    with Store.open(archive_path.parent / "reader.db") as store:
        imported = store.import_archive(archive_path)
        assert len(imported.generations()) == 5
        assert imported.state_at(4) == imported.state_at(4)


def test_history_commands_are_refused_without_a_history(bridge: Any) -> None:
    for payload in (
        {"cmd": "history"},
        {"cmd": "rollback", "generation": 0},
        {"cmd": "archive", "path": "nowhere.jsonl"},
    ):
        reply = request(bridge, **payload)
        assert reply["ok"] is False, payload
        assert reply["error"] == "bad_arguments", reply
        assert "--history" in reply["message"]


def test_archive_needs_a_path(recorded: tuple[Any, Path]) -> None:
    process, _ = recorded
    reply = request(process, cmd="archive")
    assert reply["ok"] is False
    assert reply["error"] == "bad_arguments"


def test_an_archive_can_be_reopened_as_a_new_session(recorded: tuple[Any, Path]) -> None:
    """Importing is the core's job: the format lives here, not in the service."""

    process, archive_path = recorded
    request(process, cmd="archive", path=str(archive_path))
    before = request(process, cmd="history")["session"]

    opened = request(process, cmd="open", path=str(archive_path))
    assert opened["session"] != before, "opening must produce a new session"
    assert opened["generation"] == 4
    assert opened["population"] == 5

    # The world now holds the archive's newest state, and the history in play is
    # the imported one.
    state = request(process, cmd="state")
    assert state["generation"] == 4
    assert state["population"] == 5
    assert request(process, cmd="history")["session"] == opened["session"]

    # And the imported session is a real history, not just a loaded state.
    rolled = request(process, cmd="rollback", generation=1)
    assert rolled["generation"] == 1


def test_open_refuses_a_missing_or_empty_path(recorded: tuple[Any, Path]) -> None:
    process, _ = recorded
    for payload in ({"cmd": "open"}, {"cmd": "open", "path": ""}):
        reply = request(process, **payload)
        assert reply["ok"] is False
        assert reply["error"] == "bad_arguments", reply


def test_quit_ends_the_process() -> None:
    process = subprocess.Popen(
        [sys.executable, "-m", "lifegame.world", "--width", "8", "--height", "8"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(json.dumps({"id": 1, "cmd": "quit"}) + "\n")
    process.stdin.flush()
    assert json.loads(process.stdout.readline())["bye"] is True
    assert process.wait(timeout=10) == 0


def test_closing_the_input_ends_the_process() -> None:
    process = subprocess.Popen(
        [sys.executable, "-m", "lifegame.world", "--width", "8", "--height", "8"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdin is not None
    process.stdin.close()
    assert process.wait(timeout=10) == 0


BLOCK = [[0, 0], [1, 0], [0, 1], [1, 1]]


def test_set_rule_switches_the_rule_and_reports_it(bridge: Any) -> None:
    """The reply names the rule the core is now running, in its canonical text."""
    clear(bridge)
    try:
        reply = request(bridge, cmd="set_rule", rule="b36/s32")
        assert reply["ok"] is True
        assert reply["rule"] == "B36/S23", "the core answers with its own canonical text"
        assert reply["birth"] == [3, 6]
        assert reply["survival"] == [2, 3]
        assert request(bridge, cmd="hello")["rule"] == "B36/S23"
        assert request(bridge, cmd="state")["rule"] == "B36/S23"
    finally:
        assert request(bridge, cmd="set_rule", rule="B3/S23")["rule"] == "B3/S23"


def test_set_rule_does_not_touch_the_state(bridge: Any) -> None:
    """A rule is not a state: switching one is not an edit and not an undo."""
    clear(bridge)
    request(bridge, cmd="set", cells=[list(cell) for cell in BLOCK])
    request(bridge, cmd="step")
    before = request(bridge, cmd="state")
    assert before["generation"] == 1
    assert before["population"] == 4, "a block is a still life under Conway"

    reply = request(bridge, cmd="set_rule", rule="B36/S23")

    assert reply["ok"] is True
    after = request(bridge, cmd="state")
    assert (after["generation"], after["population"], after["bounds"]) == (
        before["generation"],
        before["population"],
        before["bounds"],
    )
    request(bridge, cmd="set_rule", rule="B3/S23")


def test_a_switched_rule_is_the_rule_that_runs(bridge: Any) -> None:
    """A block is a still life under Conway and dies under a rule with no survival."""
    clear(bridge)
    try:
        request(bridge, cmd="set", cells=[list(cell) for cell in BLOCK])
        assert request(bridge, cmd="step")["population"] == 4
        assert request(bridge, cmd="set_rule", rule="B/S")["rule"] == "B/S"
        stepped = request(bridge, cmd="step")
        assert stepped["population"] == 0, "nothing survives B/S"
        assert stepped["changed"] == 4
    finally:
        request(bridge, cmd="set_rule", rule="B3/S23")


@pytest.mark.parametrize(
    "text",
    ["", "B3", "B/S2/3", "3/S23", "B3/", "B9/S23", "B3/S2x", "B33/S23", "B3/S32"],
)
def test_a_rule_the_core_will_not_parse_is_refused_with_a_reason(bridge: Any, text: str) -> None:
    reply = request(bridge, cmd="set_rule", rule=text)
    if text == "B3/S32":
        assert reply["ok"] is True, "a reordered set is a rule, not a fault"
        assert reply["rule"] == "B3/S23"
        return
    assert reply["ok"] is False, reply
    assert reply["error"] == "bad_rule", reply
    assert reply["message"], "a refusal has to say why"
    assert request(bridge, cmd="state")["rule"] == "B3/S23", "a refusal changes nothing"


def test_a_rule_this_representation_cannot_run_is_refused(bridge: Any) -> None:
    """The default core is sparse, and B0 is not a local rule."""
    reply = request(bridge, cmd="set_rule", rule="B0/S23")
    assert reply["ok"] is False
    assert reply["error"] == "bad_rule"
    assert "local" in reply["message"]
    assert request(bridge, cmd="state")["rule"] == "B3/S23"


@pytest.mark.parametrize("payload", [{"cmd": "set_rule"}, {"cmd": "set_rule", "rule": 3}])
def test_set_rule_needs_a_rule_string(bridge: Any, payload: dict[str, Any]) -> None:
    reply = request(bridge, **payload)
    assert reply["ok"] is False
    assert reply["error"] == "bad_rule"
    assert request(bridge, cmd="state")["ok"] is True, "the protocol must survive it"
