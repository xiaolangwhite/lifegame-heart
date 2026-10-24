# store — responsibilities

> This file owns the claims the module makes, the boundary against each peer it
> touches, what it must do when it fails, and what it must never do. The public
> surface those claims are made of is owned by [interfaces.md](interfaces.md);
> the risks that remain are owned by [risks.md](risks.md).

## 1. Claims

| Id | Claim | Decided by |
|---|---|---|
| STO-S1 | A recorded generation survives the process that recorded it. A session reopened from the same file reports the same sessions and the same generations | [test_history.py](../../../tests/store/test_history.py) — reopen, then compare ids, labels and generation counts |
| STO-S2 | Any recorded generation can be restored exactly into a world. The restored world equals a world stepped to that generation independently, cell for cell and population for population | [test_history.py](../../../tests/store/test_history.py) — rollback equivalence for every generation of a chain |
| STO-S3 | Restoring sets the world's generation counter as well as its cells. A rollback that left the counter behind would be indistinguishable from an undo of the cells alone | [test_history.py](../../../tests/store/test_history.py) — the counter is asserted after each rollback, and the next recorded delta would claim the wrong parent otherwise |
| STO-S4 | A generation is stored as a difference from the one before it when a difference is meaningful, so storage tracks what changed rather than how large the population is | [test_history.py](../../../tests/store/test_history.py) — the first generation is a keyframe and the next three are deltas; a keyframe is written when the chain has a gap |
| STO-S5 | A delta chain is validated as it is replayed. A cell that dies must be alive and a cell that is born must be dead, and a violation is reported at the generation that broke it | [test_history.py](../../../tests/store/test_history.py) — a forged birth is written into the database and reading the chain raises |
| STO-S6 | A request for a generation the store does not have is refused rather than answered with a neighbouring one | [test_history.py](../../../tests/store/test_history.py) — `state_at` raises `SessionNotFound` naming the generation |
| STO-S7 | The schema is declared once and rendered per dialect, and the repository layer writes one parameter form | [test_schema.py](../../../tests/store/test_schema.py), [test_backends.py](../../../tests/store/test_backends.py) — both dialects render every table; a `%s` in the repository source is a failure |
| STO-S8 | The stored coordinate layout and the protocol's `cells` layout are the same bytes | [test_delta.py](../../../tests/store/test_delta.py) — two independent implementations are asserted to agree |
| STO-S9 | An archive carries enough to reconstruct a session — its cells, its rule and every generation's rule — and a file this version does not understand is refused rather than guessed at | [test_archive.py](../../../tests/store/test_archive.py) — round trip into a fresh store, including a session that changed its rule; and one test per refusal |
| STO-S10 | A failed import leaves no half-session behind | [test_archive.py](../../../tests/store/test_archive.py) — a malformed line mid-file is refused and the store is left as it was |
| STO-S11 | Every recorded node names the rule that was in force for it, so a session that changed its rule says which generation each change started at, and a node an edit wrote is attributed to the rule in force when the edit was made | [test_history.py](../../../tests/store/test_history.py) — a session stepped under two rules, its change points compared; [test_rule_provenance.py](../../../tests/store/test_rule_provenance.py) — the same fact from the protocol's side |
| STO-S12 | A rule a file did not state is never reported as one it did. The default is filled in with `rule_known = 0`, and the marking survives being written out again | [test_archive.py](../../../tests/store/test_archive.py) — an archive with no rule in its header, imported, re-exported and imported again; [test_rule_provenance.py](../../../tests/store/test_rule_provenance.py) — the `open` reply's `ruleKnown` |
| STO-S13 | A store written by an older schema is migrated on open, in one transaction, with its history intact; the one thing the migration cannot know is stated rather than hidden in a column default | [test_history.py](../../../tests/store/test_history.py) — a schema-1 store rebuilt with its parent chain, a schema-2 store keeping its row ids, parents and head, and a schema-2 session that stated no rule arriving marked as an assumption |
| STO-S14 | The rebuild runs with foreign-key enforcement off, established **outside any transaction and read back**, checks its own result against the declared keys before the commit, and restores enforcement on every path — so the depth of a parent chain cannot decide whether a store opens | [test_history.py](../../../tests/store/test_history.py) — a 1300-node schema-2 store migrates with every row compared element for element, and a store whose own parent links dangle is refused with its file unchanged; [test_backends.py](../../../tests/store/test_backends.py) — the switch is read back inside a transaction and observed not to take, and the check finds a reference that names no row |

