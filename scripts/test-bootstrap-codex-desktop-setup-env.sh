#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bootstrap="$repo_dir/scripts/bootstrap-codex-desktop-setup-env.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-desktop-setup-env-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

fake_python="$tmp_dir/python3"
venv_dir="$tmp_dir/venv"
invocations="$tmp_dir/invocations.log"

cat >"$fake_python" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_PYTHON_INVOCATIONS"
[ "${1:-}" = "-m" ]
[ "${2:-}" = "venv" ]
[ "${3:-}" = "--system-site-packages" ]
mkdir -p "$4/bin"
cat >"$4/bin/python3" <<'PY'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = "-c" ]
PY
chmod +x "$4/bin/python3"
SH
chmod +x "$fake_python"

FAKE_PYTHON_INVOCATIONS="$invocations" \
CODEX_DESKTOP_SETUP_BASE_PYTHON="$fake_python" \
CODEX_DESKTOP_SETUP_VENV="$venv_dir" \
    "$bootstrap"

[ -x "$venv_dir/bin/python3" ]
grep -F -- "-m venv --system-site-packages $venv_dir" "$invocations" >/dev/null

FAKE_PYTHON_INVOCATIONS="$invocations" \
CODEX_DESKTOP_SETUP_BASE_PYTHON="$fake_python" \
CODEX_DESKTOP_SETUP_VENV="$venv_dir" \
    "$bootstrap"

[ "$(wc -l <"$invocations")" -eq 1 ]

echo "Codex Desktop setup environment bootstrap test passed"
