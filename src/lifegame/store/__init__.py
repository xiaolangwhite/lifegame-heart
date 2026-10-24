"""The history layer: sessions, generations, rollback and archives.

A world can be stepped and edited; this module is what makes a *session* of that
outlive the process. It records each generation as the cells that were born and
the cells that died, keeps a keyframe every
:data:`~lifegame.store.history.KEYFRAME_INTERVAL` generations to bound the cost of
walking the chain, can restore any recorded generation into a world, and can
write the whole thing to a text file that leaves the machine. Each generation
also records the rule that was in force for it, so a session that changed its
rule mid-history can still say which generation ran what — the session's own rule
being the rule it is running now.

The schema is defined once in :mod:`lifegame.store.schema` and rendered per
dialect, so SQLite and MySQL are two spellings of one authority rather than two
implementations. SQLite is the default because it needs no dependency and keeps
the history inside the repository; MySQL is available for a shared store and its
driver is an optional extra.

What is verified, and what is not, is stated in
docs/model/store/testing.md rather than implied: the SQLite round trip is
executed end to end here, and the MySQL path's SQL generation is executed by
tests that need no server, because no MySQL server exists in this environment.
"""

from lifegame.store.errors import ArchiveError, SessionNotFound, StoreError, StoreLocked
from lifegame.store.history import (
    ARCHIVE_VERSION,
    DEFAULT_RULE,
    KEYFRAME_INTERVAL,
    GenerationInfo,
    Session,
    SessionInfo,
    Store,
    salvage,
)
from lifegame.store.schema import BACKENDS, CURRENT_SCHEMA_VERSION

__all__ = [
    "ARCHIVE_VERSION",
    "BACKENDS",
    "CURRENT_SCHEMA_VERSION",
    "DEFAULT_RULE",
    "KEYFRAME_INTERVAL",
    "ArchiveError",
    "GenerationInfo",
    "Session",
    "SessionInfo",
    "SessionNotFound",
    "Store",
    "StoreError",
    "StoreLocked",
    "salvage",
]
