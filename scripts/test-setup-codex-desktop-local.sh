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
fake_state_home="$tmp_dir/state"
git_log="$tmp_dir/git.log"
curl_log="$tmp_dir/curl.log"
install_log="$tmp_dir/install.log"
result_view_log="$tmp_dir/result-view.log"
wizard_args_log="$tmp_dir/wizard-args.log"
dmg_ref="$tmp_dir/codex-desktop-dmg.ref"
mkdir -p "$fake_bin" "$fake_checkout/linux-features/read-aloud" "$fake_config_home" "$fake_cache_home" "$fake_state_home"

cat >"$dmg_ref" <<'REF'
url: https://example.invalid/Codex.dmg
sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
content-length: 123
last-modified: Mon, 13 Jul 2026 06:53:09 GMT
etag: fixture-etag
REF

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

cat >"$fake_bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_CURL_LOG"
if [ "${FAKE_CURL_FAIL:-0}" = "1" ]; then
    exit 22
fi
cat <<'HEADERS'
HTTP/2 200
content-length: 123
last-modified: Mon, 13 Jul 2026 06:53:09 GMT
etag: fixture-etag

HEADERS
SH

cat >"$tmp_dir/fake-wizard.py" <<'PY'
#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

arguments = sys.argv[1:]
with Path(os.environ["FAKE_WIZARD_ARGS_LOG"]).open("a") as log:
    log.write(" ".join(arguments) + "\n")
if "--show-result" in arguments:
    Path(os.environ["FAKE_RESULT_VIEW_LOG"]).write_text(
        arguments[arguments.index("--show-result") + 1] + "\n"
    )
    raise SystemExit(0)
result = Path(arguments[arguments.index("--result") + 1])
features = [item for item in os.environ.get("FAKE_FEATURES", "").split(",") if item]
result.parent.mkdir(parents=True, exist_ok=True)
result.write_text(
    json.dumps(
        {
            "action": os.environ["FAKE_ACTION"],
            "dmgSource": os.environ.get("FAKE_DMG_SOURCE", "pinned"),
            "features": features,
        }
    )
    + "\n"
)
PY

cat >"$tmp_dir/fake-installer.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >"$FAKE_INSTALL_LOG"
while [ "$#" -gt 0 ]; do
    if [ "$1" = "--result-file" ]; then
        mkdir -p "$(dirname "$2")"
        printf '{"verdict":"accepted"}\n' >"$2"
        break
    fi
    shift
done
SH

chmod +x "$fake_bin/git" "$fake_bin/curl" "$tmp_dir/fake-wizard.py" "$tmp_dir/fake-installer.sh"

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
    local dmg_source="${3:-pinned}"
    local curl_fail="${4:-0}"
    rm -f "$install_log"
    rm -f "$result_view_log"
    FAKE_ACTION="$action" \
    FAKE_FEATURES="$features" \
    FAKE_DMG_SOURCE="$dmg_source" \
    FAKE_COMMIT="0123456789abcdef0123456789abcdef01234567" \
    FAKE_CURL_FAIL="$curl_fail" \
    FAKE_GIT_LOG="$git_log" \
    FAKE_CURL_LOG="$curl_log" \
    FAKE_INSTALL_LOG="$install_log" \
    FAKE_RESULT_VIEW_LOG="$result_view_log" \
    FAKE_WIZARD_ARGS_LOG="$wizard_args_log" \
    PATH="$fake_bin:$PATH" \
    XDG_CONFIG_HOME="$fake_config_home" \
    XDG_CACHE_HOME="$fake_cache_home" \
    XDG_STATE_HOME="$fake_state_home" \
    CODEX_DESKTOP_DMG_REF_FILE="$dmg_ref" \
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
wizard_args="$(<"$wizard_args_log")"
assert_contains "$wizard_args" "--latest-dmg-probe-status available"
assert_contains "$wizard_args" "--latest-dmg-content-length 123"
assert_contains "$wizard_args" "--latest-dmg-last-modified Mon, 13 Jul 2026 06:53:09 GMT"
assert_contains "$wizard_args" "--latest-dmg-etag fixture-etag"
assert_contains "$(<"$curl_log")" "https://example.invalid/Codex.dmg"

: >"$wizard_args_log"
run_setup save "read-aloud" pinned 1
assert_contains "$(<"$wizard_args_log")" "--latest-dmg-probe-status unavailable"

run_setup cancel "read-aloud"
[ ! -e "$install_log" ] || fail "cancelled setup must not start installer"

run_setup install "read-aloud,pet-overlay"
install_args="$(<"$install_log")"
assert_contains "$install_args" "--conversion-commit 0123456789abcdef0123456789abcdef01234567"
assert_contains "$install_args" "--linux-features pet-overlay,read-aloud"
assert_contains "$install_args" "--dmg-source pinned"

run_setup install ""
install_args="$(<"$install_log")"
assert_contains "$install_args" "--linux-features none"

run_setup install "read-aloud" latest
install_args="$(<"$install_log")"
assert_contains "$install_args" "--dmg-source latest"
assert_contains "$install_args" "--result-file"
[ -s "$result_view_log" ] || fail "latest build must display the compatibility result"
assert_contains "$(<"$result_view_log")" "upstream-dmg-decision.json"

git_calls="$(<"$git_log")"
assert_contains "$git_calls" "ls-remote --exit-code"
assert_contains "$git_calls" "refs/heads/patchraptor-main"

echo "Codex Desktop Homebrew setup adapter test passed"
