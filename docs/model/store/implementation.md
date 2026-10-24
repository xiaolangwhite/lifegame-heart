# store — implementation

> This file owns how the module is built: the file layout, the algorithms that
> matter and their complexity bounds, the environment it needs, how it is
> configured, why the structural choices were made, and the alternatives that
> were rejected. It is a record of decisions, not of aspiration. What the module
> promises is owned by [interfaces.md](interfaces.md); what is measured is owned
> by [performance.md](performance.md).

## 1. Layout

```
src/lifegame/store/
  __init__.py    the facade: thirteen names and __all__
  errors.py      one base exception and three subclasses
  schema.py      the logical schema and its rendering per dialect
  backends.py    the Backend shape, the SQLite adapter, the MySQL adapter
  delta.py       coordinates to and from the bytes a generation is stored as
  history.py     Store, Session, the keyframe policy, replay, rollback, archive driving
  archive.py     the JSON Lines file format, written and read
  __main__.py    the command line
```

Eight files, eight components, one each
([internal-components.md](internal-components.md) §1). The split is by
responsibility and the dependency direction is one-way; the one place the
direction is not visible at import time is `history-core` reaching
`archive-format` inside two method bodies, which
[internal-components.md](internal-components.md) §2 records.

## 2. Prior art

The shape of this module is not novel and was not invented here. Three
established designs were taken:

* **Write-ahead history with periodic snapshots.** Databases have kept a
  snapshot-plus-log history since the first write-ahead log: replay is forward,
  the log records effects rather than states, and a snapshot bounds how far a
  recovery walks. The generational structure here is that design with a
  hard-coded snapshot interval.
* **Delta encoding against a base.** Storage systems have stored the difference
  between versions since the first revision control system. The reason is the
  same here: what changed is usually much smaller than what exists.
* **Schema as data, dialect as rendering.** Declaring tables once and rendering
  DDL per dialect is the ordinary shape of every migration tool. It is chosen
  over hand-written per-dialect DDL for the reason the ADR gives: two hand-written
  copies drift.
* **Migrating by rebuild rather than by `ALTER TABLE`.** Every database has a
  documented recipe for a change it cannot make in place, and the recipe is
  always: create the new shape, copy the rows, drop the old one. That is what this
  module does, and for the same reason — one code path both dialects accept,
  instead of a different dance per database. The recipe also fixes an **order**,
  which §3.6 follows rather than approximates: the drop is the step that needs
  foreign-key enforcement off, and the copy is the step whose result has to be
  checked before anything commits.

Nothing in the module is algorithmically difficult. The complexity that matters
is in the three policies — when a delta is honest, what a replay must refuse, and
what a migration may infer — and all three are decided in
[history.py](../../../src/lifegame/store/history.py) rather than spread across
files.

## 3. The algorithms that matter

### 3.1 Choosing the storage kind

```
keyframe  :=  force_keyframe
           or  no generation is recorded
           or  the newest recorded generation != generation - 1
           or  generation mod KEYFRAME_INTERVAL == 0
delta     :=  otherwise
```

The decision is a predicate over the *stored* chain, not over the caller's
intent. A caller cannot ask for a delta that would be dishonest, and cannot
forget to ask for the keyframe that makes the next delta honest.

`KEYFRAME_INTERVAL` is 64. It trades two costs against each other: a smaller
interval means larger storage and shorter replays, a larger one the reverse. 64
is a round number rather than a measured optimum, and
[performance.md](performance.md) §5 says so instead of implying otherwise.

### 3.2 Forward replay with validation

```
alive  :=  the keyframe's cells, as a set
for each delta from keyframe+1 to target:
    for cell in delta.died:
        if cell not in alive:  raise StoreError("kills a cell that is not alive")
        alive.remove(cell)
    for cell in delta.born:
        if cell in alive:      raise StoreError("bears a cell that is already alive")
        alive.add(cell)
```

Two properties follow from the direction of the loop, and both are the reason it
is not written backward:

* **It can be checked.** A delta asserts an effect on a state; replaying it
  forward means the state it asserts about is the state just built. Inverting it
  backward would produce a state from an assertion with nothing to check it
  against.
