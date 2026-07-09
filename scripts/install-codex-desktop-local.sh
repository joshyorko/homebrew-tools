#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/install-codex-desktop-local.sh [options]

Build Codex Desktop Linux locally from the official OpenAI DMG, then install the
generated local artifact through Homebrew. No converted app payload is uploaded
or downloaded from this tap.

Options:
  --codex-dmg PATH              Use an already-downloaded local Codex.dmg.
  --conversion-commit SHA       Use a specific joshyorko/codex-desktop-linux commit.
  --linux-feature ID            Enable one Linux feature. May be repeated.
  --linux-features LIST         Use comma- or space-separated Linux feature IDs.
  --bundle-dir PATH             Write the local bundle here instead of a temp dir.
  --use-existing-bundle         Install from --bundle-dir without rebuilding it.
  --skip-install                Build only; do not run brew install/reinstall.
  --stop-running                Stop a live Codex Desktop before install.
  --allow-running               Allow installing over a live Codex Desktop.
  -h, --help                    Show this help.

Environment defaults:
  CODEX_DESKTOP_CONVERSION_COMMIT  Conversion ref used when --conversion-commit is omitted.
  CODEX_DESKTOP_CONVERSION_REF_FILE File containing the default conversion ref.
  CODEX_DESKTOP_CONVERSION_REPO    Conversion repository used when resolving mutable refs.
  CODEX_DESKTOP_LINUX_FEATURES     Comma- or space-separated Linux feature IDs.
  CODEX_DESKTOP_CODEX_DMG          Local DMG path used when --codex-dmg is omitted.
  CODEX_DESKTOP_DMG_REF_FILE       File containing the pinned upstream DMG metadata.
  CODEX_DESKTOP_BUNDLE_DIR         Bundle directory used when --bundle-dir is omitted.
  CODEX_DESKTOP_BUNDLE_PARENT      Parent directory for generated local bundles.
  CODEX_DESKTOP_USE_EXISTING_BUNDLE
                                      Install from CODEX_DESKTOP_BUNDLE_DIR without rebuilding.
  CODEX_DESKTOP_STOP_RUNNING       Stop a live Codex Desktop before install.
  CODEX_DESKTOP_ALLOW_RUNNING_INSTALL
                                      Allow installing over a live Codex Desktop.
  CODEX_DESKTOP_SKIP_INSTALL       Set to any non-empty value to imply --skip-install.
EOF
}

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
conversion_repo="${CODEX_DESKTOP_CONVERSION_REPO:-https://github.com/joshyorko/codex-desktop-linux}"
codex_dmg="${CODEX_DESKTOP_CODEX_DMG:-}"
conversion_ref_file="${CODEX_DESKTOP_CONVERSION_REF_FILE:-$repo_dir/codex-desktop-conversion.ref}"
codex_dmg_ref_file="${CODEX_DESKTOP_DMG_REF_FILE:-$repo_dir/codex-desktop-dmg.ref}"
linux_features="${CODEX_DESKTOP_LINUX_FEATURES:-}"
bundle_dir="${CODEX_DESKTOP_BUNDLE_DIR:-}"
cache_home="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}"
bundle_parent="${CODEX_DESKTOP_BUNDLE_PARENT:-$cache_home/codex-desktop-local-bundles}"
auto_bundle_dir=0
skip_install=0
use_existing_bundle=0
stop_running=0
allow_running_install=0
used_pinned_codex_dmg=0
wait_seconds="${CODEX_DESKTOP_STOP_WAIT_SECONDS:-25}"
temp_tap_name=""
install_succeeded=0

read_default_conversion_ref() {
    local ref_file="$1"
    local ref=""

    if [ -f "$ref_file" ]; then
        ref="$(
            sed -e 's/[[:space:]]*#.*//' -e '/^[[:space:]]*$/d' "$ref_file" |
                head -n 1
        )"
    fi

    printf '%s\n' "${ref:-self-hosted}"
}

read_ref_value() {
    local ref_file="$1"
    local wanted_key="$2"

    awk -v wanted_key="$wanted_key" '
        BEGIN { IGNORECASE = 1 }
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        {
            key = $0
            sub(/:.*/, "", key)
            value = substr($0, index($0, ":") + 1)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            if (tolower(key) == tolower(wanted_key)) {
                print value
                exit
            }
        }
    ' "$ref_file"
}

