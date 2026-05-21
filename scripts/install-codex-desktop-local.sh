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

Environment defaults:
  CODEX_DESKTOP_CONVERSION_COMMIT  Conversion ref used when --conversion-commit is omitted.
  CODEX_DESKTOP_CONVERSION_REPO    Conversion repository used when resolving mutable refs.
  CODEX_DESKTOP_CODEX_DMG          DMG path used when --codex-dmg is omitted.
  CODEX_DESKTOP_BUNDLE_DIR         Bundle directory used when --bundle-dir is omitted.
  CODEX_DESKTOP_SKIP_INSTALL       Set to any non-empty value to imply --skip-install.
EOF
}

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
codex_dmg_url="https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"
conversion_repo="${CODEX_DESKTOP_CONVERSION_REPO:-https://github.com/joshyorko/codex-desktop-linux}"
codex_dmg="${CODEX_DESKTOP_CODEX_DMG:-}"
conversion_commit="${CODEX_DESKTOP_CONVERSION_COMMIT:-}"
bundle_dir="${CODEX_DESKTOP_BUNDLE_DIR:-}"
auto_bundle_dir=0
skip_install=0
temp_tap_name=""
install_succeeded=0

if [ -n "${CODEX_DESKTOP_SKIP_INSTALL:-}" ]; then
    skip_install=1
fi

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

resolved_conversion_commit="$conversion_commit"
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

dmg_cache_buster=""
if [ -z "$codex_dmg" ]; then
    if ! command -v curl >/dev/null 2>&1; then
        echo "curl is required to resolve the current upstream Codex.dmg metadata." >&2
        exit 69
    fi

    dmg_cache_buster="$(
        curl -fsSIL --retry 3 "$codex_dmg_url" |
            awk '
                BEGIN { IGNORECASE = 1 }
                /^last-modified:/ { last_modified = substr($0, index($0, ":") + 1); gsub(/^[ \t]+|[ \t\r]+$/, "", last_modified) }
                /^etag:/ { etag = substr($0, index($0, ":") + 1); gsub(/^[ \t]+|[ \t\r]+$/, "", etag) }
                /^content-length:/ { content_length = substr($0, index($0, ":") + 1); gsub(/^[ \t]+|[ \t\r]+$/, "", content_length) }
                END {
                    printf "last-modified=%s;etag=%s;content-length=%s\n", last_modified, etag, content_length
                }
            '
    )"
fi

if [ -z "$bundle_dir" ]; then
    bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-desktop-local.XXXXXX")"
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
if [ -n "$dmg_cache_buster" ]; then
    dagger_args+=("--codex-desktop-dmg-cache-buster=$dmg_cache_buster")
fi

echo "Building local Codex Desktop bundle into $bundle_dir"
if [ -n "$conversion_commit" ]; then
    echo "Requested Codex Desktop Linux conversion ref: $conversion_commit"
fi
if [ -n "$resolved_conversion_commit" ] && [ "$resolved_conversion_commit" != "$conversion_commit" ]; then
    echo "Resolved Codex Desktop Linux conversion commit: $resolved_conversion_commit"
fi
if [ -n "$dmg_cache_buster" ]; then
    echo "Resolved upstream Codex.dmg metadata: $dmg_cache_buster"
fi
(cd "$repo_dir" && dagger "${dagger_args[@]}")

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

if brew list --cask codex-desktop >/dev/null 2>&1; then
    brew reinstall --cask --force "$local_cask_token"
else
    brew install --cask "$local_cask_token"
fi

install_succeeded=1
