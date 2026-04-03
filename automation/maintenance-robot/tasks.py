"""Compatibility entry point for the maintenance robot."""

from __future__ import annotations

import sys
from importlib import import_module
from pathlib import Path

_CURRENT_DIR = Path(__file__).resolve().parent
_SRC_DIR = _CURRENT_DIR / "src"
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

_tasks = import_module("maintenance_robot.tasks")

maintenance = getattr(_tasks, "maintenance")
update_workflows_only = getattr(_tasks, "update_workflows_only")
