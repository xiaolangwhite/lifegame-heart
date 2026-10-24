# ADR 0014 — Snippets are content-addressed, published objects

## Status

Accepted (2026-10-19), at the design level. Implementation is **Planned**: it will
be delivered by the version naming phase 04 milestone 00 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md). The editing document itself is
[0013](../service-and-api/0013-editing-is-a-versioned-document.md).

## Context

A repeated shape is the most common editing action the owner described: some
modules repeat, so a small region should be savable and reusable for quick
overwrite fill. The owner chose local drafts plus a publish step into a shared
directory (Q8c), both placement modes with overwrite by default (Q9c), the
transforms (Q10), a 256 x 256 and 8192-cell limit (Q11), and a snippet library
separate from the built-in patterns (Q12).

The built-in pattern library is read-only data shipped with the viewer, placed by
name at the centre of the view. A snippet differs in three ways that matter:
a person authors it, its content changes over time, and it can be placed over an
existing region with overwrite semantics. Those differences decide where it
belongs.

## Decision

* **A snippet is an immutable value**, `{cells, width, height, contentHash}`, with
  the hash computed canonically over the sorted cell coordinates and the box. The
  hash is the identity; the name is an index entry.
* **The shared library is a content-addressed directory**: one object per hash
  under `data/snippets/`, and an `index.json` mapping `name -> hash`. Publishing
  writes the object and updates the index; a name can be pinned as `name@hash` so
  a later publish cannot change what a placement used.
* **A draft is not in the shared library.** The page keeps drafts in browser
  storage and an API client holds its own content; publishing is the explicit
  step that makes a draft shared (Q8c). This keeps the shared directory the only
  place with a permission story, and it keeps an unpublished experiment out of
  everyone else's palette.
* **Publishing a different content under an existing name is refused** unless the
  caller pins the expected hash. There is no silent overwrite of a name.
* **Placement is a stamp operation**, not a separate world-write route: the
  transaction names the source (pattern or snippet), an optional pinned hash, a
  transform (rotate 90/180/270, flip horizontal/vertical) and a mode
  (`overwrite` by default, `merge` optional). The service resolves the content and
  computes the difference; the core still applies only cells.
* **The libraries stay separate** (Q12). Patterns remain read-only data shipped
  with the viewer; snippets are user data with publish, version and delete. They
  share a placement path, not a lifecycle.
* **The content is rule-agnostic.** A snippet is a shape; the world's rule decides
  what it becomes when it runs. This keeps a snippet placeable in any session
  regardless of the rule that produced it.

## Consequences

* A snippet is content-addressed, so publishing the same shape twice yields one
  object; the index is the only mutable part. That is what makes deduplication
  and pinned references cheap.
* Deleting an index entry leaves the object in place. Reference counting, or a
  sweep, is a later decision rather than an assumed safety; the delivery version
  records what deletion means for an already-published hash.
* The directory is user data, not repository source. It follows
  [ADR 0002](../governance-and-build/0002-confine-transient-artifacts-to-repository.md):
  it lives inside the checkout, under `data/`, next to the history and archives.
* A snippet's transform is applied by the service before the difference is
  computed, so the core never learns a snippet or a transform. The transform
  cases assert the exact rotated and flipped cell sets rather than a bounding
  box.
* The 256 x 256 and 8192-cell limits keep a snippet a snippet rather than a
  second world import format. They are product choices, named in the interface;
  the delivery version records the measured cases that motivated them.
* Alternatives were rejected: one mutable JSON file (no immutable identity, no
  pinned references), storing snippets in the history store (a second lifecycle
  in the wrong authority), merging the snippet library with patterns (different
  ownership and mutability), a server-side draft namespace (drafts are private
  until published), and a second world-file format (the store and the archive
  already own world persistence).

## Superseding

None. This ADR does not change
[ADR 0011](../data-and-formats/0011-sqlite-default-mysql-supported.md); snippets
are not history and are not stored in the history database.
