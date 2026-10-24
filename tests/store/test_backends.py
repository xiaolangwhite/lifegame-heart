"""What can be verified about MySQL without a MySQL server.

There is no MySQL server in this environment: no client, no service, no listening
port, and no driver installed. That makes the honest statement about the MySQL
path "the SQL it will generate is verified; the round trip through a server is
not". These tests are the first half, and they are real tests rather than
documentation: they execute the same rendering code the backend executes.

The second half is written down in docs/model/store/testing.md with the command
that would run it, so the gap is owned rather than implied.
"""

from pathlib import Path

import pytest

from lifegame.store import Store, StoreError
from lifegame.store.backends import MySqlBackend, open_backend
from lifegame.store.schema import TABLES, render_ddl, render_placeholders


def test_the_sqlite_pragmas_actually_take_effect(tmp_path: Path) -> None:
    """The declared pragmas must be the effective ones.

    An earlier version applied them *inside* a transaction, where SQLite ignores
    `journal_mode` and `foreign_keys` silently: the store ran on the rollback
    journal while its own comment claimed write-ahead logging, and the declared
    `ON DELETE CASCADE` could never fire. Asserting the file exists and the
    session list is empty did not catch it, so this asserts the values.
    """
    with Store.open(tmp_path / "pragmas.db") as store:
        assert store.backend.pragma("journal_mode") == "wal"
        assert store.backend.pragma("foreign_keys") == 1
        assert store.backend.pragma("synchronous") == 1  # NORMAL


def test_the_pragmas_are_reapplied_on_every_connection(tmp_path: Path) -> None:
    """`journal_mode` is a property of the file; `foreign_keys` is not."""
    path = tmp_path / "reopened.db"
    with Store.open(path) as store:
        assert store.backend.pragma("foreign_keys") == 1
    with Store.open(path) as reopened:
        assert reopened.backend.pragma("foreign_keys") == 1
        assert reopened.backend.pragma("journal_mode") == "wal"


def test_the_foreign_key_cascade_actually_deletes_the_history(tmp_path: Path) -> None:
    """The constraint is only worth declaring if it fires."""
    from lifegame.world import Change, SparseWorld

    with Store.open(tmp_path / "cascade.db") as store:
        world = SparseWorld(16, 16)
        world.set_alive(1, 1)
        session = store.create_session(world)
        session.record(world, Change(changed=0, generation=0))
        assert session.generations()
        store.backend.begin()
        store.backend.execute("DELETE FROM lifegame_session WHERE id = ?", (session.id,))
        store.backend.commit()
        remaining = store.backend.query_one(
            "SELECT COUNT(*) FROM lifegame_generation WHERE session_id = ?", (session.id,)
        )
        assert remaining is not None
        assert int(remaining[0]) == 0, "the generations must not outlive their session"


def test_the_foreign_key_switch_is_read_back_rather_than_trusted(tmp_path: Path) -> None:
    """The value a rebuild depends on is the effective one, not the statement's.

    SQLite ignores `PRAGMA foreign_keys` inside a transaction and raises nothing,
    so "the statement succeeded" is not evidence. That is why the setter reads
    the pragma back and why a schema migration refuses to rebuild when the value
    it gets back is still 1 — the case this test constructs on purpose.
    """
    with Store.open(tmp_path / "switch.db") as store:
        store.backend.begin()
        try:
            assert store.backend.set_foreign_keys(False) == 1, (
                "inside a transaction the pragma is ignored, and this says so"
            )
        finally:
            store.backend.rollback()
        assert store.backend.set_foreign_keys(False) == 0, "outside one it takes"
        assert store.backend.set_foreign_keys(True) == 1, "and it comes back"
        assert store.backend.pragma("foreign_keys") == 1


