#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/setup-codex-desktop-local.sh [options]

Open the guided Codex Desktop Linux feature wizard and optionally run the
existing local Homebrew build/install path with the saved selection.

Options:
  --conversion-ref REF   Conversion branch, tag, or commit.
  --full-profile LIST    Feature IDs used by the Daily driver profile.
  --lean-profile LIST    Feature IDs used by the Minimal profile.
  -h, --help             Show this help.

Environment:
  CODEX_DESKTOP_CONVERSION_REPO      Conversion git repository.
  CODEX_DESKTOP_CONVERSION_CHECKOUT  Existing checkout used for feature discovery.
  CODEX_DESKTOP_FEATURES_CONFIG      Saved feature selection path.
  CODEX_DESKTOP_FEATURE_WIZARD       Override the Python wizard path.
  CODEX_DESKTOP_INSTALLER            Override the local installer path.
EOF
}

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
conversion_repo="${CODEX_DESKTOP_CONVERSION_REPO:-https://github.com/joshyorko/codex-desktop-linux}"
conversion_ref_file="${CODEX_DESKTOP_CONVERSION_REF_FILE:-$repo_dir/codex-desktop-conversion.ref}"
codex_dmg_ref_file="${CODEX_DESKTOP_DMG_REF_FILE:-$repo_dir/codex-desktop-dmg.ref}"
conversion_ref="${CODEX_DESKTOP_CONVERSION_COMMIT:-}"
conversion_checkout="${CODEX_DESKTOP_CONVERSION_CHECKOUT:-}"
cache_home="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}"
config_home="${XDG_CONFIG_HOME:-${HOME:-/tmp}/.config}"
state_home="${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}"
features_config="${CODEX_DESKTOP_FEATURES_CONFIG:-$config_home/homebrew-tools/codex-desktop-features.json}"
wizard="${CODEX_DESKTOP_FEATURE_WIZARD:-$repo_dir/scripts/codex-desktop-feature-wizard.py}"
installer="${CODEX_DESKTOP_INSTALLER:-$repo_dir/scripts/install-codex-desktop-local.sh}"
python_bin="${CODEX_DESKTOP_SETUP_PYTHON:-python3}"
full_profile="${CODEX_DESKTOP_LINUX_FEATURES_FULL:-}"
lean_profile="${CODEX_DESKTOP_LINUX_FEATURES_LEAN:-}"

read_default_conversion_ref() {
    local ref_file="$1"
    local ref=""
    if [ -f "$ref_file" ]; then
        ref="$(sed -e 's/[[:space:]]*\#.*//' -e '/^[[:space:]]*$/d' "$ref_file" | head -n 1)"
    fi
    printf '%s\n' "${ref:-self-hosted}"
}

read_ref_value() {
    local ref_file="$1"
    local wanted_key="$2"
    [ -f "$ref_file" ] || return 0
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

while [ "$#" -gt 0 ]; do
    case "$1" in
        --conversion-ref)
            conversion_ref="${2:-}"
            [ -n "$conversion_ref" ] || { echo "--conversion-ref requires a value" >&2; exit 64; }
            shift 2
            ;;
        --full-profile)
            full_profile="${2:-}"
            shift 2
            ;;
        --lean-profile)
            lean_profile="${2:-}"
            shift 2
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

command -v git >/dev/null 2>&1 || { echo "git is required for Codex Desktop setup." >&2; exit 69; }
command -v "$python_bin" >/dev/null 2>&1 || { echo "$python_bin is required for Codex Desktop setup." >&2; exit 69; }
[ -f "$wizard" ] || { echo "Codex Desktop feature wizard not found: $wizard" >&2; exit 66; }
[ -x "$installer" ] || { echo "Codex Desktop local installer not executable: $installer" >&2; exit 66; }

conversion_ref="${conversion_ref:-$(read_default_conversion_ref "$conversion_ref_file")}"
resolved_commit="$conversion_ref"
if ! [[ "$resolved_commit" =~ ^[0-9a-fA-F]{40}$ ]]; then
    resolved_commit="$(
        git ls-remote --exit-code "$conversion_repo" \
            "$conversion_ref" \
            "refs/heads/$conversion_ref" \
            "refs/tags/$conversion_ref" |
            awk 'NR == 1 { print $1 }'
    )"
    [ -n "$resolved_commit" ] || {
        echo "Failed to resolve Codex Desktop Linux conversion ref '$conversion_ref' from $conversion_repo" >&2
        exit 65
    }
