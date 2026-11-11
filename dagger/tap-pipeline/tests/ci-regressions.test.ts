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
  const devpodCi = section(pipeline, 'case "devpod-linux": {', 'case "t3code-cli-main": {')

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

test("T3 builds inject one shared audited public Connect config before compilation", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const cliBuild = section(pipeline, "private async buildT3Artifact", "private async buildFizzyArtifact")
  const desktopBuild = section(pipeline, "private async buildT3CodeArtifact", "private async buildHeadroomArtifact")

  for (const build of [cliBuild, desktopBuild]) {
    assert.match(build, /this\.withT3PublicConnectConfig\(/)
    assert.match(build, /t3PublicConnectDriftGuardCommand\(\)/)
    assert.ok(
      build.indexOf("withT3PublicConnectConfig") < build.indexOf('.withExec(["pnpm", "install"'),
      "public Connect config must be applied before dependency installation",
    )
    assert.ok(
      build.indexOf("t3PublicConnectDriftGuardCommand()") < build.indexOf('.withExec(["pnpm", "install"'),
      "the drift guard must run before dependency installation",
    )
    assert.doesNotMatch(build, /T3CODE_CLERK_PUBLISHABLE_KEY/)
  }
})

test("T3 CLI checks its service protection patch and tests before bundling", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const build = section(pipeline, "private async buildT3Artifact", "private async buildFizzyArtifact")
  const check = build.indexOf("git -C /upstream apply --check /tap/patches/t3-homebrew-service-protect.patch")
  const apply = build.indexOf("git -C /upstream apply /tap/patches/t3-homebrew-service-protect.patch")
  const tests = build.indexOf('"src/cloud/serviceProtectionTarget.test.ts"')
  const bundle = build.indexOf('"build:bundle"')
  assert.ok(check >= 0 && check < apply && apply < tests && tests < bundle)
  assert.match(build, /"src\/cloud\/serviceProtection\.test\.ts"/)
  assert.match(build, /"src\/cli\/service\.test\.ts"/)
  assert.match(build, /"pnpm", "--dir", "apps\/server", "exec", "vp", "test", "run"/)
  const patchPaths = Array.from(read("patches/t3-homebrew-service-protect.patch").matchAll(/^\+\+\+ b\/(.+)$/gm), (match) => match[1] ?? "")
  assert.ok(patchPaths.length > 0 && patchPaths.every((path) => path.startsWith("apps/server/src/")), "Dependency changes must apply before pnpm install")
  const desktop = section(pipeline, "private async buildT3CodeArtifact", "private async buildHeadroomArtifact")
  assert.doesNotMatch(desktop, /t3-homebrew-service-protect\.patch/)
})

