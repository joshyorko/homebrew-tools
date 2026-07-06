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
fake_home="$tmp_dir/home"
mkdir -p "$fake_bin" "$fake_prefix/Caskroom/codex-desktop" "$fake_taps" "$fake_home/.local/state"

cat >"$fake_bin/dagger" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

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

touch "$tmp_dir/Codex.dmg"

set +e
output="$(
    PATH="$fake_bin:$PATH" \
    HOME="$fake_home" \
    XDG_STATE_HOME="$fake_home/.local/state" \
    FAKE_BREW_LOG="$fake_log" \
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

assert_contains "$output" "Local artifact:"
assert_contains "$brew_log" "brew reinstall --cask --force codex-local/"
assert_not_contains "$brew_log" "brew list --cask codex-desktop"

echo "install-codex-desktop local cask test passed"
