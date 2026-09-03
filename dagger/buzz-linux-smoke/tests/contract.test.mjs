import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")

test("defaults to the verified package-compatible Buzz release", () => {
  assert.match(source, /DEFAULT_SOURCE_REF = "95154bee4034ca7a40b33095c2ddbde8c9aa1614"/)
  assert.match(source, /DEFAULT_VERSION = "0\.5\.20"/)
  assert.match(source, /for package in buzz-acp buzz-agent buzz-backend-kubernetes buzz-dev-mcp git-credential-nostr buzz-cli/)
  assert.match(source, /test -f .*crates\/\$package\/Cargo\.toml/)
  assert.match(source, /BUZZ_SOURCE_PACKAGE_CHECK name=%s status=present/)
  assert.match(source, /BUZZ_SOURCE_PACKAGE_CHECK name=%s status=missing/)
})

test("keeps scheduled source inputs pinned through the detached checkout", () => {
  assert.match(source, /git clone --filter=blob:none "\$\{sourceRepository\}" \/src/)
  assert.match(source, /git checkout --detach "\$\{sourceRef\}"/)
  assert.match(source, /test "\$\(git rev-parse HEAD\)" = "\$\{sourceRef\}"/)
  assert.match(source, /sourceRepository = DEFAULT_SOURCE_REPOSITORY/)
  assert.match(source, /sourceRef = DEFAULT_SOURCE_REF/)
  assert.match(source, /version = DEFAULT_VERSION/)
})

test("labels every post-repack assertion and checksum observation failure", () => {
  assert.match(source, /BUZZ_POST_REPACK_CHECK_START name=/)
  assert.match(source, /BUZZ_POST_REPACK_CHECK_PASS name=/)
  assert.match(source, /BUZZ_POST_REPACK_CHECK_FAIL name=.*status=.*command=/)
  assert.match(source, /BUZZ_CHECKSUM_OBSERVATION_FAIL/)

  for (const check of [
    "fix-appimage-script",
    "gstreamer-shim-script",
    "appimage-present",
    "appimage-realpath",
    "appimage-repack",
    "appimage-extract",
    "webkit-runtime-setting",
    "fontconfig-setting",
    "desktop-launcher",
    "desktop-binary",
    "gstreamer-system-path",
    "launcher-variable-unset",
    "artifact-copy",
    "checksum-write",
    "checksum-present",
    "checksum-format",
  ]) {
    assert.match(source, new RegExp(`run_post_repack_check ${check}`))
  }
})

test("separates post-repack execution failures from checksum observation failures", () => {
  assert.match(source, /await build\.container\.sync\(\)/)
  assert.match(source, /BUZZ_POST_REPACK_EXECUTION_FAIL/)
  assert.match(source, /BUZZ_CHECKSUM_OBSERVATION_FAIL/)
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

test("records the artifact checksum inside the packaging container", () => {
  assert.match(source, /sha256sum "\$1" \| awk '\{print \$1\}' > "\$2"/)
  assert.match(source, /build\.container\.file\(`\$\{build\.artifactPath\}\.sha256`\)\.contents\(\)/)
  assert.doesNotMatch(source, /build\.container\.withExec\(\["sha256sum", build\.artifactPath\]\)\.stdout\(\)/)
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
