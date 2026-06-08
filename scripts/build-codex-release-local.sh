#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/build-codex-release-local.sh [options]

Clone/fetch Codex source into this tap, build the Linux Homebrew release asset,
and keep dependencies cached under this tap.

Options:
  --source-repo URL        Git repository to build (default: https://github.com/joshyorko/codex)
  --ref REF                Git ref to build (default: tap-release)
  --source-dir DIR         Source checkout dir (default: .codex-release/source)
  --cache-dir DIR          Persistent build/cache dir (default: .codex-release/cache)
  --output-dir DIR         Clean artifact output dir (default: dist/codex-release-build)
  --target TRIPLE          Rust target (default: x86_64-unknown-linux-musl)
  --image NAME             Local build image name (default: homebrew-tools-codex-release-build:ubuntu24)
  --rebuild-image          Rebuild the local container image before running
  --clean-cache            Delete the persistent cache before building
  --clean-source           Delete and reclone the Codex source checkout
  --no-container           Run in the current environment instead of a local container
  -h, --help               Show this help

Default output:
  dist/codex-release-build/codex-release-release.<commit_timestamp>.<sha12>.tar.gz
EOF
}

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="${CODEX_RELEASE_WORK_DIR:-$repo_dir/.codex-release}"
source_repo="${CODEX_RELEASE_SOURCE_REPO:-https://github.com/joshyorko/codex}"
source_ref="${CODEX_RELEASE_REF:-tap-release}"
source_dir="${CODEX_RELEASE_SOURCE_DIR:-$work_dir/source}"
cache_dir="${CODEX_RELEASE_CACHE_DIR:-$work_dir/cache}"
output_dir="${CODEX_RELEASE_OUTPUT_DIR:-$repo_dir/dist/codex-release-build}"
target="x86_64-unknown-linux-musl"
image="${CODEX_RELEASE_BUILD_IMAGE:-homebrew-tools-codex-release-build:ubuntu24}"
use_container="auto"
rebuild_image=0
clean_cache=0
clean_source=0
inside_container="${CODEX_RELEASE_INSIDE_CONTAINER:-0}"

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
        --target)
            target="${2:-}"
            [ -n "$target" ] || { echo "--target requires a value" >&2; exit 64; }
            shift 2
            ;;
        --image)
            image="${2:-}"
            [ -n "$image" ] || { echo "--image requires a value" >&2; exit 64; }
            shift 2
            ;;
        --rebuild-image)
            rebuild_image=1
            shift
            ;;
        --clean-cache)
            clean_cache=1
            shift
            ;;
        --clean-source)
            clean_source=1
            shift
            ;;
        --no-container)
            use_container="false"
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

