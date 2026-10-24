"""The rule object: notation, validation and the transition it defines."""

import pytest

from lifegame.world import CONWAY, LifeRule


def test_conway_reports_the_notation_the_life_community_uses() -> None:
    assert CONWAY.notation == "B3/S23"


def test_notation_sorts_the_digits() -> None:
    rule = LifeRule(birth=frozenset({3, 6, 8}), survive=frozenset({2, 3, 4}))
    assert rule.notation == "B368/S234"


def test_a_count_outside_the_moore_neighbourhood_is_refused() -> None:
    with pytest.raises(ValueError, match="birth count 9"):
        LifeRule(birth=frozenset({9}), survive=frozenset())
    with pytest.raises(ValueError, match="survive count -1"):
        LifeRule(birth=frozenset(), survive=frozenset({-1}))


def test_a_dead_cell_is_born_on_exactly_three_neighbours() -> None:
    for neighbours in range(9):
        expected = neighbours == 3
        assert CONWAY.next_alive(False, neighbours) is expected


def test_a_live_cell_survives_on_two_or_three_neighbours() -> None:
    for neighbours in range(9):
        expected = neighbours in {2, 3}
        assert CONWAY.next_alive(True, neighbours) is expected


def test_rules_are_immutable_and_usable_as_mapping_keys() -> None:
    rule = LifeRule(birth=frozenset({3}), survive=frozenset({2, 3}))
    assert rule == CONWAY
    assert hash(rule) == hash(CONWAY)
    with pytest.raises(AttributeError):
        rule.birth = frozenset()  # type: ignore[misc]


# -- the text form --------------------------------------------------------

#: Rules that parse, with the notation each one prints as. Every entry is a
#: spelling a person or a client may reasonably send.
ACCEPTED = [
    ("B3/S23", "B3/S23"),
    ("b3/s23", "B3/S23"),
    ("B3/s23", "B3/S23"),
    ("B3/S32", "B3/S23"),
    ("b36/s23", "B36/S23"),
    ("B863/S432", "B368/S234"),
    ("B03/S23", "B03/S23"),
    ("B/S", "B/S"),
    ("B2/S", "B2/S"),
    ("B/S012345678", "B/S012345678"),
    ("B3/S012345678", "B3/S012345678"),
    ("B1357/S1357", "B1357/S1357"),
]


@pytest.mark.parametrize(("text", "notation"), ACCEPTED)
def test_parse_accepts_either_case_and_any_digit_order(text: str, notation: str) -> None:
    rule = LifeRule.parse(text)
    assert rule.notation == notation
    assert LifeRule.parse(notation) == rule


def test_parsing_and_printing_are_inverse_for_every_birth_set() -> None:
    """``parse(rule.notation) == rule``, over all 512 birth sets and four evens.

    Exhaustive rather than sampled, because a table or a mask that loses one
    count is exactly the defect that shows up under one rule in a hundred.
    """
    survive_sets = [
        frozenset(),
        frozenset({0}),
        frozenset({2, 3, 5}),
        frozenset(range(9)),
    ]
    for mask in range(512):
        birth = frozenset(count for count in range(9) if mask >> count & 1)
        for survive in survive_sets:
            rule = LifeRule(birth=birth, survive=survive)
            assert LifeRule.parse(rule.notation) == rule
            assert LifeRule.parse(rule.notation).notation == rule.notation


def test_an_empty_section_is_a_rule_and_not_a_typo() -> None:
    assert LifeRule.parse("B/S").birth == frozenset()
    assert LifeRule.parse("B/S").survive == frozenset()
    assert LifeRule.parse("B012345678/S012345678").birth == frozenset(range(9))


def test_a_rule_that_is_not_a_rule_is_refused_with_its_reason() -> None:
    """Every rejection names one fault, and the faults are not interchangeable."""
    rejected = [
        ("", "must not be empty"),
        ("B3S23", "exactly one '/'"),
        ("B3/S2/3", "exactly one '/'"),
        ("/S23", "missing its birth section"),
        ("3/S23", "missing its birth section"),
        ("B3/", "missing its survival section"),
        ("B3/23", "missing its survival section"),
        ("B9/S23", "at most 8"),
        ("B3/S29", "at most 8"),
        ("B89/S23", "at most 8"),
        ("B33/S23", "twice"),
        ("B3/S233", "twice"),
        ("B3/S2x", "digits"),
        ("B3-1/S23", "digits"),
        ("B3/S2 ", "digits"),
        ("B3 /S23", "digits"),
    ]
    for text, reason in rejected:
        with pytest.raises(ValueError, match=reason):
            LifeRule.parse(text)


def test_parse_refuses_something_that_is_not_a_string() -> None:
    with pytest.raises(ValueError, match="must be a string"):
        LifeRule.parse(None)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="must be a string"):
        LifeRule.parse(323)  # type: ignore[arg-type]


# -- the precomputed decision -------------------------------------------

def test_every_count_has_a_precomputed_decision() -> None:
    rule = LifeRule.parse("B36/S12345")
    assert len(rule.birth_table) == len(rule.survive_table) == 9
    for count in range(9):
        assert rule.birth_table[count] is (count in rule.birth)
        assert rule.survive_table[count] is (count in rule.survive)
    assert rule.birth_mask == (1 << 3) | (1 << 6)
    assert rule.survive_mask == sum(1 << count for count in {1, 2, 3, 4, 5})


def test_the_packed_mask_the_table_and_the_sets_agree_for_every_rule() -> None:
    for text, _ in ACCEPTED:
        rule = LifeRule.parse(text)
        assert rule.birth_mask == sum(1 << count for count in rule.birth)
        assert rule.survive_mask == sum(1 << count for count in rule.survive)
        for count in range(9):
            assert rule.birth_table[count] is bool(rule.birth_mask >> count & 1)
            assert rule.survive_table[count] is bool(rule.survive_mask >> count & 1)


def test_next_alive_answers_from_the_precomputed_table() -> None:
    rule = LifeRule.parse("B36/S12345")
    for neighbours in range(9):
        assert rule.next_alive(False, neighbours) is (neighbours in rule.birth)
        assert rule.next_alive(True, neighbours) is (neighbours in rule.survive)


def test_a_count_a_cell_cannot_have_is_dead() -> None:
    assert CONWAY.next_alive(False, 9) is False
    assert CONWAY.next_alive(True, -1) is False
