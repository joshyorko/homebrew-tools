import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { parseDebianPackageVersion } from "../src/library.ts"

const repoRoot = new URL("../../..", import.meta.url)

function read(path: string): string {
  return readFileSync(new URL(path, repoRoot), "utf8")
}

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`)
  return source.slice(start, end)
}

test("package CI uses the current Homebrew main image for structured cask steps", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")

  assert.match(pipeline, /const BREW_IMAGE = "ghcr\.io\/homebrew\/brew:main"/)
  assert.doesNotMatch(pipeline, /homebrew\/brew:latest/)
})

test("DevPod package CI trusts its local dependency formula", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const devpodCi = section(pipeline, 'case "devpod-linux": {', 'case "chatgpt": {')

  assert.match(devpodCi, /brew trust --formula test\/tap\/devpod-appindicator-runtime-tools/)
})

test("Devsy Desktop package CI styles the local cask fixture", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const devsyDesktopCi = section(pipeline, 'case "devsy-desktop": {', 'case "fizzy-cli-master": {')

  assert.match(devsyDesktopCi, /brew style --cask test\/tap\/devsy-desktop/)
  assert.doesNotMatch(devsyDesktopCi, /brew audit --cask test\/tap\/devsy-desktop/)
})

test("Devsy package CI trusts only staged fixtures before auditing and installing them", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const cases = [
    ["devsy", 'case "devsy": {', 'case "devsy-desktop": {'],
    ["devsy-desktop", 'case "devsy-desktop": {', 'case "fizzy-cli-master": {'],
  ]

  for (const [packageId, start, end] of cases) {
    const tempRoot = mkdtempSync(join(tmpdir(), "devsy-brew-trust-"))
    try {
      const brew = join(tempRoot, "brew")
      writeFileSync(brew, [
        "#!/usr/bin/env bash",
        "set -eu",
        'case "$*" in',
        '  "trust --formula test/tap/devsy") touch "$FAKE_BREW_STATE/formula" ;;',
        '  "trust --cask test/tap/devsy-desktop") touch "$FAKE_BREW_STATE/cask" ;;',
        '  "audit --formula test/tap/devsy"|"install test/tap/devsy"|"test --verbose test/tap/devsy") test -f "$FAKE_BREW_STATE/formula" ;;',
        '  "style --cask test/tap/devsy-desktop"|"install --cask test/tap/devsy-desktop") test -f "$FAKE_BREW_STATE/cask" ;;',
        '  *) printf "unexpected brew command: %s\\n" "$*" >&2; exit 2 ;;',
        "esac",
      ].join("\n"))
      chmodSync(brew, 0o755)
      const commands: string[] = []
      for (const line of section(pipeline, start, end).split("\n")) {
        const match = line.match(/^\s*"(brew [^"]+)",\s*$/)
        if (match) commands.push(match[1])
      }
      assert.ok(commands.includes("brew audit --formula test/tap/devsy"), packageId)
      assert.ok(commands.includes("brew install test/tap/devsy"), packageId)
      if (packageId === "devsy-desktop") {
        assert.ok(commands.includes("brew style --cask test/tap/devsy-desktop"))
        assert.ok(commands.includes("brew install --cask test/tap/devsy-desktop"))
      }
      const result = spawnSync("bash", ["-e", "-c", commands.join("\n")], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${tempRoot}:${process.env.PATH ?? ""}`, FAKE_BREW_STATE: tempRoot },
      })
      assert.equal(result.status, 0, `${packageId}: ${result.stderr}`)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }
})

test("Headroom follows the pushed self-hosted branch and installs the bundled proxy wheelhouse", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const formula = section(
    pipeline,
    "private renderHeadroomFormula",
    "private headroomReleaseMetadata",
  )

  assert.match(pipeline, /const sourceRef = entry\.autoUpdate\.ref/)
  assert.match(pipeline, /dag\.git\(entry\.upstream\.repo\)\.ref\(sourceRef\)/)
  assert.match(formula, /--find-links=#\{libexec\}\/wheelhouse/)
  assert.match(formula, /"headroom-ai\[proxy\]"/)
  assert.doesNotMatch(formula, /headroom-ai\[proxy\]==/)
})

test("ChatGPT parses its Debian stanza and retains both official RPM architectures", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")

  const packages = [
    "Package: another-package\nVersion: 9.9.9-1\nArchitecture: amd64",
    "Package: chatgpt\nVersion: 1.2.3\nArchitecture: amd64",
  ].join("\n\n")
  assert.equal(parseDebianPackageVersion(packages, "chatgpt"), "1.2.3")

  const chatgptBuild = section(
    pipeline,
    "private async buildChatgptArtifacts",
    "private async resolveGitHeadVersion",
  )
  assert.match(chatgptBuild, /linux\/rpm\/x86_64\/\$\{amd64Name\}/)
  assert.match(chatgptBuild, /linux\/rpm\/aarch64\/\$\{arm64Name\}/)
})

test("downloadAsset mounts GitHub auth only for GitHub-hosted assets", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const downloadAsset = section(
    pipeline,
    "private downloadAsset(",
    "private async sha256For",
  )

  assert.match(downloadAsset, /new URL\(url\)\.hostname === "github\.com"/)
  assert.match(downloadAsset, /\?\s*this\.withGithubAuth\(container\)\s*:\s*container/)
  assert.doesNotMatch(downloadAsset, /const authenticatedContainer = this\.withGithubAuth\(container\)/)
})

