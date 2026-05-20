#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/install-codex-desktop-local.sh [options]

Build Codex Desktop Linux locally from the official OpenAI DMG, then install the
generated local artifact through Homebrew. No converted app payload is uploaded
or downloaded from this tap.

Options:
  --codex-dmg PATH              Use an already-downloaded Codex.dmg.
  --conversion-commit SHA       Use a specific joshyorko/codex-desktop-linux commit.
  --bundle-dir PATH             Write the local bundle here instead of a temp dir.
  --skip-install                Build only; do not run brew install/reinstall.
  -h, --help                    Show this help.
EOF
}

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
codex_dmg=""
conversion_commit=""
bundle_dir=""
skip_install=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --codex-dmg)
            codex_dmg="${2:-}"
            [ -n "$codex_dmg" ] || { echo "--codex-dmg requires a path" >&2; exit 64; }
            shift 2
            ;;
        --conversion-commit)
            conversion_commit="${2:-}"
            [ -n "$conversion_commit" ] || { echo "--conversion-commit requires a SHA" >&2; exit 64; }
            shift 2
            ;;
        --bundle-dir)
            bundle_dir="${2:-}"
            [ -n "$bundle_dir" ] || { echo "--bundle-dir requires a path" >&2; exit 64; }
            shift 2
            ;;
        --skip-install)
            skip_install=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 64
            ;;
    esac
done

if ! command -v dagger >/dev/null 2>&1; then
    echo "dagger is required. Install it first, then rerun this script." >&2
    exit 69
fi

if [ "$skip_install" -eq 0 ] && ! command -v brew >/dev/null 2>&1; then
    echo "brew is required unless --skip-install is set." >&2
    exit 69
fi

if [ -n "$codex_dmg" ]; then
    codex_dmg="$(realpath "$codex_dmg")"
    [ -f "$codex_dmg" ] || { echo "Codex DMG not found: $codex_dmg" >&2; exit 66; }
fi

if [ -z "$bundle_dir" ]; then
    bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-desktop-local.XXXXXX")"
else
    mkdir -p "$bundle_dir"
    bundle_dir="$(realpath "$bundle_dir")"
fi

dagger_args=(
    -m "$repo_dir/dagger/tap-pipeline"
    call
    -o "$bundle_dir"
    codex-desktop-local-bundle
)

if [ -n "$codex_dmg" ]; then
    dagger_args+=("--codex-dmg=$codex_dmg")
fi
if [ -n "$conversion_commit" ]; then
    dagger_args+=("--codex-desktop-conversion-commit=$conversion_commit")
fi

echo "Building local Codex Desktop bundle into $bundle_dir"
(cd "$repo_dir" && dagger "${dagger_args[@]}")

artifact="$(find "$bundle_dir/artifacts" -maxdepth 1 -type f -name 'codex-desktop-linux-*.tar.gz' | sort | tail -n 1)"
cask_file="$bundle_dir/homebrew/codex-desktop.rb"

if [ -z "$artifact" ] || [ ! -f "$artifact" ]; then
    echo "Local Codex Desktop artifact was not produced under $bundle_dir/artifacts" >&2
    exit 70
fi
if [ ! -f "$cask_file" ]; then
    echo "Local Codex Desktop cask was not produced at $cask_file" >&2
    exit 70
fi

echo "Local artifact: $artifact"
echo "Local cask: $cask_file"

if [ "$skip_install" -eq 1 ]; then
    echo "Build complete. Skipping Homebrew install."
    exit 0
fi

export CODEX_DESKTOP_LOCAL_ARTIFACT="$artifact"
export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"

if brew list --cask codex-desktop >/dev/null 2>&1; then
    brew reinstall --cask "$cask_file"
else
    brew install --cask "$cask_file"
fi