file_sha256() {
    local file_path="$1"

    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file_path" | awk '{ print $1 }'
        return 0
    fi

    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file_path" | awk '{ print $1 }'
        return 0
    fi

    if command -v python3 >/dev/null 2>&1; then
        python3 - "$file_path" <<'PY'
from hashlib import sha256
import sys

digest = sha256()
with open(sys.argv[1], "rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
print(digest.hexdigest())
PY
        return 0
    fi

    echo "Could not find sha256sum, shasum, or python3 to verify Codex.dmg." >&2
    exit 69
}

file_size_bytes() {
    local file_path="$1"

    wc -c <"$file_path" | tr -d '[:space:]'
}

load_pinned_codex_dmg_metadata() {
    local ref_file="$1"

    [ -f "$ref_file" ] || { echo "Pinned Codex.dmg ref file not found: $ref_file" >&2; exit 66; }

    pinned_codex_dmg_url="$(read_ref_value "$ref_file" "url")"
    pinned_codex_dmg_sha256="$(read_ref_value "$ref_file" "sha256")"
    pinned_codex_dmg_content_length="$(read_ref_value "$ref_file" "content-length")"
    pinned_codex_dmg_last_modified="$(read_ref_value "$ref_file" "last-modified")"
    pinned_codex_dmg_etag="$(read_ref_value "$ref_file" "etag")"

    [ -n "$pinned_codex_dmg_url" ] || { echo "Pinned Codex.dmg ref file is missing url: $ref_file" >&2; exit 65; }
    [[ "$pinned_codex_dmg_sha256" =~ ^[0-9a-fA-F]{64}$ ]] || {
        echo "Pinned Codex.dmg ref file has an invalid sha256: $ref_file" >&2
        exit 65
    }
    [[ "$pinned_codex_dmg_content_length" =~ ^[0-9]+$ ]] || {
        echo "Pinned Codex.dmg ref file has an invalid content-length: $ref_file" >&2
        exit 65
    }
    [ -n "$pinned_codex_dmg_last_modified" ] || {
        echo "Pinned Codex.dmg ref file is missing last-modified: $ref_file" >&2
        exit 65
    }
    [ -n "$pinned_codex_dmg_etag" ] || {
        echo "Pinned Codex.dmg ref file is missing etag: $ref_file" >&2
        exit 65
    }
}

pinned_codex_dmg_matches() {
    local file_path="$1"
    local expected_sha256="$2"
    local expected_content_length="$3"
    local actual_content_length
    local actual_sha256

    [ -f "$file_path" ] || return 1

    actual_content_length="$(file_size_bytes "$file_path")"
    [ "$actual_content_length" = "$expected_content_length" ] || return 1

    actual_sha256="$(file_sha256 "$file_path")"
    [ "$actual_sha256" = "$expected_sha256" ]
}

ensure_pinned_codex_dmg() {
    local ref_file="$1"
    local cache_dir
    local cached_dmg
    local temp_dmg
    local actual_content_length
    local actual_sha256

    load_pinned_codex_dmg_metadata "$ref_file"

    cache_dir="${cache_home}/codex-desktop-dmg/${pinned_codex_dmg_sha256}"
    cached_dmg="${cache_dir}/Codex.dmg"
    temp_dmg="${cache_dir}/Codex.dmg.partial.$$"

    mkdir -p "$cache_dir"

    if pinned_codex_dmg_matches "$cached_dmg" "$pinned_codex_dmg_sha256" "$pinned_codex_dmg_content_length"; then
        echo "Using pinned Codex.dmg cache: $cached_dmg" >&2
        printf '%s\n' "$cached_dmg"
        return 0
    fi

    if ! command -v curl >/dev/null 2>&1; then
        echo "curl is required to download the pinned Codex.dmg." >&2
        exit 69
    fi

    rm -f "$temp_dmg"
    echo "Downloading pinned Codex.dmg to $cached_dmg" >&2
    curl -fsSL --retry 3 -o "$temp_dmg" "$pinned_codex_dmg_url"

    actual_content_length="$(file_size_bytes "$temp_dmg")"
    if [ "$actual_content_length" != "$pinned_codex_dmg_content_length" ]; then
        rm -f "$temp_dmg"
        echo "Pinned Codex.dmg content-length mismatch: expected $pinned_codex_dmg_content_length, got $actual_content_length" >&2
        exit 70
    fi

    actual_sha256="$(file_sha256 "$temp_dmg")"
    if [ "$actual_sha256" != "$pinned_codex_dmg_sha256" ]; then
        rm -f "$temp_dmg"
        echo "Pinned Codex.dmg sha256 mismatch: expected $pinned_codex_dmg_sha256, got $actual_sha256" >&2
        exit 70
    fi

    mv "$temp_dmg" "$cached_dmg"
    echo "Pinned Codex.dmg verified: sha256=$pinned_codex_dmg_sha256 content-length=$pinned_codex_dmg_content_length last-modified=$pinned_codex_dmg_last_modified etag=$pinned_codex_dmg_etag" >&2
    printf '%s\n' "$cached_dmg"
}

conversion_commit="${CODEX_DESKTOP_CONVERSION_COMMIT:-$(read_default_conversion_ref "$conversion_ref_file")}"

append_linux_feature() {
    local feature="$1"

    linux_features="${linux_features:+$linux_features }$feature"
}

if [ -n "${CODEX_DESKTOP_SKIP_INSTALL:-}" ]; then
    skip_install=1
fi
if [ -n "${CODEX_DESKTOP_USE_EXISTING_BUNDLE:-}" ]; then
    use_existing_bundle=1
fi
if [ -n "${CODEX_DESKTOP_STOP_RUNNING:-}" ]; then
    stop_running=1
fi
if [ -n "${CODEX_DESKTOP_ALLOW_RUNNING_INSTALL:-}" ]; then
    allow_running_install=1
fi

is_live_pid() {
    local pid="$1"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

read_pid_file() {
    local path="$1"
    local pid=""
    [ -f "$path" ] || return 0
    pid="$(sed -n 's/^[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$path" 2>/dev/null | head -n 1 || true)"
    if [ -n "$pid" ] && is_live_pid "$pid"; then
        printf '%s\n' "$pid"
    fi
}

discover_codex_desktop_pids() {
    local state_root="${XDG_STATE_HOME:-$HOME/.local/state}"
    local pid_file
    for pid_file in \
        "$state_root/codex-desktop/app.pid" \
        "$state_root/codex-desktop/webview.pid"
    do
        read_pid_file "$pid_file"
    done

    pgrep -u "$(id -u)" -f '/Caskroom/codex-desktop/.*/share/codex-desktop/app/(start\.sh|electron|chrome_crashpad_handler|resources/node_repl|resources/node-runtime/bin/node)|/share/codex-desktop/app/(start\.sh|electron|chrome_crashpad_handler|resources/node_repl|resources/node-runtime/bin/node)' 2>/dev/null || true
}

unique_live_pids() {
    local pid
    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        is_live_pid "$pid" || continue
        printf '%s\n' "$pid"
    done | awk '!seen[$0]++'
}

codex_desktop_cask_is_installed() {
    local prefix
    prefix="$(brew --prefix)"
    [ -d "$prefix/Caskroom/codex-desktop" ]
}

wait_for_exit() {
    local pid="$1"
    local waited=0
    while is_live_pid "$pid"; do
        [ "$waited" -lt "$wait_seconds" ] || return 1
        sleep 1
        waited=$((waited + 1))
    done
    return 0
}

stop_codex_desktop() {
    local pids="$1"
    local pid
    local stubborn=()

    echo "Stopping live Codex Desktop bundle-backed processes before local cask install."
    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        kill "$pid" 2>/dev/null || true
    done <<<"$pids"

    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        if ! wait_for_exit "$pid"; then
            stubborn+=("$pid")
        fi
    done <<<"$pids"

    if [ "${#stubborn[@]}" -gt 0 ]; then
        echo "Codex Desktop did not exit after ${wait_seconds}s; sending SIGKILL." >&2
        kill -9 "${stubborn[@]}" 2>/dev/null || true
    fi
}

guard_running_codex_desktop() {
    local pids

    [ "$skip_install" -eq 0 ] || return 0
    pids="$(discover_codex_desktop_pids | unique_live_pids)"
    [ -n "$pids" ] || return 0

    if [ "$stop_running" -eq 1 ]; then
        stop_codex_desktop "$pids"
        return 0
    fi

    if [ "$allow_running_install" -eq 1 ]; then
        echo "WARN: installing over live Codex Desktop bundle-backed processes:" >&2
        printf '%s\n' "$pids" | sed 's/^/  pid /' >&2
        return 0
    fi

    echo "Refusing to install Codex Desktop while bundle-backed processes are running:" >&2
    printf '%s\n' "$pids" | sed 's/^/  pid /' >&2
    echo "These may be the GUI app itself or Codex CLI/MCP helpers using the installed Desktop bundle." >&2
    echo "Use 'make codex-desktop-rebuild-relaunch' when rebuilding from inside Codex Desktop." >&2
    echo "From an external terminal, rerun with CODEX_DESKTOP_STOP_RUNNING=1 to stop it before install." >&2
    echo "Set CODEX_DESKTOP_ALLOW_RUNNING_INSTALL=1 only if you deliberately want to risk stale old helper processes." >&2
    exit 75
}

cleanup() {
    status=$?
    trap - EXIT

    if [ -n "$temp_tap_name" ]; then
        brew untap --force "$temp_tap_name" >/dev/null 2>&1 || true
    fi

    if [ "$status" -eq 0 ] && [ "$install_succeeded" -eq 1 ] && [ "$auto_bundle_dir" -eq 1 ]; then
        rm -rf "$bundle_dir"
    fi

    return "$status"
}

trap cleanup EXIT

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
        --linux-feature)
            feature="${2:-}"
            [ -n "$feature" ] || { echo "--linux-feature requires an ID" >&2; exit 64; }
            append_linux_feature "$feature"
            shift 2
            ;;
        --linux-features)
            linux_features="${2:-}"
            [ -n "$linux_features" ] || { echo "--linux-features requires a list" >&2; exit 64; }
            shift 2
            ;;
        --bundle-dir)
            bundle_dir="${2:-}"
            [ -n "$bundle_dir" ] || { echo "--bundle-dir requires a path" >&2; exit 64; }
            shift 2
            ;;
        --use-existing-bundle)
            use_existing_bundle=1
            shift
            ;;
        --skip-install)
            skip_install=1
            shift
            ;;
        --stop-running)
            stop_running=1
            shift
            ;;
        --allow-running)
            allow_running_install=1
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