Two things about this table are deliberate.

**The load-bearing claim is STO-S2, not STO-S1.** A chain that stores the wrong
deltas still produces *a* world, and it still survives a reopen. Only comparison
against an independently stepped world decides whether the history is correct,
which is why the equivalence test walks every generation of the chain rather than
sampling one.

**The claims are narrower than the module.** Nothing here claims that recording
is cheap, that the MySQL path works against a server, or that a world of the
wrong size is refused. All three are true statements about the code and none is
a promise; the first is measured in [performance.md](performance.md), the second
is scoped in [testing.md](testing.md) §8, and the third is open in
[risks.md](risks.md) STO-04.

## 2. Peer boundaries

| Peer | What crosses the boundary | What does not |
|---|---|---|
| `world` module | The store reads `width`, `height`, `rule.notation`, `population`, `generation`, `live_cells_in()`, `advance()` and `restore()` off a world object. It imports one thing from the module: the rule authority in [world/rules.py](../../../src/lifegame/world/rules.py) — the parser a stored rule text is canonicalised through, and the notation `DEFAULT_RULE` is taken from | The store does not import a representation, does not name one in its own code, and does not own a rule's grammar: the only spelling of a rule is the world's. The world's public contract is owned by [world/interfaces.md](../world/interfaces.md) |
| SQLite | One file inside the repository, opened with the standard library. The store writes DDL, rows and transactions, and reads them back | The store does not manage the file's location policy — that is [ADR 0002](../../adr/governance-and-build/0002-confine-transient-artifacts-to-repository.md) and the environment module's job — and it does not vacuum, back up or repair the file |
| MySQL | The same logical schema, rendered for the dialect, and one parameter translation | The store does not create the database, does not manage the server, and does not verify a round trip it has no server to run. The DDL a DBA applies is printed, not executed |
| The command line | The public facade, plus `Store.open` | The CLI is a client. It holds no logic the library does not have, except rendering |
| `docs/model/store/` | The promises | The module does not decide the schema of its own documentation; that is [DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) |
| `docs/plan/` | Nothing. Version state is read, never written | The store does not name its own owning version. It links to [VERSIONS.md](../../plan/VERSIONS.md) |

### 2.1 The boundary with `world` is a shape and one import

The store imports exactly one name from the world module — the rule authority in
`lifegame.world.rules` — and it imports it so that a stored rule is spelled the
way the simulation spells it: a rule text is canonicalised through the world's own
parser, so the store cannot hold a spelling the simulation would refuse, and
`DEFAULT_RULE` is `CONWAY.notation` rather than a second copy of it. Everything
else it needs, it takes from the *shape* of the object it is handed: it uses five
attributes and three methods of it. This is a deliberate structural choice with a
cost worth stating: a caller that passes an object with the wrong shape gets an
`AttributeError` from the caller's own object rather than a `StoreError` from the
store, and nothing in this module validates the shape up front.

The benefit is the reason for the cost: because the store knows coordinates and
generation numbers rather than a representation, a history recorded from a sparse
world restores into a tiled one, and a test asserts exactly that
([test_history.py](../../../tests/store/test_history.py)
`test_a_rollback_can_cross_representations`). Wrapping the world behind a
protocol type would have bought a better error message at the price of a
dependency edge between two peer modules, and that edge is the thing this
structure exists to avoid. The one edge the module does take — the rule authority
— is taken for a reason that cannot be met any other way: a second rule grammar
in the store would be a second answer to "what is this rule", which is exactly the
drift the store's provenance columns exist to prevent.

