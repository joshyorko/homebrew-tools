#!/usr/bin/env bash
set -euo pipefail

upstream_dir="${1:?usage: build-t3code-resource-monitor.sh <upstream-dir>}"
rust_target="x86_64-unknown-linux-gnu"
target_dir="$upstream_dir/apps/server/dist/resource-monitor/linux-x64"

cargo build \
  --locked \
  --release \
  --manifest-path "$upstream_dir/native/resource-monitor/Cargo.toml" \
  --target "$rust_target"

mkdir -p "$target_dir"
cp \
  "$upstream_dir/native/resource-monitor/target/$rust_target/release/t3-resource-monitor" \
  "$target_dir/"
chmod +x "$target_dir/t3-resource-monitor"
