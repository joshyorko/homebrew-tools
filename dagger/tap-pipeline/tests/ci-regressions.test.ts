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

test("superseded auto-update runs are canceled and bundle jobs are time-bounded", () => {
  const workflow = read(".github/workflows/tap-auto-update.yml")

  assert.match(workflow, /concurrency:\n  group: tap-auto-update-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/)
  assert.match(workflow, /  build:\n    needs: resolve\n    if: needs\.resolve\.outputs\.has_packages == 'true'\n    name: Build \$\{\{ matrix\.package_id \}\} Bundle\n    runs-on: ubuntu-latest\n    timeout-minutes: 60/)
})
