# store — testing

> This file owns what is tested and what is deliberately not, how to run it, the
> fixture layout, which failure modes are covered, the exact command that
> produced the last recorded result, and the defects this work item verified. The
> promises those tests decide are owned by
> [responsibilities.md](responsibilities.md) §1; the measured cost of the same
> operations is owned by [performance.md](performance.md).

## 1. What is tested

`tests/store/` holds six files and **92 test functions**, all of which run
without a server, a network or a browser.

| File | Cases | Decides |
|---|---|---|
| [test_schema.py](../../../tests/store/test_schema.py) | 14 | The logical schema and its rendering: both dialects render every table; MySQL uses MySQL types; the auto key is inline and only once; the composite key survives because it cannot be inline; timestamps are text in both dialects; `?` translates to `%s` only for MySQL; an unknown dialect is refused; an auto column outside the key is a defect rather than a quiet success |
| [test_delta.py](../../../tests/store/test_delta.py) | 6 | The payload codec: a round trip preserves every coordinate including negatives; eight bytes per cell; empty encodes to empty; a truncated payload is refused rather than truncated; a wrongly shaped array is refused; **the stored layout and the wire layout are the same bytes** |
| [test_history.py](../../../tests/store/test_history.py) | 35 | The history itself: schema creation and reopen; **rollback equivalence for every generation**; a rollback across a keyframe boundary; a rollback across representations; the keyframe/delta policy; a gap producing a keyframe; a forced keyframe; a checkout forking instead of discarding; `rewind`; truncation, including a sibling under the cut surviving as a replayable root keyframe; a corrupted chain reported rather than applied; unknown identifiers; archived sessions; a newer schema refused; **a schema-1 and a schema-2 store migrated with their histories intact, and the rule a schema-2 session stated written onto every generation**; **a schema-2 store whose parent chain is deeper than SQLite's trigger limit migrated with every row compared element for element, and still recording and replaying afterwards**; **a schema-2 store whose own parent links already dangle refused with its file unchanged**; the rule every node ran and the generation a rule change started at; unknown backend; SQLite without a path |
| [test_archive.py](../../../tests/store/test_archive.py) | 15 | The file format: a round trip into a fresh store; a label replaced on import; the file is readable text; the write count; **a session that changed its rule coming back with its change points**; **an archive that states no rule imported as an assumption and staying marked through a re-export**; a rule normalised and an unreadable one refused; and one case per refusal — empty, no header, foreign format, wrong version, missing session description, malformed generation line, missing file — plus **a failed import leaving no half-session** |
| [test_backends.py](../../../tests/store/test_backends.py) | 13 | What can be decided about MySQL without a server: the backend names its dialect and opens lazily; an unknown backend is refused; a missing driver or server is a `StoreError` naming the cause; the DDL a DBA would apply is complete; `?` translates to `%s`; **no repository statement writes a dialect-specific marker**; the SQLite pragmas take effect and are re-applied on every connection; `StoreLocked` has a producer; **the foreign-key switch reports the value actually in force, so a switch made inside a transaction is observed not to take**; **the foreign-key check finds a dangling reference written with enforcement off, and a clean store answers with an empty list rather than "not asked"**; **both adapters implement the protocol the history layer needs** |
| [test_rule_provenance.py](../../../tests/store/test_rule_provenance.py) | 9 | Which rule the core is running and whether the history says the same thing: the bridge keeps **no copy** of the rule, `hello`/`state`/`export` report the world's own, a `set_rule` moves the world and the session together and the `history` reply carries a rule per node, `import` adopts the rule the payload names and keeps the running one when it names none, a rule this core cannot run is refused without moving anything, and `open` restores the archived rule and reports whether it was stated |

### 1.1 The load-bearing case

`test_a_rollback_equals_a_world_stepped_independently` in
[test_history.py](../../../tests/store/test_history.py) is the case the module
exists for. It records twelve generations of a glider and then, for **every**
generation from 0 to 12, builds a fresh world, steps it that many times, rolls
the store back into a second fresh world, and compares the live sets and the
populations.