test("root Homebrew APT bootstraps remove only the inherited GitHub CLI source before updating", () => {
  const paths = [
    "dagger/tap-pipeline/src/index.ts",
    "dagger/vscode-insiders-linux-smoke/src/index.ts",
    "dagger/eitype-smoke/src/index.ts",
    "dagger/voxtype-smoke/src/index.ts",
  ]
  const cleanupCommand = "rm -f /etc/apt/sources.list.d/github-cli.list"

  for (const path of paths) {
    const source = read(path)
    const blocks = [...source.matchAll(
      /\.from\(BREW_IMAGE\)\s*\.withUser\("root"\)([\s\S]*?)\.withUser\("linuxbrew"\)/g,
    )]
      .map((match) => match[1])
      .filter((block) => block.includes("apt-get update"))

    assert.ok(blocks.length > 0, `expected root Homebrew APT block in ${path}`)
    assert.equal(
      (source.match(new RegExp(cleanupCommand.replaceAll(".", "\\."), "g")) ?? []).length,
      blocks.length,
      `cleanup must be limited to root Homebrew APT blocks in ${path}`,
    )

    for (const block of blocks) {
      const cleanupIndex = block.indexOf(cleanupCommand)
      const updateIndex = block.indexOf("apt-get update")
      assert.notEqual(cleanupIndex, -1, `missing inherited source cleanup in ${path}`)
      assert.ok(cleanupIndex < updateIndex, `source cleanup must precede apt update in ${path}`)
    }
  }
})

test("Codex ci-check defaults to PatchRaptor while preserving the scheduled latest package path", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const ciCheck = section(
    pipeline,
    "async ciCheck(",
    "async releaseMetadata(",
  )
  const codexBuild = section(
    pipeline,
    "private async buildCodexDesktopLinuxOfficialArtifact",
    "private async buildChatgptArtifacts",
  )

  assert.match(ciCheck, /const ciConversionCommit = codexDesktopConversionCommit \|\| "patchraptor-main"/)
  assert.match(ciCheck, /buildCodexDesktopLinuxOfficialArtifact\([\s\S]*ciConversionCommit/)
  assert.match(codexBuild, /if \(packageSource === "latest"\)/)
  assert.match(codexBuild, /upstream-linux-package\.js/)
})

test("CI workflows forward the existing GitHub token as a Dagger secret reference", () => {
  for (const path of [".github/workflows/tap-ci.yml"]) {
    const workflow = read(path)
    assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/)
    const ciCommands = [...workflow.matchAll(/call: >-\n(          ci-check\n(?:          [^\n]+\n)*)/g)]
    assert.ok(ciCommands.length > 0, `missing ci-check command in ${path}`)
    for (const [, command] of ciCommands) {
      const tokenArguments = command.split(/\s+/).filter((value) => value.startsWith("--github-token"))
      assert.deepEqual(tokenArguments, ["--github-token=env://GH_TOKEN"], path)
    }
  }
})

test("manual runs use the standard tap pipeline for package actions", () => {
  const workflow = read(".github/workflows/tap-manual.yml")
  assert.match(workflow, /name: \$\{\{ inputs\.package_id \}\} \(\$\{\{ inputs\.action \}\}\)/)
  assert.match(workflow, /module: \.\/dagger\/tap-pipeline/)
  assert.match(workflow, /ci-check --package-id=.*GH_TOKEN/)
})

test("independent auto-update slots queue without canceling builds and publication is serialized", () => {
  const workflow = read(".github/workflows/tap-auto-update.yml")

  assert.match(workflow, /group: tap-auto-update-.*inputs\.slot_id.*github\.event\.schedule/)
  assert.doesNotMatch(workflow, /cancel-in-progress: true/)
  assert.match(workflow, /  publish:[\s\S]*concurrency:\n      group: tap-publish[\s\S]*queue: max/)
  assert.match(workflow, /  build:\n    needs: resolve\n    if: needs\.resolve\.outputs\.has_packages == 'true'\n    name: Build \$\{\{ matrix\.package_id \}\} Bundle\n    runs-on: ubuntu-latest\n    timeout-minutes: 60/)
})

test("Codex MemoryD slot uses the four-platform native builder instead of Dagger release bundles", () => {
  const scheduler = read(".github/workflows/tap-auto-update.yml")
  const builder = read(".github/workflows/codex-memoryd-update.yml")
  assert.match(scheduler, /- codex-memoryd-daily/)
  assert.match(scheduler, /inputs\.slot_id != 'codex-memoryd-daily'/)
  assert.match(scheduler, /uses: \.\/\.github\/workflows\/codex-memoryd-update\.yml/)
  for (const target of ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "x86_64-apple-darwin", "aarch64-apple-darwin"]) {
    assert.ok(builder.includes(`target: ${target}`))
  }
  assert.match(builder, /ref: \$\{\{ needs\.resolve\.outputs\.commit \}\}/)
  assert.match(builder, /cargo test --locked/)
  assert.match(builder, /group: tap-publish/)
  assert.match(builder, /commits\/master --jq \.sha\)" = "\$SOURCE_COMMIT"/)
  assert.match(builder, /cmp "\$artifact"/)
  assert.doesNotMatch(builder, /--clobber/)
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const tags = section(pipeline, "private expectedTapReleaseTag", "private async tapReleaseExists")
  assert.match(tags, /case "codex-memoryd":\s*return `codex-memoryd-\$\{version\}`/)
})
