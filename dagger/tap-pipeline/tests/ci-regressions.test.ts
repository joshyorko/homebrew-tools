import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

test("T3 desktop disables V8 functions without changing the CLI builder", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const cliBuild = section(
    pipeline,
    "private async buildT3Artifact",
    "private async buildCodexDesktopLinuxOfficialArtifact",
  )
  const desktopBuild = section(
    pipeline,
    "private async buildT3CodeArtifact",
    "private async buildHeadroomArtifact",
  )

  assert.match(desktopBuild, /this\.t3BaseContainer\(\)\s*\.withEnvVariable\("ENABLE_V8_FUNCTIONS", "false"\)/)
  assert.ok(
    desktopBuild.indexOf('withEnvVariable("ENABLE_V8_FUNCTIONS", "false")')
      < desktopBuild.indexOf('.withExec(["pnpm", "install"'),
    "desktop rebuild env must be set before dependency installation",
  )
  assert.doesNotMatch(cliBuild, /ENABLE_V8_FUNCTIONS/)
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

test("T3 base installs libsecret development metadata and verifies it before dependent builds", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const t3Base = section(
    pipeline,
    "private t3BaseContainer()",
    "private codexDesktopBaseContainer",
  )

  const installIndex = t3Base.indexOf("apt-get install")
  const checkIndex = t3Base.indexOf("pkg-config --exists libsecret-1")
  const bunInstallIndex = t3Base.indexOf("curl -fsSL https://bun.sh/install")

  assert.match(t3Base, /libsecret-1-dev/)
  assert.match(t3Base, /pkg-config/)
  assert.notEqual(checkIndex, -1, "T3 base must verify the libsecret pkg-config module")
  assert.ok(installIndex < checkIndex, "libsecret verification must follow package installation")
  assert.ok(checkIndex < bunInstallIndex, "libsecret verification must happen before tool setup continues")
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
  for (const path of [".github/workflows/tap-ci.yml", ".github/workflows/tap-manual.yml"]) {
    const workflow = read(path)
    assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/)
    const ciCommands = [...workflow.matchAll(/call: >-\n(          ci-check\n(?:          [^\n]+\n)*)/g)]
    assert.ok(ciCommands.length > 0, `missing ci-check command in ${path}`)
    for (const [, command] of ciCommands) {
      const tokenArguments = command.split(/\s+/).filter((value) => value.startsWith("--github-token"))
      assert.deepEqual(tokenArguments, ["--github-token=env://GH_TOKEN"], path)
    }
    const buzzCi = workflow.split("- name: Run Buzz Linux CI through Dagger")[1]?.split("- name:")[0]
    assert.ok(buzzCi, `missing direct Buzz CI step in ${path}`)
    assert.doesNotMatch(buzzCi, /--github-token/)
  }
})

test("superseded auto-update runs are canceled and bundle jobs are time-bounded", () => {
  const workflow = read(".github/workflows/tap-auto-update.yml")

  assert.match(workflow, /concurrency:\n  group: tap-auto-update-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/)
  assert.match(workflow, /  build:\n    needs: resolve\n    if: needs\.resolve\.outputs\.has_packages == 'true'\n    name: Build \$\{\{ matrix\.package_id \}\} Bundle\n    runs-on: ubuntu-latest\n    timeout-minutes: 60/)
})