## 3. Failure behaviour

| Condition | Required behaviour | Where it is decided |
|---|---|---|
| The store file cannot be opened | `StoreError` naming the path and the underlying reason | [backends.py](../../../src/lifegame/store/backends.py) |
| The store's schema version is newer than this build understands | `StoreError` naming both versions, refusing to read rather than guessing | [history.py](../../../src/lifegame/store/history.py) |
| The store's schema version is older than this build writes | The store is migrated on open: read, rebuild, write, in one transaction, and the version row is rewritten to the current one. The rule a schema-2 session recorded is written onto **every** generation of it, because that one value is the only evidence that survived; what that cannot know is stated in [implementation.md](implementation.md) §3.6 | [history.py](../../../src/lifegame/store/history.py) |
| The store's schema version is one no migration implements | `StoreError` naming the version and the build's own, refusing to proceed | [history.py](../../../src/lifegame/store/history.py) |
| The store's own rows already violate the declared foreign keys | The rebuild is refused with `StoreError` before it commits, and the transaction rolls back, so the file is left as it was: the old schema, the same tables and the same rows. Importing a tree whose parent links point nowhere would be worse than declining to open it, and what the owner can do next is open, as [risks.md](risks.md) STO-19 | [history.py](../../../src/lifegame/store/history.py) |
| Foreign-key enforcement cannot be established as off before a rebuild | `StoreError` and nothing written. The check happens **before** the transaction opens, because a pragma issued inside one is ignored without an error, so a rebuild that cannot confirm the setting refuses to run rather than running with the wrong one | [history.py](../../../src/lifegame/store/history.py), [backends.py](../../../src/lifegame/store/backends.py) |
| Foreign-key enforcement does not come back on after a rebuild | `StoreError` telling the caller to close and reopen the store. The rows are migrated — the commit happened — and the connection that ran the rebuild is the thing that cannot be trusted, so the value is asserted rather than assumed | [history.py](../../../src/lifegame/store/history.py) |
| A delete that cascades along a deep parent chain | The driver's `too many levels of trigger recursion`, which this module's vocabulary does not translate. Nothing shipped performs one: `truncate_after` removes nodes deepest-first and therefore never cascades. Open in [risks.md](risks.md) STO-16 | [history.py](../../../src/lifegame/store/history.py) |
| Another process holds the store's write lock | `StoreLocked` naming the path, translated from the driver's lock error rather than leaking it | [backends.py](../../../src/lifegame/store/backends.py) |
| A session or generation identifier does not exist | `SessionNotFound` naming what is missing | [history.py](../../../src/lifegame/store/history.py) |
| A replayed delta kills a cell that is not alive, or bears one that is already alive | `StoreError` naming the generation and the cell, refusing to apply the rest | [history.py](../../../src/lifegame/store/history.py) |
| A generation payload's length is not a multiple of eight bytes | `ArchiveError` rather than a truncation. A truncated coordinate would be read as a cell in the wrong place, which is the one failure a rollback cannot recover from | [delta.py](../../../src/lifegame/store/delta.py) |
| An archive is empty, has no header, names another format or version, or carries a malformed line | `ArchiveError` naming the file and, for a line, its number | [archive.py](../../../src/lifegame/store/archive.py) |
| A write fails part-way | The transaction is rolled back. A failed import leaves no session row and no generation rows | [history.py](../../../src/lifegame/store/history.py), [archive.py](../../../src/lifegame/store/archive.py) |
| The MySQL driver is not installed | `StoreError` naming the optional extra to install, never a bare `ImportError` | [backends.py](../../../src/lifegame/store/backends.py) |
| The MySQL server cannot be reached | `StoreError` naming host and port and the driver's own message | [backends.py](../../../src/lifegame/store/backends.py) |
| The world handed in has the wrong size for the session | **Nothing happens.** The size is not compared, and a mismatch is usually silent. This is open, not intended | [risks.md](risks.md) STO-04 |

