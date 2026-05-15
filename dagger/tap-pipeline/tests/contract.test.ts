import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { AUTO_UPDATE_SLOTS, PACKAGE_REGISTRY, formatGitHeadVersion, releaseMetadataForPackage } from "../src/library.ts"

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
      "codex_desktop_linux_cask",
      "github_release_appimage_cask",
      "github_release_binary_cask",
      "github_release_deb_cask",
      "rpm_repack_cask",
      "source_build_go_formula",
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
    assert.ok(typeof entry.autoUpdate.kind === "string")
    assert.ok(entry.upstream, `missing upstream for ${entry.id}`)
    assert.ok(typeof entry.upstream.kind === "string")
  }
})

test("every auto-update slot references registered packages", () => {
  const packageIds = new Set(PACKAGE_REGISTRY.map((entry) => entry.id))

  for (const slot of AUTO_UPDATE_SLOTS) {
    for (const packageId of slot.packageIds) {
      assert.equal(packageIds.has(packageId), true, `expected registered package for ${slot.id}:${packageId}`)
    }
  }
})

test("auto-update slots cover the expected package set", () => {
  const coveredPackageIds = new Set(AUTO_UPDATE_SLOTS.flatMap((slot) => slot.packageIds))

  assert.deepEqual(
    [...coveredPackageIds].sort(),
    [
      "action-server",
      "codex-desktop-linux",
      "devpod-linux",
      "eitype",
      "fizzy-cli-master",
      "fizzy-popper-self-hosted",
      "fizzy-symphony",
      "rcc",
      "t3-code-linux",
      "t3code-cli-main",
      "voxtype",
      "vscode-insiders-linux",
    ],
  )
})

test("every auto-updated package declares a version resolution strategy", () => {
  const registryById = new Map(PACKAGE_REGISTRY.map((entry) => [entry.id, entry]))

  for (const packageId of new Set(AUTO_UPDATE_SLOTS.flatMap((slot) => slot.packageIds))) {
    const entry = registryById.get(packageId)
    assert.ok(entry, `missing registry entry for ${packageId}`)
    assert.ok(entry.autoUpdate, `missing auto-update strategy for ${packageId}`)
  }
})

test("timestamped git-head versions sort by commit time before sha", () => {
  const older = formatGitHeadVersion({
    committedAt: "2026-04-25T20:00:00Z",
    includeCommitDate: true,
    prefix: "selfhosted.",
    sha: "f641c5c86889abcdef",
    shaLength: 12,
  })
  const newer = formatGitHeadVersion({
    committedAt: "2026-04-26T20:00:00Z",
    includeCommitDate: true,
    prefix: "selfhosted.",
    sha: "d08b71dff98dabcdef",
    shaLength: 12,
  })

  assert.equal(older, "selfhosted.20260425200000.f641c5c86889")
  assert.equal(newer, "selfhosted.20260426200000.d08b71dff98d")
  assert.equal(newer > older, true)
})

test("fizzy-popper self-hosted opts into timestamped git-head versions", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "fizzy-popper-self-hosted")

  assert.ok(entry)
  assert.equal(entry.autoUpdate.kind, "git_head_sha")

  if (entry.autoUpdate.kind === "git_head_sha") {
    assert.equal(entry.autoUpdate.includeCommitDate, true)
  }
})

test("fizzy-symphony opts into timestamped git-head versions", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "fizzy-symphony")

  assert.ok(entry)
  assert.equal(entry.autoUpdate.kind, "git_head_sha")

  if (entry.autoUpdate.kind === "git_head_sha") {
    assert.equal(entry.autoUpdate.includeCommitDate, true)
  }
})

test("t3code CLI main uses timestamped main snapshots instead of smoke labels", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "t3code-cli-main")

  assert.ok(entry)
  assert.equal(entry.autoUpdate.kind, "git_head_sha")

  if (entry.autoUpdate.kind === "git_head_sha") {
    assert.equal(entry.autoUpdate.prefix, "main.")
    assert.equal(entry.autoUpdate.includeCommitDate, true)
  }
})

test("codex desktop auto-update tracks the official upstream DMG", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "codex-desktop-linux")

  assert.ok(entry)
  assert.equal(entry.autoUpdate.kind, "http_header_fingerprint")

  if (entry.upstream.kind === "http_file") {
    assert.equal(entry.upstream.url, "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg")
  } else {
    assert.fail("codex desktop should use the official Codex.dmg URL as its upstream source")
  }
})

test("t3code CLI builders do not rewrite the upstream runtime package version", () => {
  const builders = [
    "../../../dagger/tap-pipeline/src/index.ts",
    "../../../dagger/t3code-cli-main-smoke/src/index.ts",
  ]

  for (const builder of builders) {
    const contents = readFileSync(new URL(builder, import.meta.url), "utf8")

    assert.doesNotMatch(contents, /pkg\.version\s*=\s*process\.argv\[1\]/)
  }
})

test("t3code CLI main formula bumps the Homebrew version scheme", () => {
  const formula = readFileSync(new URL("../../../Formula/t3code-cli-main.rb", import.meta.url), "utf8")

  assert.match(formula, /^\s*version_scheme 1$/m)
})

test("fizzy-symphony formula test stays credentialless", () => {
  const formula = readFileSync(new URL("../../../Formula/fizzy-symphony.rb", import.meta.url), "utf8")

  assert.doesNotMatch(formula, /shell_output\("#{bin}\/fizzy-symphony"\)/)
  assert.match(formula, /shell_output\("#{bin}\/fizzy-symphony --help"\)/)
  assert.match(formula, /setup --template-only/)
})

test("fizzy-popper self-hosted formula bumps the Homebrew version scheme", () => {
  const formula = readFileSync(new URL("../../../Formula/fizzy-popper-self-hosted.rb", import.meta.url), "utf8")

  assert.match(formula, /^\s*version_scheme 1$/m)
})

test("eitype normalizes v-prefixed upstream release tags", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "eitype")

  assert.ok(entry)
  assert.equal(entry.autoUpdate.kind, "github_release_latest_tag")

  if (entry.autoUpdate.kind === "github_release_latest_tag") {
    assert.equal(entry.autoUpdate.stripPrefix, "v")
  }
})