fi

if [ -z "$conversion_checkout" ]; then
    conversion_checkout="$cache_home/homebrew-tools/codex-desktop-wizard/source"
    if [ ! -d "$conversion_checkout/.git" ]; then
        mkdir -p "$(dirname "$conversion_checkout")"
        git clone --filter=blob:none --no-checkout "$conversion_repo" "$conversion_checkout"
    fi
    git -C "$conversion_checkout" fetch --depth=1 origin "$resolved_commit"
    git -C "$conversion_checkout" checkout --detach --force FETCH_HEAD
fi

features_root="$conversion_checkout/linux-features"
[ -d "$features_root" ] || {
    echo "Linux feature manifests not found in conversion checkout: $features_root" >&2
    exit 66
}

mkdir -p "$(dirname "$features_config")" "$cache_home/homebrew-tools/codex-desktop-wizard"
result_file="$(mktemp "$cache_home/homebrew-tools/codex-desktop-wizard/result.XXXXXX.json")"
trap 'rm -f "$result_file"' EXIT

pinned_dmg_sha256="$(read_ref_value "$codex_dmg_ref_file" sha256)"
pinned_dmg_content_length="$(read_ref_value "$codex_dmg_ref_file" content-length)"
pinned_dmg_last_modified="$(read_ref_value "$codex_dmg_ref_file" last-modified)"
pinned_dmg_etag="$(read_ref_value "$codex_dmg_ref_file" etag)"

"$python_bin" "$wizard" \
    --features-root "$features_root" \
    --config "$features_config" \
    --full-profile "$full_profile" \
    --lean-profile "$lean_profile" \
    --conversion-commit "$resolved_commit" \
    --pinned-dmg-sha256 "${pinned_dmg_sha256:-unknown}" \
    --pinned-dmg-content-length "${pinned_dmg_content_length:-unknown}" \
    --pinned-dmg-last-modified "${pinned_dmg_last_modified:-unknown}" \
    --pinned-dmg-etag "${pinned_dmg_etag:-unknown}" \
    --result "$result_file"

[ -f "$result_file" ] || {
    echo "Codex Desktop feature wizard did not produce a result." >&2
    exit 70
}

mapfile -t result_values < <(
    "$python_bin" - "$result_file" <<'PY'
import json
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())
action = data.get("action")
dmg_source = data.get("dmgSource", "pinned")
features = data.get("features")
if action not in {"save", "install", "cancel"}:
    raise SystemExit(f"Invalid wizard action: {action}")
if dmg_source not in {"pinned", "latest"}:
    raise SystemExit(f"Invalid wizard DMG source: {dmg_source}")
if not isinstance(features, list) or any(
    not isinstance(item, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", item)
    for item in features
):
    raise SystemExit("Invalid wizard feature result")
print(action)
print(",".join(sorted(set(features))) if features else "none")
print(dmg_source)
PY
)

action="${result_values[0]:-}"
feature_argument="${result_values[1]:-none}"
dmg_source="${result_values[2]:-pinned}"

case "$action" in
    save)
        echo "Codex Desktop feature selection saved: $features_config"
        echo "Run 'make codex-desktop-install' when you are ready to build."
        ;;
    install)
        evidence_dir="$state_home/homebrew-tools/codex-desktop/reports/$(date -u +%Y%m%dT%H%M%SZ)-$$"
        decision_file="$evidence_dir/upstream-dmg-decision.json"
        mkdir -p "$evidence_dir"
        set +e
        "$installer" \
            --conversion-commit "$resolved_commit" \
            --linux-features "$feature_argument" \
            --dmg-source "$dmg_source" \
            --result-file "$decision_file"
        install_status=$?
        set -e
        if [ "$dmg_source" = "latest" ] && [ -f "$decision_file" ]; then
            "$python_bin" "$wizard" --show-result "$decision_file"
        fi
        exit "$install_status"
        ;;
    cancel)
        echo "Codex Desktop setup cancelled; no build started."
        ;;
    *)
        echo "Invalid Codex Desktop setup action: $action" >&2
        exit 70
        ;;
esac