The single base type is `StoreError`, and a caller either can use the store or
cannot. Subclasses exist where a caller would genuinely branch: `SessionNotFound`
for "ask for something else", `ArchiveError` for "this file is not one", and
`StoreLocked` for "someone else is writing, try later".

## 4. What the module must never do

Even though it technically could:

* It must never answer a request for generation *g* with the state of a
  neighbouring generation. This is the most dangerous failure available to a
  rollback, because the caller cannot tell: the world it gets is a real world,
  just the wrong one. `state_at` therefore asserts the generation exists before
  it opens a keyframe, and that check is the reason the assertion is line one of
  the replay rather than an optimisation over it.
* It must never store a delta whose parent it did not see. A delta is a claim
  about a transition; without the generation before it, the claim is unfalsifiable
  and the chain cannot be validated. A gap, a first generation, or an interval
  boundary must produce a keyframe.
* It must never invert a delta backward to roll back. Replay is forward because
  forward replay can be checked; an inverted delta can only be trusted.
* It must never apply a delta that fails validation, or apply the valid prefix
  and report the failure afterwards. The world must be left as the caller had it,
  and a partially applied chain is worse than a refusal.
* It must never truncate a payload that is not a whole number of cells. Half a
  coordinate is a cell in the wrong place.
* It must never discard a branch because a caller looked at history. A record
  appends a child of the head; moving the working point is `checkout`, and
  discarding a branch is `truncate_after`, which is explicit and is asked for by
  name.
* It must never report an assumed rule as a stated one. A rule filled in for a
  file that named none is stored with `rule_known = 0` and stays marked when it is
  written out again, so a guess cannot become a fact by passing through a newer
  build.
* It must never keep a second spelling of a rule. A stored rule is canonicalised
  through the world's own parser, so `b3/s32` and `B3/S23` are one stored value
  and a notation this module invented cannot reach a row.
* It must never migrate by writing a value the schema cannot defend. A column the
  migration cannot fill from evidence is filled from the only surviving source,
  and the fact that it was inferred is written down rather than left to a default.
* It must never drop or create a table while foreign-key enforcement is on, and it
  must never trust that switching it off took. `DROP TABLE` performs an implicit
  delete; the self-referential cascade behind it is an internal trigger that walks
  a parent chain one level per row; and a pragma issued inside a transaction is
  ignored without a word. The rebuild reads the value back, refuses to start if it
  is not off, and asserts that it is back on.
* It must never commit a rebuild whose own foreign-key check reported a violation.
  The check is inside the transaction, so a store that would hold a dangling
  reference is a rollback rather than a store that opened with links pointing
  nowhere.
* It must never discard work the caller did not name. `truncate_after` is asked
  for by name and removes only the head's own future: a node that hangs off that
  path is rewritten as a keyframe with no parent, so it survives the cut and stays
  replayable ([interfaces.md](interfaces.md) §2.4).
* It must never repair a damaged store in place. A store whose own rows violate
  its keys is refused on open; `salvage` repairs a **copy**, returns the row ids
  it cleared, and leaves the source byte-identical, because the damaged file may
  be a person's only copy. A branch whose ancestry was lost must refuse a replay
  by name rather than invent a state.
* It must never let a backend own a schema. A dialect supplies spelling; a second
  copy of the tables is how two dialects drift apart.
* It must never write a dialect-specific parameter marker in the repository layer. The
  repository writes `?` and the backend translates, so a new dialect is a
  translation rather than an audit.
* It must never present the MySQL path as verified. The SQL is verified and the
  round trip is not, and the difference is stated wherever the backend is
  described.
* It must never decide version state, and it must never name its own owning
  version in prose. It links to [VERSIONS.md](../../plan/VERSIONS.md).
