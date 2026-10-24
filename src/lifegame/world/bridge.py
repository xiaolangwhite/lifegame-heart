"""The world's line protocol: how the NodeJS service drives the Python core.

The core is the authority for the world. The service never computes a
generation itself and never reads the core's memory; it sends requests and
renders what comes back. The protocol is therefore owned here, in the module
that defines it, and the service documents itself as a consumer.

Transport: one JSON object per line, UTF-8, on standard input and standard
output. Requests carry an ``id`` and are answered with the same ``id``;
unsolicited events carry an ``event`` field and no ``id``. Every response is a
single line, flushed immediately, so the service can pipeline.

Requests
--------
``hello``    handshake: protocol version, world size, rule notation, the limits
             the core enforces, and whether a history is being recorded
``state``    generation, population, bounds, running flag, ticks per second
``toggle``   flip one cell
``set``      set a list of cells to one state, applying what it can as it goes
``patch``    apply every listed birth and death atomically, after checking every
             cell and an expected generation, and record the change as one edit
``clear``    remove every cell and reset the generation counter
``set_rule`` adopt a rule for the generations that follow; the cells and the
             generation counter are untouched, and a rule the core will not run
             is refused with ``bad_rule`` and a reason
``step``     apply the rule ``count`` times, report what changed
``run``      start ticking at ``tps``
``pause``    stop ticking
``frame``    a rectangle of the world, encoded as cells or as a packed bitmap
``export``   the whole live set as one portable payload
``import``   replace the world with such a payload, generation and rule included
``history``  the recorded generations as a tree, when a history is being recorded
``select``   load a recorded node and move the working point onto it, so the next
             record becomes a sibling of the children it already has
``rollback`` load a recorded generation into the world, and **only** read: the
             working point does not move, so nothing recorded after that
             generation is lost
``archive``  write the recorded session to a portable file
``open``     read a portable file back as the current session, its rule included
``quit``     end the process

The list above is the whole protocol: nineteen requests. Reading a generation and
working on one are two commands on purpose — one command that did both would turn
looking at history into editing it.

Events
------
``tick``    emitted after each automatic step while running

Representation is chosen at start-up with ``--representation``: ``sparse``
(the default) or ``tiled``. Both answer the identical protocol, so a client
cannot tell them apart; the measurement that decides which is faster for which
shape of population is in docs/model/world/performance.md.

A history is recording when ``--history PATH`` is given. The core then stores
every generation in a SQLite store at that path and answers ``history``,
``select``, ``rollback``, ``archive`` and ``open``; without the argument those
five are refused with ``bad_arguments`` and a message naming the flag. The
history is passed in rather than imported: the store imports this module, so
importing it here would make the cycle real, and only the console entry point
knows both.

Exit codes: ``0`` on ``quit`` or end of input, ``2`` on a usage error.

Authority: docs/model/world/interfaces.md § protocol, docs/model/viewer/interfaces.md.
"""

import argparse
import base64
import binascii
import json
import queue
import sys
import threading
import time
from typing import Any, TextIO

import numpy as np

from lifegame.world.errors import OutOfBoundsError
from lifegame.world.rules import LifeRule
from lifegame.world.sparse import SparseWorld
from lifegame.world.tiled import TiledWorld

__all__ = ["PROTOCOL_VERSION", "Bridge", "decode_cells", "encode_frame", "main"]

PROTOCOL_VERSION = 1
MIN_TICKS_PER_SECOND = 1
MAX_TICKS_PER_SECOND = 60
DEFAULT_TICKS_PER_SECOND = 10
MAX_STEPS_PER_REQUEST = 100_000
DEFAULT_WORLD_SIZE = 65536
# The interactive workload is scattered cells that a person placed by hand, and
# the sparse representation is the faster of the two for that shape. The tiled
# representation wins by an order of magnitude once a pattern is clustered; see
# docs/model/world/performance.md for the measurement that decides this.
DEFAULT_REPRESENTATION = "sparse"
#: The storage choices a client may ask for, advertised in ``hello`` so that no
#: client has to keep its own list.
REPRESENTATIONS = ("sparse", "tiled")
#: The largest coordinate a world may hold, and therefore the largest value a
#: client may send.
_MAX_COORDINATE = (1 << 32) - 1


