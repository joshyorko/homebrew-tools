import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  AUTO_UPDATE_SLOTS,
  PACKAGE_REGISTRY,
  codexDesktopBuildVersion,
  formatGitHeadVersion,
  releaseMetadataForPackage,
} from "../src/library.ts"

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
      "headroom_self_hosted_formula",
      "http_binary_formula",
    "rpm_repack_cask",
      "source_build_go_formula",
      "source_build_node_appimage_cask",
      "source_build_node_formula",
      "source_build_rust_appimage_cask",
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
    "buzz-linux",
    "chatgpt",
    "codex-desktop-linux",
      "devpod-linux",
      "devsy",
      "devsy-desktop",
      "fizzy-cli-master",
      "fizzy-popper-self-hosted",
      "fizzy-symphony",
      "headroom-self-hosted",
      "rcc",
      "t3-code-linux",
      "t3code-cli-main",
      "vscode-insiders-linux",
    ],
  )
})

test("Buzz runs through the standard daily auto-update pipeline", () => {
  const autoUpdateWorkflow = readFileSync(
    new URL("../../../.github/workflows/tap-auto-update.yml", import.meta.url),
    "utf8",
  )
  const slots = readFileSync(new URL("../auto-update-slots.json", import.meta.url), "utf8")

  assert.match(autoUpdateWorkflow, /- cron: "13 10 \* \* \*"/)
  assert.match(autoUpdateWorkflow, /- buzz-daily/)
  assert.match(autoUpdateWorkflow, /"13 10 \* \* \*"\) slot_id="buzz-daily"/)
  assert.match(slots, /"id": "buzz-daily"/)
  assert.match(slots, /"packageIds": \["buzz-linux"\]/)
  assert.doesNotMatch(autoUpdateWorkflow, /^  buzz:/m)
  assert.match(autoUpdateWorkflow, /matrix\.package_id != 'buzz-linux'/)
  assert.match(autoUpdateWorkflow, /module: \.\/dagger\/buzz-linux-smoke/)
  assert.match(autoUpdateWorkflow, /release-bundle/)
  assert.match(autoUpdateWorkflow, /repos\/block\/buzz\/releases\/latest/)
  assert.match(autoUpdateWorkflow, /--source-ref="\$\{\{ steps\.buzz_source\.outputs\.commit \}\}"/)
  assert.match(autoUpdateWorkflow, /--version="\$\{\{ steps\.buzz_source\.outputs\.version \}\}"/)
})

test("ChatGPT runs through the standard daily release pipeline", () => {
  const autoUpdateWorkflow = readFileSync(
    new URL("../../../.github/workflows/tap-auto-update.yml", import.meta.url),
    "utf8",
  )

  assert.match(autoUpdateWorkflow, /- cron: "0 10 \* \* \*"/)
  assert.match(autoUpdateWorkflow, /- chatgpt-daily/)
  assert.match(autoUpdateWorkflow, /"0 10 \* \* \*"\) slot_id="chatgpt-daily"/)
  assert.doesNotMatch(autoUpdateWorkflow, /^  chatgpt:/m)
})

test("Codex Desktop rebuilds daily from OpenAI version, PatchRaptor commit, and feature profile", () => {
  const autoUpdateWorkflow = readFileSync(
    new URL("../../../.github/workflows/tap-auto-update.yml", import.meta.url),
    "utf8",
  )
  const slots = readFileSync(new URL("../auto-update-slots.json", import.meta.url), "utf8")
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "codex-desktop-linux")

  assert.equal(entry?.autoUpdate.kind, "deb_packages_version")
  assert.match(autoUpdateWorkflow, /- cron: "15 10 \* \* \*"/)
  assert.match(autoUpdateWorkflow, /push:[\s\S]*config\/codex-desktop-linux-features\.json/)
  assert.match(autoUpdateWorkflow, /- codex-desktop-daily/)
  assert.match(autoUpdateWorkflow, /EVENT_NAME" = "push"[\s\S]*slot_id="codex-desktop-daily"/)
  assert.match(autoUpdateWorkflow, /"15 10 \* \* \*"\) slot_id="codex-desktop-daily"/)
  assert.match(autoUpdateWorkflow, /--codex-desktop-package-source=.*latest/)
  assert.match(slots, /"id": "codex-desktop-daily"[\s\S]*"packageIds": \["codex-desktop-linux"\]/)
  assert.equal(
    codexDesktopBuildVersion("26.818.21641", "1234567890abcdef", ["ui-tweaks", "agent-workspace"]),
    "26.818.21641.patchraptor.1234567890ab.features.fd9999f9e051",
  )
})

