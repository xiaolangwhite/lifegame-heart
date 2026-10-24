"""Coordinates in and out of the bytes a generation is stored as.

The layout is little-endian ``int32`` pairs, ``x`` then ``y``, absolute world
coordinates — the same bytes the protocol's ``cells`` frame encoding carries, and
the same bytes the viewer's decoder reads. That is deliberate: a stored
generation and a wire frame are the same thing, so an archive can be inspected
with the tools that already exist and neither side needs the other's code.

The protocol wraps these bytes in base64 and this module does not, because a
database column holds bytes and a JSON line holds text. A test asserts that the
two encodings agree, so the shared layout cannot drift into two layouts.
"""

import numpy as np

from lifegame.store.errors import ArchiveError

__all__ = ["decode_cells", "encode_cells"]

#: Bytes per stored cell: two ``int32`` values.
CELL_BYTES = 8


def encode_cells(cells: np.ndarray) -> bytes:
    """Pack an ``(M, 2)`` ``x``/``y`` array into a generation payload."""
    if cells.size == 0:
        return b""
    if cells.ndim != 2 or cells.shape[1] != 2:
        raise ValueError(f"expected an (M, 2) array, got shape {cells.shape}")
    return np.ascontiguousarray(cells).astype("<i4").tobytes()


def decode_cells(payload: bytes | None) -> np.ndarray:
    """Unpack a generation payload into an ``(M, 2)`` ``int32`` array.

    A payload whose length is not a multiple of eight is refused rather than
    truncated. A truncated coordinate would be read as a cell in the wrong
    place, which is the one failure mode a rollback cannot recover from: it
    would corrupt the world it was asked to restore.
    """
    if not payload:
        return np.empty((0, 2), dtype=np.int32)
    if len(payload) % CELL_BYTES:
        raise ArchiveError(
            f"a cell payload must be a multiple of {CELL_BYTES} bytes, got {len(payload)}"
        )
    return np.frombuffer(payload, dtype="<i4").reshape(-1, 2).astype(np.int32)
