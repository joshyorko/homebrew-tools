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
      "github_release_binary_cask",
      "github_release_deb_cask",
      "http_binary_formula",
      "rpm_repack_cask",
      "source_build_go_formula",
      "source_build_node_appimage_cask",
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
      "devpod-linux",
      "fizzy-cli-master",
      "fizzy-popper-self-hosted",
      "fizzy-symphony",
      "rcc",
      "t3-code-linux",
      "t3code-cli-main",
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

test("t3-code-linux builds the desktop AppImage from upstream main", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "t3-code-linux")

  assert.ok(entry)
  assert.equal(entry.kind, "source_build_node_appimage_cask")
  assert.equal(entry.homebrewPath, "Casks/t3-code-linux.rb")
  assert.equal(entry.autoUpdate.kind, "git_head_sha")
  assert.equal(entry.upstream.kind, "git")

  if (entry.autoUpdate.kind === "git_head_sha") {
    assert.equal(entry.autoUpdate.ref, "main")
    assert.equal(entry.autoUpdate.prefix, "main.")
    assert.equal(entry.autoUpdate.includeCommitDate, true)
  }

  const source = readFileSync(new URL("../../../dagger/tap-pipeline/src/index.ts", import.meta.url), "utf8")

  assert.match(source, /pnpm",\s*"dist:desktop:linux"/)
  assert.match(source, /T3-Code-\$\{resolvedVersion\}-x86_64\.AppImage/)
  assert.doesNotMatch(source, /repos\/pingdotgg\/t3code\/releases\/latest/)
})

test("codex release tracks the fork tap-release branch and installs codex", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "codex-release")

  assert.ok(entry)
  assert.equal(entry.autoUpdate.kind, "git_head_sha")

  if (entry.autoUpdate.kind === "git_head_sha") {
    assert.equal(entry.autoUpdate.ref, "tap-release")
    assert.equal(entry.autoUpdate.prefix, "release.")
    assert.equal(entry.autoUpdate.includeCommitDate, true)
  }

  const formula = readFileSync(new URL("../../../Formula/codex-release.rb", import.meta.url), "utf8")

  assert.doesNotMatch(formula, /conflicts_with "codex"/)
  assert.match(formula, /libexec\.install Dir\["\*"\]/)
  assert.match(formula, /exec "#\{libexec\}\/bin\/codex" "\$@"/)
  assert.match(formula, /tap-release branch/)
  assert.match(formula, /official `codex` cask/)
})

test("codex release bundle consumes the fork's Linux release asset instead of compiling", () => {
  const source = readFileSync(new URL("../../../dagger/tap-pipeline/src/index.ts", import.meta.url), "utf8")
  const sectionMatch = source.match(/private async buildCodexReleaseArtifact[\s\S]*?private async codexReleaseSmokeLog/)

  assert.ok(sectionMatch)

  const section = sectionMatch[0]

  assert.match(section, /githubApiContainer/)
  assert.match(section, /downloadAsset/)
  assert.match(section, /githubApiRepoUrl\(entry\.upstream\.repo\)/)
  assert.doesNotMatch(section, /cargo", "build"/)
  assert.doesNotMatch(section, /tap-pipeline-cargo-target-codex-release/)
})

test("codex release local bundle accepts a locally built artifact", () => {
  const source = readFileSync(new URL("../../../dagger/tap-pipeline/src/index.ts", import.meta.url), "utf8")
  const installer = readFileSync(new URL("../../../scripts/install-codex-release-local.sh", import.meta.url), "utf8")
  const builder = readFileSync(new URL("../../../scripts/build-codex-release-local.sh", import.meta.url), "utf8")
  const makefile = readFileSync(new URL("../../../Makefile", import.meta.url), "utf8")
  const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")

  assert.match(source, /codexReleaseLocalBundle/)
  assert.match(source, /codexReleaseArtifact: File/)
  assert.match(source, /buildLocalCodexReleaseArtifact/)
  assert.match(source, /CODEX_RELEASE_LOCAL_ARTIFACT/)
  assert.match(installer, /codex-release-local-bundle/)
  assert.match(installer, /--codex-release-artifact=\$artifact/)
  assert.match(installer, /CODEX_RELEASE_LOCAL_ARTIFACT="\$artifact"/)
  assert.match(installer, /scripts\/build-codex-release-local\.sh/)
  assert.match(builder, /CODEX_RELEASE_SOURCE_REPO/)
  assert.match(builder, /\.codex-release\/source/)
  assert.match(builder, /\.codex-release\/cache/)
  assert.match(builder, /dist\/codex-release-build/)
  assert.match(builder, /git clone --filter=blob:none/)
  assert.match(makefile, /^codex:/m)
  assert.match(makefile, /^codex-build:/m)
  assert.match(makefile, /CODEX_RELEASE_SOURCE_REPO/)
  assert.doesNotMatch(makefile, /CODEX_REPO/)
  assert.match(makefile, /CODEX_RELEASE_BUILD_ARGS/)
  assert.match(readme, /make codex/)
  assert.match(readme, /make codex-build/)
  assert.match(readme, /\.codex-release\/source/)
  assert.match(readme, /\.codex-release\/cache/)
  assert.match(readme, /CODEX_RELEASE_ARTIFACT=\/path\/to\/codex-release-release/)
})

test("antigravity CLI is a manual closed-source binary formula", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "antigravity-cli")

  assert.ok(entry)
  assert.equal(entry.kind, "http_binary_formula")
  assert.equal(entry.homebrewPath, "Formula/antigravity-cli.rb")
  assert.equal(entry.supportsPrCi, true)
  assert.equal(entry.autoUpdate.kind, "manual")
  assert.equal(entry.upstream.kind, "http_file")

  const formula = readFileSync(new URL("../../../Formula/antigravity-cli.rb", import.meta.url), "utf8")

  assert.match(formula, /class AntigravityCli < Formula/)
  assert.match(formula, /bin\/"agy"/)
  assert.match(formula, /license :cannot_represent/)
})

test("codex desktop is not registered for tap auto-update or release publishing", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "codex-desktop-linux")

  assert.equal(entry, undefined)
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

test("eitype accepts upstream release tags without a v prefix", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "eitype")

  assert.ok(entry)
  assert.equal(entry.autoUpdate.kind, "github_release_latest_tag")

  if (entry.autoUpdate.kind === "github_release_latest_tag") {
    assert.equal(entry.autoUpdate.stripPrefix, undefined)
  }
})