Nothing weaker decides the claim. A chain that stores the wrong deltas still
produces *a* world, so a round trip of one payload, or a check of only the newest
generation, would pass with the history wrong. The test also asserts the
restored world's generation counter, because a rollback that restored cells and
left the counter behind would mislabel the next recorded delta.

## 2. How to run it

```powershell
uv run pytest tests/store -q
uv run pytest tests/store/test_history.py -v
uv run pytest -q                     # the whole repository, 476 cases
```

From a shell that has sourced `scripts/env.ps1`
([AGENTS.md](../../../AGENTS.md) §1). The suite needs no network, no server and
no browser; it creates its store files under pytest's temporary directory.

## 3. Fixture layout

There is no shared `conftest.py` and no fixture module. Each file holds what it
needs, which keeps a test readable without following an import.

| Fixture or helper | Where | What it provides |
|---|---|---|
| `store` | [test_history.py](../../../tests/store/test_history.py) | An open `Store` on `tmp_path / "history.db"`, closed by the context manager at the end of the test |
| `tmp_path` | pytest | Every store file and archive file is created under it. The suite writes nothing into the repository |
| `seed_world(world, cells)` | [test_history.py](../../../tests/store/test_history.py) | Loads cells into a world, so a test reads the same whichever representation it is handed |
| `record_generations(store, world, steps, **kwargs)` | [test_history.py](../../../tests/store/test_history.py) | Records generation 0 and then one delta per `advance()`, which is the gap-free pattern the deltas require |
| `HIGHLIFE` | [test_history.py](../../../tests/store/test_history.py), [test_archive.py](../../../tests/store/test_archive.py), [test_rule_provenance.py](../../../tests/store/test_rule_provenance.py) | The second rule the rule tests step under, so a change point has something to be |
| `_write_version_two_store(path, *, rule, head)` | [test_history.py](../../../tests/store/test_history.py) | Writes a schema-2 store by hand, including the empty rule and the dangling head, so the migration is given the shapes only an old build produced. Its DDL declares both foreign keys, which is what makes it a model of the schema that shipped rather than of an easier one |
| `_write_deep_version_two_store(path, *, generations)` | [test_history.py](../../../tests/store/test_history.py) | The same store with a real glider history `generations` nodes deep, which is the fixture that crosses SQLite's trigger limit; the depth is the point, and one keyframe every `KEYFRAME_INTERVAL` generations makes the migrated store replayable as well as openable |
| `ask(world, history=None, **payload)` | [test_rule_provenance.py](../../../tests/store/test_rule_provenance.py) | Runs exactly one request through a real bridge and returns its one reply, on a fresh bridge each time so nothing can be remembered across requests |
| `GLIDER`, `BLOCK` | [test_history.py](../../../tests/store/test_history.py) | The two patterns the file uses: one that moves, and one that never changes |

The two patterns are chosen for a reason that a test failure showed: the corrupted
chain test needs a pattern that is genuinely unchanged at the generation the
forgery applies to. A still life provides that; with a glider the forged cell
would have moved on and the forgery would be indistinguishable from a real birth.

## 4. Failure modes covered

