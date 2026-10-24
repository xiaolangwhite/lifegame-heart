"""Database adapters: one interface, two dialects, identical repository code.

The repository layer writes SQL with ``?`` placeholders and never learns which
database it is talking to. An adapter supplies four things: a connection, the
dialect name, placeholder translation, and transaction control.

SQLite needs no dependency and stores the whole history in one file inside the
repository, which is why it is the default. MySQL is supported because a shared
or long-lived store is a real need; its driver is an **optional** extra, so an
installation that never uses it installs nothing new.

What is verified where is stated plainly rather than implied: the SQLite path is
executed by the test suite end to end, and the MySQL path's SQL generation,
placeholder translation and schema rendering are executed by tests that need no
server. The MySQL path's *round trip* is not verified in this repository,
because no MySQL server is available here; see
docs/model/store/testing.md.
"""

from collections.abc import Iterable, Sequence
from typing import Any, Protocol, runtime_checkable

from lifegame.store.errors import StoreError, StoreLocked

__all__ = ["Backend", "MySqlBackend", "SqliteBackend", "open_backend"]

#: Driver modules the MySQL adapter will use, in order of preference. PyMySQL is
#: pure Python and therefore needs no build step; the official connector is
#: accepted because it is what many environments already have.
_MYSQL_DRIVERS = ("pymysql", "mysql.connector")


@runtime_checkable
class Backend(Protocol):
    """What the history layer needs from a database."""

    dialect: str

    def execute(self, sql: str, parameters: Sequence[Any] = ()) -> Any:
        """Run one statement and return its cursor."""

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> Any:
        """Run one statement once per row."""

    def query(self, sql: str, parameters: Sequence[Any] = ()) -> list[tuple[Any, ...]]:
        """Run a query and return every row as a plain tuple."""

    def query_one(self, sql: str, parameters: Sequence[Any] = ()) -> tuple[Any, ...] | None:
        """Run a query and return its first row, or ``None``."""

    def begin(self) -> None:
        """Start a transaction."""

    def commit(self) -> None:
        """Finish a transaction successfully."""

    def rollback(self) -> None:
        """Abandon a transaction."""

    def set_foreign_keys(self, enabled: bool) -> int:
        """Turn foreign-key enforcement on or off, and report the value in force.

        The return value is the setting **read back** from the database, not an
        acknowledgement that the statement ran: SQLite ignores both
        `foreign_keys` and `journal_mode` inside a transaction and raises
        nothing, so a statement that succeeded is not evidence that it took.
        A caller that needs enforcement off must check this value.

        This exists for the table rebuild a schema migration performs. SQLite
        implements an `ON DELETE CASCADE` as an internal trigger, and `DROP
        TABLE` with foreign keys enforced performs an implicit `DELETE FROM`
        first, so dropping a table that references itself cascades one level per
        row and fails past `SQLITE_MAX_TRIGGER_DEPTH` with "too many levels of
        trigger recursion". Enforcement is turned off around such a rebuild and
        back on afterwards, and the caller asserts both values.
        """

    def foreign_key_violations(self) -> list[tuple[Any, ...]] | None:
        """The rows that violate a declared foreign key, or ``None`` if unanswerable.

        ``[]`` means the database was asked and is clean; ``None`` means it
        cannot be asked at all. The two are different claims and are kept
        different, because a rebuild that runs with enforcement off writes rows
        the database never checked.
        """

    def close(self) -> None:
        """Release the connection."""


class SqliteBackend:
    """The default backend: one file, no dependency, standard library only."""

    dialect = "sqlite"

    def __init__(self, path: str, *, timeout: float = 5.0) -> None:
        import sqlite3

        from lifegame.store.schema import SQLITE_CONNECTION_PRAGMAS

        self._sqlite3 = sqlite3
        self.path = path
        try:
            self._connection = sqlite3.connect(path, isolation_level=None, timeout=timeout)
        except sqlite3.OperationalError as exc:  # pragma: no cover - depends on the filesystem
            raise StoreError(f"cannot open the store at {path}: {exc}") from exc
        self._connection.row_factory = None
        # Immediately, and outside any transaction: SQLite silently ignores
        # `journal_mode` and `foreign_keys` inside one. These are per-connection
        # settings, so a later connection has to apply them again.
        self._apply_pragmas(SQLITE_CONNECTION_PRAGMAS)

    def _apply_pragmas(self, pragmas: Iterable[str]) -> None:
        for pragma in pragmas:
            try:
                self._connection.execute(pragma)
            except self._sqlite3.DatabaseError as exc:
                raise StoreError(f"cannot apply {pragma!r} to {self.path}: {exc}") from exc

    def pragma(self, name: str) -> Any:
        """Read a pragma's effective value, which is what a test has to assert."""
        row = self._connection.execute(f"PRAGMA {name}").fetchone()
        return None if row is None else row[0]

    def set_foreign_keys(self, enabled: bool) -> int:
        """Set `foreign_keys` and read it back; see :meth:`Backend.set_foreign_keys`."""
        self._connection.execute(f"PRAGMA foreign_keys = {'ON' if enabled else 'OFF'}")
        value = self.pragma("foreign_keys")
        return 0 if value is None else int(value)

    def foreign_key_violations(self) -> list[tuple[Any, ...]]:
        """`PRAGMA foreign_key_check`: one row per dangling reference, if any."""
        return self.query("PRAGMA foreign_key_check")

    def execute(self, sql: str, parameters: Sequence[Any] = ()) -> Any:
        return self._connection.execute(sql, tuple(parameters))

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> Any:
        return self._connection.executemany(sql, [tuple(row) for row in rows])

    def query(self, sql: str, parameters: Sequence[Any] = ()) -> list[tuple[Any, ...]]:
        return [tuple(row) for row in self._connection.execute(sql, tuple(parameters))]

    def query_one(self, sql: str, parameters: Sequence[Any] = ()) -> tuple[Any, ...] | None:
        cursor = self._connection.execute(sql, tuple(parameters))
        row = cursor.fetchone()
        return None if row is None else tuple(row)

    def script(self, statements: Iterable[str]) -> None:
        """Run a sequence of DDL statements on the connection, without committing.

        The caller owns the transaction: `_rebuild_tables` runs this inside the
        one transaction the whole rebuild is, because a `DROP TABLE` that
        committed on its own would leave a half-migrated store behind if the
        statements after it failed.
        """
        for statement in statements:
            self._connection.execute(statement)

    def begin(self) -> None:
        try:
            self._connection.execute("BEGIN IMMEDIATE")
        except self._sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                raise StoreLocked(
                    f"another process is writing {self.path}: {exc}"
                ) from exc
            raise

    def commit(self) -> None:
        self._connection.execute("COMMIT")

    def rollback(self) -> None:
        self._connection.execute("ROLLBACK")

    def close(self) -> None:
        self._connection.close()


