#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$repo_dir/scripts/setup-codex-desktop-local.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-desktop-setup-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

fake_bin="$tmp_dir/bin"
fake_checkout="$tmp_dir/codex-desktop-linux"
fake_config_home="$tmp_dir/config"
fake_cache_home="$tmp_dir/cache"
git_log="$tmp_dir/git.log"
install_log="$tmp_dir/install.log"
mkdir -p "$fake_bin" "$fake_checkout/linux-features/read-aloud" "$fake_config_home" "$fake_cache_home"

cat >"$fake_checkout/linux-features/read-aloud/feature.json" <<'JSON'
{"id":"read-aloud","title":"Read Aloud","defaultEnabled":false}
JSON
printf '# Read Aloud\n' >"$fake_checkout/linux-features/read-aloud/README.md"

cat >"$fake_bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_GIT_LOG"
if [ "${1:-}" = "ls-remote" ]; then
    printf '%s\trefs/heads/patchraptor-main\n' "$FAKE_COMMIT"
    exit 0
fi
echo "Unexpected fake git invocation: $*" >&2
exit 1
SH

cat >"$tmp_dir/fake-wizard.py" <<'PY'
#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

arguments = sys.argv[1:]
result = Path(arguments[arguments.index("--result") + 1])
features = [item for item in os.environ.get("FAKE_FEATURES", "").split(",") if item]
result.parent.mkdir(parents=True, exist_ok=True)
result.write_text(json.dumps({"action": os.environ["FAKE_ACTION"], "features": features}) + "\n")
PY

cat >"$tmp_dir/fake-installer.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >"$FAKE_INSTALL_LOG"
SH

chmod +x "$fake_bin/git" "$tmp_dir/fake-wizard.py" "$tmp_dir/fake-installer.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    [[ "$haystack" == *"$needle"* ]] || fail "Expected '$haystack' to contain '$needle'"
}

run_setup() {
    local action="$1"
    local features="$2"
    rm -f "$install_log"
    FAKE_ACTION="$action" \
    FAKE_FEATURES="$features" \
    FAKE_COMMIT="0123456789abcdef0123456789abcdef01234567" \
    FAKE_GIT_LOG="$git_log" \
    FAKE_INSTALL_LOG="$install_log" \
    PATH="$fake_bin:$PATH" \
    XDG_CONFIG_HOME="$fake_config_home" \
    XDG_CACHE_HOME="$fake_cache_home" \
    CODEX_DESKTOP_CONVERSION_CHECKOUT="$fake_checkout" \
    CODEX_DESKTOP_FEATURE_WIZARD="$tmp_dir/fake-wizard.py" \
    CODEX_DESKTOP_INSTALLER="$tmp_dir/fake-installer.sh" \
        "$script" \
            --conversion-ref patchraptor-main \
            --full-profile "read-aloud pet-overlay" \
            --lean-profile "read-aloud"
}

run_setup save "read-aloud"
[ ! -e "$install_log" ] || fail "save-only setup must not start installer"

run_setup cancel "read-aloud"
[ ! -e "$install_log" ] || fail "cancelled setup must not start installer"

run_setup install "read-aloud,pet-overlay"
install_args="$(<"$install_log")"
assert_contains "$install_args" "--conversion-commit 0123456789abcdef0123456789abcdef01234567"
assert_contains "$install_args" "--linux-features pet-overlay,read-aloud"

run_setup install ""
install_args="$(<"$install_log")"
assert_contains "$install_args" "--linux-features none"

git_calls="$(<"$git_log")"
assert_contains "$git_calls" "ls-remote --exit-code"
assert_contains "$git_calls" "refs/heads/patchraptor-main"

echo "Codex Desktop Homebrew setup adapter test passed"