* **It fails where the damage is.** A corrupted generation is caught at the
  generation that is corrupted, so the message names a generation rather than
  reporting that "the archive is bad".

The validation is `O(cells named by the delta)` with a hash-set membership test,
so it does not change the replay's asymptotic cost.

### 3.3 The payload codec

Coordinates are `(M, 2)` `int32` and the payload is those values as
little-endian pairs. Encoding is one `astype("<i4").tobytes()`; decoding is one
`frombuffer(...).reshape(-1, 2)`. The whole codec is two lines of work and one
length check, and the length check is the part that matters: a payload whose
length is not a multiple of eight is refused, because a truncated coordinate
would place a cell somewhere it never was.

The same layout exists in the world module's protocol as the `cells` frame
encoding, written independently. Two implementations of one layout drift, so a
test asserts they agree rather than a comment claiming they do.

### 3.4 Rendering a schema for two dialects

```
logical schema (TABLES)  --render(dialect)-->  physical DDL
                         --render_placeholders(dialect)-->  '?' or '%s'
```

Two syntactic differences are handled: the physical type of a logical type, and
the parameter spelling. Everything else — the tables, the columns, the
constraints, the keys, the indexes — is spelled once. The repository layer writes
`?` and never learns which database it is talking to, and a test asserts that no
`%s` appears in the repository source.

The auto-increment key is the one place a dialect's spelling is structural rather
than cosmetic: both dialects accept an auto key only when it is declared inline
on the column, so `Column.render(inline_key=True)` exists and a column marked
`auto` outside the key raises rather than rendering something subtly wrong.

### 3.5 Rule provenance

A session's rule and a generation's rule answer different questions, so both are
stored:

```
lifegame_session.rule       the rule the session is running now
lifegame_session.rule_known whether that value was stated, or assumed
lifegame_generation.rule    the rule that was in force for that node
```

The session's value is what a listing, a reopened archive and a query report. It
is written by `create_session` from the world's own notation, moved by `set_rule`
as the world's rule changes, and written by the archive reader from the file's
header. `rule_known` exists because one path cannot state a rule at all: an
archive written before the rule travelled with it names none, and a reader that
filled in the default without recording that it did so would report a guess as a
fact. Nothing else creates that case — a world always states a rule — so a false
`rule_known` means "this came from a file that did not say".

The generation's value is written on **every** row, and it is the rule the row
describes: the rule whose step produced the node, or, for a node an edit wrote,
the rule the world was running when the edit was recorded. It is written rather
than derived, and that is the decision the rest of this section is about.

#### 3.5.1 Why every row, rather than "the same as the parent, omitted"

The obvious storage for a value that rarely changes is an inheritance: write the
rule when it changes and leave the column empty otherwise, and read it by walking
up to the nearest ancestor that states one. That was rejected, and the reason is
the read path rather than the write path. `record` asks the session where it is
once per recorded generation (`head`), and each rollback or `select` walks the
path from the root to a node (`path_to`). An inherited value turns each of those
single-node reads into a walk: the common case is a session whose rule never
changes, so every read would have to climb to the root, and the whole history
would cost `O(n²)` statements to read back. A per-row value is one row read.

Storing it per row also makes the column **immune to a later `set_rule` rewriting
history**: the row says what ran, and a rule adopted afterwards cannot reach back
and relabel a generation that ran under something else.

#### 3.5.2 What it costs

Measured, 256 x 256, a glider recorded for 2001 generations: the rule column holds
**12 006 bytes, 6.0 bytes per generation**. The same run's `born` + `died` payload
is **16.5 bytes per generation**, so the rule is at its worst — every generation a
single short delta — **26.6 percent** of a stored row, and under 3 percent once
the deltas are large. The same run records and steps at **232 µs per generation**.
[performance.md](performance.md) §4.1 carries the figures and the method.

#### 3.5.3 The normalised table that was rejected

A `lifegame_rule(id, notation)` table with a `rule_id` column would remove the
repetition: 6 bytes per generation becomes one or two, and the notation is stored
once per distinct rule. It was rejected because it buys that with three costs. It
adds a table, which is a second thing to migrate; it adds a join to every read
path, or a per-session cache that has to be invalidated exactly when `set_rule`
runs — the same invalidation problem the per-row value does not have; and it
gives rule text a second home, so "what does this rule say" acquires an owner
besides the world's parser and the archive header. Six bytes per generation is the
price of not having any of those, and it is measured rather than assumed.

