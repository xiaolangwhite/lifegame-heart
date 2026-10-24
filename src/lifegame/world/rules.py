"""Rule objects for the life world.

A rule is a pair of neighbourhood-count sets: the counts that bring a dead cell
to life (birth) and the counts that keep a live cell alive (survive). Conway's
rule is birth on 3 and survival on 2 or 3, written ``B3/S23`` — the notation the
Life community uses, and the one this class reports through :attr:`LifeRule.notation`.

This module is the **only** place a rule's text is understood, and the only place
the decision it implies is derived. Everything a representation needs from a rule
is precomputed here, once per rule:

``birth_table`` / ``survive_table``
    A nine-entry decision table for counts 0..8. ``birth_table[count]`` answers a
    dead cell, ``survive_table[count]`` a live one; between them they say, for
    every count, whether the cell is born, survives unchanged or stays dead. The
    sparse and dense worlds index them directly.
``birth_mask`` / ``survive_mask``
    The same decision packed into a *bit* mask: bit ``i`` is set when count ``i``
    is in the set, so the whole rule is at most nine bits of a sixteen-bit word.
    The tiled world's bit-parallel selection network consumes this form, because
    a 64-cell word cannot be branched per cell and a mask can be selected bitwise.

Deriving both here rather than in each world is what makes a rule switch cheap
and single-sourced: a representation adopts a new rule by taking these values
again, and no representation keeps a second copy of the parse.

The text form is parsed in one direction and printed in the other, and the two
are inverse: ``LifeRule.parse(CONWAY.notation) == CONWAY`` for every rule. The
sets are normalised to ascending order on the way in, so ``S32`` and ``S23``
are the same rule and both print as ``S23``. A rejection names the single fault —
a missing section, a character that is not a digit, a count above the eight
neighbours a cell has, a repeated digit, an empty string — because a caller that
shows a person why the rule was refused needs the reason, not a boolean.

Authority: docs/model/world/interfaces.md.
"""

from dataclasses import dataclass, field

__all__ = ["CONWAY", "LifeRule"]

#: The largest neighbour count a Moore neighbourhood can produce.
MAX_NEIGHBOURS = 8
#: The bit that carries a count of eight in a packed rule mask.
COUNT_EIGHT_BIT = 1 << MAX_NEIGHBOURS
#: The digits a rule's text may name, in the one order they are printed in.
_DIGITS = "012345678"


def _pack(counts: frozenset[int]) -> int:
    """The counts as a bit mask: bit ``i`` set when ``i`` is in the set."""
    mask = 0
    for count in counts:
        mask |= 1 << count
    return mask


def _table(mask: int) -> tuple[bool, ...]:
    """The nine-entry decision table a packed mask describes."""
    return tuple(bool(mask >> count & 1) for count in range(MAX_NEIGHBOURS + 1))


def _digits(mask: int) -> str:
    """The ascending digit string a packed mask prints as."""
    return "".join(_DIGITS[count] for count in range(MAX_NEIGHBOURS + 1) if mask >> count & 1)


