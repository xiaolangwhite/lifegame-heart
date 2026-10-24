"""Sessions, generations, rollback and archives.

The model
---------
A **session** is one world's history: the world's size, its rule, the
representation it was recorded from, and a chain of generations. A
**generation** is stored either as a *keyframe* — every live cell — or as a
*delta* — the cells that were born and the cells that died relative to the
generation before it.

The rule is stored twice on purpose, because the two answer different questions.
The **session's** rule is the rule the session is running now: what a listing, a
reopened archive and a query report, updated by :meth:`Session.set_rule` as the
world's rule changes. The **generation's** rule is the rule that was in force
for that generation: what a timeline needs, because one session may be stepped
under Conway, switched, and stepped again, and every generation then has to be
attributable to the rule that made it. A change therefore appears in the data as
a generation whose rule differs from its parent's, and
:meth:`Session.rule_changes` reports exactly those points.

Replay does **not** re-run the rule. A stored delta says which cells were born
and which died, so a rollback is a set operation and the rule takes no part in
it — which is why a history recorded across a rule change still replays exactly,
and why the rule columns are provenance rather than a step a rollback performs.

Deltas are the point. A Life generation usually changes a small fraction of its
population, so a delta is a few dozen bytes where a keyframe is eight bytes per
live cell. A chain of deltas is therefore cheap to store and cheap to walk, and
a keyframe every :data:`KEYFRAME_INTERVAL` generations bounds how far a rollback
has to walk.

Rolling back to generation *g* loads the newest keyframe at or before *g* and
replays the deltas forward. Replaying *forward* rather than inverting backward is
deliberate: a delta is a statement about what happened, so it can be verified as
it is replayed — the cells that die must be alive and the cells that are born
must be dead — and a corrupted chain is caught at the point of corruption rather
than producing a plausible wrong world.

What this layer does not do
---------------------------
It does not decide *when* to record. A consumer that steps ten generations and
records once has a ten-generation gap; the store notices, and stores a keyframe
rather than a delta that would silently claim to be relative to a generation it
never saw. A gap-free timeline costs one `advance` per generation, which is
exactly the cost of the feature.
"""

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np

from lifegame.store.backends import Backend, open_backend
from lifegame.store.delta import decode_cells, encode_cells
from lifegame.store.errors import SessionNotFound, StoreError
from lifegame.store.schema import CURRENT_SCHEMA_VERSION, now, render_ddl
from lifegame.world.rules import CONWAY, LifeRule

__all__ = [
    "ARCHIVE_FORMAT",
    "DEFAULT_RULE",
    "KEYFRAME_INTERVAL",
    "GenerationInfo",
    "NodeInfo",
    "Session",
    "SessionInfo",
    "Store",
]

#: How many generations may sit between two keyframes. Bounds the replay work a
#: rollback does, and bounds how much of a chain a single corruption can affect.
KEYFRAME_INTERVAL = 64

#: The archive file's `format` field, and the version this module writes.
ARCHIVE_FORMAT = "lifegame-archive"
ARCHIVE_VERSION = 1

#: The rule this layer attributes to a session, a generation or an archive that
#: states none. The notation is taken from the world's own authority rather than
#: spelled again here, so the default cannot drift from the rule it names.
DEFAULT_RULE = CONWAY.notation


def normalize_rule(rule: Any) -> str:
    """The canonical text of one rule, however the caller holds it.

    Accepts a rule object — anything with a ``notation`` — or the text itself.
    Text is parsed by the world's own parser, so a store cannot hold a spelling
    the simulation would refuse and so that ``b3/s32`` and ``B3/S23`` are one
    stored rule rather than two. Raises ``ValueError`` naming the single fault.
    """
    if isinstance(rule, str):
        return LifeRule.parse(rule).notation
    notation = getattr(rule, "notation", None)
    if not isinstance(notation, str) or not notation:
        raise ValueError(f"a rule must be a string such as B3/S23, got {type(rule).__name__}")
    return notation


@dataclass(frozen=True, slots=True)
class SessionInfo:
    """A session's identity and provenance, without its history."""

    id: int
    label: str
    world_width: int
    world_height: int
    rule: str
    #: ``False`` when nothing stated the session's rule and ``rule`` is the
    #: default this layer put in its place. An imported archive with no rule in
    #: its header is the case this exists for: a guess is not a fact.
    rule_known: bool
    representation: str
    created_at: str
    archived: bool


def _now() -> str:  # pragma: no cover - replaced by schema.now; kept for clarity
    return now()


@dataclass(frozen=True, slots=True)
class _Generation:
    """The least a `record` call needs when it is storing a keyframe.

    `record` reads only `generation` on that path, so passing a change record
    would mean importing the world's change type into the store for one field —
    and the store is deliberately built on the *shape* of what the world reports
    rather than on its types.
    """

    generation: int


@dataclass(frozen=True, slots=True)
class _OldSession:
    """One session as an older schema stored it, before it is rebuilt."""

    id: int
    label: str
    world_width: int
    world_height: int
    rule: str
    representation: str
    created_at: str
    archived: int
    head_id: int | None


@dataclass(frozen=True, slots=True)
class _OldGeneration:
    """One generation as an older schema stored it, before it is rebuilt."""

    id: int
    session_id: int
    generation: int
    parent_id: int | None
    kind: str
    born: bytes
    died: bytes
    population: int
    changed: int
    created_at: str


@dataclass(frozen=True, slots=True)
class NodeInfo:
    """One node of a recorded history.

    A history is a tree: a node knows its parent, and two nodes may carry the
    same generation number when they descend from a common ancestor. The number
    is a label for a person; the id is the identity.
    """

    id: int
    generation: int
    parent_id: int | None
    kind: str
    #: The rule in force at this node: the rule whose step produced it, or — for
    #: a node an edit wrote — the rule the world was running when it was written.
    rule: str
    population: int
    changed: int
    created_at: str
    born: int
    died: int

    @property
    def is_keyframe(self) -> bool:
        return self.kind == "keyframe"


