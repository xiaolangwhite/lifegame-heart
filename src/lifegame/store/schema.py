"""The logical schema, and its rendering for each supported dialect.

This module is the single authority for what the history layer stores. A backend
does not own a schema; it renders this one. That is what makes "SQLite now, MySQL
as well" a real statement rather than two implementations that drift: the tables,
the columns and the constraints are declared once, and each dialect supplies only
spelling.

Three decisions are baked in here rather than left to a backend:

**Every table is prefixed.** ``session`` and ``generation`` are keywords in one
dialect or another, and a prefix also says which application owns the database
when it is not the only tenant.

**Timestamps are ISO 8601 text.** Both dialects have native date types and they
disagree about time zones, precision and rounding. A text column is portable,
sortable in the format used, and readable by a person looking at the file.

**Blobs hold coordinates, not structures.** A generation's payload is the same
little-endian ``int32`` ``x``/``y`` layout the protocol's ``cells`` encoding
uses, so a stored generation and a wire frame are the same bytes and neither
needs the other's code to be understood.

**A generation states the rule that was in force for it.** Provenance is per
generation and not per session, because a session may change its rule in the
middle of its history: a timeline that cannot point at the generation where that
happened cannot describe what it recorded. The value is written on every row
rather than inherited from the row before it, so reading one node is one row
read — an inherited form would have to walk to the nearest ancestor that states
one, on the path `record` and `rollback` already walk per generation. The cost
is a few bytes per row; the alternative is a walk on the hot path.

A logical type is rendered per dialect by :meth:`Column.render`; placeholders are
written ``?`` and translated by :func:`render_placeholders`, which is the only
syntactic difference the repository code would otherwise have to know about.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

__all__ = [
    "BACKENDS",
    "CURRENT_SCHEMA_VERSION",
    "SQLITE_CONNECTION_PRAGMAS",
    "TABLES",
    "Column",
    "Table",
    "column_names",
    "now",
    "render_ddl",
    "render_placeholders",
]

CURRENT_SCHEMA_VERSION = 3

#: The dialects this module can spell. A backend names one of these.
BACKENDS = ("sqlite", "mysql")

#: Logical type to physical type, per dialect. Anything not listed is a defect.
_TYPES = {
    "sqlite": {
        "integer": "INTEGER",
        "bigint": "INTEGER",
        "text": "TEXT",
        "blob": "BLOB",
        "timestamp": "TEXT",
    },
    "mysql": {
        "integer": "INT",
        "bigint": "BIGINT",
        "text": "VARCHAR(255)",
        "blob": "LONGBLOB",
        "timestamp": "VARCHAR(32)",
    },
}

#: How each dialect spells a key its own database generates.
_AUTO = {
    "sqlite": "INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT",
    "mysql": "BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY",
}


def _check_dialect(dialect: str) -> str:
    if dialect not in BACKENDS:
        raise ValueError(f"unknown dialect {dialect!r}; expected one of {BACKENDS}")
    return dialect


def now() -> str:
    """The single spelling of a timestamp this store writes.

    It lives here, with the schema, because the stored form *is* a schema
    decision: ISO 8601 in UTC, as text, so that the two dialects cannot disagree
    about time zones, precision and rounding. Keeping it here also means the
    archive reader does not have to reach into the history implementation for a
    private helper.
    """
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass(frozen=True, slots=True)
class Column:
    """One column, described logically.

    ``auto`` marks a key the database generates. It has to be declared inline on
    the column rather than as a table constraint, because that is the only form
    both dialects accept for an auto-increment key.
    """

    name: str
    kind: str  # one of: integer, bigint, text, blob, timestamp
    constraint: str = ""
    auto: bool = False

    def render(self, dialect: str, *, inline_key: bool = False) -> str:
        _check_dialect(dialect)
        if self.auto and not inline_key:
            raise ValueError(f"column {self.name!r} is auto and must be the inline key")
        if inline_key:
            return f"{self.name} {_AUTO[dialect]}"
        physical = _TYPES[dialect][self.kind]
        suffix = f" {self.constraint}" if self.constraint else ""
        return f"{self.name} {physical}{suffix}"


@dataclass(frozen=True, slots=True)
class Table:
    """One table, described logically."""

    name: str
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...]
    foreign_keys: tuple[tuple[str, str, str], ...] = ()
    indexes: tuple[tuple[str, ...], ...] = ()

    def _inline_key(self) -> str | None:
        if len(self.primary_key) != 1:
            return None
        name = self.primary_key[0]
        column = next(column for column in self.columns if column.name == name)
        return name if column.auto else None

    def render(self, dialect: str) -> list[str]:
        _check_dialect(dialect)
        inline = self._inline_key()
        lines = [
            column.render(dialect, inline_key=column.name == inline) for column in self.columns
        ]
        if inline is None:
            lines.append(f"PRIMARY KEY ({', '.join(self.primary_key)})")
        for column, target_table, target_column in self.foreign_keys:
            lines.append(
                f"FOREIGN KEY ({column}) REFERENCES {target_table} ({target_column}) "
                "ON DELETE CASCADE"
            )
        body = ",\n    ".join(lines)
        statements = [f"CREATE TABLE {self.name} (\n    {body}\n)"]
        for index in self.indexes:
            suffix = "_".join(index)
            statements.append(
                f"CREATE INDEX {self.name}_{suffix} ON {self.name} ({', '.join(index)})"
            )
        return statements


#: The schema. Adding a column means adding a schema version and a migration.
TABLES = (
    Table(
        name="lifegame_schema",
        columns=(
            Column("version", "integer", "NOT NULL"),
            Column("applied_at", "timestamp", "NOT NULL"),
        ),
        primary_key=("version",),
    ),
    Table(
        name="lifegame_session",
        columns=(
            Column("id", "bigint", auto=True),
            Column("label", "text", "NOT NULL"),
            Column("world_width", "bigint", "NOT NULL"),
            Column("world_height", "bigint", "NOT NULL"),
            Column("rule", "text", "NOT NULL"),
            # Whether `rule` was *stated* — by the world at creation, by an
            # archive, or by `set_rule` — or assumed because nothing stated one.
            # An archive written before this column existed carries no rule at
            # all, and a store that fills in a default without recording that it
            # did so would report a guess as a fact.
            Column("rule_known", "integer", "NOT NULL DEFAULT 1"),
            Column("representation", "text", "NOT NULL"),
            Column("created_at", "timestamp", "NOT NULL"),
            Column("archived", "integer", "NOT NULL DEFAULT 0"),
            # The node the world currently corresponds to. A history is a tree
            # once recording appends a child instead of truncating, so "the
            # newest generation" is no longer a meaningful pointer.
            Column("head_id", "bigint"),
        ),
        primary_key=("id",),
    ),
    Table(
        name="lifegame_generation",
        columns=(
            Column("id", "bigint", auto=True),
            Column("session_id", "bigint", "NOT NULL"),
            Column("generation", "bigint", "NOT NULL"),
            Column("parent_id", "bigint"),
            Column("kind", "text", "NOT NULL"),
            # The rule in force at this node: the rule whose step produced it, or
            # — for a node written by an edit — the rule the world was running
            # when the edit was recorded. `lifegame_session.rule` is the rule the
            # session is on *now*; this column is what each generation ran, and
            # the two differ exactly after a rule change that has been recorded.
            Column("rule", "text", "NOT NULL"),
            Column("born", "blob"),
            Column("died", "blob"),
            Column("population", "bigint", "NOT NULL"),
            Column("changed", "bigint", "NOT NULL"),
            Column("created_at", "timestamp", "NOT NULL"),
        ),
        # Identity is the row, not the generation number: two branches may hold a
        # node with the same number, which is what a fork *is*.
        primary_key=("id",),
        foreign_keys=(
            ("session_id", "lifegame_session", "id"),
            ("parent_id", "lifegame_generation", "id"),
        ),
        indexes=(("session_id", "generation"), ("parent_id",)),
    ),
)

#: Pragmas a SQLite **connection** needs, applied immediately after connecting.
#:
#: These are connection settings, not schema: `journal_mode` is a property of the
#: file that a later connection inherits, while `foreign_keys` and `synchronous`
#: are per-connection and reset every time one is opened. They are applied
#: outside any transaction because SQLite **silently ignores** `journal_mode` and
#: `foreign_keys` inside one — it returns the old value and raises nothing, which
#: is how an earlier version of this module ran on the rollback journal while its
#: own comment claimed write-ahead logging.
SQLITE_CONNECTION_PRAGMAS = (
    "PRAGMA journal_mode = WAL",
    "PRAGMA foreign_keys = ON",
    "PRAGMA synchronous = NORMAL",
)

#: Statements a SQLite store needs before it can be used, in order.
_SQLITE_PREAMBLE = SQLITE_CONNECTION_PRAGMAS


def render_ddl(dialect: str, *, preamble: bool = True) -> list[str]:
    """Every statement needed to create the schema in ``dialect``."""
    _check_dialect(dialect)
    statements: list[str] = []
    if preamble and dialect == "sqlite":
        statements.extend(_SQLITE_PREAMBLE)
    for table in TABLES:
        statements.extend(table.render(dialect))
    return statements


def render_placeholders(sql: str, dialect: str) -> str:
    """Translate ``?`` placeholders into the dialect's spelling.

    The repository code writes one form and every backend accepts it; without
    this, every statement would need a copy per dialect and the copies would
    drift.
    """
    _check_dialect(dialect)
    return sql if dialect == "sqlite" else sql.replace("?", "%s")


def column_names(table: Table) -> Iterable[str]:
    return (column.name for column in table.columns)
