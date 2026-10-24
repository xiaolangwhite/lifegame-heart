"""Archives: writing a session out, reading it back, and refusing bad files.

An archive is what leaves the machine, so the tests care about two things a
working store does not need: that a round trip through a text file is lossless,
and that a file which is not an archive, or is one from a different version, is
refused with a message that names the problem.
"""

import base64
import json
from pathlib import Path

import pytest

from lifegame.store import DEFAULT_RULE, ArchiveError, Store
from lifegame.store.archive import read_archive, write_archive
from lifegame.world import Change, SparseWorld
from lifegame.world.rules import LifeRule

GLIDER = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)]
HIGHLIFE = "B36/S23"


def build(tmp_path: Path, steps: int = 5) -> tuple[Store, object, Path]:
    store = Store.open(tmp_path / "source.db")
    world = SparseWorld(64, 64)
    world.load(GLIDER)
    session = store.create_session(world, label="glider run", representation="sparse")
    session.record(world, Change(changed=0, generation=0))
    for _ in range(steps):
        session.record(world, world.advance())
    return store, session, tmp_path / "glider.lifegame.jsonl"


def test_an_archive_round_trips_into_a_fresh_store(tmp_path: Path) -> None:
    store, session, path = build(tmp_path)
    try:
        written = write_archive(session, path)  # type: ignore[arg-type]
        assert written == 6
        # A header line and one line per generation.
        assert path.read_text(encoding="utf-8").count("\n") == 7

        with Store.open(tmp_path / "destination.db") as destination:
            imported = read_archive(destination, path)
            assert imported.info.label == "glider run"
            assert imported.info.world_width == 64
            assert imported.info.rule == "B3/S23"
            # An imported archive is a session you can work on, not one that has
            # been put away: marking it archived would hide it from the default
            # listing of the store it was just imported into.
            assert imported.info.archived is False
            assert [info.id for info in destination.sessions(include_archived=False)] == [
                imported.id
            ]
            assert [info.generation for info in imported.generations()] == list(range(6))

            for generation in range(6):
                assert imported.state_at(generation) == session.state_at(generation), generation  # type: ignore[union-attr]
    finally:
        store.close()


def test_a_label_can_be_replaced_on_import(tmp_path: Path) -> None:
    store, session, path = build(tmp_path, steps=1)
    try:
        write_archive(session, path)  # type: ignore[arg-type]
        with Store.open(tmp_path / "relabelled.db") as destination:
            imported = read_archive(destination, path, label="imported copy")
            assert imported.info.label == "imported copy"
    finally:
        store.close()


def test_the_archive_is_text_a_person_can_read(tmp_path: Path) -> None:
    store, session, path = build(tmp_path, steps=2)
    try:
        write_archive(session, path)  # type: ignore[arg-type]
        lines = path.read_text(encoding="utf-8").splitlines()
        header = json.loads(lines[0])
        assert header["kind"] == "header"
        assert header["format"] == "lifegame-archive"
        assert header["version"] == 1
        assert header["session"]["world_width"] == 64
        first = json.loads(lines[1])
        assert first["kind"] == "generation"
        assert first["storage"] == "keyframe"
        assert first["born"] != ""
        second = json.loads(lines[2])
        assert second["storage"] == "delta"
        assert "died" in second
    finally:
        store.close()


def test_write_reports_how_many_lines_it_wrote(tmp_path: Path) -> None:
    store, session, path = build(tmp_path, steps=3)
    try:
        assert write_archive(session, path) == 4  # type: ignore[arg-type]
    finally:
        store.close()


def _write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8", newline="\n")
    return path


def _cell(*coordinates: int) -> str:
    payload = b"".join(
        int(value).to_bytes(4, "little", signed=True) for value in coordinates
    )
    return base64.b64encode(payload).decode("ascii")


def test_a_round_trip_restores_the_rule_and_the_rule_of_every_generation(
    tmp_path: Path,
) -> None:
    """Export, import, and a session that changed its rule comes back whole.

    Two things have to survive the file: the session's current rule, so a caller
    knows what to keep running, and each generation's rule, so the timeline can
    still say where the change was. A payload that carried neither would import
    as a session that cannot describe what it did.
    """
    store = Store.open(tmp_path / "rules.db")
    path = tmp_path / "two-rules.jsonl"
    try:
        world = SparseWorld(64, 64)
        world.load(GLIDER)
        session = store.create_session(world, label="two rules", representation="sparse")
        session.record(world, Change(changed=0, generation=0))
        for _ in range(3):
            session.record(world, world.advance())
        world.set_rule(LifeRule.parse(HIGHLIFE))
        session.set_rule(world.rule)
        for _ in range(3):
            session.record(world, world.advance())

        assert write_archive(session, path) == 7
        lines = path.read_text(encoding="utf-8").splitlines()
        assert json.loads(lines[0])["session"]["rule"] == HIGHLIFE
        assert json.loads(lines[0])["session"]["rule_known"] is True
        assert json.loads(lines[1])["rule"] == "B3/S23", "generation 0 ran Conway"
        assert json.loads(lines[5])["rule"] == HIGHLIFE, "generation 4 started HighLife"

        with Store.open(tmp_path / "imported.db") as destination:
            imported = read_archive(destination, path)
            assert imported.info.rule == HIGHLIFE
            assert imported.info.rule_known is True
            assert imported.rule_changes() == [(0, "B3/S23"), (4, HIGHLIFE)]
            assert [info.rule for info in imported.generations()] == (
                ["B3/S23"] * 4 + [HIGHLIFE] * 3
            )
            for generation in range(7):
                assert imported.state_at(generation) == session.state_at(generation), generation
    finally:
        store.close()


