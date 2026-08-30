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

test("Dagger exposes a local dictation bundle that builds Cohere and both latest releases", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8")

  assert.match(source, /async dictationBundle\(/)
  assert.match(source, /selectLatestStableRelease\(/)
  assert.match(source, /\["cohere"\]/)
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
})

test("local installer target configures Herdr toggle and GNOME-safe output drivers", async () => {
  const makefile = await readFile(new URL("../../../Makefile", import.meta.url), "utf8")
  const script = await readFile(new URL("../../../scripts/install-dictation-local.sh", import.meta.url), "utf8")

  assert.match(makefile, /dictation-install/)
  assert.match(script, /--git-dir/)
  assert.match(script, /tap_name=local\/dictation/)
  assert.match(script, /tap-new/)
  assert.match(script, /prefix\+alt\+v/)
  assert.match(script, /eitype.*ydotool.*clipboard/)
  assert.match(script, /auto_submit.*false|output\.auto_submit.*false/)
  assert.match(script, /voxtype_user_agent="voxtype\/\$\{voxtype_version\}"/)
  assert.match(script, /\.voxtype-manifest\.json/)
})
