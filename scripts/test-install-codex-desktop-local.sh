#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$repo_dir/scripts/install-codex-desktop-local.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    [[ "$haystack" == *"$needle"* ]] || fail "expected output to contain: $needle"
}

assert_not_contains() {
    local haystack="$1"
    local needle="$2"
    [[ "$haystack" != *"$needle"* ]] || fail "expected output not to contain: $needle"
}

[ -x "$script" ] || fail "script is missing or not executable: $script"
bash -n "$script"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-desktop-install-test.XXXXXX")"
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

fake_bin="$tmp_dir/bin"
fake_prefix="$tmp_dir/homebrew-prefix"
fake_taps="$tmp_dir/taps"
fake_log="$tmp_dir/brew.log"
fake_dagger_log="$tmp_dir/dagger.log"
fake_curl_log="$tmp_dir/curl.log"
fake_home="$tmp_dir/home"
mkdir -p "$fake_bin" "$fake_prefix/Caskroom/codex-desktop" "$fake_taps" "$fake_home/.local/state"

cat >"$fake_bin/dagger" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ -n "${FAKE_DAGGER_LOG:-}" ]; then
    printf 'dagger %s\n' "$*" >>"$FAKE_DAGGER_LOG"
fi

out_dir=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o)
            out_dir="${2:-}"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

[ -n "$out_dir" ] || { echo "missing dagger -o output dir" >&2; exit 64; }
mkdir -p "$out_dir/artifacts" "$out_dir/homebrew"
printf 'fake artifact\n' >"$out_dir/artifacts/codex-desktop-linux-test.tar.gz"
cat >"$out_dir/homebrew/codex-desktop.rb" <<'CASK'
cask "codex-desktop" do
  version "test"
  sha256 :no_check
  url "file://#{ENV.fetch("CODEX_DESKTOP_LOCAL_ARTIFACT")}"
  name "Codex Desktop"
end
CASK
printf '{"upstream_conversion_commit":"0123456789abcdef0123456789abcdef01234567"}\n' >"$out_dir/release.json"
EOF
chmod +x "$fake_bin/dagger"

cat >"$fake_bin/pgrep" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$fake_bin/pgrep"

cat >"$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

log="${FAKE_CURL_LOG:-}"
source_file="${FAKE_CURL_SOURCE:-}"
out_file=""

if [ -n "$log" ]; then
    printf 'curl' >>"$log"
    for arg in "$@"; do
        printf ' %s' "$arg" >>"$log"
    done
    printf '\n' >>"$log"
fi

while [ "$#" -gt 0 ]; do
    case "$1" in
        -o)
            out_file="${2:-}"
            shift 2
            ;;
        --retry)
            shift 2
            ;;
        -*)
            shift
            ;;
        *)
            shift
            ;;
    esac
done

[ -n "$out_file" ] || exit 64
[ -n "$source_file" ] || exit 64
cp "$source_file" "$out_file"
EOF
chmod +x "$fake_bin/curl"

cat >"$fake_bin/brew" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

log="${FAKE_BREW_LOG:?}"
prefix="${FAKE_BREW_PREFIX:?}"
taps="${FAKE_BREW_TAPS:?}"

printf 'brew' >>"$log"
for arg in "$@"; do
    printf ' %s' "$arg" >>"$log"
done
printf '\n' >>"$log"

case "${1:-}" in
    --prefix)
        printf '%s\n' "$prefix"
        ;;
    tap-new)
        tap_name="${3:-}"
        [ -n "$tap_name" ] || exit 64
        mkdir -p "$taps/$tap_name"
        ;;
    --repository)
        tap_name="${2:-}"
        [ -n "$tap_name" ] || exit 64
        mkdir -p "$taps/$tap_name"
        printf '%s\n' "$taps/$tap_name"
        ;;
    ruby)
        cask_path="${@: -2:1}"
        artifact="${@: -1}"
        python3 - "$cask_path" "$artifact" <<'PY'
from pathlib import Path
import sys

