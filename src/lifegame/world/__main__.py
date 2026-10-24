"""Entry point: ``python -m lifegame.world`` serves the world's line protocol."""

from lifegame.world.bridge import main

if __name__ == "__main__":
    raise SystemExit(main())