if [ "$use_existing_bundle" -eq 1 ] && [ -z "$bundle_dir" ]; then
    echo "--use-existing-bundle requires --bundle-dir or CODEX_DESKTOP_BUNDLE_DIR." >&2
    exit 64
fi

if [ "$use_existing_bundle" -eq 0 ] && ! command -v dagger >/dev/null 2>&1; then
    echo "dagger is required. Install it first, then rerun this script." >&2
    exit 69
fi

if [ "$skip_install" -eq 0 ] && ! command -v brew >/dev/null 2>&1; then
    echo "brew is required unless --skip-install is set." >&2
    exit 69
fi

guard_running_codex_desktop

resolved_conversion_commit="$conversion_commit"

if [ "$use_existing_bundle" -eq 1 ]; then
    bundle_dir="$(realpath "$bundle_dir")"
    echo "Using existing Codex Desktop bundle from $bundle_dir"
else
    if [ -n "$codex_dmg" ]; then
        codex_dmg="$(realpath "$codex_dmg")"
        [ -f "$codex_dmg" ] || { echo "Codex DMG not found: $codex_dmg" >&2; exit 66; }
    fi

    if [ -n "$conversion_commit" ] && ! [[ "$conversion_commit" =~ ^[0-9a-fA-F]{40}$ ]]; then
        if ! command -v git >/dev/null 2>&1; then
            echo "git is required to resolve mutable Codex Desktop conversion refs." >&2
            exit 69
        fi

        resolved_conversion_commit="$(
            git ls-remote --exit-code "$conversion_repo" \
                "$conversion_commit" \
                "refs/heads/$conversion_commit" \
                "refs/tags/$conversion_commit" \
                2>/dev/null |
                awk 'NR == 1 { print $1 }'
        )"

        if [ -z "$resolved_conversion_commit" ]; then
            echo "Failed to resolve Codex Desktop Linux conversion ref '$conversion_commit' from $conversion_repo" >&2
            exit 70
        fi
    fi

    if [ -z "$codex_dmg" ]; then
        codex_dmg="$(ensure_pinned_codex_dmg "$codex_dmg_ref_file" | tail -n 1)"
        used_pinned_codex_dmg=1
    fi

    if [ -z "$bundle_dir" ]; then
        mkdir -p "$bundle_parent"
        bundle_dir="$(mktemp -d "$bundle_parent/codex-desktop-local.XXXXXX")"
        auto_bundle_dir=1
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
    if [ -n "$resolved_conversion_commit" ]; then
        dagger_args+=("--codex-desktop-conversion-commit=$resolved_conversion_commit")
    fi
    if [ -n "$linux_features" ]; then
        dagger_args+=("--codex-desktop-linux-features=$linux_features")
    fi
    echo "Building local Codex Desktop bundle into $bundle_dir"
    if [ -n "$conversion_commit" ]; then
        echo "Requested Codex Desktop Linux conversion ref: $conversion_commit"
    fi
    if [ -n "$resolved_conversion_commit" ] && [ "$resolved_conversion_commit" != "$conversion_commit" ]; then
        echo "Resolved Codex Desktop Linux conversion commit: $resolved_conversion_commit"
    fi
    if [ -n "$linux_features" ]; then
        echo "Enabled Codex Desktop Linux features: $linux_features"
    fi
    if [ "$used_pinned_codex_dmg" -eq 1 ]; then
        echo "Pinned Codex.dmg ref: $codex_dmg_ref_file"
    fi
    (cd "$repo_dir" && dagger "${dagger_args[@]}")
