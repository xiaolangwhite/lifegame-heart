"""The stored coordinate layout, and its agreement with the wire layout.

Two encodings of the same bytes exist: the database column and the protocol's
``cells`` payload. They are independent implementations on purpose — one is
storage and one is transport, and neither module should depend on the other — so
the agreement between them is a test rather than a comment.
"""

import base64

import numpy as np
import pytest

from lifegame.store.delta import CELL_BYTES, decode_cells, encode_cells
from lifegame.store.errors import ArchiveError
from lifegame.world.bridge import decode_cells as protocol_decode_cells
from lifegame.world.bridge import encode_frame


def test_a_round_trip_preserves_every_coordinate() -> None:
    cells = np.array([[0, 0], [1, 2], [65535, 65535], [7, 9]], dtype=np.int32)
    assert np.array_equal(decode_cells(encode_cells(cells)), cells)


def test_eight_bytes_per_cell() -> None:
    cells = np.array([[3, 4], [5, 6]], dtype=np.int32)
    assert CELL_BYTES == 8
    assert len(encode_cells(cells)) == 2 * CELL_BYTES


def test_nothing_encodes_to_nothing() -> None:
    assert encode_cells(np.empty((0, 2), dtype=np.int32)) == b""
    assert decode_cells(b"").shape == (0, 2)
    assert decode_cells(None).shape == (0, 2)


def test_a_truncated_payload_is_refused_rather_than_truncated() -> None:
    """Half a coordinate read as a whole one is a cell in the wrong place."""
    with pytest.raises(ArchiveError, match="multiple of 8"):
        decode_cells(b"12345")


def test_a_wrongly_shaped_array_is_refused() -> None:
    with pytest.raises(ValueError, match=r"\(M, 2\)"):
        encode_cells(np.zeros((3, 3), dtype=np.int32))


def test_the_stored_layout_and_the_wire_layout_are_the_same_bytes() -> None:
    """An archive and a frame must not drift into two formats."""
    cells = np.array([[1, 0], [2, 1], [0, 2], [40, 41]], dtype=np.int32)
    stored = encode_cells(cells)

    from lifegame.world import SparseWorld

    world = SparseWorld(64, 64)
    world.load((int(x), int(y)) for x, y in cells)
    frame = encode_frame(world, 0, 0, 64, 64)
    assert frame["format"] == "cells"
    wire = base64.b64decode(frame["data"])

    # The frame orders cells by key (ascending y, then x); storage preserves the
    # caller's order. The bytes agree cell for cell, which is what matters.
    assert sorted(_pairs(stored)) == sorted(_pairs(wire))
    assert np.array_equal(protocol_decode_cells(base64.b64encode(stored).decode("ascii")), cells)


def _pairs(payload: bytes) -> list[tuple[int, int]]:
    return [tuple(int(value) for value in cell) for cell in decode_cells(payload)]
