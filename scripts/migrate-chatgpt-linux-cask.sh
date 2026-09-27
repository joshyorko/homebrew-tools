#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Linux ]]; then
    echo "This migration is only for the Linux ChatGPT cask." >&2
    exit 64
fi

command -v brew >/dev/null 2>&1 || { echo "brew is required." >&2; exit 69; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 69; }
command -v flock >/dev/null 2>&1 || { echo "flock is required." >&2; exit 69; }

export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"

prefix=$(brew --prefix)
old_token=chatgpt
old_cask=joshyorko/tools/chatgpt
new_cask=joshyorko/tools/chatgpt-linux
old_caskroom="${prefix}/Caskroom/${old_token}"
new_caskroom="${prefix}/Caskroom/chatgpt-linux"
receipt="${old_caskroom}/.metadata/INSTALL_RECEIPT.json"
new_receipt="${new_caskroom}/.metadata/INSTALL_RECEIPT.json"
migration_dir="${prefix}/var/homebrew-tools-chatgpt-linux-migration"
backup_caskroom="${migration_dir}/old-caskroom"
state_file="${migration_dir}/state.json"
lock_file="${prefix}/var/homebrew-tools-chatgpt-linux-migration.lock"

mkdir -p "${prefix}/var" "$migration_dir"
exec 9> "$lock_file"
flock -w 120 9 || { echo "Another ChatGPT migration is running." >&2; exit 1; }

verify_old_receipt() {
    jq -e '
        .source.tap == "joshyorko/tools" and
        (.source.path | type == "string" and endswith("/Casks/chatgpt.rb")) and
        (.source.version | type == "string" and test("^[0-9]+(\\.[0-9]+)+$"))
    ' "$1" >/dev/null
}

verify_new_receipt() {
    jq -e '
        .source.tap == "joshyorko/tools" and
        (.source.path | type == "string" and endswith("/Casks/chatgpt-linux.rb"))
    ' "$1" >/dev/null
}

new_install_healthy() {
    verify_new_receipt "$new_receipt" &&
        [[ -x "${prefix}/bin/chatgpt" ]] &&
        [[ -f "${HOME}/.local/share/applications/chatgpt.desktop" ]] &&
        [[ -f "${HOME}/.local/share/icons/hicolor/512x512@2/apps/chatgpt.png" ]]
}

restore_old_install() {
    local version old_version_dir launcher desktop icon source
    if [[ ! -f "${backup_caskroom}/.metadata/INSTALL_RECEIPT.json" ]] || ! verify_old_receipt "${backup_caskroom}/.metadata/INSTALL_RECEIPT.json"; then
        echo "Old cask backup is missing or has the wrong source; manual recovery is required." >&2
        return 1
    fi

    version=$(jq -er '.source.version' "${backup_caskroom}/.metadata/INSTALL_RECEIPT.json") || return 1
    if [[ -e "$new_caskroom" || -L "$new_caskroom" ]]; then
        if ! verify_new_receipt "${new_caskroom}/.metadata/INSTALL_RECEIPT.json"; then
            echo "Another cask now occupies the chatgpt-linux Caskroom token; refusing rollback." >&2
            return 1
        fi
        rm -rf "$new_caskroom"
    fi

    if [[ ! -e "${old_caskroom}/.metadata/INSTALL_RECEIPT.json" ]]; then
        if [[ -e "$old_caskroom" || -L "$old_caskroom" ]]; then
            echo "The old Caskroom token is partially occupied; refusing rollback." >&2
            return 1
        fi
        cp -al "$backup_caskroom" "$old_caskroom" || return 1
    elif ! verify_old_receipt "${old_caskroom}/.metadata/INSTALL_RECEIPT.json"; then
        echo "Another cask now occupies the old Caskroom token; refusing rollback." >&2
        return 1
    fi

    old_version_dir="${old_caskroom}/${version}"
    launcher="${old_version_dir}/usr/lib/chatgpt/codex-launcher"
    desktop="${old_version_dir}/usr/share/applications/chatgpt.desktop"
    icon="${old_version_dir}/usr/share/pixmaps/chatgpt.png"
    for source in "$launcher" "$desktop" "$icon"; do
        [[ -e "$source" ]] || { echo "Old cask backup is incomplete: $source" >&2; return 1; }
    done

    if [[ -e "${prefix}/bin/chatgpt" || -L "${prefix}/bin/chatgpt" ]]; then
        if [[ ! -L "${prefix}/bin/chatgpt" ]] || ! readlink "${prefix}/bin/chatgpt" | rg -q '/Caskroom/chatgpt(-linux)?/'; then
            echo "${prefix}/bin/chatgpt is occupied by another file; refusing rollback." >&2
            return 1
        fi
        rm -f "${prefix}/bin/chatgpt"
    fi
    ln -s "$launcher" "${prefix}/bin/chatgpt" || return 1

    mkdir -p \
        "${HOME}/.local/share/applications" \
        "${HOME}/.local/share/icons/hicolor/512x512@2/apps"
    cp -f "$desktop" "${HOME}/.local/share/applications/chatgpt.desktop" || return 1
    cp -f "$icon" "${HOME}/.local/share/icons/hicolor/512x512@2/apps/chatgpt.png" || return 1
}

