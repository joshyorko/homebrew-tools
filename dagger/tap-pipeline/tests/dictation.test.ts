import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  dictationManifest,
  renderLocalFormula,
  selectLatestStableRelease,
} from "../src/library.ts"

test("selectLatestStableRelease accepts a stable release and preserves its tag", () => {
  assert.deepEqual(
    selectLatestStableRelease(
      {
        tag_name: "v1.0.0",
        draft: false,
        prerelease: false,
        published_at: "2026-08-29T17:48:37Z",
      },
      "peteonrails/voxtype",
    ),
    {
      tagName: "v1.0.0",
      publishedAt: "2026-08-29T17:48:37Z",
    },
  )
})

test("selectLatestStableRelease rejects drafts and prereleases", () => {
  assert.throws(
    () => selectLatestStableRelease({ tag_name: "v1.1.0-rc1", draft: false, prerelease: true }, "example/tool"),
    /not a stable release/,
  )
  assert.throws(
    () => selectLatestStableRelease({ tag_name: "v1.1.0", draft: true, prerelease: false }, "example/tool"),
    /not a stable release/,
  )
})

test("selectLatestStableRelease rejects incomplete release metadata", () => {
  assert.throws(
    () => selectLatestStableRelease({ draft: false, prerelease: false }, "example/tool"),
    /missing tag_name/,
  )
})

test("renderLocalFormula rewrites only the package metadata", () => {
  const formula = [
    'class Example < Formula',
    '  url "https://example.invalid/release.tar.gz"',
    '  version "0.1.0"',
    '  sha256 "old"',
    "end",
    "",
  ].join("\n")

  assert.equal(
    renderLocalFormula(formula, "example-1.0.0.tar.gz", "1.0.0", "abc123"),
    [
      'class Example < Formula',
      '  url "file:///artifacts/example-1.0.0.tar.gz"',
      '  version "1.0.0"',
      '  sha256 "abc123"',
      "end",
      "",
    ].join("\n"),
  )
})

test("renderLocalFormula fails closed when a formula has ambiguous metadata", () => {
  assert.throws(
    () => renderLocalFormula('url "one"\nurl "two"\nversion "1"\nsha256 "x"\n', "a", "1", "y"),
    /exactly one url stanza/,
  )
})

test("dictationManifest records immutable upstream and artifact provenance", () => {
  assert.deepEqual(
    dictationManifest([
      {
        id: "voxtype",
        version: "1.0.0",
        upstreamTag: "v1.0.0",
        upstreamCommit: "a".repeat(40),
        artifact: "voxtype-1.0.0-homebrew-x86_64-linux.tar.gz",
        sha256: "b".repeat(64),
      },
    ]),
    {
      schema_version: 1,
      workflow: "dakota-local-dictation",
      packages: [
        {
          id: "voxtype",
          version: "1.0.0",
          upstream_tag: "v1.0.0",
          upstream_commit: "a".repeat(40),
          artifact: "voxtype-1.0.0-homebrew-x86_64-linux.tar.gz",
          sha256: "b".repeat(64),
        },
      ],
    },
  )
})

