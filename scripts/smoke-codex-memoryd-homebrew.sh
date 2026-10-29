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
runtime_dir="$(mktemp -d)"
export CODEX_MEMORYD_HOME="$runtime_dir/runtime"

tap_dir="$(brew --repository)/Library/Taps/joshyorko/homebrew-tools"
brew tap-new --no-git joshyorko/tools >/dev/null
mkdir -p "$tap_dir/Formula"
cp "$formula_path" "$tap_dir/Formula/codex-memoryd.rb"

brew install joshyorko/tools/codex-memoryd
codex-memoryd --version
brew test joshyorko/tools/codex-memoryd
codex-memoryd init --bind 127.0.0.1:8989
db="$CODEX_MEMORYD_HOME/memory.db"
# The formula test above owns a disposable foreground child and checks health.
# The initialized database below independently checks upgrade persistence.
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

brew uninstall --force joshyorko/tools/codex-memoryd
test -s "$db"
test "$(sha256sum "$db" | awk '{print $1}')" = "$db_sha"

# Verify the official tunnel client remains independently installable.
brew install openai/tools/tunnel-client
tunnel-client --version