prepare_rollback_backup() {
    local backup_receipt backup_sha staging_dir
    if [[ -e "$backup_caskroom" || -L "$backup_caskroom" ]]; then
        if [[ ! -d "$backup_caskroom" || -L "$backup_caskroom" ]]; then
            echo "Rollback backup path is occupied; refusing migration." >&2
            return 1
        fi
        backup_receipt="${backup_caskroom}/.metadata/INSTALL_RECEIPT.json"
        if ! verify_old_receipt "$backup_receipt"; then
            echo "Existing rollback backup is incomplete or belongs to another cask; refusing migration." >&2
            return 1
        fi
        backup_sha=$(sha256sum "$backup_receipt" | cut -d ' ' -f 1)
        if [[ "$backup_sha" != "$old_receipt_sha" ]]; then
            echo "Existing rollback backup does not match the installed receipt; refusing migration." >&2
            return 1
        fi
        return 0
    fi

    staging_dir=$(mktemp -d "${migration_dir}/old-caskroom-staging.XXXXXX") || return 1
    if ! cp -al -- "${old_caskroom}/." "${staging_dir}/"; then
        rm -rf "$staging_dir"
        return 1
    fi
    backup_receipt="${staging_dir}/.metadata/INSTALL_RECEIPT.json"
    if ! verify_old_receipt "$backup_receipt"; then
        rm -rf "$staging_dir"
        echo "Rollback backup copy is incomplete or has the wrong source." >&2
        return 1
    fi
    backup_sha=$(sha256sum "$backup_receipt" | cut -d ' ' -f 1)
    if [[ "$backup_sha" != "$old_receipt_sha" ]]; then
        rm -rf "$staging_dir"
        echo "Rollback backup copy does not match the installed receipt." >&2
        return 1
    fi
    if ! mv -T -- "$staging_dir" "$backup_caskroom"; then
        rm -rf "$staging_dir"
        return 1
    fi
}

finish_migration() {
    rm -rf "$backup_caskroom" "$migration_dir"
    echo "ChatGPT Linux cask migrated. ChatGPT and Codex user data was preserved."
}

if [[ -f "$new_receipt" ]]; then
    if ! verify_new_receipt "$new_receipt"; then
        echo "The chatgpt-linux cask token is occupied by another installation; nothing was changed." >&2
        exit 1
    fi
    if [[ -f "$receipt" ]]; then
        echo "Both ChatGPT cask tokens are installed; inspect them before migrating." >&2
        exit 1
    fi
    if new_install_healthy; then
        echo "The renamed ChatGPT Linux cask is already installed."
        exit 0
    fi
fi

