"""Command line access to the history layer.

Exists because two of this module's jobs are not the viewer's: printing the DDL
a database administrator has to apply before a MySQL store can be used, and
looking at a store when something has gone wrong. Both are one-off actions on a
machine, not part of a simulation.

Exit codes: ``0`` success, ``1`` the store refused, ``2`` a usage error.
"""

import argparse
import sys
from typing import Any

from lifegame.store.errors import StoreError
from lifegame.store.history import Store
from lifegame.store.schema import BACKENDS, render_ddl

__all__ = ["main"]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lifegame.store",
        description="Inspect, archive and restore recorded life sessions.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    schema = sub.add_parser("schema", help="print the DDL for a dialect")
    schema.add_argument("--dialect", choices=BACKENDS, default="sqlite")

    for name, help_text in (
        ("sessions", "list the sessions in a store"),
        ("show", "list the generations of a session"),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("store")
        if name == "show":
            command.add_argument("session", type=int)

    rollback = sub.add_parser("rollback", help="print the state a rollback would restore")
    rollback.add_argument("store")
    rollback.add_argument("session", type=int)
    rollback.add_argument("generation", type=int)

    archive = sub.add_parser("archive", help="write a session to a portable file")
    archive.add_argument("store")
    archive.add_argument("session", type=int)
    archive.add_argument("path")

    restore = sub.add_parser("import", help="read a portable file into a store")
    restore.add_argument("store")
    restore.add_argument("path")
    restore.add_argument("--label", default=None)

    salvage = sub.add_parser(
        "salvage",
        help="copy a damaged store to a new file, clearing dangling parent links",
    )
    salvage.add_argument("source")
    salvage.add_argument("target")

    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _build_parser().parse_args(argv)
    try:
        return _run(arguments)
    except StoreError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _run(arguments: Any) -> int:
    if arguments.command == "schema":
        for statement in render_ddl(arguments.dialect):
            print(f"{statement};")
        return 0

    if arguments.command == "import":
        from lifegame.store.archive import read_archive

        with Store.open(arguments.store) as store:
            session = read_archive(store, arguments.path, label=arguments.label)
            recorded = len(session.generations())
            print(f"imported session {session.id} with {recorded} generation(s)")
        return 0

    if arguments.command == "salvage":
        from lifegame.store.history import salvage

        store = salvage(arguments.source, arguments.target)
        try:
            sessions = store.sessions()
            repaired = store.repaired_dangling
            print(
                f"copied {arguments.source} to {arguments.target}: "
                f"{len(sessions)} session(s)"
            )
            if repaired:
                names = ", ".join(str(node) for node in repaired)
                print(f"cleared {len(repaired)} dangling parent link(s) on row(s): {names}")
            else:
                print("no dangling parent link needed repair")
        finally:
            store.close()
        return 0

    with Store.open(arguments.store) as store:
        if arguments.command == "sessions":
            sessions = store.sessions()
            if not sessions:
                print("no sessions")
                return 0
            print(f"{'id':>4}  {'generations':>11}  {'world':>13}  {'rule':<8}  label")
            for info in sessions:
                session = store.session(info.id)
                count = len(session.generations())
                world = f"{info.world_width}x{info.world_height}"
                print(
                    f"{info.id:>4}  {count:>11}  {world:>13}  {info.rule:<8}  "
                    f"{info.label or '(unlabelled)'}"
                    f"{'  [archived]' if info.archived else ''}"
                )
            return 0

        if arguments.command == "show":
            session = store.session(arguments.session)
            generations = session.generations()
            if not generations:
                print("no generations")
                return 0
            print(
                f"{'generation':>10}  {'storage':<9} {'population':>10} "
                f"{'changed':>8} {'born':>6} {'died':>6}"
            )
            for info in generations:
                print(
                    f"{info.generation:>10}  {info.kind:<9} {info.population:>10} "
                    f"{info.changed:>8} {info.born:>6} {info.died:>6}"
                )
            return 0

        if arguments.command == "rollback":
            session = store.session(arguments.session)
            cells = session.state_at(arguments.generation)
            if cells:
                xs = [cell[0] for cell in cells]
                ys = [cell[1] for cell in cells]
                bounds = f"({min(xs)}, {min(ys)}) to ({max(xs)}, {max(ys)})"
            else:
                bounds = "empty"
            print(
                f"generation {arguments.generation}: {len(cells)} live cell(s), {bounds}"
            )
            return 0

        if arguments.command == "archive":
            session = store.session(arguments.session)
            written = session.archive(arguments.path)
            print(f"wrote {written} generation(s) to {arguments.path}")
            return 0

    raise StoreError(f"unhandled command {arguments.command!r}")


if __name__ == "__main__":  # pragma: no cover - exercised through `python -m`
    raise SystemExit(main())