cask_path = Path(sys.argv[1])
artifact = sys.argv[2]
needle = 'url "file://#{ENV.fetch("CODEX_DESKTOP_LOCAL_ARTIFACT")}"'
replacement = 'url "file://' + artifact + '"'
contents = cask_path.read_text()
if needle not in contents:
    raise SystemExit("placeholder missing")
cask_path.write_text(contents.replace(needle, replacement, 1))
PY
        ;;
    list)
        if [ "${2:-}" = "--cask" ] && [ "${3:-}" = "codex-desktop" ]; then
            echo "Error: Cask 'codex-desktop' is ambiguous" >&2
            exit 1
        fi
        exit 1
        ;;
    reinstall)
        [ "${2:-}" = "--cask" ] || exit 64
        ;;
    install)
        if [ -d "$prefix/Caskroom/codex-desktop" ]; then
            echo "install called even though codex-desktop is already installed" >&2
            exit 42
        fi
        ;;
    untap)
        ;;
    *)
        echo "unexpected brew command: $*" >&2
        exit 64
        ;;
esac
EOF
chmod +x "$fake_bin/brew"

pinned_dmg_source="$tmp_dir/pinned-Codex.dmg"
printf 'pinned dmg payload\n' >"$pinned_dmg_source"
pinned_dmg_sha="$(
    python3 - "$pinned_dmg_source" <<'PY'
from hashlib import sha256
import sys

with open(sys.argv[1], "rb") as handle:
    print(sha256(handle.read()).hexdigest())
PY
)"
pinned_dmg_content_length="$(wc -c <"$pinned_dmg_source" | tr -d '[:space:]')"
pinned_dmg_ref="$tmp_dir/codex-desktop-dmg.ref"
cat >"$pinned_dmg_ref" <<EOF
url: https://persistent.oaistatic.com/codex-app-prod/Codex.dmg
sha256: $pinned_dmg_sha
content-length: $pinned_dmg_content_length
last-modified: Tue, 07 Jul 2026 00:21:59 GMT
etag: 0x8DEDBBDC2BC816D
EOF

pinned_cache_home="$tmp_dir/cache"
pinned_cache_file="$pinned_cache_home/codex-desktop-dmg/$pinned_dmg_sha/Codex.dmg"
mkdir -p "$(dirname "$pinned_cache_file")"
printf 'stale cached payload\n' >"$pinned_cache_file"

set +e
pinned_output="$(
    PATH="$fake_bin:$PATH" \
    HOME="$fake_home" \
    XDG_STATE_HOME="$fake_home/.local/state" \
    XDG_CACHE_HOME="$pinned_cache_home" \
    FAKE_BREW_LOG="$fake_log" \
    FAKE_CURL_LOG="$fake_curl_log" \
    FAKE_CURL_SOURCE="$pinned_dmg_source" \
    FAKE_DAGGER_LOG="$fake_dagger_log" \
    FAKE_BREW_PREFIX="$fake_prefix" \
    FAKE_BREW_TAPS="$fake_taps" \
    CODEX_DESKTOP_DMG_REF_FILE="$pinned_dmg_ref" \
    CODEX_DESKTOP_BUNDLE_DIR="$tmp_dir/pinned-bundle" \
    "$script" \
        --conversion-commit 0123456789abcdef0123456789abcdef01234567 \
        2>&1
)"
pinned_status=$?
set -e

if [ "$pinned_status" -ne 0 ]; then
    printf '%s\n' "$pinned_output" >&2
    fail "installer should build from the pinned Codex.dmg ref"
fi

pinned_brew_log="$(cat "$fake_log")"
pinned_dagger_log="$(cat "$fake_dagger_log")"
pinned_curl_log="$(cat "$fake_curl_log")"

assert_contains "$pinned_output" "Downloading pinned Codex.dmg"
assert_contains "$pinned_output" "Pinned Codex.dmg verified"
assert_contains "$pinned_output" "Pinned Codex.dmg ref: $pinned_dmg_ref"
assert_contains "$pinned_dagger_log" "--codex-dmg=$pinned_cache_file"
assert_not_contains "$pinned_dagger_log" "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"
assert_contains "$pinned_curl_log" "curl -fsSL --retry 3 -o"
assert_contains "$pinned_curl_log" "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"
assert_contains "$pinned_brew_log" "brew reinstall --cask --force codex-local/"
cmp -s "$pinned_cache_file" "$pinned_dmg_source" || fail "pinned Codex.dmg cache should be refreshed with verified contents"