def test_an_archive_that_states_no_rule_is_imported_as_an_assumption(tmp_path: Path) -> None:
    """A file written before the rule travelled must not look like one that stated it.

    The reader fills in the default, because a session with no rule cannot answer
    anything; what it must not do is make that fill indistinguishable from a fact.
    The marking survives being written out again, which is what stops an old
    archive's guess from being promoted by a round trip through a new build.
    """
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
            "born": _cell(3, 4),
            "died": "",
        }
    )
    path = _write(tmp_path, "norule.jsonl", header + "\n" + line + "\n")

    with Store.open(tmp_path / "norule.db") as store:
        imported = read_archive(store, path)
        assert imported.info.rule == DEFAULT_RULE
        assert imported.info.rule_known is False, "the default is an assumption, not a fact"
        assert [info.rule for info in imported.generations()] == [DEFAULT_RULE]
        assert imported.state_at(0) == [(3, 4)]

        again = tmp_path / "again.jsonl"
        write_archive(imported, again)
        written = json.loads(again.read_text(encoding="utf-8").splitlines()[0])
        assert written["session"]["rule"] == DEFAULT_RULE
        assert written["session"]["rule_known"] is False
        with Store.open(tmp_path / "again.db") as second:
            restored = read_archive(second, again)
            assert restored.info.rule == DEFAULT_RULE
            assert restored.info.rule_known is False


def test_a_rule_named_by_an_archive_is_normalised_and_a_bad_one_is_refused(
    tmp_path: Path,
) -> None:
    """The file is untrusted input, so its rule is read by the world's own parser."""
    def archive(name: str, rule: object) -> Path:
        header = json.dumps(
            {
                "kind": "header",
                "format": "lifegame-archive",
                "version": 1,
                "session": {"world_width": 8, "world_height": 8, "rule": rule},
            }
        )
        return _write(tmp_path, f"{name}.jsonl", header + "\n")

    with Store.open(tmp_path / "named.db") as store:
        imported = read_archive(store, archive("normalised", "b3/s32"))
        assert imported.info.rule == "B3/S23", "a stored rule is canonical"
        assert imported.info.rule_known is True

    with (
        Store.open(tmp_path / "bad.db") as store,
        pytest.raises(ArchiveError, match="cannot read"),
    ):
        read_archive(store, archive("unreadable", "hello"))


def test_an_empty_file_is_refused(tmp_path: Path) -> None:
    path = _write(tmp_path, "empty.jsonl", "")
    with Store.open(tmp_path / "e.db") as store, pytest.raises(ArchiveError, match="is empty"):
        read_archive(store, path)


def test_a_file_without_a_header_is_refused(tmp_path: Path) -> None:
    path = _write(tmp_path, "noheader.jsonl", "not json at all\n")
    with Store.open(tmp_path / "h.db") as store, pytest.raises(ArchiveError, match="JSON header"):
        read_archive(store, path)


def test_a_foreign_format_is_refused(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "foreign.jsonl",
        json.dumps({"kind": "header", "format": "something-else", "version": 1}) + "\n",
    )
    with (
        Store.open(tmp_path / "f.db") as store,
        pytest.raises(ArchiveError, match="not a lifegame-archive"),
    ):
        read_archive(store, path)


def test_a_different_archive_version_is_refused(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "future.jsonl",
        json.dumps(
            {"kind": "header", "format": "lifegame-archive", "version": 99, "session": {}}
        )
        + "\n",
    )
    with (
        Store.open(tmp_path / "v.db") as store,
        pytest.raises(ArchiveError, match="archive version 99"),
    ):
        read_archive(store, path)


def test_a_missing_session_description_is_refused(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "nodesc.jsonl",
        json.dumps({"kind": "header", "format": "lifegame-archive", "version": 1}) + "\n",
    )
    with (
        Store.open(tmp_path / "d.db") as store,
        pytest.raises(ArchiveError, match="session description"),
    ):
        read_archive(store, path)


def test_a_malformed_generation_line_is_refused(tmp_path: Path) -> None:
    header = json.dumps(
        {
            "kind": "header",
            "format": "lifegame-archive",
            "version": 1,
            "session": {"world_width": 8, "world_height": 8},
        }
    )
    body = header + "\n" + json.dumps({"kind": "generation"}) + "\n"
    path = _write(tmp_path, "badgen.jsonl", body)
    with (
        Store.open(tmp_path / "g.db") as store,
        pytest.raises(ArchiveError, match="expected 'keyframe' or 'delta'"),
    ):
        read_archive(store, path)


def test_a_missing_archive_file_is_refused(tmp_path: Path) -> None:
    with Store.open(tmp_path / "m.db") as store, pytest.raises(ArchiveError, match="no archive at"):
        read_archive(store, tmp_path / "does-not-exist.jsonl")


def test_a_failed_import_leaves_no_half_session(tmp_path: Path) -> None:
    """A refused archive must not leave a session with no generations behind."""
    header = json.dumps(
        {
            "kind": "header",
            "format": "lifegame-archive",
            "version": 1,
            "session": {"world_width": 8, "world_height": 8},
        }
    )
    forged = '{"kind":"generation","storage":"delta","born":"zz"}\n'
    path = _write(tmp_path, "half.jsonl", header + "\n" + forged)
    with Store.open(tmp_path / "partial.db") as store:
        with pytest.raises(ArchiveError):
            read_archive(store, path)
        assert store.sessions() == [], "a failed import must roll back completely"