@dataclass(frozen=True, slots=True)
class GenerationInfo:
    """One recorded generation, without its payload."""

    generation: int
    kind: str
    #: The rule in force for this generation; see :class:`NodeInfo`.
    rule: str
    population: int
    changed: int
    created_at: str
    born: int
    died: int

    @property
    def is_keyframe(self) -> bool:
        return self.kind == "keyframe"


class Store:
    """An open history database."""

    def __init__(self, backend: Backend, *, repair_dangling: bool = False) -> None:
        self._backend = backend
        self._closed = False
        self._repair_dangling = repair_dangling
        #: The rows whose parent link named no row and was cleared during this
        #: open's migration. Empty unless `open(repair_dangling=True)` was used.
        self.repaired_dangling: tuple[int, ...] = ()
        self._ensure_schema()

    # -- lifecycle --------------------------------------------------------

    @classmethod
    def open(
        cls,
        path: str | Path | None = None,
        *,
        backend: str = "sqlite",
        repair_dangling: bool = False,
        **options: Any,
    ) -> Store:
        """Open, or create, a store.

        ``sqlite`` is the default and takes a path; ``mysql`` takes connection
        options and is described in :mod:`lifegame.store.backends`.

        ``repair_dangling`` changes what a **migration** does with a row whose
        parent link names no row: the default refuses the whole migration, and
        ``True`` clears that link and records the row ids in
        :attr:`Store.repaired_dangling`. The default is the safe answer for a
        store opened in place; :func:`salvage` is the path a person uses on a
        damaged file, and it works on a copy.
        """
        if backend == "sqlite" and path is None:
            raise StoreError("opening a sqlite store needs a path")
        if path is not None and backend == "sqlite":
            parent = Path(path).parent
            parent.mkdir(parents=True, exist_ok=True)
        handle = open_backend(backend, path=None if path is None else str(path), **options)
        try:
            return cls(handle, repair_dangling=repair_dangling)
        except Exception:
            handle.close()
            raise

    @property
    def backend(self) -> Backend:
        return self._backend

    @property
    def dialect(self) -> str:
        return self._backend.dialect

    def close(self) -> None:
        if not self._closed:
            self._backend.close()
            self._closed = True

    def __enter__(self) -> Store:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # -- schema -----------------------------------------------------------

    def _ensure_schema(self) -> None:
        found = self._existing_schema_version()
        if found is None:
            self._create_schema()
            return
        if found > CURRENT_SCHEMA_VERSION:
            raise StoreError(
                f"the store has schema version {found}, and this build understands "
                f"{CURRENT_SCHEMA_VERSION}; a newer build wrote it"
            )
        if found < CURRENT_SCHEMA_VERSION:
            self._migrate(found, repair_dangling=self._repair_dangling)

    def _migrate(self, from_version: int, *, repair_dangling: bool = False) -> None:
        """Bring an older store up to the current schema.

        Written as read-rebuild-write rather than as a sequence of `ALTER TABLE`
        statements, because neither change is additive. Schema 1 identified a
        generation by its `(session, generation)` pair and had no head: identity
        moved to the row, since two branches may now hold a node with the same
        number. Schema 2 had no rule provenance, and the columns that carry it
        are `NOT NULL`, so every existing row needs a value the schema can
        defend. Rebuilding is one code path that both dialects accept, where an
        in-place column change is a different dance per database.

        The whole history is held in memory while it happens. That is acceptable
        for a one-off migration of a store that is measured in generations rather
        than gigabytes, and it is stated here because it is the reason a very
        large store needs room to migrate.

        **What the migration cannot know.** Schema 2 recorded one rule per
        session — the rule the world was running when the session was created —
        and nothing per generation; `set_rule` did not update it. There is
        therefore no evidence of what an old session ran after a rule change, and
        this migration attributes that recorded rule to *every* generation of the
        session. For a session that never changed its rule that is exact. For one
        that did, the generations after the change are labelled with the rule the
        session started on, and the change point is not recoverable: the
        uncertainty is written here rather than hidden in a column default, and
        removing it from every session recorded from now on is what schema 3 is
        for.

        A session whose stored rule is empty — which is what a schema-2 build
        wrote when it imported an archive whose header named no rule — is given
        the default rule and `rule_known = 0`, so the guess stays visible.
        """
        if from_version == 1:
            sessions, generations = self._read_schema_one()
        elif from_version == 2:
            sessions, generations = self._read_schema_two()
        else:
            raise StoreError(
                f"the store has schema version {from_version} and needs migration to "
                f"{CURRENT_SCHEMA_VERSION}, which no version has implemented"
            )
        self._rebuild_tables(sessions, generations, repair_dangling=repair_dangling)

    def _read_schema_one(self) -> tuple[list[_OldSession], list[_OldGeneration]]:
        """Read a schema-1 store: a chain per session, no head, no parent links."""
        session_rows = self._backend.query(
            "SELECT id, label, world_width, world_height, rule, representation, "
            "created_at, archived FROM lifegame_session ORDER BY id"
        )
        generation_rows = self._backend.query(
            "SELECT session_id, generation, kind, born, died, population, changed, "
            "created_at FROM lifegame_generation ORDER BY session_id, generation"
        )
        generations: list[_OldGeneration] = []
        previous_by_session: dict[int, int] = {}
        head_by_session: dict[int, int] = {}
        for row in generation_rows:
            session_id = int(row[0])
            node_id = len(generations) + 1
            generations.append(
                _OldGeneration(
                    id=node_id,
                    session_id=session_id,
                    generation=int(row[1]),
                    # Schema 1 had no parent column. The generation immediately
                    # before this one in the same session is the parent the tree
                    # needs, and the order the query asked for is what makes
                    # "before" mean anything.
                    parent_id=previous_by_session.get(session_id),
                    kind=str(row[2]),
                    born=bytes(row[3] or b""),
                    died=bytes(row[4] or b""),
                    population=int(row[5]),
                    changed=int(row[6]),
                    created_at=str(row[7]),
                )
            )
            previous_by_session[session_id] = node_id
            head_by_session[session_id] = node_id
        sessions = [
            _OldSession(
                id=int(row[0]),
                label=str(row[1]),
                world_width=int(row[2]),
                world_height=int(row[3]),
                rule=str(row[4]),
                representation=str(row[5]),
                created_at=str(row[6]),
                archived=int(row[7]),
                # Schema 1 had no head; the newest generation is the only
                # working point it can be said to have had.
                head_id=head_by_session.get(int(row[0])),
            )
            for row in session_rows
        ]
        return sessions, generations

    def _read_schema_two(self) -> tuple[list[_OldSession], list[_OldGeneration]]:
        """Read a schema-2 store, which already has row identity, parents and a head."""
        session_rows = self._backend.query(
            "SELECT id, label, world_width, world_height, rule, representation, "
            "created_at, archived, head_id FROM lifegame_session ORDER BY id"
        )
        generation_rows = self._backend.query(
            "SELECT id, session_id, generation, parent_id, kind, born, died, population, "
            "changed, created_at FROM lifegame_generation ORDER BY id"
        )
        generations = [
            _OldGeneration(
                id=int(row[0]),
                session_id=int(row[1]),
                generation=int(row[2]),
                parent_id=None if row[3] is None else int(row[3]),
                kind=str(row[4]),
                born=bytes(row[5] or b""),
                died=bytes(row[6] or b""),
                population=int(row[7]),
                changed=int(row[8]),
                created_at=str(row[9]),
            )
            for row in generation_rows
        ]
        # A head that names no node is not a working point. Schema 2 declared no
        # foreign key on `head_id`, so one could be stored; the newest node of
        # that session is the only honest replacement.
        existing = {node.id for node in generations}
        newest: dict[int, int] = {}
        for node in generations:
            newest[node.session_id] = node.id
        sessions = []
        for row in session_rows:
            session_id = int(row[0])
            stored_head = None if row[8] is None else int(row[8])
            sessions.append(
                _OldSession(
                    id=session_id,
                    label=str(row[1]),
                    world_width=int(row[2]),
                    world_height=int(row[3]),
                    rule=str(row[4]),
                    representation=str(row[5]),
                    created_at=str(row[6]),
                    archived=int(row[7]),
                    head_id=stored_head if stored_head in existing else newest.get(session_id),
                )
            )
        return sessions, generations

    def _rebuild_tables(
        self,
        sessions: list[_OldSession],
        generations: list[_OldGeneration],
        *,
        repair_dangling: bool = False,
    ) -> None:
        """Write a read history into the current schema, in one transaction.

        The order is the one SQLite documents for changing a table's shape
        ("Making Other Kinds Of Table Schema Changes"): foreign keys are turned
        **off**, outside any transaction; the rebuild runs in one transaction;
        the result is checked; enforcement is turned back on.

        The first step is the reason this method exists. SQLite implements an
        `ON DELETE CASCADE` as an internal trigger, and `DROP TABLE` with foreign
        keys enforced performs an implicit `DELETE FROM` first so that the
        deletes a dropped table would have caused still happen.
        `lifegame_generation.parent_id` references its own table, so that
        implicit delete walks the parent chain one level per row, and a chain
        deeper than `SQLITE_MAX_TRIGGER_DEPTH` (1000, unless the build raised it)
        fails with "too many levels of trigger recursion". A real schema-2 store
        whose deepest history is 1300 nodes therefore could not be opened at all.
        With enforcement off no cascade is attempted and the depth of a chain
        cannot decide whether a store migrates. The value is **read back** rather
        than trusted, because SQLite silently ignores `foreign_keys` inside a
        transaction, and this migration refuses to run if it is not actually off.

        The rebuild writes rows the database does not check while enforcement is
        off, so it asks afterwards whether the result holds any dangling
        reference and rolls the whole thing back if it does. A store whose own
        data already violated its declared keys is refused rather than imported
        as a tree whose parent links point at nothing.

        Both the rebuild and the check are inside the one transaction, and
        enforcement is restored on every path, so a migration that fails leaves
        the file, the schema version and the connection exactly as they were.
        What the migration cannot know about an old session's rules is stated
        once, in :meth:`_migrate`.
        """
        # The rule every generation of a session is labelled with, and whether
        # that label is what the session recorded or the default put in its
        # place. Both come from the session row, because nothing else survived.
        rules = {session.id: (session.rule.strip() or DEFAULT_RULE) for session in sessions}
        known = {session.id: bool(session.rule.strip()) for session in sessions}

        # Outside any transaction, and checked: inside one SQLite ignores the
        # pragma and says nothing.
        if self._backend.set_foreign_keys(False) != 0:
            raise StoreError(
                "refusing to rebuild the schema while foreign keys are enforced: "
                "SQLite ignores PRAGMA foreign_keys inside a transaction, so the "
                "setting this rebuild needs could not be established"
            )
        try:
            self._backend.begin()
            try:
                for table in ("lifegame_generation", "lifegame_session", "lifegame_schema"):
                    self._backend.execute(f"DROP TABLE IF EXISTS {table}")
                script = getattr(self._backend, "script", None)
                statements = render_ddl(self.dialect, preamble=False)
                if script is not None:
                    script(statements)
                else:  # pragma: no cover - every shipped backend has `script`
                    for statement in statements:
                        self._backend.execute(statement)

                # Sessions first, with no head: the generations they own do not
                # exist yet, and the foreign key would refuse them the other way
                # round. Nothing is checked while enforcement is off, which is
                # why the order still matters.
                for session in sessions:
                    self._backend.execute(
                        "INSERT INTO lifegame_session "
                        "(id, label, world_width, world_height, rule, rule_known, "
                        "representation, created_at, archived, head_id) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            session.id,
                            session.label,
                            session.world_width,
                            session.world_height,
                            rules[session.id],
                            1 if known[session.id] else 0,
                            session.representation,
                            session.created_at,
                            session.archived,
                            None,
                        ),
                    )

                known_ids = {node.id for node in generations}
                repaired: list[int] = []
                for node in generations:
                    parent_id = node.parent_id
                    if parent_id is not None and parent_id not in known_ids and repair_dangling:
                        parent_id = None
                        repaired.append(node.id)
                    self._backend.execute(
                        "INSERT INTO lifegame_generation "
                        "(id, session_id, generation, parent_id, kind, rule, born, died, "
                        "population, changed, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            node.id,
                            node.session_id,
                            node.generation,
                            parent_id,
                            node.kind,
                            rules.get(node.session_id, DEFAULT_RULE),
                            node.born,
                            node.died,
                            node.population,
                            node.changed,
                            node.created_at,
                        ),
                    )

                for session in sessions:
                    if session.head_id is not None:
                        self._backend.execute(
                            "UPDATE lifegame_session SET head_id = ? WHERE id = ?",
                            (session.head_id, session.id),
                        )
                self._backend.execute(
                    "INSERT INTO lifegame_schema (version, applied_at) VALUES (?, ?)",
                    (CURRENT_SCHEMA_VERSION, now()),
                )
                violations = self._backend.foreign_key_violations()
                if violations:
                    raise StoreError(
                        f"the rebuilt store would hold {len(violations)} foreign-key "
                        f"violation(s), the first being {tuple(violations[0])}; the "
                        "migration was rolled back and the store is unchanged"
                    )
                self._backend.commit()
                # Only after the commit: a rolled-back rebuild repaired nothing.
                self.repaired_dangling = tuple(repaired)
            except Exception:
                self._backend.rollback()
                raise
        finally:
            enforced = self._backend.set_foreign_keys(True)
        if enforced != 1:
            # Only reached when the rebuild succeeded: an exception in flight
            # propagates instead, which is why the value is asserted here rather
            # than inside the `finally` that would swallow it.
            raise StoreError(
                "the migration finished but foreign-key enforcement did not come "
                "back on; close and reopen the store"
            )

    def _existing_schema_version(self) -> int | None:
        try:
            row = self._backend.query_one(
                "SELECT version FROM lifegame_schema ORDER BY version DESC",
            )
        except Exception:  # noqa: BLE001 - the table not existing is the normal first run
            return None
        return None if row is None else int(row[0])

    def _create_schema(self) -> None:
        """Create the tables in one transaction.

        No pragmas are applied here. They belong to the connection and the
        backend sets them when it opens one, because SQLite ignores
        `journal_mode` and `foreign_keys` inside a transaction and this method
        runs inside one.
        """
        statements = render_ddl(self.dialect, preamble=False)
        self._backend.begin()
        try:
            script = getattr(self._backend, "script", None)
            if script is not None:
                script(statements)
            else:  # pragma: no cover - every shipped backend has `script`
                for statement in statements:
                    self._backend.execute(statement)
            self._backend.execute(
                "INSERT INTO lifegame_schema (version, applied_at) VALUES (?, ?)",
                (CURRENT_SCHEMA_VERSION, now()),
            )
            self._backend.commit()
        except Exception:
            self._backend.rollback()
            raise

    # -- sessions ---------------------------------------------------------

    def create_session(
        self,
        world: Any,
        *,
        label: str = "",
        representation: str = "sparse",
    ) -> Session:
        """Start recording a world. The world itself is not copied yet."""
        created = now()
        self._backend.begin()
        try:
            cursor = self._backend.execute(
                "INSERT INTO lifegame_session "
                "(label, world_width, world_height, rule, rule_known, representation, "
                "created_at, archived) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    label,
                    int(world.width),
                    int(world.height),
                    world.rule.notation,
                    # The world states its rule, so nothing here is a guess.
                    1,
                    representation,
                    created,
                    0,
                ),
            )
            session_id = int(getattr(cursor, "lastrowid", 0) or 0)
            if session_id == 0:
                row = self._backend.query_one("SELECT MAX(id) FROM lifegame_session")
                session_id = int(row[0]) if row and row[0] is not None else 0
            self._backend.commit()
        except Exception:
            self._backend.rollback()
            raise
        if session_id == 0:
            raise StoreError("the database did not report an id for the new session")
        return Session(self, self._session_info(session_id))

    def sessions(self, *, include_archived: bool = True) -> list[SessionInfo]:
        sql = (
            "SELECT id, label, world_width, world_height, rule, rule_known, representation, "
            "created_at, archived FROM lifegame_session"
        )
        if not include_archived:
            sql += " WHERE archived = 0"
        sql += " ORDER BY id"
        return [self._to_session_info(row) for row in self._backend.query(sql)]

    def session(self, session_id: int) -> Session:
        return Session(self, self._session_info(session_id))

    def _session_info(self, session_id: int) -> SessionInfo:
        row = self._backend.query_one(
            "SELECT id, label, world_width, world_height, rule, rule_known, representation, "
            "created_at, archived FROM lifegame_session WHERE id = ?",
            (session_id,),
        )
        if row is None:
            raise SessionNotFound(f"no session with id {session_id}")
        return self._to_session_info(row)

    @staticmethod
    def _to_session_info(row: tuple[Any, ...]) -> SessionInfo:
        return SessionInfo(
            id=int(row[0]),
            label=str(row[1]),
            world_width=int(row[2]),
            world_height=int(row[3]),
            rule=str(row[4]),
            rule_known=bool(row[5]),
            representation=str(row[6]),
            created_at=str(row[7]),
            archived=bool(row[8]),
        )

    # -- whole-store operations -------------------------------------------

    def import_archive(self, path: str | Path, *, label: str | None = None) -> Session:
        """Read a portable archive back into this store as a new session."""
        from lifegame.store.archive import read_archive

        return read_archive(self, path, label=label)