### 3.6 Migrating an older store

`Store._ensure_schema` reads the version row. A missing row means a new store and
the schema is created. A version **newer** than `CURRENT_SCHEMA_VERSION` raises,
because a build that guessed at a shape it does not know would misread it. A
version **older** is migrated.

```
read the old rows (one reader per version)
  -> PRAGMA foreign_keys = OFF, outside any transaction, and read back
     (refuse to go on unless the value in force is 0)
  -> begin one transaction
      -> drop the old tables, dependants first
      -> render the current DDL without the connection pragmas, and run it
      -> insert the sessions, then the nodes, then each head
      -> write the version row
      -> PRAGMA foreign_key_check; any violation rolls the whole thing back
      -> commit
  -> PRAGMA foreign_keys = ON, read back and assert
```

**The order is the one SQLite documents for changing a table's shape, and the
first step is why the migration is written this way rather than as a plain drop
and re-create.** `lifegame_generation.parent_id` is a **self-referential** foreign
key with `ON DELETE CASCADE`, and SQLite implements a cascade as an internal
trigger. A `DROP TABLE` with enforcement on performs an implicit `DELETE FROM`
first, so that implicit delete walks the parent chain one level per row and stops
at `SQLITE_MAX_TRIGGER_DEPTH` — 1000 on a default build, measured here as a chain
of 1000 migrating and a chain of 1001 failing. A store whose deepest history is
1300 nodes is therefore a store that cannot be opened at all: the rebuild raised
`too many levels of trigger recursion` before the person who owned it could see
anything. With enforcement off no cascade is attempted, and the depth of a parent
chain cannot decide whether a store migrates.

**The pragma is read back rather than trusted, and that is not defensive
programming — it is a measured failure mode.** SQLite silently ignores
`foreign_keys` and `journal_mode` inside a transaction: it returns the previous
value and raises nothing, so "the statement succeeded" is not evidence that the
setting took. This repository has already paid for that once
([testing.md](testing.md) §7.2). The rebuild therefore calls
`Backend.set_foreign_keys(False)` and refuses to proceed unless the value it gets
back is `0`, and it does so **before** `begin()`, because inside a transaction the
call could not take effect at all. There is no temporary table and no
`ALTER TABLE ... RENAME`: the three tables are dropped and created under their
final names inside the one transaction, so there is no window in which a
half-renamed schema exists.

**The rebuilt rows are written while the database is not checking them, so the
migration asks afterwards whether the result holds together.** `PRAGMA
foreign_key_check` runs inside the transaction, before the commit; a result with
any row in it raises `StoreError` and rolls the entire rebuild back. That is what
makes the refusal safe to rely on: a store whose own rows already violate its
declared keys — a `parent_id` naming nothing, which schema 2 could hold because
its foreign-key enforcement was silently off ([testing.md](testing.md) §7.2) — is
refused rather than imported as a tree whose parent links point nowhere, and the
file is left byte-for-byte as it was: still the old schema, the same tables and
the same rows.

**Enforcement is restored on every path.** The `finally` around the transaction
turns it back on, so the exception path restores it too, and the value that comes
back is asserted **after** the `finally` rather than inside it: an assertion
inside a `finally` would replace a migration failure with a second, less useful
message. A rebuild that raised reports its own cause; a rebuild that succeeded and
then found enforcement still off raises `StoreError` telling the caller to close
and reopen, because the data is migrated and only that connection's setting is
wrong.

**What "enforcement is on" means here.** `foreign_keys` is a setting of the
**connection**, not a property of the file, so the assertion above is about the
connection the migration ran on: it ends with the value read back as `1`, and
every later `Store.open` applies the pragma again, which the connection cases
decide ([testing.md](testing.md) §1). A bare `sqlite3` connection to the same file
reads `0` until it sets the pragma itself — that limitation is
[risks.md](risks.md) STO-20, and nothing in this module claims the setting is
stored.

