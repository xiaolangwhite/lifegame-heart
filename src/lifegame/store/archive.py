"""Portable archives: a session as one inspectable text file.

The database is the working store; an archive is what leaves the machine. It is
JSON Lines — a header, then one line per generation — because a format that a
person can read with `Get-Content` is a format that can be diagnosed without this
code, and because a partially written archive is still a file whose first lines
are valid.

Coordinates are base64 of the same bytes the database column holds and the same
bytes the protocol's ``cells`` frames carry, so an archive is not a fourth
encoding of a world. The header carries the format name and version, so a reader
can refuse a file it does not understand instead of guessing.

The rule travels with the archive, in two places and for two reasons: the header
states the rule the session is running now, and every generation line states the
rule that was in force for it, so a session that changed its rule mid-history
imports with its change points rather than flattened onto one rule. An archive
written before the rule travelled at all states neither: the reader fills the
default and records that it did so, and re-exporting keeps that marking, so a
guess made once cannot become a fact by being written out again.
"""

import base64
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from lifegame.store.errors import ArchiveError
from lifegame.store.history import (
    ARCHIVE_FORMAT,
    ARCHIVE_VERSION,
    DEFAULT_RULE,
    Session,
    normalize_rule,
)

__all__ = ["read_archive", "write_archive"]