: >"$fake_log"
: >"$fake_dagger_log"
: >"$fake_curl_log"
touch "$tmp_dir/Codex.dmg"

set +e
output="$(
    PATH="$fake_bin:$PATH" \
    HOME="$fake_home" \
    XDG_STATE_HOME="$fake_home/.local/state" \
    FAKE_BREW_LOG="$fake_log" \
    FAKE_CURL_LOG="$fake_curl_log" \
    FAKE_DAGGER_LOG="$fake_dagger_log" \
    FAKE_BREW_PREFIX="$fake_prefix" \
    FAKE_BREW_TAPS="$fake_taps" \
    CODEX_DESKTOP_BUNDLE_DIR="$tmp_dir/bundle" \
    "$script" \
        --codex-dmg "$tmp_dir/Codex.dmg" \
        --conversion-commit 0123456789abcdef0123456789abcdef01234567 \
        2>&1
)"
status=$?
set -e

if [ "$status" -ne 0 ]; then
    printf '%s\n' "$output" >&2
    fail "installer should reinstall the existing local cask without using the ambiguous token"
fi

brew_log="$(cat "$fake_log")"
explicit_dagger_log="$(cat "$fake_dagger_log")"

assert_contains "$output" "Local artifact:"
assert_contains "$brew_log" "brew reinstall --cask --force codex-local/"
assert_not_contains "$brew_log" "brew list --cask codex-desktop"
assert_contains "$explicit_dagger_log" "--codex-dmg=$tmp_dir/Codex.dmg"
[ ! -s "$fake_curl_log" ] || fail "explicit --codex-dmg should not trigger pinned Codex.dmg download"

existing_bundle="$tmp_dir/existing-bundle"
mkdir -p "$existing_bundle/artifacts" "$existing_bundle/homebrew"
printf 'fake existing artifact\n' >"$existing_bundle/artifacts/codex-desktop-linux-existing.tar.gz"
cat >"$existing_bundle/homebrew/codex-desktop.rb" <<'CASK'
cask "codex-desktop" do
  version "existing"
  sha256 :no_check
  url "file://#{ENV.fetch("CODEX_DESKTOP_LOCAL_ARTIFACT")}"
  name "Codex Desktop"
end
CASK
printf '{"upstream_conversion_commit":"0123456789abcdef0123456789abcdef01234567"}\n' >"$existing_bundle/release.json"
: >"$fake_dagger_log"
: >"$fake_log"

set +e
existing_output="$(
    PATH="$fake_bin:$PATH" \
    HOME="$fake_home" \
    XDG_STATE_HOME="$fake_home/.local/state" \
    FAKE_BREW_LOG="$fake_log" \
    FAKE_CURL_LOG="$fake_curl_log" \
    FAKE_DAGGER_LOG="$fake_dagger_log" \
    FAKE_BREW_PREFIX="$fake_prefix" \
    FAKE_BREW_TAPS="$fake_taps" \
    "$script" \
        --bundle-dir "$existing_bundle" \
        --use-existing-bundle \
        --conversion-commit 0123456789abcdef0123456789abcdef01234567 \
        2>&1
)"
existing_status=$?
set -e

if [ "$existing_status" -ne 0 ]; then
    printf '%s\n' "$existing_output" >&2
    fail "installer should install from an existing local bundle"
fi

existing_brew_log="$(cat "$fake_log")"
existing_dagger_log="$(cat "$fake_dagger_log")"

assert_contains "$existing_output" "Using existing Codex Desktop bundle"
assert_contains "$existing_output" "Local artifact:"
assert_contains "$existing_brew_log" "brew reinstall --cask --force codex-local/"
assert_not_contains "$existing_dagger_log" "dagger "
[ ! -s "$fake_curl_log" ] || fail "--use-existing-bundle should not trigger pinned Codex.dmg download"

echo "install-codex-desktop local cask test passed"