class _UnknownCommand(Exception):
    """Internal: raised for a command name the protocol does not define."""


def encode_frame(
    world: SparseWorld | TiledWorld,
    x0: int,
    y0: int,
    width: int,
    height: int,
) -> dict[str, Any]:
    """Encode one rectangle of the world for transport.

    Two encodings, chosen by measured size rather than by taste:

    ``cells``
        base64 of little-endian ``int32`` pairs, ``x`` then ``y``, absolute
        coordinates. Costs eight bytes per live cell in the rectangle.
    ``bits``
        base64 of row-major packed bits, one bit per cell, most significant bit
        first, row stride ``ceil(width / 8)`` bytes. Costs ``width * height / 8``
        bytes regardless of population.

    ``cells`` wins when the rectangle is sparse — below one live cell per 64
    cells — which is the common case in a large world. ``bits`` wins when the
    rectangle is dense, where a coordinate list would be larger than the bitmap
    it describes.
    """
    cells = world.live_cells_in(x0, y0, width, height)
    # Eight bytes per live cell, against one bit per cell in the rectangle.
    # Both sides are in bytes; comparing a bit count against a byte count was
    # the first version's defect, and it sent a coordinate list up to eight
    # times larger than the bitmap it was chosen over.
    cell_bytes = int(cells.size) * 4
    bitmap_bytes = ((width + 7) // 8) * height
    if cell_bytes <= bitmap_bytes:
        payload = cells.astype("<i4").tobytes()
        encoding = "cells"
    else:
        packed = np.packbits(world.viewport(x0, y0, width, height), axis=1)
        payload = packed.tobytes()
        encoding = "bits"
    return {
        "x0": int(x0),
        "y0": int(y0),
        "w": int(width),
        "h": int(height),
        "generation": world.generation,
        "population": world.population,
        "format": encoding,
        "data": base64.b64encode(payload).decode("ascii"),
    }


def decode_cells(data: str) -> np.ndarray:
    """Decode a ``cells`` payload into an ``(M, 2)`` ``int32`` array.

    The payload is base64 of little-endian ``int32`` pairs, ``x`` then ``y``,
    which is the same encoding `encode_frame` produces and the same one the
    history layer stores a generation in.

    A payload whose length is not a multiple of eight bytes is refused rather
    than truncated: half a coordinate is worse than an error, and a consumer
    that guesses at a truncated buffer writes cells into the wrong places.
    """
    try:
        payload = base64.b64decode(data, validate=True)
    except binascii.Error as exc:
        raise ValueError(f"'data' is not valid base64: {exc}") from exc
    if len(payload) % 8:
        raise ValueError(
            f"a cells payload must be a multiple of 8 bytes, got {len(payload)}"
        )
    if not payload:
        return np.empty((0, 2), dtype=np.int32)
    return np.frombuffer(payload, dtype="<i4").reshape(-1, 2).astype(np.int32)


class Bridge:
    """Serves the line protocol for one world."""

    def __init__(
        self,
        world: SparseWorld | TiledWorld,
        reader: TextIO,
        writer: TextIO,
        history: Any = None,
    ) -> None:
        """Serve one world.

        The rule is not a constructor argument and is not copied here: it belongs
        to the world, and the world is what the protocol reports. A second copy
        would be a value that agrees with the world only until someone changes
        one of them — and the direction it fails in is silent, since ``hello``
        would answer with a rule no generation will ever run.

        ``history`` is an optional recorded session the bridge logs every
        generation into and can roll the world back to. It is passed in rather
        than built here, and it is duck-typed on purpose: the world module must
        not import the history module, because the history module already imports
        the world. Only the console entry point knows both, which is why the
        import of the store lives in `main`.
        """
        self._world = world
        self._reader = reader
        self._writer = writer
        self._history = history
        self._requests: queue.Queue[str | None] = queue.Queue()
        self._write_lock = threading.Lock()
        self._running = False
        self._ticks_per_second = DEFAULT_TICKS_PER_SECOND
        self._stop = False

    # -- history ----------------------------------------------------------

    def _require_history(self) -> Any:
        if self._history is None:
            raise ValueError(
                "this core was started without a history; pass --history PATH to record one"
            )
        return self._history

    def _adopt_rule(self, rule: LifeRule) -> None:
        """Make the world and the recording run one rule, or change neither.

        Adopting a rule is one action with two records — the world it runs in and
        the session that has to answer "what is this session running" — so the two
        are written together here rather than at each call site. The world is set
        first: it is the one that can refuse a rule this representation cannot
        run, and a refusal must leave both sides where they were.
        """
        self._world.set_rule(rule)
        if self._history is not None:
            self._history.set_rule(rule)

    def _record(self, change: Any) -> None:
        if self._history is not None:
            self._history.record(self._world, change)

    def _record_edit(self) -> None:
        """Record the world after an edit, as a keyframe at the current generation.

        An edit changes the world *between* two generations, so the delta that
        brought the world to this generation no longer describes where the next
        step starts. Replacing the current generation's row with a keyframe keeps
        the chain replayable and puts the edit at the generation it happened.

        Without this the chain is quietly wrong: the replay validation catches it
        as a delta that kills a cell which was never alive, which is how this was
        found rather than shipped.
        """
        if self._history is None:
            return
        self._history.amend_head(self._world)

    def advance(self, count: int = 1) -> int:
        """Step the world, recording each generation when a history is attached.

        Counting is per generation rather than in one call so the recorded chain
        has no gaps. A caller that steps ten generations and records once gets a
        keyframe instead of ten deltas, which is correct but throws away the nine
        intermediate states a timeline wants.
        """
        if self._history is None:
            return self._world.step(count)
        changed = 0
        for _ in range(count):
            change = self._world.advance()
            self._record(change)
            changed = change.changed
        return changed

    # -- transport --------------------------------------------------------

    def _send(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, separators=(",", ":"), ensure_ascii=False)
        with self._write_lock:
            self._writer.write(line + "\n")
            self._writer.flush()

    def _read_lines(self) -> None:
        try:
            for line in self._reader:
                self._requests.put(line)
        finally:
            self._requests.put(None)

    def serve(self) -> int:
        """Run until ``quit``, end of input, or an unrecoverable write error."""
        threading.Thread(target=self._read_lines, name="lifegame-bridge-stdin", daemon=True).start()

        next_tick = 0.0
        while True:
            timeout: float | None = None
            if self._running:
                timeout = max(0.0, next_tick - time.monotonic())
            try:
                if timeout is None:
                    line = self._requests.get()
                else:
                    line = self._requests.get(timeout=timeout)
            except queue.Empty:
                self._tick()
                next_tick = max(time.monotonic(), next_tick + 1.0 / self._ticks_per_second)
                continue
            if line is None:
                return 0
            self._dispatch(line)
            if self._stop:
                return 0

    def _tick(self) -> None:
        changed = self.advance()
        self._send(
            {
                "event": "tick",
                "generation": self._world.generation,
                "population": self._world.population,
                "changed": changed,
            }
        )

    def _dispatch(self, line: str) -> None:
        request: dict[str, Any] | None = None
        try:
            parsed = json.loads(line)
            if not isinstance(parsed, dict):
                raise TypeError("a request must be a JSON object")
            request = parsed
            response = self._handle(parsed)
        except json.JSONDecodeError as exc:
            response = self._error("bad_request", f"line is not valid JSON: {exc}")
        except _UnknownCommand as exc:
            response = self._error("unknown_command", str(exc))
        except OutOfBoundsError as exc:
            response = self._error("out_of_bounds", str(exc))
        except (TypeError, ValueError) as exc:
            response = self._error("bad_arguments", str(exc))
        except Exception as exc:  # noqa: BLE001 - the protocol must never die on one request
            response = self._error("internal", f"{type(exc).__name__}: {exc}")
        if response is None:
            return
        if request is not None and "id" in request:
            response["id"] = request["id"]
        self._send(response)

    @staticmethod
    def _error(code: str, message: str) -> dict[str, Any]:
        return {"ok": False, "error": code, "message": message}

    # -- commands ---------------------------------------------------------

    def _handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        command = request.get("cmd")
        if not isinstance(command, str):
            raise TypeError("every request needs a string 'cmd'")
        handler = getattr(self, f"_cmd_{command}", None)
        if handler is None:
            raise _UnknownCommand(f"unknown command {command!r}")
        return handler(request)

    def _cmd_hello(self, request: dict[str, Any]) -> dict[str, Any]:
        del request
        return {
            "ok": True,
            "protocol": PROTOCOL_VERSION,
            "world": {"width": self._world.width, "height": self._world.height},
            "rule": self._world.rule.notation,
            "running": self._running,
            "tps": self._ticks_per_second,
            # The limits a client would otherwise hard-code. A page that offers a
            # rate the core refuses is a page that lies, and the copy of the
            # number that drifts is always the client's.
            "limits": {
                "ticksPerSecond": {
                    "min": MIN_TICKS_PER_SECOND,
                    "max": MAX_TICKS_PER_SECOND,
                },
                "stepsPerRequest": MAX_STEPS_PER_REQUEST,
                "maxCoordinate": _MAX_COORDINATE,
                "representations": list(REPRESENTATIONS),
            },
            "history": self._history is not None,
        }

    def _cmd_state(self, request: dict[str, Any]) -> dict[str, Any]:
        del request
        bounds = self._world.bounds()
        return {
            "ok": True,
            "world": {"width": self._world.width, "height": self._world.height},
            "rule": self._world.rule.notation,
            "generation": self._world.generation,
            "population": self._world.population,
            "bounds": list(bounds) if bounds is not None else None,
            "running": self._running,
            "tps": self._ticks_per_second,
        }

    def _cmd_toggle(self, request: dict[str, Any]) -> dict[str, Any]:
        x = self._integer(request, "x")
        y = self._integer(request, "y")
        alive = self._world.toggle(x, y)
        self._record_edit()
        return {"ok": True, "x": x, "y": y, "alive": alive, "population": self._world.population}

    def _cmd_set(self, request: dict[str, Any]) -> dict[str, Any]:
        cells = request.get("cells")
        if not isinstance(cells, list):
            raise TypeError("'set' needs a 'cells' list of [x, y] pairs")
        alive = request.get("alive", True)
        if not isinstance(alive, bool):
            raise TypeError("'alive' must be a boolean")
        added = 0
        for entry in cells:
            if not isinstance(entry, (list, tuple)) or len(entry) != 2:
                raise TypeError("every cell must be a [x, y] pair")
            added += int(self._world.set_alive(int(entry[0]), int(entry[1]), alive))
        self._record_edit()
        return {"ok": True, "changed": added, "population": self._world.population}

    def _cmd_patch(self, request: dict[str, Any]) -> dict[str, Any]:
        """Apply born and died cells as one atomic, recorded edit.

        ``set`` applies what it can while it walks its list, so one bad
        coordinate can leave the world half-changed. A transaction cannot be
        expressed that way: it either happens completely or not at all. Every
        part of this request is therefore checked before the first cell is
        written — both lists must hold pairs of integers, no cell may appear in
        both, ``expectGeneration`` must be the world's generation, and every
        coordinate must be inside the world — and a refusal returns before
        anything has moved.

        The generation precondition is what makes a lost race visible to the
        core rather than assumed away by the caller: a change built against an
        older generation is refused with ``stale_generation``. In the editing
        mode the world is paused, so a match is the common case; the refusal is
        the running-world case.

        ``bornCount`` and ``diedCount`` count cells whose state actually
        changed: a born cell that is already alive, or a died cell that is
        already dead, is applied cleanly and is not counted. The reply's
        ``born`` and ``died`` name exactly those changed cells, in the order they
        were applied, so a caller records the change that happened rather than
        the candidate it sent.

        One call records one edit, through the same path as the other mutating
        commands, so a transaction does not become one history node per cell.
        """
        born = request.get("born")
        died = request.get("died")
        if not isinstance(born, list):
            raise TypeError("'born' must be a list of [x, y] pairs")
        if not isinstance(died, list):
            raise TypeError("'died' must be a list of [x, y] pairs")
        expected = request.get("expectGeneration")
        if not isinstance(expected, int) or isinstance(expected, bool):
            raise TypeError("'expectGeneration' must be an integer")
        born_cells = [self._cell(entry, "born") for entry in born]
        died_cells = [self._cell(entry, "died") for entry in died]
        both = set(born_cells) & set(died_cells)
        if both:
            x, y = min(both)
            raise ValueError(f"cell ({x}, {y}) is in both 'born' and 'died'")
        if expected != self._world.generation:
            return self._error(
                "stale_generation",
                f"'expectGeneration' is {expected}, but the world is at "
                f"generation {self._world.generation}",
            )
        # Reading every cell first is the bounds check: `is_alive` is the
        # world's own coordinate validation, and keeping it in a pass of its own
        # is what stops a refusal from arriving after part of the patch was
        # already written.
        for x, y in born_cells:
            self._world.is_alive(x, y)
        for x, y in died_cells:
            self._world.is_alive(x, y)
        born_count = 0
        changed_born: list[list[int]] = []
        for x, y in born_cells:
            if self._world.set_alive(x, y, True):
                born_count += 1
                changed_born.append([x, y])
        died_count = 0
        changed_died: list[list[int]] = []
        for x, y in died_cells:
            if self._world.set_alive(x, y, False):
                died_count += 1
                changed_died.append([x, y])
        self._record_edit()
        return {
            "ok": True,
            "generation": self._world.generation,
            "population": self._world.population,
            "bornCount": born_count,
            "diedCount": died_count,
            "born": changed_born,
            "died": changed_died,
        }

    def _cmd_export(self, request: dict[str, Any]) -> dict[str, Any]:
        """The whole live set as one portable payload, whatever the storage.

        This is what makes a representation switch possible without losing the
        world: export, start a core on the other representation, import. The
        payload is always the ``cells`` encoding and never a bitmap, because a
        bitmap describes the world's area rather than its contents, and the
        point of an export is to be independent of how the area is stored.

        The rule travels in the payload for the same reason the generation does:
        a world carried to another core is not the same world running something
        else, and a payload that omitted the rule would make the importer's
        default decide what happens next.
        """
        del request
        cells = self._world.live_cells_in(0, 0, self._world.width, self._world.height)
        payload = cells.astype("<i4").tobytes()
        return {
            "ok": True,
            "export": {
                "format": "cells",
                "data": base64.b64encode(payload).decode("ascii"),
                "population": int(cells.shape[0]),
                "generation": self._world.generation,
                "world": {"width": self._world.width, "height": self._world.height},
                "rule": self._world.rule.notation,
            },
        }

    def _cmd_import(self, request: dict[str, Any]) -> dict[str, Any]:
        """Replace the world with an exported payload, generation and rule included.

        A payload that names a rule is adopted, through the same path
        ``set_rule`` uses, so the world and the recording cannot disagree about
        what is running. A payload that names none leaves the running rule alone:
        it is a payload written before the rule travelled, and silently resetting
        a world to the default would be a bigger change than the one it asked
        for.
        """
        declared = request.get("format", "cells")
        if declared != "cells":
            raise ValueError(f"import format must be 'cells', got {declared!r}")
        data = request.get("data")
        if not isinstance(data, str):
            raise TypeError("'import' needs a base64 'data' string")
        generation = request.get("generation", 0)
        if not isinstance(generation, int) or isinstance(generation, bool):
            raise TypeError("'generation' must be an integer")
        rule = request.get("rule")
        if rule is not None:
            if not isinstance(rule, str):
                raise TypeError("'rule' must be a string such as B3/S23")
            try:
                self._adopt_rule(LifeRule.parse(rule))
            except ValueError as exc:
                return self._error("bad_rule", str(exc))
        cells = decode_cells(data)
        added = self._world.restore(
            ((int(x), int(y)) for x, y in cells),
            generation=generation,
        )
        self._record_edit()
        return {
            "ok": True,
            "changed": added,
            "population": self._world.population,
            "generation": self._world.generation,
            "rule": self._world.rule.notation,
        }

    def _cmd_clear(self, request: dict[str, Any]) -> dict[str, Any]:
        del request
        self._world.clear()
        self._record_edit()
        return {"ok": True, "generation": 0, "population": 0}

    def _cmd_set_rule(self, request: dict[str, Any]) -> dict[str, Any]:
        """Adopt a rule for the generations that follow.

        The rule is not a state: the cells and the generation counter are left
        exactly where they were, so switching a rule cannot look like an edit or
        an undo, and a world that is running keeps running under the new rule
        from its next generation. The reply repeats the rule the core is now
        running rather than the string that was sent, because the core
        normalises: ``s32`` arrives and ``B3/S23`` is what comes back, and a
        client that shows what it sent shows something the core never said.

        A rule the core will not run — text it cannot parse, or a local rule's
        refusal of a rule that is not local — answers ``bad_rule`` with the
        reason, and leaves the running rule alone.

        The change is one change, not two: the world adopts the rule and the
        recorded session is told the same thing, so a query of the history can
        never report a rule the core is not running. See ``_adopt_rule``.
        """
        text = request.get("rule")
        if not isinstance(text, str):
            return self._error("bad_rule", "'rule' must be a string such as B3/S23")
        try:
            rule = LifeRule.parse(text)
            self._adopt_rule(rule)
        except ValueError as exc:
            return self._error("bad_rule", str(exc))
        return {
            "ok": True,
            "rule": rule.notation,
            "birth": sorted(rule.birth),
            "survival": sorted(rule.survive),
        }

    def _cmd_step(self, request: dict[str, Any]) -> dict[str, Any]:
        count = request.get("count", 1)
        if not isinstance(count, int) or isinstance(count, bool):
            raise TypeError("'count' must be an integer")
        if not 0 <= count <= MAX_STEPS_PER_REQUEST:
            raise ValueError(f"'count' must be in 0..{MAX_STEPS_PER_REQUEST}, got {count}")
        changed = self.advance(count)
        return {
            "ok": True,
            "generation": self._world.generation,
            "population": self._world.population,
            "changed": changed,
        }

    def _cmd_run(self, request: dict[str, Any]) -> dict[str, Any]:
        tps = request.get("tps", DEFAULT_TICKS_PER_SECOND)
        if not isinstance(tps, int) or isinstance(tps, bool):
            raise TypeError("'tps' must be an integer")
        if not MIN_TICKS_PER_SECOND <= tps <= MAX_TICKS_PER_SECOND:
            raise ValueError(
                f"'tps' must be in {MIN_TICKS_PER_SECOND}..{MAX_TICKS_PER_SECOND}, got {tps}"
            )
        self._ticks_per_second = tps
        self._running = True
        return {"ok": True, "running": True, "tps": tps, "generation": self._world.generation}

    def _cmd_pause(self, request: dict[str, Any]) -> dict[str, Any]:
        del request
        self._running = False
        return {"ok": True, "running": False, "generation": self._world.generation}

    def _cmd_frame(self, request: dict[str, Any]) -> dict[str, Any]:
        x0 = self._integer(request, "x0")
        y0 = self._integer(request, "y0")
        width = self._integer(request, "w")
        height = self._integer(request, "h")
        return {"ok": True, "frame": encode_frame(self._world, x0, y0, width, height)}

    def _cmd_history(self, request: dict[str, Any]) -> dict[str, Any]:
        """The recorded history as a tree, so a client can draw branches.

        Each node names its parent, which is what makes two branches visible as
        two children of one node rather than as two unrelated lists. The head is
        named too: it is where the next record appends, and therefore what a
        client has to highlight.

        Each node also names the rule that was in force for it, which is what a
        timeline needs to mark where the rule changed: the change points are the
        nodes whose rule differs from their parent's.
        """
        del request
        session = self._require_history()
        nodes = session.nodes()
        head = session.head()
        return {
            "ok": True,
            "session": session.id,
            "current": self._world.generation,
            "head": None if head is None else head.id,
            "count": len(nodes),
            "generations": [
                {
                    "id": node.id,
                    "generation": node.generation,
                    "parent": node.parent_id,
                    "kind": node.kind,
                    "rule": node.rule,
                    "population": node.population,
                    "changed": node.changed,
                    "born": node.born,
                    "died": node.died,
                    "at": node.created_at,
                }
                for node in nodes
            ],
        }

    def _cmd_select(self, request: dict[str, Any]) -> dict[str, Any]:
        """Move the world and the recording head onto a recorded node.

        This is what replaces a destructive rollback: the node keeps whatever
        already descends from it, and the next record becomes a sibling of those
        nodes instead of deleting them. A client that selects an older node and
        then edits gets a second branch.
        """
        session = self._require_history()
        wanted = request.get("node")
        if wanted is None:
            wanted = request.get("generation")
        if not isinstance(wanted, int) or isinstance(wanted, bool):
            raise TypeError("'select' needs an integer 'node' or 'generation'")
        if "node" in request:
            node_id = int(wanted)
        else:
            node = session.node_at_generation(int(wanted))
            if node is None:
                raise ValueError(
                    f"no generation {wanted} on the current branch; select by node id "
                    "to reach another branch"
                )
            node_id = node.id
        # Selecting is not an edit: the world now holds exactly the state the node
        # describes, so nothing is recorded and no branch is created by looking.
        generation = session.checkout(self._world, node_id)
        return {
            "ok": True,
            "node": node_id,
            "generation": generation,
            "population": self._world.population,
        }

    def _cmd_rollback(self, request: dict[str, Any]) -> dict[str, Any]:
        """Load a recorded generation into the world, and only read.

        The working point does not move, so every generation recorded after the
        one loaded is still in the tree and the next record appends a sibling
        rather than discarding them. `select` is the command that moves it.
        """
        session = self._require_history()
        generation = request.get("generation")
        if not isinstance(generation, int) or isinstance(generation, bool):
            raise TypeError("'rollback' needs an integer 'generation'")
        restored = session.rollback(self._world, generation)
        bounds = self._world.bounds()
        return {
            "ok": True,
            "generation": restored,
            "population": self._world.population,
            "bounds": list(bounds) if bounds is not None else None,
        }

    def _cmd_archive(self, request: dict[str, Any]) -> dict[str, Any]:
        """Write the recorded session to a portable file.

        The core writes here, which is the one place in this project where a
        process creates a file — and it is at the request of whoever is driving
        it, to a path they named. Nothing is written unless this command is sent.
        """
        session = self._require_history()
        path = request.get("path")
        if not isinstance(path, str) or not path:
            raise TypeError("'archive' needs a non-empty 'path'")
        written = session.archive(path)
        return {"ok": True, "path": path, "generations": written}

    def _cmd_open(self, request: dict[str, Any]) -> dict[str, Any]:
        """Import an archive as a new session and make it the current one.

        The alternative was for the service to read the archive and replay its
        deltas itself, which would have made a second implementation of the
        stored format in a different language. The core owns the format, so the
        core opens the file; the caller names a path and gets a session back.

        The archive's rule is adopted before a single cell is restored, so a rule
        this representation cannot run refuses the whole open instead of leaving a
        world that holds one session's cells and another session's rule. The reply
        says whether the rule was stated or assumed, because an archive written
        before the rule travelled states none and the default filled in for it is
        the reader's, not the file's.
        """
        session = self._require_history()
        path = request.get("path")
        if not isinstance(path, str) or not path:
            raise TypeError("'open' needs a non-empty 'path'")
        opened = session.open_archive(path)
        newest = opened.latest()
        if newest is None:
            raise ValueError(f"the archive at {path} holds no generations")
        try:
            self._world.set_rule(LifeRule.parse(opened.info.rule))
        except ValueError as exc:
            return self._error(
                "bad_rule", f"the archive at {path} records a rule this core cannot run: {exc}"
            )
        cells = opened.state_at(newest.generation)
        self._world.restore(cells, generation=newest.generation)
        self._history = opened
        return {
            "ok": True,
            "session": opened.id,
            "generation": self._world.generation,
            "population": self._world.population,
            "rule": self._world.rule.notation,
            "ruleKnown": bool(opened.info.rule_known),
        }

    def _cmd_quit(self, request: dict[str, Any]) -> dict[str, Any]:
        del request
        self._stop = True
        return {"ok": True, "bye": True}

    @staticmethod
    def _integer(request: dict[str, Any], key: str) -> int:
        value = request.get(key)
        if not isinstance(value, int) or isinstance(value, bool):
            raise TypeError(f"'{key}' must be an integer")
        return value

    @staticmethod
    def _cell(entry: Any, key: str) -> tuple[int, int]:
        """One ``[x, y]`` pair from a ``patch`` list, with both values integral.

        The pair is validated strictly rather than coerced: a float or a boolean
        that happens to convert to a coordinate is a client that is not speaking
        the protocol, and the apply-as-it-goes behaviour that tolerates one is
        what this command exists to replace.
        """
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            raise TypeError(f"every entry in '{key}' must be an [x, y] pair")
        for value in entry:
            if not isinstance(value, int) or isinstance(value, bool):
                raise TypeError(f"every coordinate in '{key}' must be an integer")
        return (int(entry[0]), int(entry[1]))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="lifegame.world.bridge",
        description="Serve the world's line protocol on standard input and output.",
    )
    parser.add_argument("--width", type=int, default=DEFAULT_WORLD_SIZE)
    parser.add_argument("--height", type=int, default=DEFAULT_WORLD_SIZE)
    parser.add_argument(
        "--history",
        metavar="PATH",
        default=None,
        help=(
            "record every generation into a store at PATH. Enables the history, "
            "rollback and archive commands, which are refused without it."
        ),
    )
    parser.add_argument(
        "--continue-session",
        metavar="ID",
        type=int,
        default=None,
        help=(
            "with --history PATH, continue the recorded session ID instead of "
            "starting a new one. Used by the viewer's representation switch, so a "
            "switch does not truncate the timeline; the world is restored into "
            "the session by the caller's import."
        ),
    )
    parser.add_argument(
        "--representation",
        choices=("sparse", "tiled"),
        default=DEFAULT_REPRESENTATION,
        help=(
            "sparse stores one packed key per live cell and wins on scattered "
            "populations; tiled stores 64 x 64 bit-packed tiles and wins by an "
            "order of magnitude once a pattern is clustered. See "
            "docs/model/world/performance.md."
        ),
    )
    arguments = parser.parse_args(argv)
    if arguments.continue_session is not None and not arguments.history:
        parser.error("--continue-session needs --history PATH")

    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")

    world: SparseWorld | TiledWorld
    if arguments.representation == "tiled":
        world = TiledWorld(width=arguments.width, height=arguments.height)
    else:
        world = SparseWorld(width=arguments.width, height=arguments.height)

    # The history is wired here and nowhere else. The world module must not
    # import the store (the store imports the world), and the bridge takes the
    # session as an argument for the same reason; the console entry point is the
    # one place allowed to know both.
    store: Any = None
    history: Any = None
    if arguments.history:
        from lifegame.store import Store
        from lifegame.world.change import Change

        store = Store.open(arguments.history)
        if arguments.continue_session is not None:
            history = store.session(arguments.continue_session)
            recorded = (history.info.world_width, history.info.world_height)
            if recorded != (arguments.width, arguments.height):
                print(
                    f"the recorded session {arguments.continue_session} is "
                    f"{recorded[0]} x {recorded[1]} and this world is "
                    f"{arguments.width} x {arguments.height}; refusing to continue it",
                    file=sys.stderr,
                )
                store.close()
                return 2
        else:
            history = store.create_session(
                world,
                label=f"{arguments.representation} core",
                representation=arguments.representation,
            )
            history.record(world, Change(changed=0, generation=0))

    try:
        return Bridge(world, sys.stdin, sys.stdout, history=history).serve()
    finally:
        if store is not None:
            store.close()
