import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")

test("defaults to the current Linux media-capable Buzz release", () => {
  assert.match(source, /DEFAULT_SOURCE_REF = "3a96acea09b4a9e3f02c3a26cfb0607d2ccacf42"/)
  assert.match(source, /DEFAULT_VERSION = "0\.5\.3"/)
})

test("rejects source builds without the Linux WebKitGTK media capability", () => {
  assert.match(source, /test -f desktop\/src-tauri\/src\/linux_media\.rs/)
  assert.match(source, /set_enable_media_stream/)
  assert.match(source, /linux_media::enable_media_capture/)
})

test("uses the upstream post-AppRun GStreamer shim instead of reapplying a stale patch", () => {
  assert.match(source, /APPRUN_WRAPPED=/)
  assert.match(source, /Installing GStreamer launcher shim/)
  assert.match(source, /buzz-desktop\.bin/)
  assert.match(source, /GST_PLUGIN_SYSTEM_PATH_1_0/)
  assert.match(source, /unset \\\"\\\\\$var\\\"/)
  assert.doesNotMatch(source, /git apply \/tap\/patches\/buzz-linux-apprun-hooks\.patch/)
})

test("builds from the release lockfile", () => {
  assert.doesNotMatch(source, /cargo update --workspace/)
})

test("builds every sidecar required by the upstream bundler", () => {
  assert.match(
    source,
    /cargo build --release -p buzz-acp -p buzz-agent -p buzz-backend-kubernetes -p buzz-dev-mcp -p git-credential-nostr -p buzz-cli/,
  )
  assert.match(source, /\.\/scripts\/bundle-sidecars\.sh/)
})

test("persists expensive source-build caches across authenticated Dagger runs", () => {
  assert.match(source, /buzz-linux-hermit-cache/)
  assert.match(source, /buzz-linux-pnpm-store-cache/)
  assert.match(source, /buzz-linux-cargo-registry-cache/)
  assert.match(source, /buzz-linux-cargo-git-cache/)
  assert.match(source, /buzz-linux-sidecar-target-cache/)
  assert.match(source, /buzz-linux-cargo-target-cache/)
})

test("release bundles include verified artifacts and standard publish metadata", () => {
  assert.match(source, /const verification = await this\.verifyBuild\(/)
  assert.match(source, /kind: "source_build_rust_appimage_cask"/)
  assert.match(source, /artifacts\/\$\{build\.assetName\}/)
  assert.match(source, /homebrew\/buzz-linux\.rb/)
  assert.match(source, /release\.json/)
  assert.match(source, /ci\.log/)
})