The two backend methods this needs are on the `Backend` shape
([interfaces.md](interfaces.md) §1): `set_foreign_keys(enabled)` returns the value
**read back** from the database — the SQLite pragma, `@@foreign_key_checks` for
MySQL — and `foreign_key_violations()` returns the dangling references, with
MySQL answering `None` because InnoDB has no statement that re-examines stored
rows the way `PRAGMA foreign_key_check` does. Its DDL is not transactional
either, so this order is verified for SQLite only; §8 and
[risks.md](risks.md) STO-18 state the gap.

Read-rebuild-write rather than a sequence of `ALTER TABLE`, because neither
change so far is additive: schema 1 identified a generation by its
`(session, generation)` pair and had no head, and schema 2 had no rule
provenance, whose columns are `NOT NULL` — so every existing row needs a value the
schema can defend. Rebuilding is one code path both dialects accept. The whole
history is held in memory while it happens, which is acceptable for a
generation-sized store and is stated because it is the reason a very large store
needs room to migrate.

There is exactly **one writer**: `_rebuild_tables`. Each version contributes a
reader and nothing else, so the rules of one dialect, one transaction and one
version row are written once rather than re-implemented per version:

| From | Reader | What it carries over |
|---|---|---|
| 1 | `_read_schema_one` | Sessions, and nodes rebuilt as a chain: schema 1 had no parent column, so the generation immediately before a node in the same session becomes its parent, and the newest node becomes the head |
| 2 | `_read_schema_two` | Sessions with their row ids, nodes with their row ids and parents, and the stored head — with a head that names no node replaced by the session's newest node, because schema 2 declared no foreign key on `head_id` |

**What the migration cannot know.** Schema 2 recorded one rule per session — the
rule the world was running when the session was created — and nothing per
generation; `set_rule` never updated that column. There is therefore no evidence
of what an old session ran after a rule change, and the migration attributes the
recorded rule to **every** generation of the session. For a session that never
changed its rule that is exact. For one that did, the generations after the change
are labelled with the rule the session started on, and **the change point is not
recoverable**: the uncertainty is stated here rather than hidden in a column
default. A session whose stored rule is empty — what a schema-2 build wrote when
it imported an archive whose header named none — is given `DEFAULT_RULE` and
`rule_known = 0`, so the guess stays visible.

**A damaged store: refuse by default, salvage on a copy.** The rebuild runs with
enforcement off, so its result is checked before it is committed; a row whose
`parent_id` names no row is normally refused with the whole transaction rolled
back, and that remains the default. The refusal is safe but it leaves an owner
with no way forward, which was STO-19. `salvage(source, target)` is that way: it
uses SQLite's `VACUUM INTO` to take a consistent copy without opening the source
for writing, then opens the copy with `repair_dangling=True`, which clears a
dangling link on the row that bears it and records the row id in
`Store.repaired_dangling`. A cleared row starts a branch with no parent; a delta
on that branch cannot be replayed, because its keyframe was on the lost path, and
`state_at_node` refuses it with a named error. The damage is therefore bounded and
reported, and the rest of the store stays readable. Repairing the source in place
is rejected: it may be the only copy.

## 4. Complexity

With `n` recorded generations in a session, `L` live cells, and `c` cells changed
by one generation:

| Operation | Work | Bound |
|---|---|---|
| `record`, delta | one transaction, `8c` bytes plus the rule text, one `SELECT` for the head and one for its row | `O(c)` to encode plus `O(1)` for the head |
| `record`, keyframe | one transaction, `8L` bytes plus the rule text, a full read of the live population | `O(L)` plus `O(1)` |
| `state_at` | one `path_to` walk, then one keyframe read plus at most `KEYFRAME_INTERVAL` delta reads and replays | `O(L + K·c)` with `K = KEYFRAME_INTERVAL`, plus one row read per node on the path |
| `rollback` | `state_at` plus `world.restore`, which is `O(L log L)` in the sparse world | `O(L log L + K·c)` |
| `checkout` | `state_at_node` plus `world.restore` plus one head update | the same |
| `truncate_after` | one query for the children of the doomed nodes, one replay and one row rewrite per surviving branch, then one transaction | `O(P + Σ(K·c + L))` over the head's path of length `P` and each surviving branch |
| `rule_changes` | one pass over the session's nodes | `O(n)` |
| `generations` | one query for every row of the session | `O(n)` |
| `latest` | one query for every row of the session, `ORDER BY generation DESC, id DESC`, no `LIMIT` | `O(n)` |
| `write_archive` | one query plus one line per generation | `O(n)` |
| `read_archive` | one INSERT per generation, one transaction | `O(n)` |
| A migration | every row of the old store read, rebuilt and inserted, in one transaction, plus one `PRAGMA foreign_key_check` over the result | `O(n)` time and `O(n)` memory, and independent of how deep the parent chain is |

