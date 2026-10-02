#!/usr/bin/env bash
set -euo pipefail

# Run this inside a clean Linuxbrew/Wolfi environment. The formula path points at
# the checked-out PR branch, so the smoke never falls back to the default tap.
formula_path="${FORMULA_PATH:-$PWD/Formula/codex-memoryd.rb}"
test -f "$formula_path"
command -v brew >/dev/null

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ENV_HINTS=1
export HOMEBREW_NO_INSTALL_FROM_API=1
export HOME="$(mktemp -d)"

tap_dir="$(brew --repository)/Library/Taps/joshyorko/homebrew-tools"
brew tap-new --no-git joshyorko/tools >/dev/null
mkdir -p "$tap_dir/Formula"
cp "$formula_path" "$tap_dir/Formula/codex-memoryd.rb"

stop_daemon() {
  local stop_output pid state
  stop_output="$(mktemp)"
  if codex-memoryd down >"$stop_output" 2>&1; then
    cat "$stop_output"
    rm -f "$stop_output"
    return 0
  fi

  pid="$(jq -r '.pid // empty' < <(codex-memoryd status 2>/dev/null) || true)"
  state=""
  if [[ -n "$pid" && -r "/proc/$pid/stat" ]]; then
    state="$(awk '{print $3}' "/proc/$pid/stat")"
  fi
  if [[ "$state" != Z ]]; then
    cat "$stop_output" >&2
    rm -f "$stop_output"
    return 1
  fi

  rm -f "$HOME/.codex-memoryd/codex-memoryd.pid"
  rm -f "$stop_output"
}

assert_stopped() {
  local status
  status="$(codex-memoryd status)"
  jq -e '.process == "stopped" and .pid == null' <<<"$status" >/dev/null
}

trap 'stop_daemon || true' EXIT

brew install joshyorko/tools/codex-memoryd
codex-memoryd --version
codex-memoryd init --bind 127.0.0.1:8989
codex-memoryd up
codex-memoryd status
stop_daemon
assert_stopped

db="$HOME/.codex-memoryd/memory.db"
test -s "$db"
db_sha="$(sha256sum "$db" | awk '{print $1}')"

# Exercise an actual Homebrew upgrade using the same verified archive under
# a higher Homebrew revision. This also works with timestamped master builds.
# The user database is outside the formula
# prefix and MUST survive the replacement.
awk '{ print } /^  version / { print "  revision 1" }' "$formula_path" > "$tap_dir/Formula/codex-memoryd.rb"
brew upgrade joshyorko/tools/codex-memoryd
test -s "$db"
test "$(sha256sum "$db" | awk '{print $1}')" = "$db_sha"

brew uninstall codex-memoryd
test -s "$db"
test "$(sha256sum "$db" | awk '{print $1}')" = "$db_sha"

# Verify the official tunnel client remains independently installable.
brew install openai/tools/tunnel-client
tunnel-client --version