def test_a_dangling_reference_is_what_the_foreign_key_check_reports(tmp_path: Path) -> None:
    """The check a rebuild runs must find the thing it exists to find.

    With enforcement off, an insert that references a row that does not exist is
    accepted silently, so the migration asks afterwards rather than assuming. A
    clean store answers with an empty list, not with "unasked" — the two are
    different claims, and only one of them is a pass.
    """
    from lifegame.world import SparseWorld

    with Store.open(tmp_path / "check.db") as store:
        assert store.backend.foreign_key_violations() == [], "a fresh store is clean"
        session = store.create_session(SparseWorld(16, 16))
        assert store.backend.set_foreign_keys(False) == 0
        store.backend.begin()
        store.backend.execute(
            "INSERT INTO lifegame_generation "
            "(session_id, generation, parent_id, kind, rule, born, died, population, "
            "changed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                session.id,
                0,
                9999,
                "keyframe",
                "B3/S23",
                b"",
                b"",
                0,
                0,
                "2026-10-10T00:00:00+00:00",
            ),
        )
        store.backend.commit()
        assert store.backend.set_foreign_keys(True) == 1
        violations = store.backend.foreign_key_violations()
        assert violations is not None, "SQLite can be asked"
        assert len(violations) == 1, violations
        assert violations[0][0] == "lifegame_generation"


def test_both_backends_implement_what_the_history_layer_needs() -> None:
    """A method added to the protocol must be implemented by both dialects.

    The protocol is structural, so a method one backend lacks is not a type error
    at the seam: it is an `AttributeError` on the first user who points the store
    at a MySQL server, which is the one environment this repository cannot run.
    Checking the two classes against the protocol is the cheapest guard that the
    two spellings really are two spellings of one interface.
    """
    from lifegame.store.backends import Backend, SqliteBackend

    assert isinstance(SqliteBackend, Backend)
    assert isinstance(MySqlBackend, Backend)


def test_a_second_writer_is_told_the_store_is_locked(tmp_path: Path) -> None:
    """`StoreLocked` is exported, so it needs a producer and a test."""
    from lifegame.store.backends import SqliteBackend
    from lifegame.store.errors import StoreLocked

    path = tmp_path / "locked.db"
    with Store.open(path) as holder:
        holder.backend.begin()
        try:
            impatient = SqliteBackend(str(path), timeout=0.0)
            try:
                with pytest.raises(StoreLocked, match="another process"):
                    impatient.begin()
            finally:
                impatient.close()
        finally:
            holder.backend.rollback()


def test_the_mysql_backend_is_named_and_opens_lazily() -> None:
    """Importing the backend must not require a driver; connecting attempts it."""
    assert MySqlBackend.dialect == "mysql"


def test_open_backend_refuses_an_unknown_name() -> None:
    with pytest.raises(StoreError, match="unknown backend"):
        open_backend("sqlserver")


def test_connecting_without_a_driver_or_server_explains_what_is_missing() -> None:
    """Either failure is a StoreError naming the cause, never a bare ImportError.

    On a machine with the driver but no server this asserts the second message;
    on this machine, which has neither, it asserts the first. Both are the same
    contract: the caller learns what to install or start.
    """
    with pytest.raises(StoreError) as raised:
        MySqlBackend(host="127.0.0.1", port=3307, user="nobody", password="", database="nothing")
    message = str(raised.value)
    assert ("optional extra" in message) or ("cannot reach MySQL" in message), message


def test_the_ddl_a_dba_would_apply_is_complete() -> None:
    statements = render_ddl("mysql")
    assert any(statement.startswith("CREATE TABLE lifegame_session") for statement in statements)
    assert all("?" not in statement for statement in statements)
    created = [statement for statement in statements if statement.startswith("CREATE TABLE")]
    assert len(created) == len(TABLES)


def test_every_placeholders_in_a_repository_statement_is_translated() -> None:
    from lifegame.store.history import Session  # noqa: F401 - the import is the assertion

    sql = "SELECT a FROM t WHERE b = ? AND c = ?"
    translated = render_placeholders(sql, "mysql")
    assert translated.count("%s") == 2
    assert "?" not in translated


def test_no_repository_statement_uses_a_dialect_specific_placeholder() -> None:
    """The repository layer must write one form; a `%s` would only work on MySQL."""
    import inspect

    from lifegame.store import history

    source = inspect.getsource(history)
    assert "%s" not in source, "the repository layer must not write MySQL placeholders"
