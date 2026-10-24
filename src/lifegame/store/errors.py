"""The history layer's error vocabulary.

One exception type, because a caller either can use the store or cannot. The
message carries the detail; the class carries the decision. Subclasses exist
only where a caller would genuinely branch on them, and three do: a store file
another process holds, a session or generation that does not exist, and an
archive this version cannot read.
"""

__all__ = ["ArchiveError", "SessionNotFound", "StoreError", "StoreLocked"]


class StoreError(RuntimeError):
    """The store could not do what was asked."""


class StoreLocked(StoreError):
    """Another process holds the store's write lock."""


class SessionNotFound(StoreError):
    """No session, or no generation, with that identifier."""


class ArchiveError(StoreError):
    """An archive file is not one, or is one this version cannot read."""