def salvage(source: str | Path, target: str | Path) -> Store:
    """Copy a damaged old store to a new file, clearing dangling parent links.

    The copy is made with SQLite's own `VACUUM INTO`, which reads a consistent
    snapshot rather than three files that may be mid-write. The source is opened
    read-only and is never modified: a person's only copy of a history is the
    thing this function must not put at risk, which is why it does not open the
    source with ``repair_dangling`` and migrate it where it lies.

    The returned store is open on ``target``, and its
    :attr:`Store.repaired_dangling` names the rows whose link was cleared. A row
    whose link was cleared starts a branch: if it was a delta then that branch
    has no keyframe, and ``state_at_node`` refuses it with a named error — the
    data that would explain it did not survive, and saying so is better than
    inventing a state.

    SQLite only: the dangling-link case is a schema-2 SQLite store, and
    copy-then-migrate is defined in terms of a file.
    """
    source_path = Path(source)
    target_path = Path(target)
    if not source_path.is_file():
        raise StoreError(f"there is no store at {source_path}")
    if target_path.exists():
        raise StoreError(
            f"the salvage target {target_path} already exists; refusing to overwrite it"
        )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    uri = f"file:{source_path.resolve().as_posix()}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
        try:
            connection.execute("VACUUM INTO ?", (str(target_path),))
        finally:
            connection.close()
    except sqlite3.DatabaseError as exc:
        raise StoreError(f"cannot copy {source_path} to {target_path}: {exc}") from exc
    return Store.open(target_path, repair_dangling=True)