Two of those deserve comment.

**Rollback is bounded, and that is the point of the keyframe.** Without the
interval, a rollback to generation *n* would replay *n* deltas, so the cost of
going back would grow with how long the session had run. With it, a rollback
replays at most 63 deltas regardless of `n`.

**`record` does not read the chain.** It reads the session's head — one row by
primary key — and the storage kind follows from that node and the new generation
number, so recording is not quadratic in the length of the history. `latest` is
the unbounded query (`ORDER BY` with no `LIMIT`, both blobs included) and nothing
on the recording path calls it; it is what the `open` reply uses once, and it is
measured in [performance.md](performance.md) §5. Its cost is why the read path
was moved off it rather than merely optimised, and a future caller that needs the
newest node should ask `head` rather than `latest`.

## 5. Environment and configuration

| Requirement | Detail |
|---|---|
| Python 3.14 | `slots=True` dataclasses and `zip(..., strict=True)` in the wider package |
| numpy | The coordinate arrays crossing the boundary with the world |
| `sqlite3` | The standard library. The default backend adds no dependency at all |
| A MySQL driver | Optional: `pymysql` through the `mysql` extra, or the official connector if it is already installed. Its absence is a `StoreError` naming the extra |

Configuration is entirely through arguments. No environment variable is read, no
configuration file is parsed, and no default path is assumed: `Store.open` on
SQLite requires a path, and it creates that path's parent directory. Where a
store file belongs is the repository's policy
([ADR 0002](../../adr/governance-and-build/0002-confine-transient-artifacts-to-repository.md)),
not this module's decision.

MySQL options and their defaults are in
[data-flow.md](data-flow.md) §4.

## 6. Why the structural choices were made