| Failure mode | Covered by |
|---|---|
| A store file that cannot be opened | [test_history.py](../../../tests/store/test_history.py) — SQLite without a path |
| A schema newer than this build | [test_history.py](../../../tests/store/test_history.py) — the version row is rewritten to 999 and opening is refused |
| A schema older than this build | [test_history.py](../../../tests/store/test_history.py) — a schema-1 store written by hand is opened, its parent chain and head are asserted, and a schema-2 store keeps its row ids, parents and head; a schema-2 session that stated no rule arrives on the default with `rule_known = 0`, and a dangling head is repaired to the newest node |
| A store whose parent chain is deeper than SQLite's trigger limit | [test_history.py](../../../tests/store/test_history.py) — a 1300-node schema-2 store is migrated, every session and generation row is compared element for element, the head is asserted to still be the tip, the store records and replays afterwards, enforcement reads back as `1` and the foreign-key check is empty |
| A store whose own rows already violate a declared key | [test_history.py](../../../tests/store/test_history.py) — a `parent_id` is rewritten to name no row and opening is refused with `StoreError`; the version row, both row sets and the table list are asserted unchanged. `salvage` is then asserted to copy it, clear the link on the copy with `repaired_dangling` naming the row, leave the source byte-identical, apply the ordinary refusal to the source, and refuse to overwrite an existing target |
| A foreign-key check that cannot be answered | [test_backends.py](../../../tests/store/test_backends.py) — MySQL answers `None`, and SQLite's empty list is asserted separately, so "asked and clean" cannot be read as "not asked" |
| A foreign-key switch issued inside a transaction | [test_backends.py](../../../tests/store/test_backends.py) — the setter is called inside `BEGIN IMMEDIATE` and reports `1`, which is the read-back the rebuild refuses to run without |
| A method added to the `Backend` protocol and implemented by one dialect only | [test_backends.py](../../../tests/store/test_backends.py) — both adapter classes are checked against the protocol, so a missing method is a failed test rather than an `AttributeError` on the first MySQL user |
| A rule a stored session or archive states that this build cannot read | [test_archive.py](../../../tests/store/test_archive.py) — an `ArchiveError` naming the file, and nothing stored |
| An unknown backend name | [test_history.py](../../../tests/store/test_history.py), [test_backends.py](../../../tests/store/test_backends.py) |
| A missing MySQL driver or server | [test_backends.py](../../../tests/store/test_backends.py) — either message acceptable, because the machine decides which |
| A session or generation that does not exist | [test_history.py](../../../tests/store/test_history.py) — both, by message |
| A truncation that would leave a surviving branch without its ancestry | [test_history.py](../../../tests/store/test_history.py) — a sibling under the cut is asserted to survive as a root keyframe with its own child still a delta on top, both states replaying to the cells recorded on that branch, and a record on the survivor staying a child of it |
| A corrupted chain | [test_history.py](../../../tests/store/test_history.py) — a forged birth is written directly into the database and the read raises |
| A payload that is not a whole number of cells | [test_delta.py](../../../tests/store/test_delta.py) |
| A payload that is not valid base64 | [test_archive.py](../../../tests/store/test_archive.py) — through a malformed generation line |
| Every archive refusal in [interfaces.md](interfaces.md) §5 | [test_archive.py](../../../tests/store/test_archive.py) — one case each |
| A failed import writing something anyway | [test_archive.py](../../../tests/store/test_archive.py) — the session count is asserted afterwards |
| A dialect-specific parameter marker reaching the repository | [test_backends.py](../../../tests/store/test_backends.py) — the repository source is inspected |
| A world of the wrong size for the session | Not covered, and not checked by the code; see §6 and [risks.md](risks.md) STO-04 |
| Two writers on one file | The locked case is covered by forcing the driver's lock error and asserting `StoreLocked`; two real processes are not; see §6 |

## 5. The last recorded result

Run from the repository root in a shell that had sourced `scripts/env.ps1`,
profile `M1`.

```
uv run pytest tests/store -q
92 passed in 2.23s
```

```
uv run pytest -q
478 passed, 3 deselected in 14.48s
```

Both figures were observed at this revision. The 92 are this module's. The 478
are the repository's selected cases: 92 here, 372 in `tests/world` and 14 in the
environment module's own gate. The 3 deselected are the world module's benchmark
cases.

The per-file split is 14 in `test_schema.py`, 6 in `test_delta.py`, 35 in
`test_history.py`, 15 in `test_archive.py`, 13 in `test_backends.py` and 9 in
`test_rule_provenance.py`, which `uv run pytest tests/store --collect-only -q`
counts as `92 tests collected`. No test in this package is parameterised, so the
function count is the case count.

## 6. Deliberately not tested