class Session:
    """One world's recorded history."""

    def __init__(
        self,
        store: Store,
        info: SessionInfo,
        *,
        keyframe_interval: int = KEYFRAME_INTERVAL,
    ) -> None:
        self._store = store
        self._info = info
        self._keyframe_interval = max(1, int(keyframe_interval))

    @property
    def info(self) -> SessionInfo:
        return self._info

    @property
    def id(self) -> int:
        return self._info.id

    @property
    def backend(self) -> Backend:
        return self._store.backend

    @property
    def store(self) -> Store:
        """The store this session belongs to.

        Exposed because opening an archive produces a *new* session, and the
        caller that owns one session is the caller that has to be able to make
        another. Reading a session's history never needs this.
        """
        return self._store

    def open_archive(self, path: str | Path, *, label: str | None = None) -> Session:
        """Read an archive into this session's store as a new session."""
        return self._store.import_archive(path, label=label)

    def __repr__(self) -> str:
        return (
            f"Session(id={self.id}, label={self._info.label!r}, "
            f"world={self._info.world_width}x{self._info.world_height}, "
            f"representation={self._info.representation!r})"
        )

    # -- writing ----------------------------------------------------------

    def record(
        self,
        world: Any,
        change: Any,
        *,
        force_keyframe: bool = False,
    ) -> GenerationInfo:
        """Store a generation as a child of the node the world is on.

        Recording **appends**. It does not discard what already descends from the
        head, because that is the whole difference between a chain and a tree:
        looking at an older state and then editing is how a second branch is
        made, and a branch that deleted its sibling would not be one.

        The kind is still decided from the evidence. A delta is always faithful
        here — its parent is the head, which is the state the change was measured
        against — so only three things force a keyframe: no parent to be relative
        to, an interval boundary, and a delta larger than the snapshot it would
        replace in a dense chaotic region.

        The rule comes from the world that is being recorded, so the row says
        what actually ran rather than what the session is nominally on: record a
        generation under a rule the world has just adopted, and it is that rule
        the generation is attributed to.
        """
        head = self.head()
        incoming = int(change.generation)
        rule = world.rule.notation
        # The label follows the world, which is the thing a person reads. A step
        # advances it, an edit does not, and a record that arrives after several
        # unrecorded steps keeps the world's number rather than inventing one.
        if head is None:
            generation = incoming
            parent_id = None
            jumps = False
        else:
            generation = max(incoming, head.generation)
            parent_id = head.id
            jumps = generation != head.generation + 1
        due = generation % self._keyframe_interval == 0
        keyframe = force_keyframe or head is None or jumps or due

        population = int(world.population)
        if not keyframe:
            born_cells = np.asarray(change.born, dtype=np.int32).reshape(-1, 2)
            died_cells = np.asarray(change.died, dtype=np.int32).reshape(-1, 2)
            if born_cells.shape[0] + died_cells.shape[0] > population:
                keyframe = True

        if keyframe:
            cells = world.live_cells_in(0, 0, int(world.width), int(world.height))
            born = encode_cells(cells)
            died = b""
            changed = int(cells.shape[0])
        else:
            born = encode_cells(born_cells)
            died = encode_cells(died_cells)
            changed = int(change.changed)

        created = now()
        self.backend.begin()
        try:
            cursor = self.backend.execute(
                "INSERT INTO lifegame_generation "
                "(session_id, generation, parent_id, kind, rule, born, died, population, "
                "changed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    self.id,
                    generation,
                    parent_id,
                    "keyframe" if keyframe else "delta",
                    rule,
                    born,
                    died,
                    population,
                    changed,
                    created,
                ),
            )
            node_id = int(getattr(cursor, "lastrowid", 0) or 0)
            if node_id == 0:
                row = self.backend.query_one("SELECT MAX(id) FROM lifegame_generation")
                node_id = int(row[0]) if row and row[0] is not None else 0
            if node_id == 0:
                raise StoreError("the database did not report an id for the new generation")
            self.backend.execute(
                "UPDATE lifegame_session SET head_id = ? WHERE id = ?",
                (node_id, self.id),
            )
            self.backend.commit()
        except Exception:
            self.backend.rollback()
            raise
        return NodeInfo(
            id=node_id,
            generation=generation,
            parent_id=parent_id,
            kind="keyframe" if keyframe else "delta",
            rule=rule,
            population=population,
            changed=changed,
            created_at=created,
            born=len(born) // 8,
            died=len(died) // 8,
        )

    def amend_head(self, world: Any) -> NodeInfo:
        """Record the world's current state at the head, amending or branching.

        Amending the tip of a branch is not a branch. Nothing descends from the
        head, so rewriting its row changes no history anyone can reach, and a
        client that places a cell should not see a second generation zero.

        When something *does* descend from the head — which is the case exactly
        after selecting an older node — an edit is a new node instead, and that is
        where a fork appears. The distinction is not a special case; it is the
        difference between editing the present and editing the past.

        The rule is the world's, as it is for `record`: the node describes the
        world as it now stands, so a rule adopted and then edited under belongs to
        the generation the edit was made at.
        """
        head = self.head()
        if head is None or self.children(head.id):
            return self.record(world, _Generation(world.generation), force_keyframe=True)
        cells = world.live_cells_in(0, 0, int(world.width), int(world.height))
        payload = encode_cells(cells)
        self.backend.begin()
        try:
            self.backend.execute(
                "UPDATE lifegame_generation SET kind = 'keyframe', rule = ?, born = ?, "
                "died = ?, population = ?, changed = ?, created_at = ? WHERE id = ?",
                (world.rule.notation, payload, b"", int(cells.shape[0]), 0, now(), head.id),
            )
            self.backend.commit()
        except Exception:
            self.backend.rollback()
            raise
        return self.node(head.id)

    def set_rule(self, rule: Any) -> str:
        """Record the rule this session is now running, and report its notation.

        This is what keeps the session's rule and the core's rule the same fact:
        a query, a listing or a reopened archive answers with the rule here, and
        the caller that changed the world's rule is the caller that has to say so.
        It is written rather than derived from the newest generation, because a
        rule the world has adopted but not yet stepped under is still the rule
        the session is running, and reporting the last generation's rule would
        contradict the core.

        Nothing else moves. No generation is written and no node is touched: the
        generations already recorded ran under the rules they recorded, and the
        next one written will carry this one — which is where the change point
        appears in :meth:`rule_changes`.
        """
        notation = normalize_rule(rule)
        self.backend.begin()
        try:
            self.backend.execute(
                "UPDATE lifegame_session SET rule = ?, rule_known = 1 WHERE id = ?",
                (notation, self.id),
            )
            self.backend.commit()
        except Exception:
            self.backend.rollback()
            raise
        self._info = replace(self._info, rule=notation, rule_known=True)
        return notation

    # -- the tree ---------------------------------------------------------

    _NODE_COLUMNS = (
        "id, generation, parent_id, kind, population, changed, created_at, born, died, rule"
    )

    @staticmethod
    def _to_node(row: tuple[Any, ...]) -> NodeInfo:
        born = row[7]
        died = row[8]
        return NodeInfo(
            id=int(row[0]),
            generation=int(row[1]),
            parent_id=None if row[2] is None else int(row[2]),
            kind=str(row[3]),
            rule=str(row[9]),
            population=int(row[4]),
            changed=int(row[5]),
            created_at=str(row[6]),
            born=0 if born is None else len(bytes(born)) // 8,
            died=0 if died is None else len(bytes(died)) // 8,
        )

    def head(self) -> NodeInfo | None:
        """The node the world is on, which is where the next record appends."""
        row = self.backend.query_one(
            "SELECT head_id FROM lifegame_session WHERE id = ?", (self.id,)
        )
        if row is None or row[0] is None:
            return None
        return self.node(int(row[0]))

    def node(self, node_id: int) -> NodeInfo:
        row = self.backend.query_one(
            f"SELECT {self._NODE_COLUMNS} FROM lifegame_generation WHERE id = ?",
            (int(node_id),),
        )
        if row is None:
            raise SessionNotFound(f"session {self.id} has no node {node_id}")
        return self._to_node(row)

    def nodes(self) -> list[NodeInfo]:
        """Every node, oldest first, so a caller can draw the tree."""
        rows = self.backend.query(
            f"SELECT {self._NODE_COLUMNS} FROM lifegame_generation "
            "WHERE session_id = ? ORDER BY generation, id",
            (self.id,),
        )
        return [self._to_node(row) for row in rows]

    def children(self, node_id: int) -> list[NodeInfo]:
        """The nodes recorded directly on top of ``node_id`` — one per branch."""
        rows = self.backend.query(
            f"SELECT {self._NODE_COLUMNS} FROM lifegame_generation "
            "WHERE parent_id = ? ORDER BY id",
            (int(node_id),),
        )
        return [self._to_node(row) for row in rows]

    def path_to(self, node_id: int) -> list[NodeInfo]:
        """The nodes from the root down to ``node_id``, inclusive."""
        path: list[NodeInfo] = []
        seen: set[int] = set()
        current: int | None = int(node_id)
        while current is not None:
            if current in seen:
                raise StoreError("the recorded history contains a cycle")
            seen.add(current)
            node = self.node(current)
            path.append(node)
            current = node.parent_id
        path.reverse()
        return path

    def payload_for(self, node_id: int) -> tuple[str, bytes, bytes]:
        """``(kind, born, died)`` for one node, addressed by identity."""
        row = self.backend.query_one(
            "SELECT kind, born, died FROM lifegame_generation WHERE id = ?",
            (int(node_id),),
        )
        if row is None:
            raise SessionNotFound(f"session {self.id} has no node {node_id}")
        return str(row[0]), bytes(row[1] or b""), bytes(row[2] or b"")

    def state_at_node(self, node_id: int) -> list[tuple[int, int]]:
        """The live cells at a node, replayed down from its nearest keyframe.

        Walking *down* from a keyframe rather than *up* from the node is what
        makes both directions of a branch equally cheap, and it is what lets the
        replay validate: a delta that kills a cell which is not alive describes
        something other than a life world, and saying so is better than returning
        a world that is quietly wrong.
        """
        path = self.path_to(node_id)
        start = None
        for index in range(len(path) - 1, -1, -1):
            if path[index].is_keyframe:
                start = index
                break
        if start is None:
            raise StoreError(f"node {node_id} has no keyframe on its path to the root")
        _, born, _ = self.payload_for(path[start].id)
        alive = {(int(cell[0]), int(cell[1])) for cell in decode_cells(born)}
        for node in path[start + 1 :]:
            _, step_born, step_died = self.payload_for(node.id)
            for cell in decode_cells(step_died).tolist():
                key = (int(cell[0]), int(cell[1]))
                if key not in alive:
                    raise StoreError(
                        f"generation {node.generation} kills {key}, which is not alive; "
                        "the recorded history is not a life history"
                    )
                alive.discard(key)
            for cell in decode_cells(step_born).tolist():
                key = (int(cell[0]), int(cell[1]))
                if key in alive:
                    raise StoreError(
                        f"generation {node.generation} bears {key}, which is already alive; "
                        "the recorded history is not a life history"
                    )
                alive.add(key)
        return sorted(alive, key=lambda cell: (cell[1], cell[0]))

    def checkout(self, world: Any, node_id: int) -> int:
        """Move the world and the session's head onto ``node_id``.

        The head is what the next record appends to, so moving it here and then
        editing is how a branch is made: ``node_id`` keeps the children it has,
        and the new work becomes their sibling.
        """
        node = self.node(node_id)
        world.restore(self.state_at_node(node.id), generation=node.generation)
        self.backend.begin()
        try:
            self.backend.execute(
                "UPDATE lifegame_session SET head_id = ? WHERE id = ?",
                (node.id, self.id),
            )
            self.backend.commit()
        except Exception:
            self.backend.rollback()
            raise
        return node.generation

    def node_at_generation(self, generation: int) -> NodeInfo | None:
        """The node with this generation number on the current branch, if any."""
        return self._on_head_path(generation)

    def _on_head_path(self, generation: int) -> NodeInfo | None:
        head = self.head()
        if head is None:
            return None
        for node in self.path_to(head.id):
            if node.generation == int(generation):
                return node
        return None

    def truncate_after(self, generation: int) -> int:
        """Discard the current branch's nodes after ``generation``.

        Only the head's own path is removed. A node hanging off that path is a
        different line of work and is kept: its parent link is cleared, and it is
        rewritten as a keyframe of its own state so the surviving subtree can
        still be replayed after the ancestry it derived from is gone. Removing
        the path nodes without that rewrite would let the declared
        ``ON DELETE CASCADE`` on ``parent_id`` take the survivor's history with
        it — the data-loss defect this method was previously measured to have
        (docs/model/store/risks.md STO-17).

        The count returned is the number of nodes removed, so a kept sibling is
        not counted as removed work.
        """
        target = self._on_head_path(generation)
        if target is None:
            raise SessionNotFound(
                f"session {self.id} has no generation {generation} on its current branch"
            )
        head = self.head()
        if head is None:
            raise SessionNotFound(f"session {self.id} has no history to truncate")
        doomed = [node for node in self.path_to(head.id) if node.generation > target.generation]
        if not doomed:
            return 0
        doomed_ids = {node.id for node in doomed}

        # A child of a doomed node that is not itself doomed is the root of work
        # this call was not asked to discard. Its state is read before anything
        # is deleted, because after the deletion the chain that explains it is
        # gone.
        placeholders = ", ".join("?" for _ in doomed_ids)
        rows = self.backend.query(
            f"SELECT id FROM lifegame_generation WHERE parent_id IN ({placeholders})",
            tuple(doomed_ids),
        )
        survivors = [
            (int(row[0]), self.state_at_node(int(row[0])))
            for row in rows
            if int(row[0]) not in doomed_ids
        ]

        self.backend.begin()
        try:
            for node_id, cells in survivors:
                payload = encode_cells(np.asarray(cells, dtype=np.int32).reshape(-1, 2))
                self.backend.execute(
                    "UPDATE lifegame_generation SET parent_id = NULL, kind = 'keyframe', "
                    "born = ?, died = ?, changed = ? WHERE id = ?",
                    (payload, b"", len(cells), node_id),
                )
            for node in reversed(doomed):
                self.backend.execute("DELETE FROM lifegame_generation WHERE id = ?", (node.id,))
            self.backend.execute(
                "UPDATE lifegame_session SET head_id = ? WHERE id = ?", (target.id, self.id)
            )
            self.backend.commit()
        except Exception:
            self.backend.rollback()
            raise
        return len(doomed)

    def mark_archived(self, archived: bool = True) -> None:
        self.backend.begin()
        try:
            self.backend.execute(
                "UPDATE lifegame_session SET archived = ? WHERE id = ?",
                (1 if archived else 0, self.id),
            )
            self.backend.commit()
        except Exception:
            self.backend.rollback()
            raise

    # -- reading ----------------------------------------------------------

    def generations(self, *, limit: int | None = None) -> list[GenerationInfo]:
        sql = (
            "SELECT generation, kind, population, changed, created_at, born, died, rule "
            "FROM lifegame_generation WHERE session_id = ? ORDER BY generation"
        )
        rows = self.backend.query(sql, (self.id,))
        infos = [self._to_generation_info(row) for row in rows]
        if limit is not None and len(infos) > limit:
            return infos[-limit:]
        return infos

    def rule_changes(self) -> list[tuple[int, str]]:
        """Where the running rule changed, oldest first, as ``(generation, rule)``.

        The first entry is the session's first generation even when the rule never
        changed: what a timeline started under is as much a fact as what it
        switched to, and a caller drawing a timeline has no other way to label its
        beginning. Every later entry is a generation whose rule differs from its
        parent's — which is exactly the set of nodes a client has to mark, and the
        answer to "which generation started running something else".

        The walk is one pass over the session's nodes because a parent is always
        recorded before its children, so a node's parent has already been seen
        when the node is read.
        """
        rule_of: dict[int, str] = {}
        changes: list[tuple[int, str]] = []
        for node in self.nodes():
            parent_rule = None if node.parent_id is None else rule_of.get(node.parent_id)
            if node.rule != parent_rule:
                changes.append((node.generation, node.rule))
            rule_of[node.id] = node.rule
        return changes

    def latest(self) -> GenerationInfo | None:
        """The head as a plain generation record, for callers that predate the tree."""
        head = self.head()
        if head is not None:
            return GenerationInfo(
                generation=head.generation,
                kind=head.kind,
                rule=head.rule,
                population=head.population,
                changed=head.changed,
                created_at=head.created_at,
                born=head.born,
                died=head.died,
            )
        rows = self.backend.query(
            "SELECT generation, kind, population, changed, created_at, born, died, rule "
            "FROM lifegame_generation WHERE session_id = ? "
            "ORDER BY generation DESC, id DESC LIMIT 1",
            (self.id,),
        )
        return self._to_generation_info(rows[0]) if rows else None

    @staticmethod
    def _to_generation_info(row: tuple[Any, ...]) -> GenerationInfo:
        born = row[5]
        died = row[6]
        return GenerationInfo(
            generation=int(row[0]),
            kind=str(row[1]),
            rule=str(row[7]),
            population=int(row[2]),
            changed=int(row[3]),
            created_at=str(row[4]),
            born=0 if born is None else len(bytes(born)) // 8,
            died=0 if died is None else len(bytes(died)) // 8,
        )

    def payload(self, generation: int) -> tuple[str, bytes, bytes]:
        """``(kind, born, died)`` for one recorded generation."""
        row = self.backend.query_one(
            "SELECT kind, born, died FROM lifegame_generation "
            "WHERE session_id = ? AND generation = ?",
            (self.id, int(generation)),
        )
        if row is None:
            raise SessionNotFound(f"session {self.id} has no generation {generation}")
        return str(row[0]), bytes(row[1] or b""), bytes(row[2] or b"")

    def state_at(self, generation: int) -> list[tuple[int, int]]:
        """The live cells at ``generation`` on the current branch.

        The number is a label, not an identity: two branches may hold a node with
        the same one. This call answers for the branch the world is on, and a
        generation that exists only on another branch is refused rather than
        guessed at — the worst possible failure for a rollback is a confident
        answer about a state the caller did not ask for.
        """
        target = int(generation)
        node = self._on_head_path(target)
        if node is None:
            raise SessionNotFound(
                f"session {self.id} has no generation {target} on its current branch"
            )
        return self.state_at_node(node.id)

    def _chain_after(self, start: int, target: int) -> Iterator[GenerationInfo]:
        rows = self.backend.query(
            "SELECT generation, kind, population, changed, created_at, born, died, rule "
            "FROM lifegame_generation WHERE session_id = ? AND generation > ? AND generation <= ? "
            "ORDER BY generation",
            (self.id, start, target),
        )
        for row in rows:
            yield self._to_generation_info(row)

    # -- rollback ---------------------------------------------------------

    def rollback(self, world: Any, generation: int) -> int:
        """Load ``generation`` on the current branch into ``world``, and only read.

        Reading and *working on* a generation are two operations on purpose.
        This one leaves the session's head where it was, so a caller can look at
        an old state and put it back; :meth:`checkout` is the one that moves the
        working point, and moving it is what makes the next record a branch. A
        single operation that did both would make looking at history destructive,
        which is the defect this version exists to remove.
        """
        node = self._on_head_path(generation)
        if node is None:
            raise SessionNotFound(
                f"session {self.id} has no generation {generation} on its current branch"
            )
        world.restore(self.state_at_node(node.id), generation=node.generation)
        return node.generation

    def rewind(self, world: Any, generations: int = 1) -> int:
        """Load the current generation minus ``generations``; report it.

        This is the interactive form of rollback: the caller knows how far back
        it wants to go, not which generation that is.
        """
        current = world.generation
        target = int(current) - int(generations)
        if target < 0:
            raise SessionNotFound(f"cannot rewind {generations} from generation {current}")
        return self.rollback(world, target)

    # -- archives ---------------------------------------------------------

    def archive(self, path: str | Path) -> int:
        """Write the whole session as a portable, inspectable text file."""
        from lifegame.store.archive import write_archive

        return write_archive(self, path)