class MySqlBackend:
    """A shared store, when one is wanted. Needs an optional driver and a server.

    The connection is opened lazily by the driver module so that importing this
    class never fails on an installation without the extra, and so that the
    error a user sees names what to install.
    """

    dialect = "mysql"

    def __init__(
        self,
        *,
        host: str = "127.0.0.1",
        port: int = 3306,
        user: str = "lifegame",
        password: str = "",
        database: str = "lifegame",
        connect_timeout: float = 5.0,
    ) -> None:
        self._driver = _import_mysql_driver()
        self._settings = {
            "host": host,
            "port": int(port),
            "user": user,
            "password": password,
            "database": database,
        }
        self._connect_timeout = connect_timeout
        self._connection = self._connect()

    def _connect(self) -> Any:
        try:
            return self._driver.connect(
                connect_timeout=self._connect_timeout,
                autocommit=False,
                **self._settings,
            )
        except Exception as exc:  # noqa: BLE001 - the driver's exception hierarchy varies
            raise StoreError(
                f"cannot reach MySQL at {self._settings['host']}:{self._settings['port']}: {exc}"
            ) from exc

    def _cursor(self) -> Any:
        return self._connection.cursor()

    def execute(self, sql: str, parameters: Sequence[Any] = ()) -> Any:
        from lifegame.store.schema import render_placeholders

        cursor = self._cursor()
        cursor.execute(render_placeholders(sql, self.dialect), tuple(parameters))
        return cursor

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> Any:
        from lifegame.store.schema import render_placeholders

        cursor = self._cursor()
        cursor.executemany(
            render_placeholders(sql, self.dialect),
            [tuple(row) for row in rows],
        )
        return cursor

    def query(self, sql: str, parameters: Sequence[Any] = ()) -> list[tuple[Any, ...]]:
        cursor = self.execute(sql, parameters)
        rows = [tuple(row) for row in cursor.fetchall()]
        cursor.close()
        return rows

    def query_one(self, sql: str, parameters: Sequence[Any] = ()) -> tuple[Any, ...] | None:
        rows = self.query(sql, parameters)
        return rows[0] if rows else None

    def script(self, statements: Iterable[str]) -> None:
        for statement in statements:
            self.execute(statement)

    def begin(self) -> None:
        self._connection.begin()

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    def set_foreign_keys(self, enabled: bool) -> int:
        """MySQL's spelling of the same switch, read back from its session variable."""
        self.execute(f"SET foreign_key_checks = {1 if enabled else 0}")
        row = self.query_one("SELECT @@foreign_key_checks")
        return 0 if row is None else int(row[0])

    def foreign_key_violations(self) -> list[tuple[Any, ...]] | None:
        """``None``: MySQL is not asked, because it has no offline check.

        InnoDB validates a row against its foreign keys as it is written, and
        there is no MySQL statement that re-examines rows already stored the way
        SQLite's `PRAGMA foreign_key_check` does. A rebuild that ran with
        `foreign_key_checks = 0` therefore cannot be verified after the fact, and
        this says so rather than returning an empty list that would read as
        "checked and clean". The gap is part of STO-01: no MySQL server exists in
        this environment, so this path is unexecuted either way.
        """
        return None

    def close(self) -> None:
        self._connection.close()


def _import_mysql_driver() -> Any:
    """Find a MySQL driver, or explain how to get one."""
    import importlib

    for name in _MYSQL_DRIVERS:
        try:
            return importlib.import_module(name)
        except ImportError:
            continue
    raise StoreError(
        "the mysql backend needs a driver: install the optional extra with "
        '`uv sync --extra mysql`, which provides pymysql'
    )


def open_backend(
    backend: str,
    *,
    path: str | None = None,
    **options: Any,
) -> Backend:
    """Build the named backend. ``sqlite`` is the default everywhere."""
    if backend == "sqlite":
        if not path:
            raise StoreError("the sqlite backend needs a path")
        return SqliteBackend(path, **options)
    if backend == "mysql":
        return MySqlBackend(**options)
    raise StoreError(f"unknown backend {backend!r}; expected 'sqlite' or 'mysql'")
