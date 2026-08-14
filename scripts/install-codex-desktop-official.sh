#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle_dir="${CODEX_DESKTOP_BUNDLE_DIR:-$repo_dir/dist/codex-desktop-official}"

if [ "${CODEX_DESKTOP_SKIP_SETUP:-0}" != "1" ]; then
    CODEX_DESKTOP_BUNDLE_DIR="$bundle_dir" "$repo_dir/scripts/setup-codex-desktop-official.sh"
fi

release_json="$bundle_dir/release.json"
source_cask="$bundle_dir/homebrew/codex-desktop.rb"
[ -f "$release_json" ] || { echo "Missing official Codex Desktop bundle metadata: $release_json" >&2; exit 66; }
[ -f "$source_cask" ] || { echo "Missing rendered Codex Desktop cask: $source_cask" >&2; exit 66; }
command -v brew >/dev/null 2>&1 || { echo "Homebrew is required to install Codex Desktop." >&2; exit 69; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required to prepare the local cask." >&2; exit 69; }

artifact_path="$(python3 - "$release_json" "$bundle_dir" <<'PY'
import json
import pathlib
import sys

release = json.loads(pathlib.Path(sys.argv[1]).read_text())
artifact = pathlib.Path(sys.argv[2]) / "artifacts" / release["asset_name"]
if not artifact.is_file():
    raise SystemExit(f"missing retained artifact: {artifact}")
print(artifact.resolve())
PY
)"

temp_tap_name="codex-official/codex-desktop-$(date +%s)-$$"
cleanup() {
    status=$?
    trap - EXIT
    HOMEBREW_DEVELOPER=1 brew untap "$temp_tap_name" >/dev/null 2>&1 || true
    return "$status"
}
trap cleanup EXIT

brew tap-new --no-git "$temp_tap_name" >/dev/null
temp_tap_dir="$(brew --repository "$temp_tap_name")"
mkdir -p "$temp_tap_dir/Casks"

python3 - "$source_cask" "$temp_tap_dir/Casks/codex-desktop.rb" "$artifact_path" <<'PY'
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text()
artifact = pathlib.Path(sys.argv[3]).as_uri()
rendered = source.replace(next(line for line in source.splitlines() if line.lstrip().startswith("url \"")), f'  url "{artifact}"')
pathlib.Path(sys.argv[2]).write_text(rendered)
PY

echo "Installing the retained official-package Codex Desktop artifact through Homebrew..."
local_cask="$temp_tap_name/codex-desktop"
if brew list --cask codex-desktop >/dev/null 2>&1; then
    HOMEBREW_NO_AUTO_UPDATE=1 brew reinstall --cask --force "$local_cask"
else
    HOMEBREW_NO_AUTO_UPDATE=1 brew install --cask "$local_cask"
fi
echo "Codex Desktop installed from $artifact_path"
