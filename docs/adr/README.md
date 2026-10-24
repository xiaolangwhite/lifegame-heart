# ADR index

> **Authority.** This file owns the ADR category navigation and the ADR list.
> A decision's content is owned by its own file. Adding, moving, renaming,
> superseding or recategorising an ADR updates this index in the same work
> item ([../DOCUMENTATION_RULES.md](../DOCUMENTATION_RULES.md) §9).

## Categories

| Category | Owns |
|---|---|
| [governance-and-build](governance-and-build/) | authority, versioning, repository rules, toolchain, build and gates |
| [simulation-core](simulation-core/) | the Python simulation core |
| [service-and-api](service-and-api/) | the NodeJS service surface and its protocols |
| ui-and-visualization | the web UI and visualisation |
| [data-and-formats](data-and-formats/) | persistence, wire formats and migrations |

A category directory exists once it holds its first decision. Categories
without a directory have no recorded decision yet.

## Decisions

| Id | Title | Category | Status |
|---|---|---|---|
| [0001](governance-and-build/0001-single-authority-documentation-system.md) | Single-authority documentation with an executable gate | governance-and-build | Accepted |
| [0002](governance-and-build/0002-confine-transient-artifacts-to-repository.md) | Confine every transient artifact to the repository tree | governance-and-build | Accepted; path clause superseded by 0004 |
| [0003](governance-and-build/0003-cpp-is-tooling-only.md) | C++ is tooling only | governance-and-build | Accepted |
| [0004](governance-and-build/0004-cache-locations-are-checkout-relative.md) | Cache locations are checkout-relative | governance-and-build | Accepted |
| [0005](simulation-core/0005-sparse-representation-at-target-scale.md) | Sparse representation at the target scale | simulation-core | Accepted |
| [0006](simulation-core/0006-numpy-is-the-vectorised-substrate.md) | numpy is the vectorised substrate | simulation-core | Accepted |
| [0007](service-and-api/0007-viewer-service-delivered-in-phase-02.md) | The viewer service is delivered in phase 02 | service-and-api | Accepted |
| [0008](simulation-core/0008-the-world-is-bounded-and-does-not-wrap.md) | The world is bounded and does not wrap | simulation-core | Accepted |
| [0009](simulation-core/0009-sort-based-sparse-does-not-scale-to-the-target.md) | The sort-based sparse step does not scale to the target | simulation-core | Accepted; gap closed for clustered populations by 0010 |
| [0010](simulation-core/0010-tiled-bit-parallel-representation.md) | Tiled bit-parallel representation for clustered populations | simulation-core | Accepted; closes 0009 for clustered populations |
| [0011](data-and-formats/0011-sqlite-default-mysql-supported.md) | SQLite is the default history backend and MySQL is a supported one | data-and-formats | Accepted; MySQL round trip not verified in this environment |
| [0012](simulation-core/0012-atomic-patch-in-the-core-protocol.md) | The core gains an atomic patch command for editing | simulation-core | Accepted (design); implementation Planned |
| [0013](service-and-api/0013-editing-is-a-versioned-document.md) | Editing is a versioned document over a paused session | service-and-api | Accepted (design); implementation Planned |
| [0014](data-and-formats/0014-snippets-are-content-addressed-objects.md) | Snippets are content-addressed, published objects | data-and-formats | Accepted (design); implementation Planned |

The status column mirrors each decision's own `Status` section; the decision
file wins if the two ever disagree.