test("Dagger exposes a local dictation bundle and both latest releases", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8")

  assert.match(source, /async dictationBundle\(/)
  assert.match(source, /selectLatestStableRelease\(/)
  assert.match(source, /cargoFeatures\.includes\("cohere"\)/)
  assert.match(source, /ORT_STRATEGY.*download/)
  assert.match(source, /ort\/download-binaries/)
  assert.match(source, /ort\/tls-rustls/)
  assert.match(source, /ONNX_BUILD_IMAGE = "ubuntu:24\.04"/)
  assert.match(source, /features\.length === 0/)
  assert.match(source, /ONNX Runtime kernels are runtime-dispatched/)
  assert.match(source, /dictationBrewContainer\(\)/)
  assert.match(source, /withUser\("ubuntu"\)/)
  assert.match(source, /build-essential ca-certificates clang curl git libasound2t64/)
  assert.match(source, /dictationManifest\(/)
  assert.match(source, /acceptance\/speech_long\.wav/)
})

test("Dagger dictation bundle uses the verified upstream Vulkan artifact", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8")
  const bundleSource = source.slice(
    source.indexOf("async dictationBundle("),
    source.indexOf("async recoveryExport("),
  )

  assert.match(bundleSource, /buildVoxtypePrebuiltArtifact\(/)
  assert.match(source, /linux-x86_64-vulkan/)
  assert.match(source, /SHA256SUMS\.txt/)
  assert.doesNotMatch(bundleSource, /\["cohere"\]/)
})

test("local installer target configures Herdr toggle and GNOME-safe output drivers", async () => {
  const makefile = await readFile(new URL("../../../Makefile", import.meta.url), "utf8")
  const script = await readFile(new URL("../../../scripts/install-dictation-local.sh", import.meta.url), "utf8")

  assert.match(makefile, /dictation-install/)
  assert.match(script, /--git-dir/)
  assert.match(script, /tap_name=local\/dictation/)
  assert.match(script, /tap-new/)
  assert.match(script, /prefix\+alt\+v/)
  assert.match(script, /org\.gnome\.settings-daemon\.plugins\.media-keys/)
  assert.match(script, /<Super><Alt>v/)
  assert.match(script, /voxtype\.service\.d/)
  assert.match(script, /Environment=.*PATH=/)
  assert.match(script, /eitype.*ydotool.*clipboard/)
  assert.match(script, /auto_submit.*false|output\.auto_submit.*false/)
  assert.match(script, /voxtype\/\$\{voxtype_version\}/)
  assert.match(script, /whisper-\$whisper_model_name\.json/)
})

test("local installer stages Whisper Vulkan safely before switching service", async () => {
  const script = await readFile(new URL("../../../scripts/install-dictation-local.sh", import.meta.url), "utf8")

  assert.match(script, /linux-x86_64-vulkan/)
  assert.match(script, /large-v3-turbo/)
  assert.match(script, /huggingface\.co\/api\/models/)
  assert.match(script, /ggml-large-v3-turbo\.bin/)
  assert.match(script, /\.part/)
  assert.match(script, /VOXTYPE_VULKAN_DEVICE=nvidia/)
  assert.match(script, /whisper\.flash_attention/)
  assert.match(script, /rollback/i)
  assert.match(script, /nvidia-smi/)
})

test("local dictation package ships the native GTK4 HUD toolchain", async () => {
  const daggerSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8")
  const packager = await readFile(new URL("../../../scripts/package-voxtype.mjs", import.meta.url), "utf8")
  const formula = await readFile(new URL("../../../Formula/voxtype.rb", import.meta.url), "utf8")

  for (const executable of ["voxtype-osd", "voxtype-osd-gtk4", "voxtype-audio-bridge"]) {
    assert.match(daggerSource, new RegExp(executable))
    assert.match(packager, new RegExp(executable))
    assert.match(formula, new RegExp(executable))
  }
})

test("GNOME Arc Reactor HUD is a state-driven optional extension", async () => {
  const installer = await readFile(new URL("../../../scripts/install-dictation-local.sh", import.meta.url), "utf8")
  const metadata = await readFile(
    new URL("../../../gnome-extension/voxtype-arc-hud@homebrew-tools.local/metadata.json", import.meta.url),
    "utf8",
  )
  const extension = await readFile(
    new URL("../../../gnome-extension/voxtype-arc-hud@homebrew-tools.local/extension.js", import.meta.url),
    "utf8",
  )
  const stylesheet = await readFile(
    new URL("../../../gnome-extension/voxtype-arc-hud@homebrew-tools.local/stylesheet.css", import.meta.url),
    "utf8",
  )

  assert.match(metadata, /"shell-version"\s*:\s*\[\s*"50"\s*\]/)
  assert.match(metadata, /voxtype-arc-hud@homebrew-tools\.local/)
  assert.match(extension, /export default class/)
  assert.match(extension, /enable\(\)/)
  assert.match(extension, /disable\(\)/)
  assert.match(extension, /get_user_runtime_dir\(\)/)
  assert.match(extension, /FileMonitor/)
  assert.match(extension, /recording|transcribing|idle|error/)
  assert.match(extension, /reactive:\s*false/)
  assert.match(stylesheet, /arc-reactor/)
  assert.match(stylesheet, /reduced|prefers-reduced-motion/)
  assert.match(installer, /gnome-extensions/)
  assert.match(installer, /voxtype-arc-hud@homebrew-tools\.local/)
})
