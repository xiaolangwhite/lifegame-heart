# store — performance

> This file owns the cost of the module in the terms the module trades in —
> bytes per generation and milliseconds per operation — the oracle used to judge
> correctness, the measurement method, and what has not been measured. The
> decisions the numbers feed are owned by [implementation.md](implementation.md)
> §6; the risks that remain are owned by [risks.md](risks.md).

## 1. Is there a performance contract

**No admission floor is declared for this module, and that is a deliberate
statement rather than an omission.** An admission floor exists to stop a version
shipping a known-slow path when a faster one is reachable in the same work item.
There is no such comparison here: the module's cost is one database commit per
recorded generation plus a bounded replay, and the alternative — an in-process
list of generations — is not durable, which is the module's entire purpose. A
floor would be a number chosen without a competitor.

What replaces it is measurement. Every quantity a caller could care about is
recorded below with the command that produced it, and the two figures that
contradict the module's own rationale are stated as measurements rather than
excused.

The one cost that **is** judged against an alternative is the commit, in §5, and
it is judged against the same commit with the pragmas the schema module declares.
That comparison is available because it is a configuration difference rather
than a design difference.

## 2. What a stored generation costs, in bytes

The payload is eight bytes per cell named, and the number of cells named depends
on the storage kind:

| Kind | Cells named | Payload |
|---|---|---|
| keyframe | every live cell, `L` | `8L` bytes |
| delta | every cell born plus every cell that died, `b + d` | `8(b + d)` bytes |

So a delta is smaller than a keyframe exactly when `b + d < L`. That condition is
a property of the *population and its rate of change*, not of the world's size,
and it is the module's central assumption. §4 measures both sides of it.

The per-cell constant is 8, not 16: a cell is two `int32` values.

## 3. The oracle

The oracle for this module is not a timing baseline, it is a world. A generation
restored from the store must equal the same generation produced by stepping a
fresh world independently:

```python
reference = SparseWorld(64, 64); reference.load(SEED); reference.step(g)
restored  = SparseWorld(64, 64); session.rollback(restored, g)
assert sorted(restored.live_cells()) == sorted(reference.live_cells())
```

Every generation of a twelve-generation chain is checked this way, and again
across a keyframe boundary and across a representation change
([testing.md](testing.md) §5). Nothing weaker would do: a chain that stores the
wrong deltas still produces *a* world, so a round trip of one value or a check of
the newest generation would pass while the history was wrong.

The oracle costs a fresh world per generation and is therefore run over short
chains; it is not a timing harness.

## 4. Measured payload sizes

Profile `M1`, one SQLite store file per measurement, population recorded through
`world.advance()` so each generation's delta is what really changed.

**A sparse world that settles.** A 512 x 512 world holding 16,384 isolated cells
placed every fourth row and column. Every cell has no neighbour, so the whole
population dies at the first step:

| Generation | Kind | Born | Died | Payload |
|---|---|---|---|---|
| 0 | keyframe | 16,384 | 0 | 131,072 B |
| 1 | delta | 0 | 16,384 | 131,072 B |
| 2 | delta | 0 | 0 | 0 B |
| 3 | delta | 0 | 0 | 0 B |

Three things are worth reading off that table.

* The per-cell constant is confirmed at **8.00 bytes per live cell**
  (`131072 / 16384`).
* **A delta is not automatically smaller than a keyframe.** The first delta names
  every cell that died, which is the entire population, so it costs exactly what
  the keyframe cost.
* **A settled world costs nothing.** Once nothing changes, the payload is the
  empty byte string. This is the delta's best case and the reason the format
  exists.

**A dense chaotic world.** A 256 x 256 world filled at 30 percent, stepped four
generations:

| Generation | Kind | Born | Died | Payload |
|---|---|---|---|---|
| 0 | keyframe | 19,642 | 0 | 157,136 B |
| 1 | delta | 11,636 | 8,608 | 161,952 B |
| 2 | delta | 8,762 | 12,473 | 169,880 B |
| 3 | delta | 8,942 | 9,280 | 145,776 B |

**Every delta here is larger than the keyframe it descends from.** At 30 percent
fill a chaotic Life world changes about as many cells per generation as it holds,
so `b + d ≈ L` and the delta's advantage disappears — while its `O(b + d)`
replay cost remains. The module has no rule that notices this; it writes deltas
between keyframes whatever the population does. This is
[risks.md](risks.md) STO-08, and it is measured rather than argued.

