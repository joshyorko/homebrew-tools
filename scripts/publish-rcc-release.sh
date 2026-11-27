#!/usr/bin/env bash
set -euo pipefail

bundle_dir=$1
release_tag=$2
release_title=$3
notes_file=$4

assets=()
for name in rcc-linux64 rcc-linuxarm64 rcc-macos64 rcc-macosarm64; do
  asset="$bundle_dir/artifacts/$name"
  test -s "$asset"
  assets+=("$asset")
done

release_endpoint="repos/$GITHUB_REPOSITORY/releases/tags/$release_tag"
if ! release=$(gh api "$release_endpoint" 2>&1); then
  if [[ "$release" != *'gh: Not Found (HTTP 404)'* ]]; then
    printf '%s\n' "$release" >&2
    exit 1
  fi
  # With files supplied, gh uploads them to a draft before publishing.
  gh release create "$release_tag" "${assets[@]}" --repo "$GITHUB_REPOSITORY" \
    --title "$release_title" --notes-file "$notes_file"
  release=$(gh api "$release_endpoint")
fi

# Reuse a published release only if every required asset has the expected bytes.
for asset in "${assets[@]}"; do
  name=${asset##*/}
  sha256=$(sha256sum "$asset")
  if ! jq -e --arg name "$name" --arg digest "sha256:${sha256%% *}" '
    (.draft == false) and
    ([.assets[] | select(.name == $name) | .digest] == [$digest])
  ' <<<"$release" >/dev/null; then
    echo "$release_tag: missing or mismatched $name. Resolve the release with owner approval before updating the cask." >&2
    exit 1
  fi
done