| Choice | Reason | What it costs |
|---|---|---|
| A difference per generation, with a keyframe every 64 | What changed is usually much smaller than what exists, so storage tracks change rather than population | A rollback replays instead of reading, and the delta is *larger* than a keyframe for a dense chaotic population ([performance.md](performance.md) §4) |
| Replay forward rather than inverting | Only forward replay can be validated, and only a validated replay can be trusted not to produce a plausible wrong world | The chain from the keyframe must be complete; a gap is a keyframe, which is larger |
| `state_at` asserts the generation exists | Without it, a replay stops at the nearest generation below the target and returns *that*, and the caller cannot tell | One extra query per rollback |
| `restore(cells, generation)` on the world side | `load` leaves the generation counter alone, so restoring a saved generation would silently mislabel it | A second method on the world's shared contract |
| One import from the world module — the rule authority — and no other | A stored rule has to be spelled the way the simulation spells it, or the store holds a rule text the core would refuse; `DEFAULT_RULE` is the world's Conway rather than a second copy of it. Nothing else is imported, so a history recorded from one representation still restores into the other and two peer modules stay peers | A wrong object shape is still an `AttributeError` from the caller rather than a `StoreError` from the store, and the module now has one edge to a peer that has to be kept honest |
| The rule in force written on every generation | Reading one node is one row read, and no later `set_rule` can relabel a generation that already ran; see §3.5.1 | About 6 bytes per generation, measured in §3.5.2 |
| The session's rule stored with a `rule_known` marker | One import path cannot state a rule at all, and a default filled in silently is a guess reported as a fact | One column, and a second thing every reader of `SessionInfo` has to look at |
| Migrating by read-rebuild-write, one writer for all versions | One code path both dialects accept, and one place where the transaction, the version row and the parent links are handled | The whole history is held in memory while it migrates |
| Turning foreign-key enforcement off around the rebuild, and reading the value back | `DROP TABLE` with enforcement on performs an implicit delete, and the self-referential cascade it fires walks the parent chain one level per row, so a store deeper than `SQLITE_MAX_TRIGGER_DEPTH` could not be opened at all; a pragma issued inside a transaction is silently ignored, a failure this repository has already paid for (§3.6) | Two statements around the rebuild, a read-back on each, and a rebuild that refuses to start rather than run with a setting it could not confirm |
| Checking the rebuilt rows with `PRAGMA foreign_key_check` before the commit | The rebuild writes rows the database does not check while enforcement is off, so the check is the only thing that decides whether the result is a tree or a set of pointers at nothing | One check over the result, and a store whose own rows already violated its keys is refused instead of opened |
| A node's row id is its identity, its generation number only a label | Two branches may hold a node with the same number, which is what a fork is | Every read path works in ids, and a generation number alone is not an address |
| Not truncating the future on re-record | Looking at an older state and then editing is how a second branch is made; a branch that deleted its sibling would not be one | Discarding a branch is now an explicit call (`truncate_after`) |
| A truncation keeps a branch it did not name, by clearing the parent link and rewriting the survivor as a keyframe | Deleting the path nodes lets the declared cascade delete the survivor, which is data loss the call never asked for; a survivor left as a delta without its ancestry cannot be replayed, which is the same loss reported later as an error | One replay and one row rewrite per surviving branch, and the tree can hold more than one root |
| The schema as data, rendered per dialect | Two hand-written DDL copies drift; one rendering cannot | A layer of indirection on every statement |
| Blobs hold coordinates, not structures | A stored generation and a wire frame are the same bytes, so an archive can be inspected with tools that already exist | Neither module may change the layout alone, which is what the agreement test enforces |
| Timestamps as ISO 8601 text | The two dialects disagree about time zones, precision and rounding, and a history that reads differently depending on which database wrote it is not portable | Text comparison instead of a date type |
| SQLite as the default | Standard library, no dependency, the file inside the repository, and therefore the path this repository can verify end to end | The backend whose behaviour is verified is also the least capable |
| The MySQL driver as an optional extra | An installation that never uses MySQL installs nothing new | A user who wants MySQL gets a message instead of a working import |
| The `Change` value rather than two snapshots | Both representations already compute what changed while stepping; re-deriving it from two snapshots would scan the live population per step | The world's public surface grew by one method and one type |

