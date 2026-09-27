#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
    echo "brew is required to uninstall the ChatGPT cask." >&2
    exit 69
fi

export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"

if brew list --cask joshyorko/tools/chatgpt-linux >/dev/null 2>&1; then
    brew uninstall --cask joshyorko/tools/chatgpt-linux || {
        echo "Homebrew uninstall failed for chatgpt." >&2
        echo "Run 'brew doctor' and retry, or inspect: brew info --cask joshyorko/tools/chatgpt-linux" >&2
        exit 70
    }
else
    echo "ChatGPT cask is not installed."
fi

prefix="$(brew --prefix)"
caskroom="${prefix}/Caskroom/chatgpt-linux"

rm -f \
    "${HOME}/.local/share/applications/chatgpt.desktop" \
    "${HOME}/.local/share/pixmaps/chatgpt.png" \
    "${HOME}/.local/share/icons/hicolor/512x512@2/apps/chatgpt.png"

if [ -d "$caskroom" ]; then
    rm -rf "$caskroom"
fi

while IFS= read -r tap_name; do
    [ -n "$tap_name" ] || continue
    brew untap --force "$tap_name" >/dev/null 2>&1 || true
done < <(brew tap | sed -n '/^chatgpt-local\/chatgpt-linux-/p')

echo "ChatGPT cask uninstall complete; user data was preserved."
