#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$repo_dir/scripts/install-codex-release-local.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

[ -x "$script" ] || fail "script is missing or not executable: $script"
bash -n "$script"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-release-install-test.XXXXXX")"
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

fake_bin="$tmp_dir/bin"
fake_prefix="$tmp_dir/homebrew-prefix"
fake_taps="$tmp_dir/taps"
fake_log="$tmp_dir/brew.log"
bundle_dir="$tmp_dir/bundle"
artifact="$tmp_dir/codex-release-release.20260724000000.0123456789ab.tar.gz"
mkdir -p "$fake_bin" "$fake_prefix" "$fake_taps"
printf 'fake codex release artifact\n' >"$artifact"

cat >"$fake_bin/dagger" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

out_dir=""
artifact=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o)
            out_dir="${2:-}"
            shift 2
            ;;
        --codex-release-artifact=*)
            artifact="${1#*=}"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

[ -n "$out_dir" ] || exit 64
[ -f "$artifact" ] || exit 66
mkdir -p "$out_dir/artifacts" "$out_dir/homebrew"
cp "$artifact" "$out_dir/artifacts/$(basename "$artifact")"
cat >"$out_dir/homebrew/codex-release.rb" <<'FORMULA'
class CodexRelease < Formula
  url "file://#{ENV.fetch("CODEX_RELEASE_LOCAL_ARTIFACT")}"
  version "test"
end
FORMULA
printf '{"package":"codex-release"}\n' >"$out_dir/release.json"
EOF
chmod +x "$fake_bin/dagger"

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
        formula_path="${@: -2:1}"
        artifact="${@: -1}"
        python3 - "$formula_path" "$artifact" <<'PY'
from pathlib import Path
import sys

formula_path = Path(sys.argv[1])
artifact = sys.argv[2]
needle = 'url "file://#{ENV.fetch("CODEX_RELEASE_LOCAL_ARTIFACT")}"'
replacement = 'url "file://' + artifact + '"'
contents = formula_path.read_text()
if needle not in contents:
    raise SystemExit("placeholder missing")
formula_path.write_text(contents.replace(needle, replacement, 1))
PY
        ;;
    list)
        exit 1
        ;;
    install|reinstall)
        mkdir -p "$prefix/Cellar/codex-release/test"
        ;;
    test)
        [ -d "$prefix/Cellar/codex-release/test" ]
        ;;
    untap)
        if [ "${2:-}" = "--force" ]; then
            rm -rf "$prefix/Cellar/codex-release"
        elif [ "${HOMEBREW_DEVELOPER:-}" != "1" ]; then
            echo "refusing to untap an installed formula without developer mode" >&2
            exit 1
        fi
        ;;
    *)
        echo "unexpected brew command: $*" >&2
        exit 64
        ;;
esac
EOF
chmod +x "$fake_bin/brew"

PATH="$fake_bin:$PATH" \
FAKE_BREW_LOG="$fake_log" \
FAKE_BREW_PREFIX="$fake_prefix" \
FAKE_BREW_TAPS="$fake_taps" \
"$script" \
    --artifact "$artifact" \
    --bundle-dir "$bundle_dir"

[ -d "$fake_prefix/Cellar/codex-release/test" ] || fail "temporary tap cleanup must preserve the installed Codex release formula"

echo "install-codex-release local formula test passed"
