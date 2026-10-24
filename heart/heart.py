#!/usr/bin/env python3
"""Conway's Game of Life — a heart from a clearly non-heart initial state.

Assignment
----------
Initial image and final image differ; the final image is a heart; every pixel
follows the Game of Life rule B3/S23.

Idea
----
The final image is a 13 x 11 pixel heart. Every "pixel" is a 2 x 2 block, which
is a still life under B3/S23, so the heart is stable: once it exists, it never
changes.

The initial state is **not** a heart. It is a 1226-cell noise pattern, found by
reverse construction: we asked a SAT solver for a state whose next generation is
exactly the heart, and maximised the number of live cells outside the heart. The
result is a dense, unstructured pattern in which no heart can be seen. One step
of B3/S23 on it produces exactly the 364-cell heart; from generation 1 on the
heart is stable.

So the two images are very different (noise vs. a heart), the rule is the ordinary
Game of Life at every step, and the final image is a heart.

Run
---
    python3 heart.py

It reads initial_cells.json and heart_cells.json from this folder, verifies the
transition, and writes initial.png, final.png and heart.mp4. Python 3.9+ and no
third-party packages are required for the images and the verification; the video
step uses ffmpeg when it is on PATH (the included heart.mp4 was made that way).
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

WORLD_WIDTH, WORLD_HEIGHT = 60, 54
INITIAL_FILE = "initial_cells.json"
HEART_FILE = "heart_cells.json"

BACKGROUND = (12, 14, 18)
GRID = (30, 34, 41)
LIVE = (255, 92, 128)
LIVE_EDGE = (255, 160, 184)


def step(cells):
    """One generation of B3/S23 in a bounded world (no wrap)."""
    counts = {}
    for x, y in cells:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                key = (x + dx, y + dy)
                if 0 <= key[0] < WORLD_WIDTH and 0 <= key[1] < WORLD_HEIGHT:
                    counts[key] = counts.get(key, 0) + 1
    return {
        (x, y)
        for (x, y), n in counts.items()
        if n == 3 or (n == 2 and (x, y) in cells)
    }


def load_cells(name: str) -> set[tuple[int, int]]:
    path = Path(__file__).resolve().parent / name
    with path.open(encoding="utf-8") as handle:
        return {tuple(cell) for cell in json.load(handle)}


def verify(initial, heart) -> None:
    assert all(0 <= x < WORLD_WIDTH and 0 <= y < WORLD_HEIGHT for x, y in initial)
    assert all(0 <= x < WORLD_WIDTH and 0 <= y < WORLD_HEIGHT for x, y in heart)
    assert initial != heart, "the initial image must differ from the final one"
    assert step(initial) == heart, "generation 1 must be exactly the heart"
    assert step(heart) == heart, "the heart must be a still life"


# -- a small PNG writer, so no image library is needed ---------------------


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    raw = b"".join(
        b"\x00" + pixels[row * width * 3 : (row + 1) * width * 3]
        for row in range(height)
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def render(cells, crop, scale, margin=24, grid=True):
    """Render a crop of the world: cells in pink on a dark grid."""
    x0, y0, x1, y1 = crop
    width = (x1 - x0 + 1) * scale + margin * 2
    height = (y1 - y0 + 1) * scale + margin * 2
    pixels = bytearray(BACKGROUND * (width * height))
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px = margin + (x - x0) * scale
            py = margin + (y - y0) * scale
            if (x, y) in cells:
                for row in range(scale):
                    start = ((py + row) * width + px) * 3
                    pixels[start : start + scale * 3] = bytes(LIVE) * scale
                start = (py * width + px) * 3
                pixels[start : start + min(3, scale * 3)] = bytes(LIVE_EDGE) * min(
                    3, scale
                )
            elif grid:
                for row in range(scale):
                    start = ((py + row) * width + px) * 3
                    pixels[start : start + 3] = bytes(GRID)
                start = (py * width + px) * 3
                pixels[start : start + scale * 3] = bytes(GRID) * scale
    return width, height, bytes(pixels)


def write_still(path: Path, cells, crop, scale):
    width, height, pixels = render(cells, crop, scale)
    write_png(path, width, height, pixels)


def write_video(initial, heart, out: Path):
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        print("ffmpeg is not on PATH; skipping heart.mp4 (the PNGs are written)")
        return None
    crop = (0, 0, WORLD_WIDTH - 1, WORLD_HEIGHT - 1)
    scale = 12
    fps = 10
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        index = 0

        def emit(cells, times):
            nonlocal index
            width, height, pixels = render(cells, crop, scale, margin=30)
            for _ in range(times):
                write_png(directory / f"frame_{index:04d}.png", width, height, pixels)
                index += 1

        emit(initial, 40)  # 4 s on the noise
        emit(heart, 80)  # 8 s on the heart
        command = [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-framerate",
            str(fps),
            "-i",
            str(directory / "frame_%04d.png"),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(out),
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            print("ffmpeg failed:", result.stderr.strip())
            return None
    print(f"wrote {out.name} ({(index / fps):.1f} s, {fps} fps)")
    return out


def main() -> int:
    initial = load_cells(INITIAL_FILE)
    heart = load_cells(HEART_FILE)
    verify(initial, heart)

    here = Path(__file__).resolve().parent
    # The initial image is the whole world: a dense noise pattern that does not
    # look like a heart.
    write_still(here / "initial.png", initial, (0, 0, WORLD_WIDTH - 1, WORLD_HEIGHT - 1), 12)
    # The final image is the heart, cropped tightly and drawn large.
    write_still(here / "final.png", heart, (0, 0, 54, 46), 18)

    print(f"initial cells: {len(initial)}")
    print(f"heart cells:   {len(heart)}")
    print(f"generation 1 equals the heart: {step(initial) == heart}")
    print(f"the heart is stable: {step(heart) == heart}")
    print(f"initial image differs from final image: {initial != heart}")
    write_video(initial, heart, here / "heart.mp4")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