if [[ -f "$state_file" ]]; then
    if ! jq -e '
        .schema == 1 and
        (.phase == "prepared" or .phase == "old_removed") and
        (.source.tap == "joshyorko/tools") and
        (.source.version | type == "string" and test("^[0-9]+(\\.[0-9]+)+$")) and
        (.source.receipt | type == "string" and test("^[a-f0-9]{64}$"))
    ' "$state_file" >/dev/null; then
        echo "Migration checkpoint is invalid; inspect it before retrying." >&2
        exit 1
    fi
    old_version=$(jq -r '.source.version' "$state_file")
    old_receipt_sha=$(jq -r '.source.receipt' "$state_file")
    phase=$(jq -r '.phase' "$state_file")
    if [[ -f "$receipt" ]]; then
        verify_old_receipt "$receipt" || { echo "Old cask receipt changed; refusing migration." >&2; exit 1; }
        [[ $(jq -r '.source.version' "$receipt") == "$old_version" ]] || { echo "Old cask version changed; refusing migration." >&2; exit 1; }
        [[ $(sha256sum "$receipt" | cut -d ' ' -f 1) == "$old_receipt_sha" ]] || { echo "Old cask receipt changed; refusing migration." >&2; exit 1; }
    elif verify_old_receipt "${backup_caskroom}/.metadata/INSTALL_RECEIPT.json" 2>/dev/null; then
        [[ $(jq -r '.source.version' "${backup_caskroom}/.metadata/INSTALL_RECEIPT.json") == "$old_version" ]] || { echo "Backup receipt version changed; refusing migration." >&2; exit 1; }
        [[ $(sha256sum "${backup_caskroom}/.metadata/INSTALL_RECEIPT.json" | cut -d ' ' -f 1) == "$old_receipt_sha" ]] || { echo "Backup receipt changed; refusing migration." >&2; exit 1; }
        phase=old_removed
    else
        echo "Old cask and rollback receipt are both missing; manual recovery is required." >&2
        exit 1
    fi
    [[ -d "$backup_caskroom" ]] || { echo "Old cask rollback data is missing; refusing retry." >&2; exit 1; }
else
    if [[ ! -f "$receipt" ]] || ! verify_old_receipt "$receipt"; then
        echo "No tap-owned old Linux ChatGPT cask receipt found; nothing was changed." >&2
        exit 1
    fi
    old_version=$(jq -er '.source.version' "$receipt") || exit 1
    old_receipt_sha=$(sha256sum "$receipt" | cut -d ' ' -f 1)
    brew fetch --cask "$new_cask"
    prepare_rollback_backup
    jq -cn --arg version "$old_version" --arg receipt "$old_receipt_sha" \
        '{schema:1,phase:"prepared",source:{tap:"joshyorko/tools",version:$version,receipt:$receipt}}' > "${state_file}.tmp"
    mv -f "${state_file}.tmp" "$state_file"
    phase=prepared
fi

if [[ "$phase" == prepared ]]; then
    uninstall_rc=0
    brew uninstall --cask "$old_cask" || uninstall_rc=$?
    if [[ -f "$receipt" ]]; then
        [[ "$uninstall_rc" != 0 ]] || uninstall_rc=1
        restore_old_install || { echo "Old uninstall failed and rollback was incomplete; retain $backup_caskroom." >&2; exit 1; }
        finish_migration
        echo "Old cask uninstall failed; its previous installation was restored. Retry after resolving the Homebrew error." >&2
        exit "${uninstall_rc:-1}"
    fi
    phase=old_removed
    jq '.phase = "old_removed"' "$state_file" > "${state_file}.tmp"
    mv -f "${state_file}.tmp" "$state_file"
fi

install_rc=0
brew install --cask --require-sha "$new_cask" || install_rc=$?
if [[ "$install_rc" == 0 ]] && ! new_install_healthy; then
    install_rc=1
fi

if [[ "$install_rc" != 0 ]]; then
    if restore_old_install; then
        finish_migration
        echo "New cask install failed; the previous ChatGPT installation was restored. Retry after resolving the Homebrew error." >&2
    else
        echo "New cask install failed and automatic rollback was incomplete; retain $backup_caskroom for recovery." >&2
    fi
    exit "$install_rc"
fi

finish_migration
