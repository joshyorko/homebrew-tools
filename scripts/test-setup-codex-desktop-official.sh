#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wizard="$repo_dir/scripts/codex-desktop-feature-wizard.py"
setup="$repo_dir/scripts/setup-codex-desktop-official.sh"

grep -F '# /// script' "$wizard" >/dev/null
grep -F '#   "PyGObject>=' "$wizard" >/dev/null
grep -F 'uv run --script "${wizard_args[@]}"' "$setup" >/dev/null
grep -F 'using the terminal wizard' "$setup" >/dev/null
save_line="$(grep -nF 'if [ "$setup_action" = "save" ]; then' "$setup" | cut -d: -f1)"
build_line="$(grep -nF 'Building Codex Desktop from the pinned PatchRaptor main source through Dagger...' "$setup" | cut -d: -f1)"
[ -n "$save_line" ] && [ -n "$build_line" ] && [ "$save_line" -lt "$build_line" ]

echo "Codex Desktop official setup uses uv inline dependencies"