test("T3 Desktop build packages its Homebrew updater patch and helper before compilation", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const desktopBuild = section(pipeline, "private async buildT3CodeArtifact", "private async buildHeadroomArtifact")
  const injectUpdater = desktopBuild.indexOf("git -C /upstream apply --check /tap/patches/t3-homebrew-desktop-update.patch")
  const injectServiceAttach = desktopBuild.indexOf("git -C /upstream apply --check /tap/patches/t3-homebrew-service-attach.patch")
  const installHelper = desktopBuild.indexOf("install -m 0755 /tap/scripts/t3-homebrew-update.sh")
  const updateTests = desktopBuild.indexOf('"apps/desktop/src/updates/HomebrewDesktopUpdateProvider.test.ts"')
  const serviceOwnerTests = desktopBuild.indexOf('"apps/desktop/src/backend/HomebrewServiceOwnership.test.ts"')
  const installDependencies = desktopBuild.indexOf('.withExec(["pnpm", "install", "--frozen-lockfile"])')
  const buildAppImage = desktopBuild.indexOf('"dist:desktop:linux"')
  const upstreamPatch = read("patches/t3-homebrew-desktop-update.patch")

  assert.notEqual(injectUpdater, -1)
  assert.notEqual(injectServiceAttach, -1)
  assert.notEqual(installHelper, -1)
  assert.notEqual(updateTests, -1)
  assert.notEqual(serviceOwnerTests, -1)
  assert.notEqual(buildAppImage, -1)
  assert.ok(installHelper < installDependencies, "the helper must be staged before packaging")
  assert.ok(injectUpdater < injectServiceAttach && injectServiceAttach < installDependencies, "the service patch must apply after the lifecycle patch and before compilation")
  assert.ok(installDependencies < updateTests && updateTests < serviceOwnerTests && serviceOwnerTests < buildAppImage, "focused Homebrew tests must pass before AppImage packaging")
  assert.match(upstreamPatch, /Homebrew/)
  assert.match(upstreamPatch, /t3-homebrew-update\.sh/)
  assert.doesNotMatch(upstreamPatch, /\.setFeedURL\(/)
  assert.doesNotMatch(upstreamPatch, /provider:\s*["']generic["']/)
  const serviceAttachPatch = read("patches/t3-homebrew-service-attach.patch")
  assert.match(serviceAttachPatch, /Homebrew T3 service is already running/)
  assert.match(serviceAttachPatch, /serverEnvironmentId/)
})

test("T3 acceptance proves compiled Connect in the CLI and the shipped Desktop app", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const cliCi = section(pipeline, 'case "t3code-cli-main": {', 'case "chatgpt": {')
  const desktopCi = section(pipeline, 'case "t3-code-linux": {', 'case "headroom-self-hosted": {')

  assert.match(cliCi, /t3CliConnectGateChecks\(\)/)
  assert.match(desktopCi, /t3PublicConnectAsarChecks\(\)/)
})

test("T3 release bundles reuse one immutable source ref and version across CI and packaging", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const resolver = section(pipeline, "async resolveT3Source(", "private setGithubToken(")
  const releaseBundle = section(pipeline, "async releaseBundle(", "async recoveryExport(")

  assert.match(resolver, /resolveGitHeadVersion\(entry\.upstream\.repo, entry\.autoUpdate\.ref/)
  assert.match(releaseBundle, /selectedT3SourceRef = resolved\.commit/)
  assert.match(releaseBundle, /selectedT3SourceVersion = resolved\.version/)
  assert.match(releaseBundle, /selectedT3SourceVersion\?\.endsWith/)
  assert.match(releaseBundle, /selectedT3SourceRef,\s*selectedT3SourceVersion,/)
  assert.match(releaseBundle, /buildT3Artifact\(tap, selectedT3SourceRef!, selectedT3SourceVersion\)/)
  assert.match(releaseBundle, /buildT3CodeArtifact\(tap, selectedT3SourceRef!, selectedT3SourceVersion\)/)
})

test("T3 auto-update slots build and validate CLI/Desktop as one source pair", () => {
  const slots = JSON.parse(read("dagger/tap-pipeline/auto-update-slots.json")) as Array<{
    id: string
    packageIds: string[]
  }>
  const workflow = read(".github/workflows/tap-auto-update.yml")
  const publish = section(workflow, "  publish:", "  no_updates_required:")

  for (const slotId of ["t3-daily", "t3-code-6h"]) {
    const slot = slots.find((candidate) => candidate.id === slotId)
    assert.deepEqual(slot?.packageIds, ["t3code-cli-main", "t3-code-linux"])
  }
  assert.match(workflow, /Resolve shared T3 source/)
  assert.match(workflow, /PACKAGE_IDS_JSON='\["t3code-cli-main","t3-code-linux"\]'/)
  assert.match(workflow, /call: resolve-t-3-source --github-token=env:\/\/GH_TOKEN/)
  assert.match(workflow, /--t-3-source-ref=.*--t-3-source-version=/)
  assert.match(publish, /cli_commit.*desktop_commit.*T3_SOURCE_COMMIT/)
  assert.ok(
    publish.indexOf("T3 CLI/Desktop source metadata mismatch") < publish.indexOf("for package_id"),
    "paired metadata must be validated before either release is published",
  )
})

test("T3 PR acceptance resolves one source for both package checks", () => {
  const workflow = read(".github/workflows/tap-ci.yml")
  const pairedAcceptance = section(workflow, "  t3-paired-acceptance:", "  ci:")

  assert.match(pairedAcceptance, /call: resolve-t-3-source --github-token=env:\/\/GH_TOKEN/)
  for (const packageId of ["t3code-cli-main", "t3-code-linux"]) {
    const start = pairedAcceptance.indexOf(`--package-id="${packageId}"`)
    assert.notEqual(start, -1, `missing paired acceptance for ${packageId}`)
    const end = packageId === "t3code-cli-main"
      ? pairedAcceptance.indexOf('--package-id="t3-code-linux"', start)
      : pairedAcceptance.length
    assert.notEqual(end, -1, `missing Desktop acceptance after ${packageId}`)
    const packageCheck = pairedAcceptance.slice(start, end)
    assert.match(packageCheck, /--t-3-source-ref="\$\{\{ fromJSON\(steps\.t3_source\.outputs\.output\)\.commit \}\}"/)
    assert.match(packageCheck, /--t-3-source-version="\$\{\{ fromJSON\(steps\.t3_source\.outputs\.output\)\.version \}\}"/)
  }
})

test("T3 CLI package CI executes the resource monitor, formula test, and isolated help command", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const cliCi = section(pipeline, 'case "t3code-cli-main": {', 'case "chatgpt": {')

  assert.match(cliCi, /test -x.*monitor/)
  assert.match(cliCi, /brew test test\/tap\/t3code-cli-main/)
  assert.match(cliCi, /t3 --help/)
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

test("T3 Desktop builder installs Electron runtime libraries before packaging", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const desktopBuild = section(pipeline, "private async buildT3CodeArtifact", "private async buildHeadroomArtifact")
  const installIndex = desktopBuild.indexOf("apt-get install")
  const buildIndex = desktopBuild.indexOf('"dist:desktop:linux"')

  for (const library of ["libnspr4", "libnss3", "libgtk-3-0", "libgbm1", "libasound2"]) {
    assert.ok(desktopBuild.includes(library), `Desktop compile-cache generation needs ${library}`)
  }
  assert.ok(installIndex >= 0 && installIndex < buildIndex, "Electron libraries must be available when the build runs its compile-cache hook")
})

test("T3 packaging stages only upstream runtime externals and preserves its patch and override", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "t3-package-test-"))
  try {
    const upstream = join(tempRoot, "upstream")
    const serverDist = join(upstream, "apps/server/dist")
    mkdirSync(join(serverDist, "client"), { recursive: true })
    mkdirSync(join(upstream, "scripts/lib"), { recursive: true })
    writeFileSync(
      join(upstream, "scripts/lib/cli-external-packages.ts"),
      [
        "const externalPackages = [\"@ff-labs/fff-node\", \"node-pty\", \"undici\"]",
        "export function selectCliRuntimeExternalDependencies(dependencies) {",
        "  return Object.fromEntries(Object.entries(dependencies).filter(([name]) => externalPackages.includes(name)))",
        "}",
        "",
      ].join("\n"),
    )
    writeFileSync(join(upstream, "package.json"), '{"type":"module"}\n')
    writeFileSync(join(upstream, "LICENSE"), "MIT\n")
    writeFileSync(join(upstream, "README.md"), "T3\n")
    writeFileSync(join(serverDist, "bin.mjs"), "#!/usr/bin/env node\n")
    writeFileSync(join(serverDist, "client/index.html"), "<!doctype html>\n")
    writeFileSync(
      join(upstream, "pnpm-workspace.yaml"),
      [
        "catalog:",
        "  \"@effect/platform-bun\": 4.0.0-rc.112",
        "  \"@effect/platform-node\": 4.0.0-rc.112",
        "  \"@effect/sql-sqlite-bun\": 4.0.0-rc.112",
        "  effect: 4.0.0-rc.112",
        "  undici: 7.0.0",
        "",
        "overrides:",
        "  # Move this with @react-navigation/native: an older core than it requires crashes",
        "  # every native stack at launch.",
        '  "undici": "catalog:"',
        "  node-abi: 4.33.0",
        "  node-pty>node-abi: 4.33.0",
        '  "@ff-labs/fff-node": 0.9.4',
        '  "@ff-labs/fff-node>node-abi": 4.33.0',
        "  unused>removed: -",
        "",
        "patchedDependencies:",
        '  "@ff-labs/fff-node@0.9.4": patches/fff-node.patch',
        "  node-pty@1.2.0-beta.15: patches/node-pty.patch",
        "",
      ].join("\n"),
    )
    mkdirSync(join(upstream, "patches"), { recursive: true })
    writeFileSync(
      join(upstream, "patches/fff-node.patch"),
      [
        "diff --git a/package.json b/package.json",
        "--- a/package.json",
        "+++ b/package.json",
        "@@ -1 +1 @@",
        '-{"exports":{".":{"import":"./index.js"}}}',
        '+{"exports":{".":{"import":"./index.js","require":"./index.js"}}}',
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(upstream, "patches/node-pty.patch"),
      [
        "diff --git a/package.json b/package.json",
        "--- a/package.json",
        "+++ b/package.json",
        "@@ -1 +1 @@",
        '-{"exports":{".":{"import":"./index.js"}}}',
        '+{"exports":{".":{"import":"./index.js","require":"./index.js"}}}',
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(upstream, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "  '@effect/platform-node-shared@4.0.0-rc.112':",
        "    resolution: {integrity: sha512-test}",
        "  '@ff-labs/fff-node@0.9.4':",
        "    resolution: {integrity: sha512-test}",
        "  node-pty@1.3.0:",
        "    resolution: {integrity: sha512-test}",
        "  node-pty@1.2.0-beta.15:",
        "    resolution: {integrity: sha512-test}",
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(upstream, "apps/server/package.json"),
      JSON.stringify({
        name: "t3",
        bin: { t3: "./dist/bin.mjs" },
        dependencies: {
          "@ff-labs/fff-node": "0.9.4",
          "internal-workspace-package": "workspace:*",
          "node-pty": "^1.2.0-beta.15",
          undici: "catalog:",
          "@effect/platform-bun": "catalog:",
          "@effect/platform-node": "catalog:",
          "@effect/sql-sqlite-bun": "catalog:",
          effect: "catalog:",
        },
      }),
    )

    const observedManifest = join(tempRoot, "observed-package.json")
    const npmStub = join(tempRoot, "npm")
    writeFileSync(
      npmStub,
      [
        "#!/usr/bin/env node",
        "const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')",
        "const { join } = require('node:path')",
        "const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))",
        "if (process.argv.includes('--package-lock-only')) {",
        "  writeFileSync(process.env.OBSERVED_MANIFEST, JSON.stringify(manifest))",
        "  writeFileSync(join(process.cwd(), 'package-lock.json'), '{}\\n')",
        "}",
        "if (process.argv.includes('ci')) {",
        "  for (const name of Object.keys(manifest.dependencies)) {",
        "    const dependency = join(process.cwd(), 'node_modules', ...name.split('/'))",
        "    mkdirSync(dependency, { recursive: true })",
        "    writeFileSync(join(dependency, 'package.json'), '{\\\"exports\\\":{\\\".\\\":{\\\"import\\\":\\\"./index.js\\\"}}}\\n')",
        "  }",
        "}",
        "",
      ].join("\n"),
      { mode: 0o755 },
    )
    chmodSync(npmStub, 0o755)

    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(repoRoot.pathname, "scripts/package-t3code-cli-main.mjs"),
        "--upstream-dir",
        upstream,
        "--version",
        "main.test",
        "--output",
        join(tempRoot, "package.tar.gz"),
      ],
      {
        env: {
          ...process.env,
          PATH: `${tempRoot}:${process.env.PATH}`,
          OBSERVED_MANIFEST: observedManifest,
        },
        stdio: "pipe",
      },
    )

    const manifest = JSON.parse(readFileSync(observedManifest, "utf8"))
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["@ff-labs/fff-node", "node-pty", "undici"])
    assert.equal(manifest.dependencies.undici, "7.0.0")
    assert.ok(Object.values(manifest.dependencies).every((version) => !version.startsWith("workspace:")))
    assert.equal(manifest.overrides.undici, "7.0.0")
    assert.equal(Object.hasOwn(manifest.overrides, "# Move this with @react-navigation/native"), false)
    assert.equal(manifest.overrides["node-pty"]["node-abi"], "4.33.0")
    assert.equal(manifest.overrides["@ff-labs/fff-node"]["."], "0.9.4")
    assert.equal(manifest.overrides["@ff-labs/fff-node"]["node-abi"], "4.33.0")
    assert.equal(manifest.overrides["node-abi"], "4.33.0")
    assert.equal(manifest.overrides.unused, undefined)
    assert.equal(manifest.overrides["@effect/platform-node-shared"], "4.0.0-rc.112")
    assert.equal(manifest.dependencies["node-pty"], "1.2.0-beta.15")

    const unpacked = join(tempRoot, "unpacked")
    mkdirSync(unpacked)
    execFileSync("tar", ["-xzf", join(tempRoot, "package.tar.gz"), "-C", unpacked])
    const patchedDependency = JSON.parse(
      readFileSync(join(unpacked, "node_modules/@ff-labs/fff-node/package.json"), "utf8"),
    )
    assert.equal(patchedDependency.exports["."].require, "./index.js")
    const patchedNativeDependency = JSON.parse(
      readFileSync(join(unpacked, "node_modules/node-pty/package.json"), "utf8"),
    )
    assert.equal(patchedNativeDependency.exports["."].require, "./index.js")
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
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

test("T3 source acceptance trusts each isolated fixture before audit and checks the packaged helper", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  for (const [id, kind, end] of [
    ["t3code-cli-main", "formula", 'case "chatgpt": {'],
    ["t3-code-linux", "cask", 'case "headroom-self-hosted": {'],
  ]) {
    const source = section(pipeline, `case "${id}": {`, end)
    const trust = source.indexOf(`brew trust --${kind} test/tap/${id}`)
    const audit = source.indexOf(`brew audit --${kind} test/tap/${id}`)
    assert.ok(trust >= 0 && audit > trust, `${id} must be trusted before Homebrew loads it for audit`)
    assert.doesNotMatch(source, /HOMEBREW_NO_REQUIRE_TAP_TRUST/)
  }
  assert.match(pipeline, /test -x.*app_dir\/resources\/t3-homebrew-update\.sh/)
})

