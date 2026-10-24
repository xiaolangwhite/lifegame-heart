# Evidence — the zero-length GUID `.tmp` class in the system temporary directory

**Topic:** why the environment isolation check excludes one shape of file from
the system temporary directory, and what proves that shape is not this
project's.

**Related:** [scripts/verify-temp-isolation.ps1](../scripts/verify-temp-isolation.ps1),
[environment module testing](../docs/model/environment/testing.md),
[environment module risks](../docs/model/environment/risks.md).

## The observed class

On this machine, files of this shape appear continuously in the system
temporary directory:

* directly in `%LOCALAPPDATA%\Temp` — not in a subdirectory;
* exactly zero bytes long;
* the entire file name is a GUID followed by `.tmp`, for example
  `34764e73-ab94-4926-aaf4-6198e53a570d.tmp`.

Instances are unrelated to any command this project runs, and they also predate
the repository: the earliest recorded instance in the first observation session
was 2026-09-30, while the repository was created on 2026-10-08.

## Why it is not this project's artifact

Two independent observations, both taken from
[dev-log/v0.1.0.md](../dev-log/v0.1.0.md):

1. **Every toolchain step was run on its own and produced none.** Python
   temporary-file creation, Python bytecode compilation, `uv cache dir`,
   `uv python install`, the C++ tool build, a Node temporary file and
   `pnpm install` were executed one at a time, re-listing the class after each.
   All eight steps were clean.
2. **They appear while nothing of ours runs.** In a deliberately idle window —
   the command did nothing but sleep — two new instances appeared in 25
   seconds. A separate run of eight consecutive five-second idle windows
   produced instances in three of them.

Neither observation identifies the writer. Identifying it would need process
tracing, and the finding that matters for this project is the negative one: no
step of this project's toolchain produces this shape.

## How the check treats it

`scripts/verify-temp-isolation.ps1` compares the system-volume fallback
locations before and after a representative workload. A changed file is a
violation **unless** it matches the shape above, in which case it is listed
under `excused as the characterised environmental class`.

The exclusion is deliberately narrow:

| Excluded | Not excluded |
|---|---|
| zero length | anything with content |
| whole name is a GUID | a GUID as part of a longer name |
| `.tmp` extension | any other extension |
| directly in the system temporary directory | anything in a subdirectory |
| | any file in a cache, build, bytecode or package location |

Anything a package manager, a compiler, a build system or an interpreter writes
falls outside the excluded shape, and every cache location a toolchain falls
back to is watched. A project artifact can therefore still fail this check; the
class above cannot be one.

## Why the exclusion is characterized rather than re-proven per run

An earlier revision required the check to *earn* the exclusion on every run:
either at least five instances older than the repository, or an observation of
the class during a ten-second idle window. That design failed, and the failure
is itself the evidence for this one:

* a routine operating-system cleanup of the temporary directory removed the
  historical instances, so the first proof no longer held;
* the idle window happened to be quiet, so the second proof did not hold
  either;
* the check then reported a file that no project tool had written as a
  violation — a false failure on a tree that had not changed;
* the same design also made the gate take 25 s instead of about 8 s, because
  the fallback path slept for ten seconds and then re-scanned the fallback
  locations.

The lesson is recorded because it generalizes: a proof that must be reproduced
on every run can fail for reasons that have nothing to do with the claim it
supports, and a check that fails for unrelated reasons stops being evidence.