| Not tested | Why, and where the gap is owned |
|---|---|
| The MySQL round trip | No MySQL server, client, port or driver exists in this environment. The scope statement and the command that would close it are in §8 |
| A world whose size disagrees with the session | The code does not check it, so a test would only pin the absence. [risks.md](risks.md) STO-04 |
| Two real processes writing one store file | The producer of `StoreLocked` is exercised by forcing the driver's lock error; two processes racing on one file is the situation itself, and reproducing it would pin the driver's timing rather than the module's behaviour. [risks.md](risks.md) STO-05 |
| Deleting a session | No such operation exists on the facade; the declared `ON DELETE CASCADE` is exercised by a test that deletes a session row through the backend and asserts its generations go with it. That session holds a single node: a delete that cascades along a chain deeper than SQLite's trigger limit fails, which is [risks.md](risks.md) STO-16 and the reason a session-deletion feature is a design item rather than a missing call |
| The rebuild order against MySQL | No MySQL server exists, so the pre-commit check, the rollback it protects and the read-back of the switch are executed by the SQLite adapter only; the MySQL adapter's two methods are exercised for their return contract and no more. §8 and [risks.md](risks.md) STO-18 |
| A migration of a store large enough to need streaming | All of the migration's behaviour is decided by hand-written stores; the memory it needs for a large one is time and memory rather than behaviour, and is recorded as unmeasured in [performance.md](performance.md) §9 |
| A very large archive or a very long chain | Time and memory rather than behaviour, recorded as unmeasured in [performance.md](performance.md) §9. The migration's own depth case is different and **is** covered: a 1300-node chain is asserted row for row, because depth there is behaviour and not cost |

## 7. Defects verified in this work item

Each of these was decided by running something, not by reading code. None of them
is a design preference, and none is inferred from the shape of the source.

### 7.1 A rollback to a generation that does not exist returned a neighbouring one

`state_at(g)` opened the newest keyframe at or below *g* and replayed forward to
the newest recorded generation at or below *g*, without ever checking that *g*
itself existed. A caller asking for generation 7 of a chain that stopped at 3
received the state of generation 3, labelled as generation 7.

This is the most dangerous failure available to a rollback, because it is
invisible: what the caller receives is a real world, not an error and not a
corrupt one. The next recorded generation would then have claimed the wrong
parent.

**Fixed.** `state_at` now asserts the requested generation exists before it opens
anything, and raises `SessionNotFound` naming it. The assertion is the first
statement of the replay rather than an optimisation over it, and
[responsibilities.md](responsibilities.md) §4 records the rule in the form that
applies to any future implementation.

### 7.2 The SQLite pragmas the module declared were not in force

`src/lifegame/store/schema.py` declares a preamble of three pragmas and states
that it is "turned on explicitly rather than left to the default: the whole point
of this layer is that a crash does not lose a session, and the default rollback
journal does not give that". `history.py` then executed two of them **after**
`BEGIN IMMEDIATE`.

SQLite ignores both inside a transaction, silently: it returns the previous value
instead of raising. Measured on profile `M1` with three plain `sqlite3`
connections, arranged the way the store arranged them at the time — two of the
pragmas inside `BEGIN IMMEDIATE`:

```
A outside txn, WAL      : ('wal',)
A outside txn, FK       : None (1,)
B inside txn, WAL       : ('delete',)
B inside txn, FK set ON : None read back: (0,)
C reopen of WAL file, FK: (0,)  journal: ('wal',)
```

Read off that experiment:

* **`journal_mode` is `delete`, not `wal`,** when the pragma is executed inside a
  transaction, which is precisely what the module's own comment says is not good
  enough. This is a file property, so it stays wrong for every later connection
  too.
* **`foreign_keys` is `0`** when it is set inside a transaction. The declared
  `ON DELETE CASCADE` never fires, and a generation row could name a session that
  does not exist.
* **`foreign_keys` is a per-connection setting** (row C: reopening the file gives
  `0` again). A corrected schema-creation path would enforce it only on the
  connection that created the schema. The fix has to run on every connection.
* **`synchronous = NORMAL` was declared in the preamble and never executed at
  all**, so the declared and the executed pragma sets differed before the
  transaction question even arose.

**Fixed.** The pragmas are applied by `SqliteBackend` immediately after the
connection is opened and outside any transaction, which is the only place SQLite
honours `journal_mode` and `foreign_keys`, and they are re-applied on every
connection because `foreign_keys` is per-connection.
`test_the_sqlite_pragmas_actually_take_effect` and
`test_the_pragmas_are_reapplied_on_every_connection` in
[test_backends.py](../../../tests/store/test_backends.py) read the effective
values back, so a future change that puts them back inside a transaction fails the
suite instead of passing silently. The record of the defect is kept because the
failure mode — a green suite over a silent no-op — is the one worth remembering.

