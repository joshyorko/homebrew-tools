import test from "node:test"
import assert from "node:assert/strict"

import { PACKAGE_REGISTRY, releaseMetadataForPackage } from "../src/library.ts"

const REQUIRED_RELEASE_FIELDS = [
  "package",
  "kind",
  "homebrew_path",
  "version",
  "release_tag",
  "asset_name",
  "artifact_sha256",
  "download_url",
  "release_title",
  "release_notes",
  "commit_message",
  "upstream",
] as const

test("package registry covers every planned adapter kind", () => {
  const kinds = new Set(PACKAGE_REGISTRY.map((entry) => entry.kind))

  assert.deepEqual(
    [...kinds].sort(),
    [
      "github_release_appimage_cask",
      "github_release_binary_cask",
      "github_release_deb_cask",
      "rpm_repack_cask",
      "source_build_node_formula",
      "source_build_rust_formula",
    ],
  )
})

test("release metadata preserves the standard contract for every package", () => {
  for (const entry of PACKAGE_REGISTRY) {
    const metadata = releaseMetadataForPackage(entry.id, {
      version: "1.2.3",
      releaseTag: `${entry.id}-1.2.3`,
      assetName: `${entry.id}.tar.gz`,
      artifactSha256: "a".repeat(64),
      downloadUrl: `https://example.com/${entry.id}.tar.gz`,
      releaseTitle: `${entry.id} 1.2.3`,
      releaseNotes: `release notes for ${entry.id}`,
      commitMessage: `Update ${entry.id} to 1.2.3`,
      upstream: { ...entry.upstream, version: "1.2.3", commit: "abc123" },
    })

    for (const field of REQUIRED_RELEASE_FIELDS) {
      assert.ok(field in metadata, `missing ${field} for ${entry.id}`)
    }

    assert.equal(metadata.package, entry.id)
    assert.equal(metadata.kind, entry.kind)
    assert.equal(metadata.homebrew_path, entry.homebrewPath)
    assert.equal(metadata.artifact_sha256.length, 64)
    assert.match(metadata.download_url, /^https:\/\//)
  }
})

test("registry entries expose the required orchestration fields", () => {
  for (const entry of PACKAGE_REGISTRY) {
    assert.ok(entry.id.length > 0)
    assert.ok(entry.homebrewPath.startsWith("Casks/") || entry.homebrewPath.startsWith("Formula/"))
    assert.ok(typeof entry.supportsPrCi === "boolean")
    assert.ok(typeof entry.supportsAutoUpdate === "boolean")
    assert.ok(typeof entry.updatePolicy === "string")
    assert.ok(typeof entry.upstream.kind === "string")
  }
})
