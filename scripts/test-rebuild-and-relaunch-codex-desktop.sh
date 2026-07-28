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

assert_equals() {
    local actual="$1"
    local expected="$2"
    [ "$actual" = "$expected" ] || fail "expected $expected, got $actual"
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
assert_contains "$foreground_output" "env -u CODEX_ELECTRON_RESOURCES_PATH"
assert_contains "$foreground_output" "-u CODEX_BROWSER_USE_NODE_PATH"
assert_contains "$foreground_output" "codex-desktop desktop"

test_root="$(mktemp -d)"
stubborn_pids=()
cleanup() {
    if [ "${#stubborn_pids[@]}" -gt 0 ]; then
        kill -9 "${stubborn_pids[@]}" 2>/dev/null || true
        wait "${stubborn_pids[@]}" 2>/dev/null || true
    fi
    rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$test_root/bin" "$test_root/state"
sleep_count_file="$test_root/sleep-count"
printf '0\n' >"$sleep_count_file"

cat >"$test_root/bin/pgrep" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' ${TEST_PIDS}
EOF
cat >"$test_root/bin/make" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$test_root/bin/sleep" <<'EOF'
#!/usr/bin/env bash
read -r count <"$SLEEP_COUNT_FILE"
printf '%s\n' "$((count + 1))" >"$SLEEP_COUNT_FILE"
EOF
chmod +x "$test_root/bin/pgrep" "$test_root/bin/make" "$test_root/bin/sleep"

for process_number in 1 2; do
    ready_file="$test_root/ready-$process_number"
    bash -c 'trap "" TERM; printf "ready\n" >"$1"; while :; do :; done' bash "$ready_file" &
    stubborn_pids+=("$!")
    disown "$!"
    while [ ! -f "$ready_file" ]; do
        /usr/bin/sleep 0.01
    done
done

TEST_PIDS="${stubborn_pids[*]}" \
SLEEP_COUNT_FILE="$sleep_count_file" \
XDG_STATE_HOME="$test_root/state" \
PATH="$test_root/bin:$PATH" \
    "$script" --skip-pull --allow-dirty --no-launch --wait-seconds 2 --repo-dir "$repo_dir" >/dev/null

wait "${stubborn_pids[@]}" 2>/dev/null || true
stubborn_pids=()
assert_equals "$(cat "$sleep_count_file")" "2"

echo "rebuild-and-relaunch dry-run test passed"
