# Evidence — Windows directory access label versus sandboxed sessions

**Topic:** why a directory created outside a sandboxed agent session becomes
unwritable for that session, and how this repository prevents it.

**Related:** [ADR 0002](../docs/adr/governance-and-build/0002-confine-transient-artifacts-to-repository.md),
[phase 01 risks R01 and R02](../docs/plan/phase-01-foundation/risks.md).

## Symptom

Creating any file inside an existing project directory failed while the same
operation succeeded in a freshly created directory one level up:

```
New-Item : 对路径"wtest-52e1318f"的访问被拒绝。
    + CategoryInfo  : PermissionDenied: (E:\...\TEMP\wtest-52e1318f:String) [New-Item], UnauthorizedAccessException
```

Reading the directory worked. Deleting or renaming it failed as well.

## Investigation

| Observation | Command | Result |
|---|---|---|
| Confined session integrity level | `whoami /groups` filtered for the mandatory label | `Mandatory Label\Low Mandatory Level  S-1-16-4096` |
| Label on the repository root | `icacls` on the root | `Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)` |
| Label on a directory created by the confined session | `icacls` on the new directory | inherited `Mandatory Label\Low Mandatory Level:(I)(OI)(CI)(NW)` |
| Label on the pre-existing directories | `icacls` on each | no mandatory label line at all |
| Effective access for the session user | access check per directory | `WRITE_DAC`/`WRITE_OWNER` missing on the pre-existing directories until repaired |
| Directory ACLs otherwise | `Get-Acl` | identical inherited allow entries to a working directory |

## Mechanism

Two independent effects combined:

1. **Mandatory label.** The sandboxed session runs at low integrity. An object
   without an explicit integrity label is treated as medium, and the
   no-write-up policy (`NW`) then denies a low-integrity process any write to
   it. The repository root carries an inheritable low label, so directories
   created *by the session* inherit it and are writable; directories created
   *before* the label policy applied carry no label and are not. Removing or
   changing a mandatory label requires elevation, so it cannot be repaired from
   an ordinary session.
2. **Owner rights.** The pre-existing directories inherited only `Modify` for
   authenticated users, which does not include `WRITE_DAC` or `WRITE_OWNER`.
   The sandbox provisions its own access by writing the directory's
   discretionary access control entries, so it could not provision those
   directories and reported the write as denied.

## Resolution applied

* Every pre-existing project directory was verified to contain no files and
  every subdirectory was verified empty, then the directories were removed and
  recreated by the session itself. Because they now inherit the low label and
  the sandbox's own entry, writes succeed.
* All directory creation was moved into `scripts/bootstrap.ps1`, which runs in
  the same session context as the work that follows it.

## Recurrence prevention

* [ADR 0002](../docs/adr/governance-and-build/0002-confine-transient-artifacts-to-repository.md)
  makes isolated directory creation the responsibility of one script.
* `scripts/verify-temp-isolation.ps1` fails when a location the project depends
  on is not inside the repository, so the next occurrence of an unprovisionable
  directory surfaces as a gate failure rather than as a mystery access error.
* The failure is recorded as risk R01 in
  [phase 01 risks](../docs/plan/phase-01-foundation/risks.md) with a named
  owning version.

## Not covered here

A directory created by a *user* outside the sandbox, inside the repository, has
the same problem and no automatic repair today. That case is R01, and the
mitigation is procedural: create directories through the bootstrap script.
