#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/install-codex-release-local.sh [options] [-- <codex build args>]

Build a local Codex release asset from fetched source, render a local Homebrew
formula for that artifact, and optionally install it through a temporary tap.

Options:
  --source-repo URL       Git repository to build.
  --ref REF               Git ref to build.
  --source-dir PATH       Source checkout dir.
  --cache-dir PATH        Persistent build/cache dir.
  --output-dir PATH       Raw Codex asset output dir.
  --artifact PATH         Use an already-built codex-release-*.tar.gz instead of building.
  --bundle-dir PATH       Write the local bundle here instead of a temp dir.
  --skip-install          Build/render only; do not run brew install/reinstall.
  -h, --help              Show this help.

Environment defaults:
  CODEX_RELEASE_SOURCE_REPO  Git repository to build.
  CODEX_RELEASE_REF          Git ref to build.
  CODEX_RELEASE_WORK_DIR     Root for source/cache state.
  CODEX_RELEASE_SOURCE_DIR   Source checkout dir.
  CODEX_RELEASE_CACHE_DIR    Persistent build/cache dir.
  CODEX_RELEASE_OUTPUT_DIR   Raw Codex asset output dir.
  CODEX_RELEASE_ARTIFACT     Prebuilt tarball used instead of building.
  CODEX_RELEASE_BUNDLE_DIR   Bundle directory.
  CODEX_RELEASE_SKIP_INSTALL Set to any non-empty value to imply --skip-install.
  CODEX_RELEASE_BUILD_ARGS   Extra builder args passed by the Makefile after --.
EOF
}

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="${CODEX_RELEASE_WORK_DIR:-$repo_dir/.codex-release}"
source_repo="${CODEX_RELEASE_SOURCE_REPO:-https://github.com/joshyorko/codex}"
source_ref="${CODEX_RELEASE_REF:-tap-release}"
source_dir="${CODEX_RELEASE_SOURCE_DIR:-$work_dir/source}"
cache_dir="${CODEX_RELEASE_CACHE_DIR:-$work_dir/cache}"
output_dir="${CODEX_RELEASE_OUTPUT_DIR:-$repo_dir/dist/codex-release-build}"
artifact="${CODEX_RELEASE_ARTIFACT:-}"
bundle_dir="${CODEX_RELEASE_BUNDLE_DIR:-$repo_dir/dist/codex-release-local}"
skip_install=0
temp_tap_name=""
install_succeeded=0
codex_build_args=()

if [ -n "${CODEX_RELEASE_SKIP_INSTALL:-}" ]; then
    skip_install=1
fi

cleanup() {
    status=$?
    trap - EXIT

    if [ -n "$temp_tap_name" ]; then
        brew untap --force "$temp_tap_name" >/dev/null 2>&1 || true
    fi

    return "$status"
}

trap cleanup EXIT

while [ "$#" -gt 0 ]; do
    case "$1" in
        --source-repo)
            source_repo="${2:-}"
            [ -n "$source_repo" ] || { echo "--source-repo requires a URL" >&2; exit 64; }
            shift 2
            ;;
        --ref)
            source_ref="${2:-}"
            [ -n "$source_ref" ] || { echo "--ref requires a value" >&2; exit 64; }
            shift 2
            ;;
        --source-dir)
            source_dir="${2:-}"
            [ -n "$source_dir" ] || { echo "--source-dir requires a path" >&2; exit 64; }
            shift 2
            ;;
        --cache-dir)
            cache_dir="${2:-}"
            [ -n "$cache_dir" ] || { echo "--cache-dir requires a path" >&2; exit 64; }
            shift 2
            ;;
        --output-dir)
            output_dir="${2:-}"
            [ -n "$output_dir" ] || { echo "--output-dir requires a path" >&2; exit 64; }
            shift 2
            ;;
        --artifact)
            artifact="${2:-}"
            [ -n "$artifact" ] || { echo "--artifact requires a path" >&2; exit 64; }
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
        --)
            shift
            codex_build_args=("$@")
            break
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