test("T3 Desktop immutable URLs retain audit-visible version interpolation and checksums", () => {
  const cask = read("Casks/t3-code-linux.rb")
  const version = cask.match(/version "([^"]+)"/)?.[1]
  const url = cask.match(/url "([^"]+)"/)?.[1]
  assert.ok(version && url)
  assert.match(url, /t3-code-linux-#\{version\}\/T3-Code-#\{version\}-#\{arch\}\.AppImage$/)
  assert.equal(url.replaceAll("#{version}", version).replace("#{arch}", "x86_64"),
    `https://github.com/joshyorko/homebrew-tools/releases/download/t3-code-linux-${version}/T3-Code-${version}-x86_64.AppImage`)
  assert.match(cask, /sha256 x86_64_linux: "[0-9a-f]{64}"/)
  const renderer = section(read("dagger/tap-pipeline/src/index.ts"), "private renderT3CodeCask", "/** Install an unpublished")
  assert.match(renderer, /downloadUrl\.replaceAll\(version, "#\{version\}"\)/)
  assert.doesNotMatch(renderer, /sha256.*:no_check.*`sha256.*:no_check/)
})

test("T3 Desktop embeds and verifies Homebrew identity independently of Electron semver", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const build = section(pipeline, "private async buildT3CodeArtifact", "private async buildHeadroomArtifact")
  assert.match(build, /withNewFile\("\/upstream\/apps\/desktop\/resources\/t3-homebrew-build\.json", JSON\.stringify\(\{ packageVersion: resolvedVersion, sourceCommit: commit \}\)\)/)
  const patch = read("patches/t3-homebrew-desktop-update.patch")
  assert.match(patch, /homebrewUpdateProvider\.check\(homebrewPackageVersion\)/)
  assert.match(patch, /appVersion: "0\.1\.7"/)
  assert.match(patch, /to: "t3-homebrew-build\.json"/)
  assert.match(pipeline, /value\.packageVersion !== process\.argv\[2\].*value\.sourceCommit !== process\.argv\[3\]/)
})