### 7.3 `latest` fetches the whole chain to take its first row

`SELECT ... FROM lifegame_generation WHERE session_id = ? ORDER BY generation
DESC` has no `LIMIT`, so every call transfers every row of the session — both
blobs included — and sorts it.

**The hypothesis this defect came with was wrong, and measuring it is what showed
that.** It read "`record` calls `latest` once per recorded generation, so
recording is `O(n²)`". `record` does not call `latest`: it reads the session's
head, one row by primary key, so recording is constant in the length of the chain
and the measured record cost is flat from 50 to 800 generations
([performance.md](performance.md) §5). The unbounded query is real — it costs
0.110 ms at 51 generations and 0.488 ms at 401, against 0.025 ms with `LIMIT 1` —
and the caller that reaches it today is the `open` reply, once per archive opened.
It stays recorded as [risks.md](risks.md) STO-10 so that a future caller does not
adopt it for a per-generation path.

### 7.4 A delta can be larger than the keyframe it descends from

Measured on a 30 percent chaotic fill, where every generation's delta exceeded
the generation 0 keyframe (161,952 B against 157,136 B; see
[performance.md](performance.md) §4). The module's rationale for deltas assumes
`b + d < L`, which is true for the patterns this project targets and false for a
dense chaotic population, and nothing in the code notices which one it has.
Recorded as [risks.md](risks.md) STO-08.

### 7.5 `StoreLocked` had no producer

`errors.py` declared and documented three subclasses, and said "Subclasses exist
only where a caller would genuinely branch on them, and **two** do". A second
writer did not receive `StoreLocked`; it received whatever the driver raised,
while the class was exported from the facade, so a caller could write a handler
that could never run.

**Fixed.** `SqliteBackend.begin` translates the driver's lock and busy errors into
`StoreLocked` naming the path, and
`test_a_second_writer_is_told_the_store_is_locked` in
[test_backends.py](../../../tests/store/test_backends.py) forces the condition and
asserts the type and the message. What is still not tested is two real processes
on one file; see §6.

### 7.6 An older store had no upgrade path at all

`_ensure_schema` read the version row and refused anything that was not the
current one, so a store written by an earlier build was unopenable — and the
refusal happened before anything had been read out of it. Schema 1 identified a
generation by its `(session, generation)` pair and had no head; schema 2 had row
identity, parents and a head but no per-generation rule, whose column is
`NOT NULL`, so every existing row needed a value the schema could defend.

**Fixed.** `Store._migrate` reads the old rows with a reader per version and
rebuilds the tables through a single writer, in one transaction, so both dialects
take one path. The one thing the old data cannot supply is stated rather than
invented: a schema-2 session's single rule is written onto every generation of it,
which is exact for a session that never changed its rule, and the generations
after a change point are labelled with the rule the session started on, because
schema 2 kept no evidence of the change. A session whose stored rule is empty
arrives on `DEFAULT_RULE` with `rule_known = 0`. The three cases are decided by
[test_history.py](../../../tests/store/test_history.py)
`test_a_version_one_store_is_migrated_with_its_history_intact`,
`test_a_version_two_store_is_migrated_with_the_session_rule_on_every_generation`
and `test_a_version_two_session_that_never_stated_a_rule_is_marked_not_guessed`.

### 7.7 The schema 2 → 3 rebuild could not open a store whose history was deep

Opening a schema-2 store ran `_rebuild_tables`, which issued `DROP TABLE IF
EXISTS` for each table. `lifegame_generation.parent_id` is a **self-referential**
foreign key with `ON DELETE CASCADE`, and SQLite performs an implicit `DELETE
FROM` when a table is dropped with enforcement on, implementing the cascade as an
internal trigger. The drop therefore walked the parent chain one level per row and
stopped at `SQLITE_MAX_TRIGGER_DEPTH` with `too many levels of trigger recursion`,
so a store deeper than that limit could not be opened at all: the core died on
start-up, the service refused to restart it, and the interface was unusable for
the person whose store it was. The threshold was measured rather than assumed — a
chain of 1000 migrates and a chain of 1001 fails, which is the default limit — and
the store it was found on holds a 1300-node chain.