test("Camp sync consumes the published formula without rebuilding Camp", () => {
  const autoUpdateWorkflow = readFileSync(
    new URL("../../../.github/workflows/tap-auto-update.yml", import.meta.url),
    "utf8",
  )

  assert.match(autoUpdateWorkflow, /- cron: "23 10 \* \* \*"/)
  assert.match(autoUpdateWorkflow, /- camp-daily/)
  assert.match(autoUpdateWorkflow, /gh release download --repo joshyorko\/camp --pattern camp\.rb/)
  assert.match(autoUpdateWorkflow, /install -m 0644 "\$formula" Formula\/camp\.rb/)
  const campJob = autoUpdateWorkflow.slice(
    autoUpdateWorkflow.indexOf("  camp:\n"),
    autoUpdateWorkflow.indexOf("  build:\n"),
  )
  assert.doesNotMatch(campJob, /dagger/)
  assert.doesNotMatch(campJob, /go build/)
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
  const cask = readFileSync(new URL("../../../Casks/t3-code-linux.rb", import.meta.url), "utf8")
  const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")

  assert.match(source, /pnpm",\s*"dist:desktop:linux"/)
  assert.match(source, /T3-Code-\$\{resolvedVersion\}-x86_64\.AppImage/)
  assert.doesNotMatch(source, /repos\/pingdotgg\/t3code\/releases\/latest/)
  assert.match(source, /case "t3-code-linux":\n\s+return `t3-code-linux-\$\{version\.split\(",", 1\)\[0\]\}`/)
  assert.match(source, /test -x .*squashfs-root\/AppRun/)
  assert.match(source, /grep -Fq .*squashfs-root\/AppRun/)
  assert.match(source, /! grep -Eq .*AppImage/)

  assert.match(cask, /^\s*version "main\.\d{14}\.[0-9a-f]{12}"$/m)
  assert.match(cask, /T3-Code-#\{version\.csv\.first\}-#\{arch\}\.AppImage/)
  assert.match(cask, /app_run = "#\{staged_path\}\/squashfs-root\/AppRun"/)
  assert.match(cask, /raise "T3 Code AppRun is not executable" unless File\.executable\?\(app_run\)/)
  assert.match(cask, /exec "#\{app_run\}" --no-sandbox "\$@"/)
  assert.doesNotMatch(cask, /exec .*AppImage.*--no-sandbox/)
  assert.match(readme, /T3 Code[\s\S]*launches its extracted `AppRun`[\s\S]*does not require FUSE at runtime/)
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

test("ChatGPT Desktop cask extracts the pinned official Linux RPM locally", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "chatgpt")

  assert.ok(entry)
  assert.equal(entry.kind, "rpm_repack_cask")
  assert.equal(entry.homebrewPath, "Casks/chatgpt.rb")
  assert.equal(entry.supportsPrCi, true)
  assert.equal(entry.supportsReleaseBundle, true)
  assert.equal(entry.autoUpdate.kind, "deb_packages_version")

  const cask = readFileSync(new URL("../../../Casks/chatgpt.rb", import.meta.url), "utf8")

  assert.match(cask, /cask "chatgpt"/)
  assert.match(cask, /version "\d+(?:\.\d+)+"/)
  assert.match(cask, /chatgpt-#\{version\}-1\.#\{arch\}\.rpm/)
  assert.match(cask, /x86_64_linux: "[0-9a-f]{64}"/)
  assert.match(cask, /arm64_linux:\s+"[0-9a-f]{64}"/)
  assert.match(cask, /depends_on formula: "cpio"/)
  assert.match(cask, /depends_on formula: "rpm2cpio"/)
  assert.match(cask, /Formula\["rpm2cpio"\]/)
  assert.match(cask, /binary "usr\/lib\/chatgpt\/codex-launcher", target: "chatgpt"/)
  assert.match(cask, /usr\/share\/applications\/chatgpt\.desktop/)
  assert.match(cask, /usr\/share\/pixmaps\/chatgpt\.png/)
  assert.match(cask, /Exec=#\{HOMEBREW_PREFIX\}\/bin\/chatgpt %U/)
  assert.doesNotMatch(cask, /dpkg\s+-i|sources\.list\.d|apparmor_parser/)
  assert.match(
    readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"),
    /case "chatgpt"[\s\S]*brew install --cask test\/tap\/chatgpt/,
  )
  assert.match(
    readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"),
    /case "chatgpt"[\s\S]*getent passwd[\s\S]*share\/pixmaps\/chatgpt\.png/,
  )
  assert.match(
    readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"),
    /case "chatgpt"[\s\S]*buildChatgptArtifacts[\s\S]*artifacts\/\$\{build\.amd64\.assetName\}[\s\S]*artifacts\/\$\{build\.arm64\.assetName\}/,
  )

  const makefile = readFileSync(new URL("../../../Makefile", import.meta.url), "utf8")
  const installer = readFileSync(new URL("../../../scripts/install-chatgpt-local.sh", import.meta.url), "utf8")
  const uninstaller = readFileSync(new URL("../../../scripts/uninstall-chatgpt.sh", import.meta.url), "utf8")
  assert.match(makefile, /^chatgpt:\n\tscripts\/install-chatgpt-local\.sh$/m)
  assert.match(installer, /dagger -m \.\/dagger\/tap-pipeline call[\s\S]*ci-check --package-id=chatgpt/)
  assert.match(installer, /brew tap-new --no-git/)
  assert.match(installer, /brew install --cask/)
  assert.doesNotMatch(installer, /Formula\/chatgpt\.rb|--build-from-source/)
  assert.match(makefile, /^uninstall-chatgpt:\n\tscripts\/uninstall-chatgpt\.sh$/m)
  assert.match(uninstaller, /brew uninstall --cask chatgpt/)
  assert.match(uninstaller, /chatgpt-local/)
  assert.doesNotMatch(uninstaller, /\.config\/ChatGPT|\.cache\/ChatGPT|\.local\/share\/ChatGPT/)
})

test("Devsy packages pin stable release assets and keep CLI and Desktop identities separate", () => {
  const cliEntry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "devsy")
  const desktopEntry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "devsy-desktop")

  assert.ok(cliEntry)
  assert.equal(cliEntry.kind, "http_binary_formula")
  assert.equal(cliEntry.homebrewPath, "Formula/devsy.rb")
  assert.equal(cliEntry.supportsPrCi, true)
  assert.equal(cliEntry.autoUpdate.kind, "github_release_latest_tag")
  assert.equal(cliEntry.upstream.kind, "github_release")

  assert.ok(desktopEntry)
  assert.equal(desktopEntry.kind, "github_release_appimage_cask")
  assert.equal(desktopEntry.homebrewPath, "Casks/devsy-desktop.rb")
  assert.equal(desktopEntry.supportsPrCi, true)
  assert.equal(desktopEntry.autoUpdate.kind, "github_release_latest_tag")
  assert.equal(desktopEntry.upstream.kind, "github_release")

  const formula = readFileSync(new URL("../../../Formula/devsy.rb", import.meta.url), "utf8")
  const cask = readFileSync(new URL("../../../Casks/devsy-desktop.rb", import.meta.url), "utf8")
  const pipeline = readFileSync(new URL("../../../dagger/tap-pipeline/src/index.ts", import.meta.url), "utf8")
  const renderer = readFileSync(new URL("../src/devsy-render.ts", import.meta.url), "utf8")
  const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")
  const formulaVersion = formula.match(/^\s*version "(\d+\.\d+\.\d+)"$/m)?.[1]
  const caskVersionMatch = cask.match(/^\s*version "(\d+\.\d+\.\d+)(?:,(\d+))?"$/m)
  const caskVersion = caskVersionMatch?.[1]
  const caskRevision = caskVersionMatch?.[2]
  const formulaUrls = [...formula.matchAll(/^\s*url "([^"]+)"$/gm)].map((match) => match[1])
  const formulaDigests = [...formula.matchAll(/^\s*sha256 "([a-f0-9]{64})"$/gm)].map((match) => match[1])
  const caskUrl = cask.match(/^\s*url "([^"]+)"$/m)?.[1]
  const caskDigest = cask.match(/^\s*sha256 x86_64_linux: "([a-f0-9]{64})"$/m)?.[1]

  assert.match(formula, /class Devsy < Formula/)
  assert.match(formulaVersion ?? "", /^\d+\.\d+\.\d+$/)
  assert.match(formula, /license "MPL-2\.0"/)
  assert.equal(formulaUrls.length, 2)
  assert.match(formulaUrls[0], new RegExp(`/(?:v|devsy-)${formulaVersion}/devsy-linux-amd64$`))
  assert.match(formulaUrls[1], new RegExp(`/(?:v|devsy-)${formulaVersion}/devsy-linux-arm64$`))
  assert.equal(formulaDigests.length, 2)
  assert.notEqual(formulaDigests[0], formulaDigests[1])
  assert.match(formula, /bin\.install binary => "devsy"/)
  assert.match(formula, /ENV\["DEVSY_HOME"\] = testpath/)
  assert.match(formula, /shell_output\("#\{bin\}\/devsy --version"\)/)
  assert.doesNotMatch(formula, /devsy version/)
  assert.doesNotMatch(formula, /self update/)

  assert.match(cask, /cask "devsy-desktop"/)
  assert.match(cask, /arch intel: "x86_64"/)
  assert.match(cask, /depends_on arch: :x86_64/)
  assert.doesNotMatch(cask, /arch arm/)
  assert.equal(caskVersion, formulaVersion)
  assert.equal(caskRevision, undefined)
  assert.match(caskUrl ?? "", new RegExp(`/(?:v|devsy-desktop-)${caskVersion}/Devsy_linux_x86_64\\.AppImage$`))
  assert.match(caskDigest ?? "", /^[a-f0-9]{64}$/)
  assert.match(cask, /target: "devsy-desktop"/)
  assert.match(cask, /x-scheme-handler\/devsy/)
  assert.doesNotMatch(cask, /target: "devsy"/)
  assert.doesNotMatch(cask, /binary .*resources\/bin\/devsy/)
  assert.doesNotMatch(cask, /--no-sandbox/)
  assert.match(cask, /app_run = "#\{staged_path\}\/squashfs-root\/AppRun"/)
  assert.match(cask, /exec "#\{app_run\}" "\$@"/)
  assert.doesNotMatch(cask, /exec "#\{appimage\}" "\$@"/)
  assert.doesNotMatch(cask, /\bflatpak\b/i)
  assert.doesNotMatch(cask, /\brpm\b/i)

  assert.match(pipeline, /case "devsy"/)
  assert.match(pipeline, /case "devsy-desktop"/)
  assert.match(pipeline, /case "devsy-desktop":\n\s+return `devsy-desktop-\$\{version\.split\(",", 1\)\[0\]\}`/)
  assert.match(renderer, /GitHub digest mismatch for/)
  assert.match(pipeline, /Devsy_linux_x86_64\.AppImage/)
  assert.match(renderer, /devsy-linux-amd64/)
  assert.match(renderer, /devsy-linux-arm64/)
  assert.match(pipeline, /! grep -q -- '--no-sandbox'/)
  assert.match(pipeline, /libappindicator\.so\.1/)

  assert.match(readme, /flatpak install --user \.\/Devsy\.flatpak/)
  assert.doesNotMatch(readme, /Devsy-\d+\.\d+\.\d+\.flatpak/)
  assert.match(readme, /never auto-detects Bluefin/)
  assert.match(readme, /intentionally unsupported on arm64/)
  assert.match(readme, /updater alone[\s\S]*latest/)
})

test("Codex Desktop consumes the scheduled PatchRaptor official-package build", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "codex-desktop-linux")
  const pipeline = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
  const buildStart = pipeline.indexOf("private async buildCodexDesktopLinuxOfficialArtifact")
  const buildEnd = pipeline.indexOf("private async", buildStart + 1)
  const officialBuild = pipeline.slice(buildStart, buildEnd)

  assert.ok(entry)
  assert.equal(entry.kind, "codex_desktop_linux_cask")
  assert.equal(entry.homebrewPath, "Casks/codex-desktop.rb")
  assert.equal(entry.supportsReleaseBundle, true)
  assert.equal(entry.autoUpdate.kind, "deb_packages_version")
  assert.equal(entry.upstream.kind, "git")
  assert.equal(entry.upstream.repo, "https://github.com/joshyorko/codex-desktop-linux")
  assert.equal(entry.upstream.ref, "patchraptor-main")
  assert.match(officialBuild, /"mkdir -p \/work",[\s\S]*curl -fL --retry 3 -o \/work\/chatgpt\.deb/)
  assert.match(officialBuild, /PACKAGE_WITH_UPDATER=0 CODEX_INSTALL_DIR=\/upstream\/codex-app \.\/install\.sh \/work\/chatgpt\.deb/)
  assert.doesNotMatch(officialBuild, /UPSTREAM_DEB=\/work\/chatgpt\.deb[^\n]*make build-app/)
  assert.match(pipeline, /PACKAGE_WITH_UPDATER=0/)
  assert.match(pipeline, /nix\/upstream-linux-packages\.json/)
  assert.doesNotMatch(pipeline, /codex-desktop-linux is local-only and must not be published/)
})

