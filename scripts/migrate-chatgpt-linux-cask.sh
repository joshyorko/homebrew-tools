#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Linux ]]; then
    echo "This migration is only for the Linux ChatGPT cask." >&2
    exit 64
fi

command -v brew >/dev/null 2>&1 || { echo "brew is required." >&2; exit 69; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 69; }

export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"

prefix=$(brew --prefix)
old_token=chatgpt
old_cask=joshyorko/tools/chatgpt
new_cask=joshyorko/tools/chatgpt-linux
receipt="${prefix}/Caskroom/${old_token}/.metadata/INSTALL_RECEIPT.json"
new_receipt="${prefix}/Caskroom/chatgpt-linux/.metadata/INSTALL_RECEIPT.json"

if [[ -f "$new_receipt" ]]; then
    if jq -e '
        .source.tap == "joshyorko/tools" and
        (.source.path | type == "string" and endswith("/Casks/chatgpt-linux.rb"))
    ' "$new_receipt" >/dev/null; then
        echo "The renamed ChatGPT Linux cask is already installed."
        exit 0
    fi
    echo "The chatgpt-linux cask token is occupied by another installation; nothing was changed." >&2
    exit 1
fi

if [[ ! -f "$receipt" ]]; then
    echo "No old ChatGPT cask receipt found; nothing was changed." >&2
    exit 1
fi

if ! jq -e '
    .source.tap == "joshyorko/tools" and
    (.source.path | type == "string" and endswith("/Casks/chatgpt.rb")) and
    (.source.version | type == "string" and test("^[0-9]+(\\.[0-9]+)+$"))
' "$receipt" >/dev/null; then
    echo "The installed chatgpt cask is not this tap's old Linux cask; nothing was changed." >&2
    exit 1
fi

# Download and checksum-verify the replacement before removing the old cask.
brew fetch --cask "$new_cask"
brew uninstall --cask "$old_cask"
brew install --cask --require-sha "$new_cask"

if ! jq -e '
    .source.tap == "joshyorko/tools" and
    (.source.path | type == "string" and endswith("/Casks/chatgpt-linux.rb"))
' "${prefix}/Caskroom/chatgpt-linux/.metadata/INSTALL_RECEIPT.json" >/dev/null; then
    echo "The new cask receipt did not verify after installation." >&2
    exit 1
fi

test -x "${prefix}/bin/chatgpt"
test -f "${HOME}/.local/share/applications/chatgpt.desktop"
echo "ChatGPT Linux cask migrated. ChatGPT and Codex user data was preserved."