fi

artifact="$(find "$bundle_dir/artifacts" -maxdepth 1 -type f -name 'codex-desktop-linux-*.tar.gz' | sort | tail -n 1)"
cask_file="$bundle_dir/homebrew/codex-desktop.rb"
release_file="$bundle_dir/release.json"

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
if [ -f "$release_file" ]; then
    built_conversion_commit="$(sed -n 's/.*"upstream_conversion_commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$release_file" | head -n 1 || true)"
    if [ -n "$built_conversion_commit" ]; then
        echo "Built Codex Desktop Linux conversion commit: $built_conversion_commit"
        if [[ "$resolved_conversion_commit" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
            case "$built_conversion_commit" in
                "$resolved_conversion_commit"*) ;;
                *)
                    echo "Built conversion commit does not match requested commit: $resolved_conversion_commit" >&2
                    exit 70
                    ;;
            esac
        fi
    fi
fi

if [ "$skip_install" -eq 1 ]; then
    echo "Build complete. Skipping Homebrew install."
    exit 0
fi

export CODEX_DESKTOP_LOCAL_ARTIFACT="$artifact"
export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"

temp_tap_name="codex-local/codex-desktop-local-$(date +%s)-$$"
brew tap-new --no-git "$temp_tap_name" >/dev/null
temp_tap_dir="$(brew --repository "$temp_tap_name")"
mkdir -p "$temp_tap_dir/Casks"
cp "$cask_file" "$temp_tap_dir/Casks/codex-desktop.rb"
brew ruby -- -e '
  cask_path, artifact = ARGV
  needle = %q{url "file://#{ENV.fetch("CODEX_DESKTOP_LOCAL_ARTIFACT")}"}
  replacement = "url #{("file://" + artifact).dump}"
  contents = File.read(cask_path)
  abort "Generated cask does not contain local artifact URL placeholder" unless contents.include?(needle)
  File.write(cask_path, contents.sub(needle, replacement))
' "$temp_tap_dir/Casks/codex-desktop.rb" "$artifact"
local_cask_token="$temp_tap_name/codex-desktop"

if codex_desktop_cask_is_installed; then
    brew reinstall --cask --force "$local_cask_token"
else
    brew install --cask "$local_cask_token"
fi

install_succeeded=1
