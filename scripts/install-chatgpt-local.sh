#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

command -v dagger >/dev/null 2>&1 || { echo "dagger is required" >&2; exit 69; }
command -v brew >/dev/null 2>&1 || { echo "brew is required" >&2; exit 69; }

git_common_dir="$(git rev-parse --git-common-dir)"
export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"
export HOMEBREW_NO_INSTALL_FROM_API="${HOMEBREW_NO_INSTALL_FROM_API:-1}"

echo "Validating ChatGPT packaging through Dagger..."
dagger -m ./dagger/tap-pipeline call --git-dir="$git_common_dir" ci-check --package-id=chatgpt

temp_tap_name="chatgpt-local/chatgpt-$(date +%s)-$$"
brew tap-new --no-git "$temp_tap_name" >/dev/null
temp_tap_dir="$(brew --repository "$temp_tap_name")"
mkdir -p "$temp_tap_dir/Formula"
cp "$repo_dir/Formula/chatgpt.rb" "$temp_tap_dir/Formula/chatgpt.rb"

local_formula="$temp_tap_name/chatgpt"
if brew list --formula chatgpt >/dev/null 2>&1; then
    brew reinstall --build-from-source "$local_formula"
else
    brew install --build-from-source "$local_formula"
fi