**No test could have caught it, for two independent reasons, and the second is the
one worth keeping.**

1. The schema-2 fixture was four nodes deep. Every chain shorter than the limit
   migrates, so depth had to be the subject of a case rather than an accident of
   its data.
2. **The fixture's hand-written DDL omitted the foreign keys entirely**, while the
   schema that shipped declared both of them. The fixture was not a model of the
   store it stood for, so no fixture however deep could have produced this against
   the old DDL. A fixture written by hand drifts from the thing it represents, and
   the drift is invisible because the fixture passes.

**Fixed.** `_rebuild_tables` now follows SQLite's documented order for changing a
table's shape ([implementation.md](implementation.md) §3.6), including the
read-back whose reason §7.2 records, and the fixture declares the real keys. The
three migration cases are
`test_a_version_two_store_deeper_than_the_trigger_limit_migrates` — which compares
every session and generation row element for element, asserts the head is still
the tip and the path still reaches the root, and then records and replays on top —
`test_a_migrated_deep_store_still_records_and_replays` and
`test_a_schema_two_store_whose_own_parent_links_dangle_is_refused_untouched`. The
two backend seams are decided by
`test_the_foreign_key_switch_is_read_back_rather_than_trusted`,
`test_a_dangling_reference_is_what_the_foreign_key_check_reports` and
`test_both_backends_implement_what_the_history_layer_needs`.

One side correction came with the fix: `SqliteBackend.script`'s docstring said it
ran "outside a transaction", which was never true — the rebuild is the transaction
that owns it, deliberately, because a `DROP TABLE` that committed on its own would
leave a half-migrated store behind if a later statement failed. The text now says
what the code does.

### 7.8 `truncate_after` destroyed a sibling branch

Measured on the migrated store, not inferred: nodes `[1,2,3,4,5]` with the
working point's path `1 → 2 → 3 → 5` and node 4 a live sibling under node 2.
`truncate_after(0)` removed three path nodes and left `[1]`. Node 4 was gone with
them, although the method's own docstring said only the head's path was affected.

The cause is the declared schema, not the loop: `lifegame_generation.parent_id`
is a self-referential foreign key with `ON DELETE CASCADE`, so deleting node 2
cascaded to every node whose parent it was — including node 4, which was never on
the path the call named. The delete loop was removing exactly what it said; the
database was removing more.

**Fixed.** The call now reads the state of every child of a doomed node that is
not itself doomed, clears that child's parent link and rewrites it as a keyframe
of its own state in the same transaction as the deletes and the head update.
Clearing the link alone would have preserved the rows and destroyed the branch's
replayability, because its keyframe and deltas were on the deleted path; the
keyframe rewrite is what makes the survivor readable rather than merely present.
The returned count is the number of path nodes removed and does not include the
kept branch. The case is
`test_truncating_a_branch_keeps_a_sibling_it_never_named`, which asserts the
survivor's state and its child's state cell for cell, that the child stays a
delta, and that recording on top of the survivor still appends to it.

## 8. What is not verified, and the command that would verify it

**The MySQL round trip.** Stated here because everything else in this file is
about what *was* executed.

What is verified without a server: the schema renders for the MySQL dialect, the
DDL covers every table, the physical types are MySQL's, the auto key is declared
inline, and `?` translates to `%s`. All of that is executed by
[test_schema.py](../../../tests/store/test_schema.py) and
[test_backends.py](../../../tests/store/test_backends.py).

What is **not** verified: that a generation can be written to and read from a
MySQL server by this code. No part of that path has been executed by this
project, because no MySQL server, client, listening port or driver exists in this
environment and no container runtime is available to obtain one. The decision
behind the split is
[ADR 0011](../../adr/data-and-formats/0011-sqlite-default-mysql-supported.md).

The commands that would close the gap, on a machine with a server:

```powershell
uv sync --extra mysql
uv run python -m lifegame.store schema --dialect mysql   # apply this as a DBA
uv run pytest tests/store -q                             # the same suite, MySQL backend
```

Until those run, the honest statement is: **MySQL is implemented, its SQL is
verified, and no generation has been written to or read from a MySQL server by
this project.**