The honest summary of §4 is therefore narrower than the module's own docstring:
**the delta wins when the change is a small fraction of the population**, which
is the case for the patterns this project cares about — gliders, guns, tracks and
anything that has settled — and not for a dense chaotic fill.

### 4.1 What the per-generation rule costs

The rule in force is written on every generation
([implementation.md](implementation.md) §3.5), so it has a per-row price that the
payload tables above do not include.

Profile `M1`, one store file, a five-cell glider in a 256 x 256 world, 2001
generations recorded, one `record` after one `advance` per generation:

| Quantity | Measured |
|---|---|
| The `rule` column over the whole run | 12 006 B — 6.0 B per generation |
| The `born` + `died` payloads of the same run | 16.5 B per generation |
| `record` + `advance` | 232 µs per generation |

The rule text is the same nine characters on every row, so its per-generation cost
is the text plus the row overhead that points at it, and it does not move with the
size of the world or the population.

The rule column is **26.6 percent of a stored row in its worst case** — when every
generation is a single short delta, so `born + died` is near its floor — and
**under 3 percent** once the deltas are large, which is the case the delta format
exists for (§4). A normalised rule table would take the 6.0 bytes down to one or
two; it was rejected for the three costs listed in
[implementation.md](implementation.md) §3.5.3, and rejecting a measured 4-to-5
byte saving is the kind of decision that has to be written down rather than
implied.

## 5. Measured cost of recording

Profile `M1`, one store file, a five-cell glider in a 256 x 256 world, one
`record` per generation:

| Generations recorded | Milliseconds per record |
|---|---|
| 50 | 7.634 |
| 100 | 8.330 |
| 200 | 8.678 |
| 400 | 7.382 |
| 800 | 6.482 |

**The cost is flat in the length of the chain**, between about five and nine
milliseconds per recorded generation, and it does not grow with 800 generations
of history. The first hypothesis — that `latest`'s missing `LIMIT` made
recording quadratic — is **wrong**, and measuring it is what showed that: the
same curve is flat from 50 to 800 generations.

The cost is the commit. A controlled comparison isolates it, with 200
`BEGIN IMMEDIATE` / `INSERT` / `COMMIT` cycles on a minimal table through plain
`sqlite3`, across the three journal and synchronisation settings the store could
run under:

| Journal mode and synchronisation | Milliseconds per commit |
|---|---|
| rollback journal, `synchronous=FULL` | 5.212 |
| `journal_mode=WAL`, `synchronous=FULL` | 1.454 |
| `journal_mode=WAL`, `synchronous=NORMAL` — the store's setting | 0.014 |

The third row is what the store applies, on **every** connection and outside any
transaction, which is the only place SQLite honours it; the effective values are
read back by a test ([testing.md](testing.md) §7.2). Against the first row that is a
factor of about **370** on this workload. This comparison is on a minimal table
and isolates one commit; it is not a measurement of the store end to end, and it
is labelled as such.

The record-cost curve above and the 232 µs per generation in §4.1 come from
different runs on different workloads — a five-cell glider recorded alone, and a
glider recorded with a step per generation under a newer configuration. §4.1 is
the newer end-to-end figure; the curve above is kept because the shape of the
curve, flat rather than growing, was the finding.

`latest` was measured separately, because it is the one query in the module with
no bound on it:

| Chain length | `latest()` as written | The same query with `LIMIT 1` |
|---|---|---|
| 51 generations | 0.110 ms | 0.035 ms |
| 401 generations | 0.488 ms | 0.025 ms |

`latest` fetches every row of the session, including both blobs, and sorts to
take the first. Nothing on the recording path calls it: `record` reads the
session's head by primary key and is constant in the length of the chain. The
caller that does reach it is the `open` reply, once per archive opened, and a
caller that wants the newest node should ask `head` instead. Both figures are
recorded here so that the cost of the unbounded query is not rediscovered by
surprise.

## 6. Measured cost of rolling back

Profile `M1`, the same 201-generation glider chain, one keyframe every 64
generations:

| Operation | Time |
|---|---|
| `state_at(200)` — one keyframe and up to 63 replayed deltas | 0.569 ms |