absolute_path() {
    case "$1" in
        /*) printf '%s\n' "$1" ;;
        *) printf '%s\n' "$repo_dir/$1" ;;
    esac
}

source_dir="$(absolute_path "$source_dir")"
cache_dir="$(absolute_path "$cache_dir")"
output_dir="$(absolute_path "$output_dir")"

prepare_source() {
    if ! command -v git >/dev/null 2>&1; then
        echo "git is required to fetch Codex source." >&2
        exit 69
    fi

    if [ "$clean_source" -eq 1 ]; then
        rm -rf "$source_dir"
    fi

    mkdir -p "$(dirname "$source_dir")"

    if [ ! -d "$source_dir/.git" ]; then
        rm -rf "$source_dir"
        git clone --filter=blob:none --no-tags "$source_repo" "$source_dir"
    else
        git -C "$source_dir" remote set-url origin "$source_repo"
    fi

    git -C "$source_dir" fetch --depth=1 origin "$source_ref"
    git -C "$source_dir" checkout --detach FETCH_HEAD

    if [ ! -f "$source_dir/scripts/build_codex_package.py" ]; then
        echo "Codex source missing scripts/build_codex_package.py: $source_dir" >&2
        exit 66
    fi
    if [ ! -f "$source_dir/.github/scripts/install-musl-build-tools.sh" ]; then
        echo "Codex source missing .github/scripts/install-musl-build-tools.sh: $source_dir" >&2
        exit 66
    fi
}

container_engine() {
    if [ -n "${CONTAINER_ENGINE:-}" ]; then
        command -v "$CONTAINER_ENGINE" >/dev/null 2>&1 || {
            echo "CONTAINER_ENGINE=$CONTAINER_ENGINE was not found." >&2
            exit 69
        }
        printf '%s\n' "$CONTAINER_ENGINE"
        return
    fi

    if command -v podman >/dev/null 2>&1; then
        printf '%s\n' podman
    elif command -v docker >/dev/null 2>&1; then
        printf '%s\n' docker
    else
        return 1
    fi
}

run_in_container() {
    local engine="$1"
    local image_exists=0

    if [ "$engine" = "podman" ]; then
        "$engine" image exists "$image" >/dev/null 2>&1 && image_exists=1
    elif "$engine" image inspect "$image" >/dev/null 2>&1; then
        image_exists=1
    fi

    if [ "$rebuild_image" -eq 1 ] || [ "$image_exists" -eq 0 ]; then
        "$engine" build -f "$repo_dir/scripts/codex-release-local.Containerfile" -t "$image" "$repo_dir"
    fi

    mkdir -p "$cache_dir" "$output_dir"

    local run_args=(
        run
        --rm
        -t
        -e CODEX_RELEASE_INSIDE_CONTAINER=1
        -e HOST_UID="$(id -u)"
        -e HOST_GID="$(id -g)"
        -v "$source_dir:/source"
        -v "$cache_dir:/cache"
        -v "$output_dir:/output"
    )

    if [ "$engine" = "podman" ]; then
        run_args+=(--security-opt label=disable)
    fi

    "$engine" "${run_args[@]}" "$image" \
        bash /build/scripts/build-codex-release-local.sh \
            --source-repo "$source_repo" \
            --ref "$source_ref" \
            --source-dir /source \
            --cache-dir /cache \
            --output-dir /output \
            --target "$target" \
            --no-container
}

if [ "$inside_container" != "1" ]; then
    prepare_source

    if [ "$clean_cache" -eq 1 ]; then
        rm -rf "$cache_dir"
    fi

    if [ "$use_container" != "false" ]; then
        if engine="$(container_engine)"; then
            run_in_container "$engine"
            exit 0
        fi

        if [ "$use_container" = "auto" ]; then
            echo "No podman/docker found; falling back to current environment." >&2
        fi
    fi
fi

if [ "$clean_cache" -eq 1 ]; then
    rm -rf "$cache_dir"
fi

mkdir -p "$cache_dir" "$output_dir"
cache_dir="$(cd "$cache_dir" && pwd)"
output_dir="$(cd "$output_dir" && pwd)"

export CARGO_HOME="$cache_dir/cargo-home"
export CARGO_TARGET_DIR="$cache_dir/cargo-target"
export CARGO_NET_GIT_FETCH_WITH_CLI="${CARGO_NET_GIT_FETCH_WITH_CLI:-true}"
export RUNNER_TEMP="$cache_dir/runner-temp"
export TMPDIR="$cache_dir/tmp"
mkdir -p "$CARGO_HOME/bin" "$CARGO_TARGET_DIR" "$RUNNER_TEMP" "$TMPDIR"

if command -v rustup >/dev/null 2>&1; then
    rustup target add "$target" >/dev/null
fi

if [[ "$target" == *-unknown-linux-musl ]]; then
    github_env="$cache_dir/github-env"
    : > "$github_env"
    TARGET="$target" \
        GITHUB_ENV="$github_env" \
        RUNNER_TEMP="$RUNNER_TEMP" \
        SKIP_APT_INSTALL="${SKIP_APT_INSTALL:-1}" \
        bash "$source_dir/.github/scripts/install-musl-build-tools.sh"

    while IFS= read -r line; do
        [ -n "$line" ] || continue
        name="${line%%=*}"
        value="${line#*=}"
        export "$name=$value"
    done < "$github_env"

    export AWS_LC_SYS_NO_JITTER_ENTROPY=1
    target_no_jitter="AWS_LC_SYS_NO_JITTER_ENTROPY_${target}"
    target_no_jitter="${target_no_jitter//-/_}"
    export "$target_no_jitter=1"
fi

commit="$(git -C "$source_dir" rev-parse HEAD)"
committed_at="$(git -C "$source_dir" show -s --format=%cI HEAD)"
timestamp="$(date -u -d "$committed_at" +%Y%m%d%H%M%S)"
version="release.${timestamp}.${commit:0:12}"
release_tag="codex-release-${version}"
asset_name="${release_tag}.tar.gz"
package_dir="$output_dir/package-$target"
archive_path="$output_dir/$asset_name"

python3 "$source_dir/scripts/build_codex_package.py" \
    --target "$target" \
    --variant codex \
    --cargo-profile release \
    --package-dir "$package_dir" \
    --archive-output "$archive_path" \
    --force

sha256sum "$archive_path" | tee "$archive_path.sha256"
cp "$CARGO_TARGET_DIR/$target/release/codex" "$output_dir/codex"
cp "$CARGO_TARGET_DIR/$target/release/bwrap" "$output_dir/bwrap"

if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ] && [ "$(id -u)" = "0" ]; then
    chown -R "$HOST_UID:$HOST_GID" "$cache_dir" "$output_dir"
fi

cat <<EOF
Built local Codex release asset.
  source repo:  ${source_repo}
  source ref:   ${source_ref}
  source dir:   ${source_dir}
  version:      ${version}
  release tag:  ${release_tag}
  archive:      ${archive_path}
  sha256:       ${archive_path}.sha256
  package dir:  ${package_dir}
  binaries:     ${output_dir}/codex ${output_dir}/bwrap
  cache dir:    ${cache_dir}
EOF
