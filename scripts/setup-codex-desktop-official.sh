#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/setup-codex-desktop-official.sh [--bundle-dir PATH]

Build the selected verified OpenAI Linux package through the Homebrew
Tools Dagger release-bundle path, retain the bundle locally, and prove an
offline Homebrew install from that bundle in an isolated container.

This command never installs on the host, publishes a release, or mutates a
remote tap.

Environment:
  CODEX_DESKTOP_SETUP_PYTHON  Python used for the non-uv fallback wizard.
EOF
}

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle_dir="${CODEX_DESKTOP_BUNDLE_DIR:-$repo_dir/dist/codex-desktop-official}"
features_config="$repo_dir/config/codex-desktop-linux-features.json"
conversion_ref="$(sed -e 's/[[:space:]]*#.*//' -e '/^[[:space:]]*$/d' "$repo_dir/codex-desktop-conversion.ref" | head -n 1)"
full_profile="${CODEX_DESKTOP_LINUX_FEATURES_FULL:-agent-workspace api-key-model-visibility api-key-service-tier appshots authenticated-proxy automation-extensions chronicle-skysight computer-use-linux copilot-reasoning-effort directory-only-working-tree-watch frameless-titlebar global-dictation mcp-helper-reaper node-repl-reaper omarchy-theme persistent-status-panel pet-overlay project-group-last-updated-sort project-task-sort read-aloud read-aloud-mcp record-and-replay remote-control-ui remote-mobile-control shared-app-server-socket ui-tweaks}"
lean_profile="${CODEX_DESKTOP_LINUX_FEATURES_LEAN:-computer-use-linux node-repl-reaper read-aloud read-aloud-mcp chronicle-skysight record-and-replay}"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --bundle-dir)
            bundle_dir="${2:-}"
            [ -n "$bundle_dir" ] || { echo "--bundle-dir requires a value" >&2; exit 64; }
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

command -v dagger >/dev/null 2>&1 || { echo "dagger is required for Codex Desktop setup." >&2; exit 69; }
command -v git >/dev/null 2>&1 || { echo "git is required for Codex Desktop setup." >&2; exit 69; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required for Codex Desktop setup." >&2; exit 69; }

wizard_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-desktop-feature-source.XXXXXX")"
wizard_result="$wizard_dir/result.json"
trap 'rm -rf "$wizard_dir"' EXIT
git clone --quiet --filter=blob:none https://github.com/joshyorko/codex-desktop-linux "$wizard_dir/source"
git -C "$wizard_dir/source" checkout --quiet "$conversion_ref"
wizard_args=(
    "$repo_dir/scripts/codex-desktop-feature-wizard.py"
    --features-root "$wizard_dir/source/linux-features" \
    --config "$features_config" \
    --result "$wizard_result" \
    --conversion-commit "$conversion_ref" \
    --full-profile "$full_profile" \
    --lean-profile "$lean_profile"
)
if command -v uv >/dev/null 2>&1 && uv run --script "${wizard_args[@]}"; then
    :
else
    fallback_python="${CODEX_DESKTOP_SETUP_PYTHON:-}"
    if [ -z "$fallback_python" ] && [ -x /usr/bin/python3 ]; then
        fallback_python=/usr/bin/python3
    fi
    fallback_python="${fallback_python:-python3}"
    echo "uv could not prepare the GTK environment; using the terminal wizard with $fallback_python." >&2
    "$fallback_python" "${wizard_args[@]}"
fi
python3 - "$wizard_result" <<'PY'
import json
import pathlib
import sys

result = json.loads(pathlib.Path(sys.argv[1]).read_text())
if result.get("action") == "cancel":
    raise SystemExit("Codex Desktop setup cancelled.")
PY
echo "Saved release feature choices to $features_config"
setup_action="$(python3 - "$wizard_result" <<'PY'
import json
import pathlib
import sys

print(json.loads(pathlib.Path(sys.argv[1]).read_text()).get("action", ""))
PY
)"
package_source="$(python3 - "$wizard_result" <<'PY'
import json
import pathlib
import sys

source = json.loads(pathlib.Path(sys.argv[1]).read_text()).get("packageSource", "pinned")
if source not in {"pinned", "latest"}:
    raise SystemExit(f"Unsupported Linux package source: {source}")
print(source)
PY
)"
if [ "$setup_action" = "save" ]; then
    echo "Save for later selected; skipping the Codex Desktop build."
    exit 0
fi

git_dir="${DAGGER_GIT_DIR:-$(git -C "$repo_dir" rev-parse --git-common-dir)}"
case "$git_dir" in
    /*) ;;
    *) git_dir="$repo_dir/$git_dir" ;;
esac

mkdir -p "$bundle_dir"
echo "Building Codex Desktop from $package_source signed Linux package through Dagger..."
dagger -m "$repo_dir/dagger/tap-pipeline" call \
    --git-dir="$git_dir" \
    -o "$bundle_dir" \
    release-bundle \
    --package-id=codex-desktop-linux \
    --codex-desktop-conversion-commit="$conversion_ref" \
    --codex-desktop-package-source="$package_source"

release_json="$bundle_dir/release.json"
[ -f "$release_json" ] || { echo "Dagger did not emit $release_json" >&2; exit 70; }

mapfile -t artifact_values < <(
    python3 - "$release_json" "$bundle_dir" <<'PY'
import hashlib
import json
import pathlib
import sys

release_path = pathlib.Path(sys.argv[1])
bundle = pathlib.Path(sys.argv[2])
release = json.loads(release_path.read_text())
required = {
    "package",
    "version",
    "asset_name",
    "artifact_sha256",
    "upstream",
    "official_package_path",
    "official_package_sha256",
    "build_mode",
}
missing = sorted(required.difference(release))
if missing:
    raise SystemExit(f"release.json is missing provenance fields: {', '.join(missing)}")
if release["package"] != "codex-desktop-linux":
    raise SystemExit(f"unexpected release package: {release['package']}")
artifact = bundle / "artifacts" / release["asset_name"]
if not artifact.is_file():
    raise SystemExit(f"missing retained artifact: {artifact}")
actual = hashlib.sha256(artifact.read_bytes()).hexdigest()
if actual != release["artifact_sha256"]:
    raise SystemExit(f"artifact checksum mismatch: {actual} != {release['artifact_sha256']}")
print(artifact)
print(actual)
print(release["version"])
PY
)

artifact_path="${artifact_values[0]}"
artifact_sha256="${artifact_values[1]}"
version="${artifact_values[2]}"
echo "Retained artifact: $artifact_path"
echo "Artifact SHA256: $artifact_sha256"
sha256sum "$artifact_path"
echo "Running offline Homebrew install smoke from the retained bundle..."
dagger -m "$repo_dir/dagger/tap-pipeline" call \
    codex-desktop-offline-smoke \
    --bundle="$bundle_dir"
echo "Codex Desktop official-package setup passed for version $version"
