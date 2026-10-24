# ADR 0001 — Single-authority documentation with an executable gate

## Status

Accepted (2026-10-08). Implemented by the documentation system delivered with
the version that names phase 01 milestone 00 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md).

## Context

The project is worked on by agents and humans in the same tree. Free-form
documentation drifts in two directions at once: the same fact is written in
several files and only some of them are updated, and a claim's age cannot be
told from its wording. Both failures are silent, and both make the document
tree actively harmful as a source of truth.

Two candidate designs were considered:

1. **Convention only.** Document the rules and rely on reviewers. Rejected:
   the repository already depends on agents that cannot be assumed to have
   read a long policy, and the failure mode is invisible.
2. **Hash-verified generated manifests.** Generate a manifest plus a hash
   receipt and fail configuration when the receipt is stale. Rejected for this
   project: the freshness mechanism costs a generation step, a receipt file and
   a gate for every documentation change, while the actual drift this project
   suffers from is structural (missing sections, broken links, wrong status
   vocabulary, copied authority), not content-hash drift. The user explicitly
   excluded hash verification from scope.

## Decision

Adopt a single-authority documentation system with an executable conformance
gate:

* Every claim type has exactly one owner file. Consumers summarise and link.
  The assignment is normative in
  [../../DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §2.
* Version order and state live only in
  [../../plan/VERSIONS.md](../../plan/VERSIONS.md).
* Status words come from a closed vocabulary defined in
  [../../AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §3.
* A C++ tool, `tools/documentation`, checks the mechanical subset of the rules
  — required layout, English paths, LF and BOM, link resolution, status
  vocabulary, forbidden marker words, version syntax, authority leakage, ADR
  naming and sections, module contract completeness and catalog agreement — and
  reports stable check codes with a deterministic ordering.
* No content hashes and no hash receipts are part of the mechanism.

## Consequences

* A structural documentation defect becomes a build-time failure instead of a
  review comment.
* The gate can only check what is mechanically decidable. Judgement-bearing
  rules — diagram triggers, ownership of a claim, whether an acceptance
  criterion is measurable — remain reviewer duties, and the gate's README says
  so explicitly.
* Check codes become an interface. Renaming or removing one is a decision that
  requires a superseding ADR, because the rules and the tool would otherwise
  drift apart.
* Documentation changes now carry a tool dependency: the tree cannot be
  validated without a working C++ build.

## Superseding

None.