## 7. Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| Storing a keyframe per generation | Storage becomes eight bytes per live cell **per generation**. A dense 4096 x 4096 world is 134 MB per generation, which is not a history, it is a copy |
| Storing the world's packed sparse keys instead of coordinates | The layout would be the sparse world's private encoding, so a history could only be restored into the representation that wrote it, and the format would freeze a private structure. Coordinates are what the other two representations and the wire already agree on |
| Inverting a delta to roll back | Nothing to validate against. A forward replay can refuse a delta that does not describe a life transition; an inverted one can only be trusted |
| Replaying and reporting validation failures afterwards | A world would have been restored from a chain known to be broken, and the caller would have to undo it |
| Returning the nearest generation when the requested one is missing | This is the recorded defect ([testing.md](testing.md) §7.1): the caller receives a real world that is the wrong one and has no way to tell |
| Deleting the whole subtree under the cut, which is what the code did before the change | It discards work the caller never named, and the docstring promised the opposite; the measured case is [testing.md](testing.md) §7.8 and [risks.md](risks.md) STO-17 |
| Refusing a truncation that would orphan a surviving branch | A rewind after a fork is ordinary, and a refusal pushes the caller into deleting branches by hand, which is the same loss with more steps |
| Clearing the parent without rewriting the survivor as a keyframe | The rows would survive but the branch could not be replayed, because its keyframe and deltas were on the deleted path; kept but unreadable is not kept |
| A per-dialect DDL file or a migration framework | A framework is a dependency and a project of its own; the two dialects differ in two syntactic places, which two functions cover |
| Inheriting the rule from the nearest ancestor that states one | The common case is a session whose rule never changes, so every single-node read would climb to the root: `record` reads once per generation and `path_to` once per rollback, which is `O(n²)` statements across a history. A per-row value is one row read (§3.5.1) |
| A normalised `lifegame_rule(id, notation)` table | The repetition is real — 6 bytes per generation becomes one or two — but it is bought with a second table to migrate, a join or an invalidation-prone cache on every read path, and a second home for a rule's text (§3.5.3) |
| `ALTER TABLE` per version instead of a rebuild | Neither change so far is additive: schema 1's identity moved from the pair to the row, and schema 3's columns are `NOT NULL`, so every dialect would need its own dance for the same result |
| Rebuilding with foreign-key enforcement on | That is the shape that shipped first, and it lets the depth of a store's parent chain decide whether the store opens: the implicit delete a `DROP TABLE` performs cascades one level per row, and past `SQLITE_MAX_TRIGGER_DEPTH` the drop itself fails. The store this was found on held a 1300-node chain (§3.6) |
| Trusting `PRAGMA foreign_keys = OFF` because the statement returned | SQLite ignores the pragma inside a transaction and reports nothing, so a rebuild that trusted it would run with enforcement on and meet the same cascade. The value is read back, and a rebuild that gets anything but `0` refuses to start |
| Checking the rebuilt rows only after committing | A violation found after the commit is a store that is already half-migrated and cannot be rolled back. The check is inside the transaction, so a refusal to migrate is a rollback |
| Filling in a missing rule without recording that it was assumed | An archive that states no rule is the one case where a value has to be invented; storing it as if the file had said it would report a guess as a fact, and re-exporting would promote it permanently |
| `pickle`, or a binary snapshot format | Not portable across Python versions, not inspectable, and a security problem in a file that is meant to be sent to someone |
| A directory of files, one per generation | The filesystem becomes the database, and crash-safety, atomicity and querying become this project's problem. Rejected in [ADR 0011](../../adr/data-and-formats/0011-sqlite-default-mysql-supported.md) |
| Making MySQL the only backend | The feature would have been unverifiable in this environment, which is the one thing the project's rules forbid more strongly than a second dialect |
| Requiring a MySQL server for the tests | The tests would not run here, so the code they cover would be untested code presented as a feature |
| Putting `record` on the world's line protocol | The protocol moves a world; a history is a separate concern with a separate lifetime, and mixing them would make the world's protocol own a database |

## 8. Known gaps in the implementation

Recorded here because they are properties of the code rather than open questions
about direction. Their risk entries are in [risks.md](risks.md); their
measurements are in [performance.md](performance.md) §4 and §5.

| Gap | Consequence |
|---|---|
| `latest` has no `LIMIT` | Any caller of `latest` transfers every row of the session, both blobs included, for one row. Nothing on the recording path calls it; the `open` reply does, once |
| A migration holds the whole history in memory | A store large enough to matter needs room to migrate, and there is no streaming path; §3.6 states it rather than implying a bound |
| What a schema-2 session ran after a rule change is not recoverable | Its generations are labelled with the rule the session started on. The uncertainty is stated in §3.6, and no value can close it |
| The world's size is never compared with the session's | A mismatch is usually silent, and occasionally surfaces as the world's own out-of-bounds error |
| `ARCHIVE_FORMAT` and `NodeInfo` are public in their submodule and absent from the facade's `__all__` | A consumer cannot name the format it must match, or annotate a node, without reaching past the facade |
| The rule column grows with the length of the history and nothing compresses it | 6.0 bytes per generation measured (§3.5.2); an archive or store of very many generations pays it per row |
| The rebuild's order is verified for SQLite only | MySQL answers `None` from `foreign_key_violations()` — InnoDB has no offline equivalent of `PRAGMA foreign_key_check` — and its DDL is not transactional, so neither the pre-commit check nor the rollback has a MySQL form. [risks.md](risks.md) STO-18 |
| A store whose own rows already violate the declared keys cannot be opened | The rebuild refuses it rather than importing a tree whose parent links point at nothing, and a refusal is a rollback, so nothing is lost; what is absent is any path that repairs, quarantines or partly imports one. §3.6 states it and [risks.md](risks.md) STO-19 records it |