def _encode(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")


def _decode(text: Any) -> bytes:
    if text is None or text == "":
        return b""
    if not isinstance(text, str):
        raise ArchiveError("a payload must be a base64 string")
    try:
        return base64.b64decode(text, validate=True)
    except Exception as exc:  # noqa: BLE001 - binascii.Error is not stable across versions
        raise ArchiveError(f"a payload is not valid base64: {exc}") from exc


def write_archive(session: Session, path: str | Path) -> int:
    """Write ``session`` to ``path``; report how many generation lines were written."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    info = session.info
    written = 0
    with destination.open("w", encoding="utf-8", newline="\n") as handle:
        header = {
            "kind": "header",
            "format": ARCHIVE_FORMAT,
            "version": ARCHIVE_VERSION,
            "session": {
                "label": info.label,
                "world_width": info.world_width,
                "world_height": info.world_height,
                "rule": info.rule,
                # Whether the rule was stated or assumed. A false here is not a
                # decoration: it is what stops the default a reader filled in
                # from being read back as something the session recorded.
                "rule_known": info.rule_known,
                "representation": info.representation,
                "created_at": info.created_at,
            },
        }
        handle.write(json.dumps(header, separators=(",", ":"), ensure_ascii=False) + "\n")
        for generation in session.generations():
            kind, born, died = session.payload(generation.generation)
            line = {
                "kind": "generation",
                "generation": generation.generation,
                "storage": kind,
                # The rule in force for this generation, on its own line: a
                # reader answering "what ran here" needs no header and no line
                # before it, and the change points are where the value changes.
                "rule": generation.rule,
                "population": generation.population,
                "changed": generation.changed,
                "created_at": generation.created_at,
                "born": _encode(born),
                "died": _encode(died),
            }
            handle.write(json.dumps(line, separators=(",", ":"), ensure_ascii=False) + "\n")
            written += 1
    return written


def read_archive(store: Any, path: str | Path, *, label: str | None = None) -> Session:
    """Read an archive into ``store`` as a new session."""
    source = Path(path)
    if not source.is_file():
        raise ArchiveError(f"no archive at {source}")
    with source.open("r", encoding="utf-8") as handle:
        lines = handle.read().splitlines()
    if not lines:
        raise ArchiveError(f"{source} is empty")
    try:
        header = json.loads(lines[0])
    except json.JSONDecodeError as exc:
        raise ArchiveError(f"{source} does not start with a JSON header: {exc}") from exc
    if not isinstance(header, dict) or header.get("kind") != "header":
        raise ArchiveError(f"{source} does not start with an archive header")
    if header.get("format") != ARCHIVE_FORMAT:
        raise ArchiveError(f"{source} is a {header.get('format')!r} file, not a {ARCHIVE_FORMAT}")
    version = header.get("version")
    if version != ARCHIVE_VERSION:
        raise ArchiveError(
            f"{source} is archive version {version}, and this build writes {ARCHIVE_VERSION}"
        )
    described = header.get("session")
    if not isinstance(described, dict):
        raise ArchiveError(f"{source} has no session description")
    rule, rule_known = _session_rule(described, source)

    from lifegame.store.schema import now

    store.backend.begin()
    try:
        cursor = store.backend.execute(
            "INSERT INTO lifegame_session "
            "(label, world_width, world_height, rule, rule_known, representation, "
            "created_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                label if label is not None else str(described.get("label", "")),
                int(described.get("world_width", 0)),
                int(described.get("world_height", 0)),
                rule,
                1 if rule_known else 0,
                str(described.get("representation", "sparse")),
                str(described.get("created_at", now())),
                0,
            ),
        )
        session_id = int(getattr(cursor, "lastrowid", 0) or 0)
        if session_id == 0:
            row = store.backend.query_one("SELECT MAX(id) FROM lifegame_session")
            session_id = int(row[0]) if row and row[0] is not None else 0
        if session_id == 0:
            raise ArchiveError("the database did not report an id for the imported session")
        rows = [
            _generation_row(session_id, line, source, index, rule)
            for index, line in _generations(lines, source)
        ]
        # The archive is written oldest first, so the parent of each node is the
        # one before it and the head is the last. Reconstructing that here is what
        # makes an imported session a history rather than a list of unrelated
        # generations: without it nothing knows where the world is.
        previous: int | None = None
        head: int | None = None
        for row in rows:
            cursor = store.backend.execute(
                "INSERT INTO lifegame_generation "
                "(session_id, generation, parent_id, kind, rule, born, died, population, "
                "changed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row[0],
                    row[1],
                    previous,
                    row[2],
                    row[3],
                    row[4],
                    row[5],
                    row[6],
                    row[7],
                    row[8],
                ),
            )
            node_id = int(getattr(cursor, "lastrowid", 0) or 0)
            if node_id == 0:
                fetched = store.backend.query_one("SELECT MAX(id) FROM lifegame_generation")
                node_id = int(fetched[0]) if fetched and fetched[0] is not None else 0
            previous = node_id or previous
            head = node_id or head
        if head is not None:
            store.backend.execute(
                "UPDATE lifegame_session SET head_id = ? WHERE id = ?", (head, session_id)
            )
        store.backend.commit()
    except Exception:
        store.backend.rollback()
        raise
    return store.session(session_id)


def _session_rule(described: dict[str, Any], source: Path) -> tuple[str, bool]:
    """The rule the archive's header names, and whether it named one at all.

    An archive written before the rule travelled with it states none. Filling in
    the default is then the only thing a reader can do, and the caller is told
    that it was a fill — the second value is ``False`` — rather than being handed
    a guess that looks like something the file recorded.
    """
    stated = described.get("rule")
    if not isinstance(stated, str) or not stated.strip():
        return DEFAULT_RULE, False
    try:
        rule = normalize_rule(stated)
    except ValueError as exc:
        raise ArchiveError(f"{source} states a rule this build cannot read: {exc}") from exc
    # A header that already says its rule was assumed keeps saying so, which is
    # what stops a guessed default from becoming a fact by being re-exported.
    return rule, bool(described.get("rule_known", True))


def _generations(lines: Iterable[str], source: Path) -> Iterable[tuple[int, str]]:
    for index, text in enumerate(lines[1:], start=1):
        if not text.strip():
            continue
        yield index, text


def _generation_row(
    session_id: int,
    text: str,
    source: Path,
    index: int,
    inherited: str,
) -> tuple[Any, ...]:
    try:
        record = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ArchiveError(f"{source} line {index + 1} is not JSON: {exc}") from exc
    if not isinstance(record, dict) or record.get("kind") != "generation":
        raise ArchiveError(f"{source} line {index + 1} is not a generation")
    storage = record.get("storage")
    if storage not in ("keyframe", "delta"):
        raise ArchiveError(
            f"{source} line {index + 1} has storage {storage!r}; expected 'keyframe' or 'delta'"
        )
    rule = record.get("rule")
    if rule is None:
        # An archive written before a generation carried its rule names the rule
        # once, in the header; every generation of it ran that one.
        rule = inherited
    elif not isinstance(rule, str) or not rule.strip():
        raise ArchiveError(f"{source} line {index + 1} has a rule that is not a rule text")
    else:
        try:
            rule = normalize_rule(rule)
        except ValueError as exc:
            raise ArchiveError(
                f"{source} line {index + 1} states a rule this build cannot read: {exc}"
            ) from exc
    return (
        session_id,
        int(record.get("generation", 0)),
        str(storage),
        rule,
        _decode(record.get("born")),
        _decode(record.get("died")),
        int(record.get("population", 0)),
        int(record.get("changed", 0)),
        str(record.get("created_at", "")),
    )
