#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv_dir="${CODEX_DESKTOP_SETUP_VENV:-$repo_dir/.venv-codex-desktop-setup}"

if [ -n "${CODEX_DESKTOP_SETUP_BASE_PYTHON:-}" ]; then
    base_python="$CODEX_DESKTOP_SETUP_BASE_PYTHON"
elif [ -x /usr/bin/python3 ]; then
    base_python=/usr/bin/python3
else
    base_python="$(command -v python3 || true)"
fi

[ -n "$base_python" ] && [ -x "$base_python" ] || {
    echo "A system Python 3 interpreter is required for Codex Desktop setup." >&2
    exit 69
}

if [ ! -x "$venv_dir/bin/python3" ]; then
    "$base_python" -m venv --system-site-packages "$venv_dir"
fi

if ! "$venv_dir/bin/python3" -c '
import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gtk
'; then
    echo "Codex Desktop setup requires the device-native GTK 4, libadwaita, and Python GObject bindings." >&2
    echo "Install those bindings for $base_python, then rerun make codex-desktop-setup-env." >&2
    exit 69
fi

printf '%s\n' "$venv_dir/bin/python3"