test("Headroom self-hosted retains an offline proxy wheelhouse with complete provenance", () => {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === "headroom-self-hosted")
  const pipeline = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
  const headroomCi = pipeline.slice(
    pipeline.indexOf('case "headroom-self-hosted": {', pipeline.indexOf("async ciCheck")),
    pipeline.indexOf('case "codex-desktop-linux": {', pipeline.indexOf("async ciCheck")),
  )

  assert.ok(entry)
  assert.equal(entry.kind, "headroom_self_hosted_formula")
  assert.equal(entry.homebrewPath, "Formula/headroom-self-hosted.rb")
  assert.equal(entry.supportsPrCi, true)
  assert.equal(entry.supportsReleaseBundle, true)
  assert.equal(entry.autoUpdate.kind, "git_head_sha")
  assert.equal(entry.autoUpdate.ref, "self-hosted")
  assert.equal(entry.upstream.kind, "git")
  assert.equal(entry.upstream.repo, "https://github.com/joshyorko/headroom")
  assert.equal(entry.upstream.ref, "ad7eea0d310c13278965a54488dbb6a9e3162d33")
  assert.match(pipeline, /python:3\.13-bookworm/)
  assert.match(pipeline, /python -m pip wheel[^\n]+\.\[proxy\]/)
  assert.match(pipeline, /source_tree: treeHash/)
  assert.match(pipeline, /artifact_sha256: build\.sha256/)
  assert.match(pipeline, /\.withNewFile\("\/work\/package\/provenance\.json", json\(buildProvenance\)\)/)
  assert.match(pipeline, /python -m json\.tool \/work\/package\/provenance\.json >\/dev\/null/)
  assert.doesNotMatch(pipeline, /JSON\.stringify\(JSON\.stringify\(buildProvenance/)
  assert.match(pipeline, /withNewFile\("provenance\.json"/)
  assert.match(pipeline, /brew test test\/tap\/headroom-self-hosted/)
  assert.match(pipeline, /headroom --help/)
  assert.match(pipeline, /headroom proxy --help/)
  assert.match(pipeline, /--no-index/)
  assert.match(pipeline, /--find-links=#\{libexec\}\/wheelhouse/)
  assert.doesNotMatch(pipeline, /rm_rf libexec\/"wheelhouse"/)
  assert.match(headroomCi, /\.from\(BREW_IMAGE\)\s*\.withUser\("linuxbrew"\)/)
})

test("Headroom self-hosted has a daily and explicitly dispatchable update slot", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/tap-auto-update.yml", import.meta.url), "utf8")
  const slot = AUTO_UPDATE_SLOTS.find((candidate) => candidate.id === "headroom-daily")

  assert.ok(slot)
  assert.deepEqual(slot.packageIds, ["headroom-self-hosted"])
  assert.match(workflow, /- cron: "31 10 \* \* \*"/)
  assert.match(workflow, /- headroom-daily/)
  assert.match(workflow, /"31 10 \* \* \*"\) slot_id="headroom-daily"/)
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
