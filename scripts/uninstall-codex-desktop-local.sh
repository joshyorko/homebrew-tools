#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/uninstall-codex-desktop-local.sh [options]

Uninstall the local-only Codex Desktop Homebrew cask and clean the user-level
desktop integration files it installs. This preserves ~/.codex.

Options:
  --zap        Also remove Codex Desktop app-local config/cache/state directories.
  -h, --help   Show this help.
EOF
}

zap=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --zap)
            zap=1
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

if ! command -v brew >/dev/null 2>&1; then
    echo "brew is required to uninstall the Codex Desktop cask." >&2
    exit 69
fi

export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"

if brew list --cask codex-desktop >/dev/null 2>&1; then
    brew uninstall --cask codex-desktop || {
        echo "Homebrew uninstall failed for codex-desktop." >&2
        echo "Run 'brew doctor' and retry, or inspect: brew info --cask codex-desktop" >&2
        exit 70
    }
else
    echo "Codex Desktop cask is not installed."
fi

prefix="$(brew --prefix)"
caskroom="${prefix}/Caskroom/codex-desktop"

rm -f \
    "${HOME}/.local/share/applications/codex-desktop.desktop" \
    "${HOME}/.local/share/icons/hicolor/512x512/apps/codex-desktop.png" \
    "${HOME}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png" \
    "${HOME}/.cache/codex-desktop/flatpak-bin/google-chrome" \
    "${HOME}/.cache/codex-desktop/flatpak-bin/chrome"

if [ -d "$caskroom" ]; then
    rm -rf "$caskroom"
fi

if [ "$zap" -eq 1 ]; then
    rm -rf \
        "${HOME}/.config/codex-desktop" \
        "${HOME}/.cache/codex-desktop" \
        "${HOME}/.local/state/codex-desktop"
fi

while IFS= read -r tap_name; do
    [ -n "$tap_name" ] || continue
    brew untap --force "$tap_name" >/dev/null 2>&1 || true
done < <(brew tap | sed -n '/^codex-local\/codex-desktop-local-/p')

echo "Codex Desktop local cask uninstall complete."
