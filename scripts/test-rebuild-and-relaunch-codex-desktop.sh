#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$repo_dir/scripts/rebuild-and-relaunch-codex-desktop.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    [[ "$haystack" == *"$needle"* ]] || fail "expected output to contain: $needle"
}

[ -x "$script" ] || fail "script is missing or not executable: $script"
bash -n "$script"

output="$("$script" --dry-run --detach --repo-dir "$repo_dir" --make-target codex-desktop-install)"

assert_contains "$output" "DRY RUN"
assert_contains "$output" "would start detached rebuild worker"
assert_contains "$output" "setsid"
assert_contains "$output" "--worker"

foreground_output="$("$script" --dry-run --worker --repo-dir "$repo_dir" --make-target codex-desktop-install)"

assert_contains "$foreground_output" "DRY RUN"
assert_contains "$foreground_output" "git -C"
assert_contains "$foreground_output" "fetch --prune"
assert_contains "$foreground_output" "pull --ff-only"
assert_contains "$foreground_output" "stop Codex Desktop"
assert_contains "$foreground_output" "make -C"
assert_contains "$foreground_output" "codex-desktop-install"
assert_contains "$foreground_output" "codex-desktop desktop"

echo "rebuild-and-relaunch dry-run test passed"
