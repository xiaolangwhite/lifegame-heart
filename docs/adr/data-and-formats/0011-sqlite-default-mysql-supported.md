# ADR 0011 — SQLite is the default history backend and MySQL is a supported one

## Status

Accepted (2026-10-10). Implemented by `src/lifegame/store/` in the version that
names phase 02 milestone 02 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md).

## Context

The project needed a history: every state saved so a session can be rolled back,
archived and resumed after the process that produced it has gone. That is a
database decision, and this is the first one in the `data-and-formats` category.

Three things were true at the time of the decision.

**A relational database is the right shape.** The data is a chain of generations
keyed by session and generation, queried by range, written once and read many
times, and it must survive a crash mid-write. That is a table with a composite
key and a transaction, not a directory of files and not a log this project would
have to make crash-safe itself.

**MySQL was asked for by name.** A shared or long-lived store is a real need, and
a database an operator already runs is cheaper to adopt than one this project
introduces.

**MySQL was not available.** On the machine where this version was built there is
no MySQL client, no server, no service, no listening port and no driver, and no
container runtime to obtain one. A decision to make MySQL the only backend would
therefore have made the whole feature — rollback, archive, persistence —
unverifiable, and this project does not ship a claim it cannot execute.

## Decision

* **The schema is the single authority.** `src/lifegame/store/schema.py` declares
  the tables, columns and constraints once; each dialect supplies spelling
  through `render_ddl` and `render_placeholders`. A backend does not own a
  schema. Prefixing every table (`lifegame_`) keeps the vocabulary clear of the
  dialects' keywords and states the ownership of a database this project may not
  be the only tenant of.
* **SQLite is the default.** It is in the standard library, so the feature adds
  no dependency at all; it stores the history in one file inside the repository,
  which is what
  [ADR 0002](../governance-and-build/0002-confine-transient-artifacts-to-repository.md)
  wants for anything this project creates; and it is therefore the backend whose
  behaviour this repository can and does verify end to end.
* **MySQL is supported through the same schema**, and its driver is an *optional*
  extra (`pymysql`, via `[project.optional-dependencies] mysql`). An
  installation that never uses MySQL installs nothing new, and one that does gets
  a message naming the extra when the driver is missing.
* **What is verified where is stated, not implied.** The SQLite round trip is
  executed by the test suite. The MySQL path's schema rendering, parameter-marker
  translation and SQL generation are executed by tests that need no server. The
  MySQL path's round trip is **not verified** in this repository, and the record
  says so with the command that would verify it.

## Consequences

* A saved session is a file in the repository by default and a row set in a
  shared server on request, with one schema between them. The cost is a layer of
  indirection — a repository that writes `?` and a backend that translates it —
  which is small and is what makes the second dialect affordable at all.
* Timestamps are ISO 8601 text rather than either dialect's date type, because
  the two disagree about time zones, precision and rounding, and a history file
  that reads differently depending on which database wrote it is not portable.
* Coordinates are stored as the same bytes the protocol's `cells` frames carry.
  The two encoders are independent implementations on purpose — one is storage,
  one is transport, and neither module should depend on the other — so a test
  asserts that they agree rather than a comment claiming it.
* The MySQL round trip is an **open item with a named owner**, not a footnote.
  Until a server exists, the honest statement is that MySQL is implemented and
  its SQL is verified, and that no generation has been written to or read from a
  MySQL server by this project.
* Asking for a database by name is not the same as requiring it. Had MySQL been
  made the only backend, the feature's tests would have been unrunnable here and
  the alternative would have been untested code presented as a working feature —
  which this project's rules forbid more strongly than they forbid a second
  dialect.

## Superseding

None. This ADR does not affect
[ADR 0006](../simulation-core/0006-numpy-is-the-vectorised-substrate.md): the
history layer adds no runtime dependency to the default installation, and the
optional MySQL extra is a database driver rather than a computation substrate.
