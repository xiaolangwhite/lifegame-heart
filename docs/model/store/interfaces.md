# store — interfaces

> This file owns the store module's complete public surface: the names the facade
> exports, every public callable with its signature, the exceptions it raises,
> what crosses the boundary, the archive file format and the command line.
> Implemented API and planned types are listed separately, as
> [AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §5.3 requires.
> Behaviour that is implemented is owned by the source; this file owns what is
> promised.

## 1. Public surface

`lifegame.store.__all__` exports thirteen names. Everything else in the package is
a private category and is not imported from outside.

| Name | Kind | Defined in |
|---|---|---|
| `Store` | class | [history.py](../../../src/lifegame/store/history.py) |
| `Session` | class | [history.py](../../../src/lifegame/store/history.py) |
| `SessionInfo` | frozen dataclass | [history.py](../../../src/lifegame/store/history.py) |
| `GenerationInfo` | frozen dataclass | [history.py](../../../src/lifegame/store/history.py) |
| `KEYFRAME_INTERVAL` | `int`, 64 | [history.py](../../../src/lifegame/store/history.py) |
| `ARCHIVE_VERSION` | `int`, 1 | [history.py](../../../src/lifegame/store/history.py) |
| `DEFAULT_RULE` | `str`, `"B3/S23"` | [history.py](../../../src/lifegame/store/history.py) |
| `CURRENT_SCHEMA_VERSION` | `int`, 3 | [schema.py](../../../src/lifegame/store/schema.py) |
| `BACKENDS` | `tuple[str, ...]`, `("sqlite", "mysql")` | [schema.py](../../../src/lifegame/store/schema.py) |
| `StoreError` | exception | [errors.py](../../../src/lifegame/store/errors.py) |
| `StoreLocked` | exception, `StoreError` | [errors.py](../../../src/lifegame/store/errors.py) |
| `SessionNotFound` | exception, `StoreError` | [errors.py](../../../src/lifegame/store/errors.py) |
| `ArchiveError` | exception, `StoreError` | [errors.py](../../../src/lifegame/store/errors.py) |

Four submodules also expose a public surface that the facade does not
re-export. They are reachable and are used by the tests, so they are part of the
module's contract rather than private detail:

| Submodule | Public names | Used by |
|---|---|---|
| `lifegame.store.schema` | `TABLES`, `Column`, `Table`, `render_ddl`, `column_names`, and the dialect parameter translation | the DDL the CLI prints, and the tests that decide the dialect rendering |
| `lifegame.store.backends` | `Backend`, `SqliteBackend`, `MySqlBackend`, `open_backend` | a caller that wants a backend without a `Store`, and the MySQL tests |
| `lifegame.store.archive` | `read_archive`, `write_archive` | `Session.archive` and `Store.import_archive`; usable directly |
| `lifegame.store.delta` | `encode_cells`, `decode_cells`, `CELL_BYTES` | the payload codec, asserted against the world's independent implementation |

The `Backend` shape is part of that surface, and a schema migration gave it two
members that a caller of `Store` never touches but that a backend author has to
supply. Both are documented on the protocol itself
([backends.py](../../../src/lifegame/store/backends.py)):

| Method | Returns | Meaning |
|---|---|---|
| `set_foreign_keys(enabled)` | `int` | The enforcement setting **in force after the call**, read back from the database rather than acknowledged. SQLite reads `PRAGMA foreign_keys` back; MySQL reads `@@foreign_key_checks`. The distinction is load-bearing: SQLite ignores the pragma inside a transaction and raises nothing, so the statement returning is not evidence that the setting took |
| `foreign_key_violations()` | `list[tuple]` or `None` | One row per dangling reference. **`[]` means the database was asked and is clean; `None` means it cannot be asked at all.** MySQL answers `None`, because InnoDB has no statement that re-examines rows already stored the way `PRAGMA foreign_key_check` does. The two are different claims and are kept different, because a rebuild writes rows the database never checked while enforcement is off, and a caller that read `None` as a pass would accept exactly the result the check exists to refuse |

`lifegame.store.history` also declares `ARCHIVE_FORMAT` and `NodeInfo` in its own
`__all__`, and the facade re-exports **neither**: `ARCHIVE_VERSION` is re-exported
but the format name is not, and a node of the tree is addressed by the `head`,
`node`, `nodes`, `children` and `path_to` calls rather than imported by type. A
consumer that wants to name the format it must match therefore has to reach into
the submodule. Recorded in [risks.md](risks.md) STO-06 rather than smoothed over.

The exact names the schema submodule exports, as the source spells them:

```text
TABLES  Column  Table  render_ddl  render_placeholders  column_names
BACKENDS  CURRENT_SCHEMA_VERSION
```

## 2. `Store`

### 2.1 Construction and lifetime

```python
Store.open(path=None, *, backend="sqlite", repair_dangling=False, **options) -> Store
Store(backend)                       # accepts any object with the Backend shape
Store.open_backend(backend, *, path=None, **options) -> Backend   # in backends.py
salvage(source, target) -> Store     # copy a damaged SQLite store, then open the copy
```

`Store.open` is the entry point. It creates the parent directory of a SQLite path
if it does not exist, opens the backend, ensures the schema, and returns the
store. On any failure after the backend is open, the backend is closed before the
exception propagates.

Ensuring the schema is not only creation: a store written by an older schema is
migrated on open, and that path turns foreign-key enforcement off and back on and
can refuse ([implementation.md](implementation.md) §3.6). The failure modes it can
produce are in §3 and §9.

| Argument | Meaning |
|---|---|
| `path` | Required for `sqlite`, ignored for `mysql`. A `str` or `Path` |
| `backend` | One of `BACKENDS`. `"sqlite"` is the default everywhere |
| `repair_dangling` | A migration option. `False` (the default) refuses a rebuild whose rows hold a dangling parent link; `True` clears the link and records the row ids in `repaired_dangling`. It only affects a migration, and it is what `salvage` uses |
| `**options` | Passed to the backend. For MySQL: `host`, `port`, `user`, `password`, `database`, `connect_timeout` |

The store is a context manager. `close()` is idempotent, and `__exit__` closes
without suppressing anything.

```python
with Store.open("data/history.db") as store:
    ...
```

**Salvaging a damaged store.** `salvage(source, target) -> Store` copies a SQLite
store to `target` with SQLite's own `VACUUM INTO`, opens the **copy** with
`repair_dangling=True`, and returns that open store. The source is opened
read-only and is never written to; `target` must not already exist. The returned
store's `repaired_dangling` names the rows whose dangling parent link was
cleared. A cleared row starts a branch with no parent, and if its payload is a
delta that branch has no keyframe: `state_at_node` refuses it with a named error
rather than inventing a state, while the intact part of the store stays readable.
The refusal to open the damaged store in place is unchanged, which is what keeps a
damaged file from being rewritten by accident.

**Ownership.** The store owns one backend connection and, through it, one
database connection. It is not thread-safe and does not claim to be: the backend
holds one connection and the repository layer issues statements directly on it.
A caller that wants two writers wants two stores, and the note in
[risks.md](risks.md) STO-12 says what happens then.

**Lifetime of returned objects.** `Session`, `SessionInfo`, `GenerationInfo` and
`NodeInfo` values are snapshots. `SessionInfo`, `GenerationInfo` and `NodeInfo`
are frozen and carry no reference to the store. `Session` holds a reference to its
`Store` and issues queries through it, so **a `Session` is only usable while its
`Store` is open** and a `Session` obtained from one store must not be used after
that store is closed.

### 2.2 Properties

| Property | Type | Meaning |
|---|---|---|
| `dialect` | `str` | `"sqlite"` or `"mysql"`, from the backend |
| `repaired_dangling` | `tuple[int, ...]` | The row ids whose dangling parent link this open cleared. Empty unless the store was opened with `repair_dangling=True`; `salvage` is the caller that uses it |
| `backend` | `Backend` | The open backend. Public because two tests corrupt and inspect a chain through it, and because the CLI's diagnostics need it |

### 2.3 Sessions

| Call | Signature | Returns | Raises |
|---|---|---|---|
| create | `create_session(world, *, label="", representation="sparse")` | `Session` | `StoreError` when the database reports no id |
| list | `sessions(*, include_archived=True)` | `list[SessionInfo]`, ordered by id | — |
| get | `session(session_id)` | `Session` | `SessionNotFound` |
| import | `import_archive(path, *, label=None)` | `Session` | `ArchiveError`, `StoreError` |

`create_session` reads `world.width`, `world.height` and `world.rule.notation`
and records them with the label, the representation name and the current time,
marking the rule as **stated** rather than assumed, because the world it was
handed states one. **It does not copy the world.** It does not check that the
world matches the session later either; see [risks.md](risks.md) STO-04.

`representation` is a free-text label recording what the session was recorded
from. It is descriptive: nothing in the module branches on it, and a history
recorded from one representation restores into the other.

### 2.4 `Session`

| Property | Type | Meaning |
|---|---|---|
| `id` | `int` | The session's key |
| `info` | `SessionInfo` | The identity row, as read when the session was obtained |
| `backend` | `Backend` | The store's backend, for diagnostics |
| `store` | `Store` | The store the session belongs to, so a caller that owns one session can open an archive into another |

`info` is a snapshot. It is not refreshed by a write; `mark_archived` does not
update it. `set_rule` is the one exception, because the rule is a field the
snapshot holds and the call has just changed it.

**Writing**

| Call | Signature | Returns | Raises |
|---|---|---|---|
| record | `record(world, change, *, force_keyframe=False)` | `NodeInfo`, the node just written | `StoreError` on a database failure |
| amend | `amend_head(world)` | `NodeInfo` | `StoreError` |
| rule | `set_rule(rule)` | `str`, the canonical notation | `ValueError` for text the world's parser refuses |
| truncate | `truncate_after(generation)` | `int`, how many nodes on the head's path were removed | `SessionNotFound`, `StoreError` |
| archive | `mark_archived(archived=True)` | `None` | `StoreError` |
| archive | `archive(path)` | `int`, how many generation lines were written | `ArchiveError`, `StoreError` |
| import | `open_archive(path, *, label=None)` | `Session`, a new one in the same store | `ArchiveError`, `StoreError` |

`record` takes a world and a `Change`, and decides the storage kind from the
evidence rather than from a caller's wish:

| Condition | Kind stored |
|---|---|
| `force_keyframe=True` | keyframe |
| No generation is recorded yet | keyframe |
| The head's generation is not `generation - 1` | keyframe. A delta whose parent was never seen is unfalsifiable |
| `generation % KEYFRAME_INTERVAL == 0` | keyframe |
| a delta naming more cells than the population | keyframe, because the difference stopped being smaller than the snapshot |
| otherwise | delta, from `change.born` and `change.died` |

**`record` appends; it never discards.** The new node's parent is the session's
current head, and whatever already descends from that head is kept. Looking at an
older state and then editing is how a second branch is made, and a branch that
deleted its sibling would not be one. The node carries a row id, which is its
identity, and a generation number, which is a label a person reads: two branches
may hold a node with the same number, which is what a fork *is*.

The node is attributed to the rule the world is running at the moment of the
write — the rule whose step produced it, or, for a node an edit wrote, the rule
in force when the edit was recorded. The session's own rule is a different
question and `set_rule` answers it.

Writing `record` a keyframe for a still life or `force_keyframe=True` costs a
full read of the live population: the keyframe payload is
`world.live_cells_in(0, 0, width, height)`, so its size is eight bytes per live
cell.

`set_rule` records the rule the session is now running, canonicalised through the
world's own parser, and reports the notation it stored. **Nothing else moves:** no
generation is written and no node is rewritten. The generations already recorded
ran under the rules they recorded, and the next node written carries the new rule
— which is where the change appears in `rule_changes`. It is written rather than
derived from the newest node, because a rule the world has adopted and not yet
stepped under is still the rule the session is running.

`amend_head` amends the tip of a branch, or branches when something already
descends from it. An edit at the head rewrites that row; an edit after looking at
an older node becomes a new sibling, which is where a fork appears.

**The tree**

| Call | Signature | Returns | Raises |
|---|---|---|---|
| head | `head()` | `NodeInfo` or `None` | — |
| node | `node(node_id)` | `NodeInfo` | `SessionNotFound` |
| list | `nodes()` | `list[NodeInfo]`, ordered by generation then id | — |
| children | `children(node_id)` | `list[NodeInfo]`, the nodes recorded directly on top of it | — |
| path | `path_to(node_id)` | `list[NodeInfo]`, root down to `node_id`, inclusive | `SessionNotFound`, `StoreError` on a cycle |
| locate | `node_at_generation(generation)` | `NodeInfo` or `None`, on the current branch | — |
| select | `checkout(world, node_id)` | `int`, the generation loaded | `SessionNotFound`, `StoreError` |
| changes | `rule_changes()` | `list[tuple[int, str]]`, oldest first | — |

`head` is the node the world is on, and therefore where the next record appends.
`checkout` moves both the world and the head onto a node — it is what the wire's
`select` command calls — and that is what makes an edit after inspecting history a
branch: the node keeps the children it already has and the new work becomes their
sibling.

`truncate_after` removes the nodes after `generation` **on the head's own path**
and nothing else. A node that hangs off that path is a different line of work and
is kept: its `parent_id` is cleared and the row is rewritten as a keyframe of its
own state, because the ancestry it used to replay from is exactly what the call
removes. That rewrite is what makes "kept" mean usable rather than merely present
— without it the declared `ON DELETE CASCADE` on `parent_id` deletes the survivor
along with the ancestry, which is the recorded defect
([risks.md](risks.md) STO-17). The count returned is the number of nodes removed;
a kept sibling is not counted as removed work. A tree may therefore hold more
than one root after a truncation.

`rule_changes` answers where the running rule changed. Its **first entry is the
session's first generation** even when the rule never changed, because what a
timeline started under is as much a fact as what it switched to, and a caller
drawing a timeline has no other way to label its beginning. Every later entry is a
node whose rule differs from its parent's.

**Reading**

| Call | Signature | Returns | Raises |
|---|---|---|---|
| list | `generations(*, limit=None)` | `list[GenerationInfo]`, ordered by generation. `limit` keeps the **newest** `limit` entries | — |
| latest | `latest()` | `GenerationInfo` or `None`, the head as a plain record | — |
| payload | `payload(generation)` | `(kind, born, died)`, the last two as `bytes` | `SessionNotFound` |
| payload | `payload_for(node_id)` | `(kind, born, died)` for one node, addressed by identity | `SessionNotFound` |
| state | `state_at(generation)` | `list[tuple[int, int]]`, ascending `y` then `x` | `SessionNotFound`, `StoreError` on a broken chain |
| state | `state_at_node(node_id)` | the same, addressed by identity | `SessionNotFound`, `StoreError` |
| rollback | `rollback(world, generation)` | `int`, the generation restored | the same as `state_at` |
| rewind | `rewind(world, generations=1)` | `int`, the generation restored | `SessionNotFound` when it would go below zero |

`state_at` is the operation the module exists for and its contract is worth
stating in full:

1. the requested generation must exist **on the current branch**, and the check
   happens before any keyframe is opened, so a request the store cannot satisfy
   is refused rather than answered with a neighbour. A generation that exists
   only on another branch is refused too: the worst failure available to a
   rollback is a confident answer about a state the caller did not ask for;
2. the path from the root down to the node is walked, and the newest keyframe on
   it is loaded — `StoreError` if that path holds no keyframe, which is what a
   history truncated to deltas alone would look like;
3. every delta after that keyframe and up to the node is replayed **forward**,
   validating as it goes: a cell that dies must be alive, and a cell that is born
   must be dead. A violation raises `StoreError` naming the generation and the
   cell;
4. nothing is applied to any world. The caller gets coordinates.

`rollback` is `state_at` followed by `world.restore(cells, generation=...)`, and
it restores the world's generation counter as well as its cells. That is the
reason `restore` exists on the world side at all: `load` would leave the counter
where it was and silently mislabel the restored state.

`rollback` **reads and leaves the head where it was**, so inspecting history is
not destructive; `checkout` is the call that moves the working point, and moving
it is what makes the next record a sibling.

`rewind` is the interactive form: the caller knows how far back, not which
generation that is. It reads `world.generation` and subtracts.

### 2.5 `SessionInfo`, `GenerationInfo` and `NodeInfo`

All three are `@dataclass(frozen=True, slots=True)`, so they are hashable,
immutable and cheap. None of them holds a reference to the store.

| `SessionInfo` field | Type |
|---|---|
| `id` | `int` |
| `label` | `str` |
| `world_width`, `world_height` | `int` |
| `rule` | `str`, the `B<digits>/S<digits>` notation the session is running now |
| `rule_known` | `bool`, whether that rule was **stated** — by the world at creation, by an archive, or by `set_rule` — or assumed because nothing stated one |
| `representation` | `str` |
| `created_at` | `str`, ISO 8601 |
| `archived` | `bool` |

| `GenerationInfo` field | Type | Meaning |
|---|---|---|
| `generation` | `int` | |
| `kind` | `str` | `"keyframe"` or `"delta"` |
| `rule` | `str` | The rule in force for this generation; see the row note below |
| `population` | `int` | The population at that generation, as recorded |
| `changed` | `int` | Cells that changed in that generation, as recorded |
| `created_at` | `str` | ISO 8601 |
| `born` | `int` | How many cells the payload names as born |
| `died` | `int` | How many cells the payload names as dying |
| `is_keyframe` | `bool` property | `kind == "keyframe"` |

| `NodeInfo` field | Type | Meaning |
|---|---|---|
| `id` | `int` | The row, which is the identity |
| `generation` | `int` | The label; two branches may share one |
| `parent_id` | `int` or `None` | The node it was recorded on top of |
| `kind` | `str` | `"keyframe"` or `"delta"` |
| `rule` | `str` | The rule in force at this node |
| `population`, `changed` | `int` | As recorded |
| `created_at` | `str` | ISO 8601 |
| `born`, `died` | `int` | Counts, not payloads |
| `is_keyframe` | `bool` property | `kind == "keyframe"` |

The `rule` of a generation is the rule that was **in force for it**: the rule
whose step produced it, or, for a node an edit wrote, the rule the world was
running when the edit was recorded. It is not the session's rule, and the two
differ exactly after a rule change that has been recorded: the session's rule is
what a listing, a reopened archive and a query report, and the generation's rule
is what a timeline needs. A change appears as a node whose rule differs from its
parent's, which is the set `rule_changes` reports.

`born` and `died` are **counts, not payloads**. The payload is read by
`payload()`, which is the only method that returns bytes.

## 3. Exceptions

```python
StoreError(RuntimeError)
├── StoreLocked(StoreError)
├── SessionNotFound(StoreError)
└── ArchiveError(StoreError)
```

| Exception | Raised when | Raised from |
|---|---|---|
| `StoreError` | The store could not do what was asked: an unopenable file, an unknown backend, a schema newer than this build, a chain that is not a life history, a database failure, a schema version no migration implements, a rebuild that would hold a dangling foreign-key reference, or a rebuild that could not establish foreign-key enforcement as off and bring it back on | `backends.py`, `history.py` |
| `SessionNotFound` | No session with that id, no generation with that number on the current branch, or a rewind past the beginning | `history.py` |
| `ArchiveError` | A file is not an archive, is one this version cannot read, states a rule this build cannot parse, or carries a payload that is not a whole number of cells | `archive.py`, `delta.py` |
| `StoreLocked` | Another process holds the file's write lock, so `BEGIN IMMEDIATE` cannot start a transaction. The driver's own lock error is translated into this type; other driver errors are not | `backends.py` |

`ArchiveError` derives from `StoreError`, so a caller that only wants "the store
could not do it" catches one type, and a caller that wants to distinguish a bad
file from a bad request catches two.

## 4. The coordinate payload

A generation's payload is a flat byte string of little-endian `int32` pairs, `x`
then `y`, absolute world coordinates. It is **the same layout the world's line
protocol calls `cells`**, and the two encoders are independent implementations:
one is storage, one is transport, and neither module imports the other.

| Property | Value |
|---|---|
| Bytes per cell | 8 |
| Empty set | the empty byte string |
| Length rule | a payload whose length is not a multiple of 8 is refused, never truncated |
| Signedness | signed, so a negative coordinate round-trips rather than wrapping |

Two implementations of one layout drift; a test asserts they agree
([test_delta.py](../../../tests/store/test_delta.py)
`test_the_stored_layout_and_the_wire_layout_are_the_same_bytes`).

The store does not base64 these bytes. A database column holds bytes and an
archive line holds text, so the archive layer wraps them and the codec does not.

## 5. The archive file format

JSON Lines: one header line, then one line per generation, UTF-8, LF.

```json
{"kind":"header","format":"lifegame-archive","version":1,
 "session":{"label":"glider","world_width":256,"world_height":256,
            "rule":"B3/S23","rule_known":true,"representation":"sparse",
            "created_at":"2026-10-10T09:00:00+00:00"}}
{"kind":"generation","generation":0,"storage":"keyframe","rule":"B3/S23",
 "population":5,
 "changed":0,"created_at":"2026-10-10T09:00:00+00:00",
 "born":"AQAAAAAAAAD/////","died":""}
```

| Field | Meaning |
|---|---|
| `kind` | `"header"` or `"generation"`; anything else is refused |
| `format` | Must be `lifegame-archive` |
| `version` | Must equal `ARCHIVE_VERSION`; a different number is refused |
| `session` | Required on the header. Missing means the file is refused |
| `session.rule` | The rule the session is running now. Absent or empty means the file states none |
| `session.rule_known` | `false` marks the header's rule as one a reader assumed rather than one the file recorded. Absent means `true` |
| `storage` | `"keyframe"` or `"delta"`; anything else is refused |
| `rule` | On a generation line: the rule in force for that generation. Absent means the header's rule, which is what a file written before a generation carried its own rule means |
| `born`, `died` | Base64 of the payload in §4. The empty string means the empty set |
| `generation`, `population`, `changed` | Integers, carried through |

**The rule travels twice, and the two answer different questions.** The header
states the rule the session is running now, so a caller knows what to keep
running; every generation line states the rule that was in force for it, so a
session that changed its rule mid-history imports with its change points instead
of being flattened onto one rule. `ARCHIVE_VERSION` is unchanged by this, and the
two fields are the reason it can be: both are optional and additive, so a file
written before the rule travelled is read by a newer reader — a generation with no
rule of its own takes the header's — and a file written by a newer reader is read
by an older one, which ignores the fields it does not know.

A file whose header states no rule is imported on `DEFAULT_RULE` with
`rule_known = 0`: a session with no rule cannot answer anything, and a reader that
filled in a default without recording that it did so would report a guess as a
fact. The marking survives being written out again, so a guess made once does not
become a fact by passing through a newer build.

The reader refuses, in this order: a missing file, an empty file, a first line
that is not JSON, a first line that is not a header, a foreign `format`, a
different `version`, a missing session description, a header rule this build
cannot parse, a generation line that is not JSON, a generation line that is not a
generation, an unknown `storage`, a generation rule that is present but empty or
unparseable, and a `born`/`died` that is not valid base64 or not a whole number
of cells. The rule fields are untrusted input, so they are read by the world's own
parser and a value it refuses is an `ArchiveError` rather than something stored.

Every one of those refusals happens inside a transaction, so **an import that
fails leaves no session row and no generation rows**.

An imported session is written with `archived=0` by the reader, so it appears in
`sessions(include_archived=False)`: an imported archive is a session you can work
on, not one that has been put away. A test asserts it. Whether a caller should be
offered the archive marking instead is recorded in [risks.md](risks.md) STO-07.

## 6. Command line

```powershell
python -m lifegame.store schema --dialect sqlite|mysql
python -m lifegame.store sessions <db>
python -m lifegame.store show <db> <session>
python -m lifegame.store rollback <db> <session> <generation>
python -m lifegame.store archive <db> <session> <path>
python -m lifegame.store import <db> <path> [--label <label>]
```

| Command | Output | Notes |
|---|---|---|
| `schema` | Every DDL statement, one per line, terminated by `;` | The SQLite form includes the pragma preamble. This is the command whose output a DBA applies to a MySQL server |
| `sessions` | A table: id, generation count, world size, rule, label, and `[archived]` | Prints `no sessions` rather than an empty table |
| `show` | A table: generation, storage kind, population, changed, born count, died count | |
| `rollback` | One line: the generation, its live-cell count and its bounds | Prints the state a rollback **would** restore; it does not open a world |
| `archive` | `wrote <n> generation(s) to <path>` | |
| `import` | `imported session <id> with <n> generation(s)` | |

| Exit code | Meaning |
|---|---|
| `0` | Success, including a query that legitimately matched nothing |
| `1` | The store refused. `StoreError` is caught, `error: <message>` goes to stderr |
| `2` | A usage error, from `argparse` |

The CLI holds no logic the library does not have, with one exception: rendering.
`rollback` does not restore into a world because there is no world in a shell;
it prints what would be restored. The command that actually restores a world is
the library call `Session.rollback`.

## 7. Diagnostics

The module exposes no counters, no timings and no statistics. What a caller can
observe instead:

| Question | Answered by |
|---|---|
| What is in this store? | `Store.sessions()`, and `Session.generations()` |
| Is this generation a keyframe or a delta? | `GenerationInfo.kind`, `GenerationInfo.is_keyframe` |
| How large is a delta? | `GenerationInfo.born + GenerationInfo.died`, in cells; eight bytes each |
| Which representation was this recorded from? | `SessionInfo.representation`, descriptive only |
| Which rule is the session running now? | `SessionInfo.rule` |
| Was that rule stated, or assumed? | `SessionInfo.rule_known` |
| Which rule ran at this generation? | `GenerationInfo.rule`, `NodeInfo.rule` |
| Where did the running rule change? | `Session.rule_changes()`, oldest first |
| What dialect am I on? | `Store.dialect` |
| What DDL would this schema be somewhere else? | `render_ddl(dialect)`, or the `schema` command |

## 8. Smoke entries

The commands a person runs to decide whether the module works at all, with what
each decides:

```powershell
python -m lifegame.store schema --dialect sqlite
python -m lifegame.store schema --dialect mysql
uv run pytest tests/store -q
```

The first two decide that the schema renders for both dialects without a server.
The third decides everything [testing.md](testing.md) §5 lists.

## 9. Compatibility policy

Two version numbers are part of this interface, and both are integers that a
reader compares rather than negotiates:

| Number | Meaning | Behaviour on mismatch |
|---|---|---|
| `CURRENT_SCHEMA_VERSION` | The shape of the tables and columns | A store **newer** than this build is refused, because it would otherwise be misread. A store **older** than this build is migrated on open, in one transaction, by the read-rebuild-write path in [implementation.md](implementation.md) §3.6 |
| `ARCHIVE_VERSION` | The shape of an archive file, on the wire line `version` | Reading a file with a different number is refused with both numbers named |

There is no negotiation and no downgrade path, deliberately: a store is read by
the code that wrote it, or upgraded to the code that reads it, and never written
back in an older shape. Adding a column means adding a schema version and a
migration; both migrations this module has — 1 to 3 and 2 to 3 — are implemented
and each is decided by a test. Their uncertainties are stated in
[implementation.md](implementation.md) §3.6 rather than hidden in a column
default.

**What a migration does to the connection, and what it refuses.** A rebuild turns
foreign-key enforcement off before it starts and back on when it finishes, and it
asserts both values rather than assuming them; the order is
[implementation.md](implementation.md) §3.6. The rows it writes are checked with
the database's own foreign-key check before the transaction commits, so a store
whose own rows already violate its declared keys is refused with its file
unchanged rather than opened as a tree whose parent links point nowhere. That
refusal leaves the owner without a path forward, which is [risks.md](risks.md)
STO-19. Only SQLite can follow the whole order: MySQL's check cannot be asked and
its DDL does not roll back, which is [risks.md](risks.md) STO-18.

The Python surface itself is not versioned. A caller that needs a different
behaviour asks for it or wraps it.

## 10. Implemented and planned

**Implemented.** Everything described in §1 to §9 above exists in the tree and
can be named by file and line. The thirteen facade names, the four submodule
surfaces, `Store`, `Session`, `SessionInfo`, `GenerationInfo`, the four
exceptions, the payload codec, the archive format, the tree of recorded nodes and
the rule provenance each node carries, the 1-to-3 and 2-to-3 schema migrations,
and the six commands.

**Planned.** Listed separately because none of it exists and none of it may be
read as present:

| Planned | What it would be | Owning version |
|---|---|---|
| A viewer session that records while the world runs | A consumer that calls `advance()` once per generation and `record()` once per generation | not scheduled; the viewer's service does not drive this module yet |
| Session deletion | A `DELETE FROM lifegame_session` path on the facade. The declared `ON DELETE CASCADE` is enforced and a test deletes a session row through the backend and asserts its generations go with it; what is absent is an operation that asks for it. It is a design item rather than a missing call, because a delete that cascades along a parent chain deeper than SQLite's trigger limit fails ([risks.md](risks.md) STO-16) | not scheduled; nothing needs it yet |
| A configurable keyframe interval per session | `Session` already accepts `keyframe_interval`, but `Store` does not expose it and nothing sets it | not scheduled |
