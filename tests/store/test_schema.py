"""The schema is one authority rendered twice, so both renderings are checked.

These tests need no database. That matters: the MySQL path cannot be executed in
this repository because no server exists here, and the parts of it that *can* be
executed — the SQL it will send — are executed here rather than described.
"""

import pytest

from lifegame.store.schema import (
    BACKENDS,
    CURRENT_SCHEMA_VERSION,
    TABLES,
    Column,
    Table,
    render_ddl,
    render_placeholders,
)


def test_both_dialects_are_spelled() -> None:
    assert BACKENDS == ("sqlite", "mysql")


def test_an_unknown_dialect_is_refused_rather_than_guessed() -> None:
    with pytest.raises(ValueError, match="unknown dialect"):
        render_ddl("postgres")
    with pytest.raises(ValueError, match="unknown dialect"):
        render_placeholders("SELECT 1", "postgres")


def test_every_table_is_prefixed() -> None:
    """`session` and `generation` are keywords somewhere; a prefix also owns them."""
    for table in TABLES:
        assert table.name.startswith("lifegame_"), table.name


def test_sqlite_ddl_covers_every_table() -> None:
    statements = render_ddl("sqlite")
    joined = "\n".join(statements)
    for table in TABLES:
        assert f"CREATE TABLE {table.name}" in joined, table.name
    assert "PRAGMA journal_mode = WAL" in joined
    assert "PRAGMA foreign_keys = ON" in joined


def test_mysql_ddl_covers_every_table_and_uses_mysql_types() -> None:
    joined = "\n".join(render_ddl("mysql"))
    for table in TABLES:
        assert f"CREATE TABLE {table.name}" in joined, table.name
    assert "LONGBLOB" in joined
    assert "VARCHAR(255)" in joined
    assert "AUTO_INCREMENT" in joined
    # The preamble is SQLite's; MySQL must not receive PRAGMA statements.
    assert "PRAGMA" not in joined
    # And MySQL must never see a `?` placeholder in DDL.
    assert "?" not in joined


def test_the_auto_key_is_declared_inline_and_only_once() -> None:
    """An auto-increment key is only accepted inline, and a second key is an error."""
    sqlite = "\n".join(render_ddl("sqlite"))
    assert "id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT" in sqlite
    assert sqlite.count("PRIMARY KEY (id)") == 0
    mysql = "\n".join(render_ddl("mysql"))
    assert "id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY" in mysql
    assert mysql.count("PRIMARY KEY (id)") == 0


def test_a_generation_is_identified_by_its_own_row() -> None:
    """Two branches may hold a node with the same generation number.

    Identity moved from the `(session, generation)` pair to the row when the
    history became a tree: a fork is exactly two nodes that share a number. A
    composite key would have made a branch impossible to store.
    """
    joined = "\n".join(render_ddl("sqlite"))
    assert "PRIMARY KEY (session_id, generation)" not in joined
    assert "parent_id" in joined
    assert "PRIMARY KEY (id)" not in joined, "the row key is declared inline"
    assert joined.count("PRIMARY KEY AUTOINCREMENT") == 2  # sessions and generations


def test_the_session_points_at_the_node_the_world_is_on() -> None:
    """Recording appends a child, so "the newest generation" is not a pointer."""
    joined = "\n".join(render_ddl("sqlite"))
    assert "head_id" in joined


def test_the_session_id_is_a_bigint_on_mysql_and_integer_on_sqlite() -> None:
    mysql = "\n".join(render_ddl("mysql"))
    assert "world_width BIGINT" in mysql
    sqlite = "\n".join(render_ddl("sqlite"))
    assert "world_width INTEGER" in sqlite


def test_timestamps_are_text_in_both_dialects() -> None:
    """Both dialects have date types and they disagree; text does not."""
    for dialect in BACKENDS:
        joined = "\n".join(render_ddl(dialect))
        assert "created_at" in joined
        assert "DATETIME" not in joined.upper()


def test_placeholders_are_translated_only_for_mysql() -> None:
    sql = "SELECT 1 FROM t WHERE a = ? AND b = ?"
    assert render_placeholders(sql, "sqlite") == sql
    assert render_placeholders(sql, "mysql") == "SELECT 1 FROM t WHERE a = %s AND b = %s"


def test_an_auto_column_outside_the_key_is_a_defect_not_a_quiet_success() -> None:
    column = Column("id", "bigint", auto=True)
    with pytest.raises(ValueError, match="inline key"):
        column.render("sqlite")


def test_an_index_is_rendered_for_every_declared_index() -> None:
    table = Table(
        name="lifegame_example",
        columns=(Column("a", "integer", "NOT NULL"), Column("b", "integer", "NOT NULL")),
        primary_key=("a", "b"),
        indexes=(("a",), ("a", "b")),
    )
    statements = table.render("sqlite")
    assert "CREATE INDEX lifegame_example_a ON lifegame_example (a)" in statements
    assert "CREATE INDEX lifegame_example_a_b ON lifegame_example (a, b)" in statements


def test_the_schema_version_is_a_positive_integer() -> None:
    assert isinstance(CURRENT_SCHEMA_VERSION, int)
    assert CURRENT_SCHEMA_VERSION >= 1