@dataclass(frozen=True, slots=True)
class LifeRule:
    """A birth/survive rule over the eight Moore neighbours.

    Instances are immutable, hashable and normalised, so two rules that name the
    same counts are equal however they were written or built. The four derived
    members are filled in by :meth:`__post_init__`; they are not constructor
    arguments and they take no part in equality, because the counts are the rule
    and the tables are merely its precomputed form.
    """

    #: The neighbour counts that bring a dead cell to life.
    birth: frozenset[int]
    #: The neighbour counts that keep a live cell alive.
    survive: frozenset[int]
    birth_mask: int = field(init=False, repr=False, compare=False)
    survive_mask: int = field(init=False, repr=False, compare=False)
    birth_table: tuple[bool, ...] = field(init=False, repr=False, compare=False)
    survive_table: tuple[bool, ...] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        birth = frozenset(self.birth)
        survive = frozenset(self.survive)
        for name, counts in (("birth", birth), ("survive", survive)):
            for count in counts:
                if not 0 <= count <= MAX_NEIGHBOURS:
                    raise ValueError(f"{name} count {count} is outside 0..{MAX_NEIGHBOURS}")

        birth_mask = _pack(birth)
        survive_mask = _pack(survive)
        for name, value in (
            ("birth", birth),
            ("survive", survive),
            ("birth_mask", birth_mask),
            ("survive_mask", survive_mask),
            ("birth_table", _table(birth_mask)),
            ("survive_table", _table(survive_mask)),
        ):
            object.__setattr__(self, name, value)

    # -- text form --------------------------------------------------------

    @classmethod
    def parse(cls, text: str) -> LifeRule:
        """Parse ``B<digits>/S<digits>``, or explain why it is not a rule.

        Either case is accepted and the digits may be in any order; the result is
        normalised, so ``parse("b3/S32") == CONWAY``. An empty section is legal:
        ``B/S`` is the rule in which nothing is ever born and nothing survives.

        Raises ``ValueError`` naming the single fault: an empty string, a
        separator count other than one, a missing ``B`` or ``S`` section, a
        character that is not an ASCII digit, a count of nine or more, or a
        repeated digit.
        """
        if not isinstance(text, str):
            raise ValueError(f"a rule must be a string such as B3/S23, got {type(text).__name__}")
        if not text:
            raise ValueError("a rule must not be empty; write it as B3/S23")

        sections = text.split("/")
        if len(sections) != 2:
            raise ValueError(
                f"{text!r} must have exactly one '/' between its birth and survival "
                "counts, as in B3/S23"
            )

        counts: list[frozenset[int]] = []
        for label, section, name in (
            ("B", sections[0], "birth"),
            ("S", sections[1], "survival"),
        ):
            # The section label is the one part of the text that is matched
            # case-insensitively; every other character is reported as it was
            # typed, so a message quotes the user's own text.
            if section[:1].upper() != label:
                raise ValueError(
                    f"{text!r} is missing its {name} section: it must start with "
                    f"{label!r}, as in B3/S23"
                )
            seen: set[int] = set()
            for character in section[1:]:
                if character not in "0123456789":
                    raise ValueError(
                        f"{text!r} contains {character!r} in its {name} section; the "
                        f"counts are the digits {_DIGITS}"
                    )
                if character == "9":
                    raise ValueError(
                        f"{text!r} names {character} as a {name} count, and a cell has "
                        f"at most {MAX_NEIGHBOURS} neighbours"
                    )
                count = int(character)
                if count in seen:
                    raise ValueError(f"{text!r} names the {name} count {count} twice")
                seen.add(count)
            counts.append(frozenset(seen))

        return cls(birth=counts[0], survive=counts[1])

    @property
    def notation(self) -> str:
        """The rule in ``B<digits>/S<digits>`` form, digits ascending."""
        return f"B{_digits(self.birth_mask)}/S{_digits(self.survive_mask)}"

    def __str__(self) -> str:
        return self.notation

    # -- the transition ---------------------------------------------------

    def next_alive(self, was_alive: bool, neighbours: int) -> bool:
        """The next state of one cell, given its state and neighbour count.

        A count outside 0..8 is not a state a Moore neighbourhood can produce, and
        answers ``False``: dead, which is what the boundary of the world already
        means.
        """
        if not 0 <= neighbours <= MAX_NEIGHBOURS:
            return False
        return (self.survive_table if was_alive else self.birth_table)[neighbours]


CONWAY = LifeRule(birth=frozenset({3}), survive=frozenset({2, 3}))


def require_local_birth(rule: LifeRule) -> None:
    """Refuse a rule whose births are not confined to the neighbourhood of life.

    Both locality-based representations — the sparse world, which stores only the
    cells next to a live cell, and the tiled world, which steps only the tiles
    that hold or touch one — rely on the same fact: a dead cell with **no** live
    neighbour has a count of zero and cannot change. A rule that births on zero
    falsifies it, and then the next state depends on the world's *area*: every
    dead cell in a 65536 x 65536 world would come to life, which is 4.29e9 cells
    that neither representation is able to hold.

    So the rule is refused instead of being answered wrongly. `DenseWorld`, which
    scans the area by construction, is the representation that can run it, and it
    is the oracle these two are checked against.
    """
    if 0 in rule.birth:
        raise ValueError(
            f"{rule.notation} is not a local rule: birth on a count of zero turns "
            "every dead cell in the world into a live one, including the cells no "
            "live cell is near, so this representation cannot hold the result; use "
            "DenseWorld, or a rule without a zero in its birth set"
        )
