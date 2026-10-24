"""Environment isolation contract, asserted from inside the virtual environment.

The shell-side enforcement lives in ``scripts/env.ps1`` and the executable
proof lives in ``scripts/verify-temp-isolation.ps1``. This module is the
Python-side check, taken from a different vantage point: whatever the shell
exported, the running interpreter must not resolve a single transient location
outside the repository.

Authority: docs/plan/phase-01-foundation/acceptance.md (criteria A1, A2, A3).
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

GUARDED_ENVIRONMENT_VARIABLES = (
    "LIFEGAME_ROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "UV_CACHE_DIR",
    "UV_PYTHON_INSTALL_DIR",
    "PIP_CACHE_DIR",
    "PIP_CONFIG_FILE",
    "PYTHONPYCACHEPREFIX",
    "npm_config_cache",
)


def assert_inside_repository(raw: str | None, label: str) -> Path:
    assert raw, f"{label} is not set; source scripts/env.ps1 before running the gates"
    path = Path(raw).resolve()
    assert path.is_relative_to(REPO_ROOT), f"{label} escapes the repository: {path}"
    return path


def test_interpreter_is_inside_repository() -> None:
    assert Path(sys.executable).resolve().is_relative_to(REPO_ROOT)


def test_base_prefix_is_inside_repository() -> None:
    """The interpreter payload must be the uv-managed one under .cache/uv-python."""
    base_prefix = Path(sys.base_prefix).resolve()
    assert base_prefix.is_relative_to(REPO_ROOT), base_prefix
    assert base_prefix.name.startswith("cpython-"), base_prefix


def test_tempdir_is_inside_repository() -> None:
    assert Path(tempfile.gettempdir()).resolve().is_relative_to(REPO_ROOT)


@pytest.mark.parametrize("name", GUARDED_ENVIRONMENT_VARIABLES)
def test_guarded_environment_variable_is_inside_repository(name: str) -> None:
    assert_inside_repository(os.environ.get(name), name)


def test_no_guarded_environment_variable_points_at_system_volume() -> None:
    for name in GUARDED_ENVIRONMENT_VARIABLES:
        value = os.environ.get(name)
        if value:
            message = f"{name} points at the system volume: {value}"
            assert not value.upper().startswith("C:"), message
