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

cleanup() {
  codex-memoryd down >/dev/null 2>&1 || true
}
trap cleanup EXIT

brew install joshyorko/tools/codex-memoryd
codex-memoryd --version
codex-memoryd init --bind 127.0.0.1:8989
codex-memoryd up
codex-memoryd status
codex-memoryd down

db="$HOME/.codex-memoryd/memory.db"
test -s "$db"
db_sha="$(sha256sum "$db" | awk '{print $1}')"

# Exercise an actual Homebrew upgrade using the same verified immutable release
# archive under a newer test version. The user database is outside the formula
# prefix and MUST survive the replacement.
source_url="$(brew info --json=v2 --formula joshyorko/tools/codex-memoryd | jq -er '.formulae[0].urls.stable.url')"
source_sha="$(brew info --json=v2 --formula joshyorko/tools/codex-memoryd | jq -er '.formulae[0].urls.stable.checksum')"
cat > "$tap_dir/Formula/codex-memoryd.rb" <<RUBY
class CodexMemoryd < Formula
  desc "Local-first memory daemon for coding agents"
  homepage "https://github.com/joshyorko/codex-memoryd"
  version "0.1.1"
  license "MIT"
  url "$source_url"
  sha256 "$source_sha"

  def install
    bin.install "codex-memoryd"
  end
end
RUBY
brew upgrade joshyorko/tools/codex-memoryd
test -s "$db"
test "$(sha256sum "$db" | awk '{print $1}')" = "$db_sha"

brew uninstall codex-memoryd
test -s "$db"
test "$(sha256sum "$db" | awk '{print $1}')" = "$db_sha"

# Verify the official tunnel client remains independently installable.
brew install openai/tools/tunnel-client
tunnel-client --version
