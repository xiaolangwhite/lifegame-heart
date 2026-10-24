"""Errors shared by every world representation.

The public surface of the module promises one exception type for one condition,
so a caller does not have to know which representation it holds.

Authority: docs/model/world/interfaces.md.
"""

__all__ = ["OutOfBoundsError"]


class OutOfBoundsError(ValueError):
    """A coordinate or rectangle outside the world's bounds was used.

    It derives from :class:`ValueError` so that callers which only care that the
    argument was wrong can catch the built-in type.
    """