The bound is what matters rather than the figure: a rollback replays at most
`KEYFRAME_INTERVAL - 1` deltas regardless of how long the session has run, so
going back 200 generations costs the same as going back 64. Without the interval,
this would have been `O(n)` in the length of the chain and the figure above would
grow with every recorded generation.

`rollback` adds `world.restore` to that, which is dominated by the world's own
cost of building a sorted key array — `O(L log L)` in the sparse world, measured
in the world module's own record
([world/performance.md](../world/performance.md)).

## 7. Candidate changes, and what each would be worth

Listed because they are the alternatives a future version would weigh. None is
scheduled by this file.

| Candidate | Expected effect | Cost |
|---|---|---|
| Add `LIMIT 1` to `latest` | 0.488 ms to 0.025 ms at 401 generations | One clause; the query returns the same row. Nothing on the recording path needs it |
| Bound the rule column by a shared rule table | 6.0 to one or two bytes per generation (§4.1) | A second table to migrate, a join or a cache on every read path, and a second home for rule text. Rejected in [implementation.md](implementation.md) §3.5.3 |
| Choose the storage kind from the measured change ratio as well as the interval | Bounds `b + d` at `L`, so a delta never exceeds the keyframe it descends from | A second predicate in `record`, and the keyframe interval stops being the only bound |
| Batch several generations into one transaction | Amortises the commit over `k` generations | A recording API that takes a batch, and a rollback granularity to decide |
| Store the archive incrementally | Constant memory on a large archive | The reader currently parses the whole file before writing anything, which is what makes the failed-import rollback simple |
| Compress a payload | Fewer bytes per delta | A dependency or a hand-written codec, and a format version |

## 8. Noise policy

* **Profile.** Every figure is profile `M1`, as declared in
  [../../plan/PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1.1.
* **Isolation.** One store file per measurement, created for that run and deleted
  afterwards. No concurrent work on the machine, no second writer.
* **Repeats.** The record-cost curve is a mean over every generation of the run
  (50 to 800 samples per point). The commit comparison is a mean over 200 cycles.
  `state_at` and `latest` are means over 20 and 50 calls respectively. Every
  figure states its sample size.
* **What is a single run.** The payload tables in §4 are one run each; they are
  exact byte counts rather than timings, so there is nothing for noise to move.
* **What is not averaged away.** The record-cost curve is reported at five chain
  lengths rather than as one number, because the shape of the curve — flat, not
  growing — is the finding.
* **What would invalidate a figure.** A store on a network filesystem, a second
  writer, a different journal mode, or a machine under load. The commit cost in
  particular is an `fsync` cost and is a property of the storage device.

## 9. Not measured

* **The MySQL round trip, end to end.** No server, client, port or driver exists
  in this environment. The command that would close it is in
  [testing.md](testing.md) §8. This is the module's largest unmeasured surface.
* **A MySQL commit, or any comparison of the two backends' speed.** The commit
  cost measured in §5 is SQLite's.
* **A chain long enough for `latest` to matter.** The longest measured chain is
  800 generations, where the commit still dominates by two orders of magnitude.
* **Concurrent writers.** No measurement of two stores on one file, which is
  also where the missing `StoreLocked` producer would matter.
* **Archive size and time.** The archive format adds base64 (about 4/3) to the
  payload plus JSON overhead per line; neither the total size of a large archive
  nor the time to write or read one has been measured.
* **Memory.** No measurement of the resident set during a large replay, which
  builds a Python set of every live cell, nor during a migration, which holds the
  whole history of the store being upgraded ([implementation.md](implementation.md)
  §3.6).
* **The cost of a rebuild on a store of realistic size.** The only figures are in
  the record of the fix that made a deep store migrate — a 3486-generation store
  and a 20000-node chain — and they were not taken under this file's noise policy,
  so they are linked rather than restated:
  [dev-log/v0.3.5fix1.md](../../../dev-log/v0.3.5fix1.md). What this file does fix
  is the bound rather than the constant: a rebuild is one pass over the old rows
  ([implementation.md](implementation.md) §4), and the depth of a parent chain no
  longer decides whether it completes.
* **Storage growth over a long session.** The per-generation bytes are measured;
  the total for a session of realistic length is arithmetic from those, not a
  measurement.
