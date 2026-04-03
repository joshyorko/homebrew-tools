from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_allowlist(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
