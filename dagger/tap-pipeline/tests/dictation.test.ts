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

test("Dagger uses one immutable Vulkan builder for public and local packages", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8")

  assert.match(source, /buildVoxtypeVulkanArtifact\(tap: Directory, tagName: string\)/)
  assert.match(source, /resolveApprovedPublicDictationRelease\("voxtype"\)/)
  assert.match(source, /resolveApprovedPublicDictationRelease\("eitype"\)/)
  assert.match(source, /tagName: "v1\.0\.0"/)
  assert.match(source, /tagName: "0\.2\.2"/)
  assert.match(source, /voxtypeVulkanReleaseMetadata\(/)
  assert.match(source, /voxtype-\$\{build\.version\}-vulkan\.1/)
  assert.match(source, /revision \$\{revision\}/)
  assert.match(source, /Checksum-verified upstream Vulkan artifact/)
  assert.match(source, /formula revision 1/)
  assert.match(source, /linux-x86_64-vulkan/)
  assert.match(source, /SHA256SUMS\.txt/)
  assert.match(source, /voxtype-\$\{version\}-linux-x86_64-osd/)
  assert.match(source, /voxtype-\$\{version\}-linux-x86_64-audio-bridge/)
})

test("public dictation versions and Homebrew ownership are immutable", async () => {
  const daggerSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8")
  const eitypeFormula = await readFile(new URL("../../../Formula/eitype.rb", import.meta.url), "utf8")
  const installer = await readFile(new URL("../../../scripts/install-dictation-local.sh", import.meta.url), "utf8")

  assert.match(daggerSource, /buildEitypeArtifact\(tap, `refs\/tags\/\$\{release\.tagName\}`\)/)
  assert.match(daggerSource, /eitype-\$\{build\.version\}/)
  assert.match(eitypeFormula, /version "0\.2\.1"/)
  assert.doesNotMatch(installer, /gnome-extensions|voxtype-arc-hud|Arc Reactor|gnome-extension/)
})

test("public dictation resolution fails closed on tag and built-version drift", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8")

  assert.match(source, /release\.tagName !== expected\.tagName/)
  assert.match(source, /release\.version !== expected\.version/)
  assert.match(source, /builtVersion !== expected\.version/)
  assert.equal(source.match(/this\.assertApprovedPublicDictationBuild\(/g)?.length, 6)
  assert.match(source, /assertApprovedPublicDictationBuild\("voxtype", release, build\.version\)/)
  assert.match(source, /assertApprovedPublicDictationBuild\("eitype", release, build\.version\)/)
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
  assert.doesNotMatch(script, /enabled-extensions/)
  assert.match(script, /voxtype\.service\.d/)
  assert.match(script, /Environment=.*PATH=/)
  assert.match(script, /eitype.*ydotool.*clipboard/)
  assert.match(script, /auto_submit.*false|output\.auto_submit.*false/)
  assert.match(script, /config set osd\.enabled false/)
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
  assert.match(script, /--continue-at -/)
  assert.match(script, /VOXTYPE_VULKAN_DEVICE=nvidia/)
  assert.match(script, /VK_ICD_FILENAMES=.*nvidia_icd\.json/)
  assert.match(script, /ggml_vulkan.*NVIDIA/)
  assert.match(script, /using Vulkan0 backend/)
  assert.match(script, /whisper\.flash_attention/)
  assert.match(script, /context_window_optimization.*false/)
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

test("Homebrew installer does not own the GNOME HUD", async () => {
  const installer = await readFile(new URL("../../../scripts/install-dictation-local.sh", import.meta.url), "utf8")
  assert.doesNotMatch(installer, /gnome-extensions/)
  assert.doesNotMatch(installer, /voxtype-arc-hud@homebrew-tools\.local/)
  assert.doesNotMatch(installer, /gnome-extension/)
  assert.match(installer, /config set osd\.enabled false/)
})