absolute_path() {
    case "$1" in
        /*) printf '%s\n' "$1" ;;
        *) printf '%s\n' "$repo_dir/$1" ;;
    esac
}

source_dir="$(absolute_path "$source_dir")"
cache_dir="$(absolute_path "$cache_dir")"
output_dir="$(absolute_path "$output_dir")"
bundle_dir="$(absolute_path "$bundle_dir")"

if ! command -v dagger >/dev/null 2>&1; then
    echo "dagger is required. Install it first, then rerun this script." >&2
    exit 69
fi

export DAGGER_NO_NAG="${DAGGER_NO_NAG:-1}"

if [ -n "$artifact" ]; then
    artifact="$(realpath "$artifact")"
    [ -f "$artifact" ] || { echo "Codex release artifact not found: $artifact" >&2; exit 66; }
fi

mkdir -p "$bundle_dir"
bundle_dir="$(realpath "$bundle_dir")"

if [ -z "$artifact" ]; then
    builder_args=(
        --source-repo "$source_repo"
        --ref "$source_ref"
        --source-dir "$source_dir"
        --cache-dir "$cache_dir"
        --output-dir "$output_dir"
    )

    echo "Building local Codex release asset from $source_repo@$source_ref"
    "$repo_dir/scripts/build-codex-release-local.sh" "${builder_args[@]}" "${codex_build_args[@]}"

    source_dir="$(realpath "$source_dir")"
    output_dir="$(realpath "$output_dir")"
    commit="$(git -C "$source_dir" rev-parse HEAD)"
    committed_at="$(git -C "$source_dir" show -s --format=%cI HEAD)"
    timestamp="$(date -u -d "$committed_at" +%Y%m%d%H%M%S)"
    version="release.${timestamp}.${commit:0:12}"
    asset_name="codex-release-${version}.tar.gz"
    expected_artifact="$output_dir/$asset_name"

    if [ ! -f "$expected_artifact" ]; then
        echo "Codex local builder did not produce expected artifact at $expected_artifact" >&2
        exit 70
    fi
    artifact="$expected_artifact"
else
    asset_name="$(basename "$artifact")"
    if [[ "$asset_name" != codex-release-*.tar.gz ]]; then
        echo "Expected artifact name like codex-release-<version>.tar.gz, got: $asset_name" >&2
        exit 65
    fi
    version="${asset_name#codex-release-}"
    version="${version%.tar.gz}"
    commit="${version##*.}"
fi

artifact="$(realpath "$artifact")"
asset_name="$(basename "$artifact")"
version="${asset_name#codex-release-}"
version="${version%.tar.gz}"
release_tag="codex-release-${version}"

case "$artifact" in
    "$bundle_dir"/*) ;;
    *)
        rm -rf "$bundle_dir"
        mkdir -p "$bundle_dir"
        ;;
esac

dagger_args=(
    --silent
    -m "$repo_dir/dagger/tap-pipeline"
    call
    -o "$bundle_dir"
    codex-release-local-bundle
    "--codex-release-artifact=$artifact"
)

if [ -n "${commit:-}" ]; then
    dagger_args+=("--codex-commit=$commit")
fi

echo "Rendering local Codex release bundle into $bundle_dir"
(cd "$repo_dir" && dagger "${dagger_args[@]}")

artifact="$bundle_dir/artifacts/$asset_name"
formula_file="$bundle_dir/homebrew/codex-release.rb"
release_file="$bundle_dir/release.json"

if [ ! -f "$artifact" ]; then
    echo "Local Codex release artifact was not produced at $artifact" >&2
    exit 70
fi
if [ ! -f "$formula_file" ]; then
    echo "Local Codex release formula was not produced at $formula_file" >&2
    exit 70
fi
if [ ! -f "$release_file" ]; then
    echo "Local Codex release metadata was not produced at $release_file" >&2
    exit 70
fi

echo "Local artifact: $bundle_dir/artifacts/$asset_name"
echo "Local formula: $formula_file"
echo "Local bundle: $bundle_dir"

if [ "$skip_install" -eq 1 ]; then
    echo "Build complete. Skipping Homebrew install."
    exit 0
fi

if ! command -v brew >/dev/null 2>&1; then
    echo "brew is required unless --skip-install is set." >&2
    exit 69
fi

export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"
export HOMEBREW_NO_INSTALL_FROM_API="${HOMEBREW_NO_INSTALL_FROM_API:-1}"
export CODEX_RELEASE_LOCAL_ARTIFACT="$artifact"

temp_tap_name="codex-local/codex-release-local-$(date +%s)-$$"
brew tap-new --no-git "$temp_tap_name" >/dev/null
temp_tap_dir="$(brew --repository "$temp_tap_name")"
mkdir -p "$temp_tap_dir/Formula"
cp "$formula_file" "$temp_tap_dir/Formula/codex-release.rb"
brew ruby -- -e '
  formula_path, artifact = ARGV
  needle = %q{url "file://#{ENV.fetch("CODEX_RELEASE_LOCAL_ARTIFACT")}"}
  replacement = "url #{("file://" + artifact).dump}"
  contents = File.read(formula_path)
  abort "Generated formula does not contain local artifact URL placeholder" unless contents.include?(needle)
  File.write(formula_path, contents.sub(needle, replacement))
' "$temp_tap_dir/Formula/codex-release.rb" "$artifact"
local_formula_token="$temp_tap_name/codex-release"

if brew list --formula codex-release >/dev/null 2>&1; then
    brew reinstall --formula --force "$local_formula_token"
else
    brew install --formula "$local_formula_token"
fi

brew test "$local_formula_token"
install_succeeded=1
