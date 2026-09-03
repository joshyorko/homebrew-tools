import { dag, CacheSharingMode, Container, Directory, File, Secret, argument, object, func } from "@dagger.io/dagger"
import { existsSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import {
  changedCiPackagesFromPaths,
  codexDesktopBuildVersion,
  listAutoUpdateSlots as slotSummaries,
  packageSummaries,
  packagedVersionForUpstreamComparison,
  parseDebianPackageVersion,
  parseAutoUpdateSlotId,
  parseRecoveryBrewfile,
  packagesForAutoUpdateSlot as slotPackages,
  recoveryBrewfile,
  recoveryHomebrewContents,
  recoveryPackageSummaries,
  formatGitHeadVersion,
  isTransientUpstreamProbeError,
  dictationManifest,
  releaseMetadataForPackage,
  renderLocalFormula,
  selectLatestStableRelease,
  TransientUpstreamProbeError,
} from "./library.js"
import { rewriteCaskUrl } from "./cask-render.js"
import {
  DevsyRelease,
  DevsyReleaseAsset,
  renderDevsyDesktopCask,
  renderDevsyFormula,
  resolveStableDevsyRelease,
  verifyDevsyGithubDigest,
} from "./devsy-render.js"
import { renderGithubApiFetchScript } from "./github-api.js"
import { renderAssetDownloadScript } from "./asset-download.js"

const TAP_DIR = "/tap"
const BREW_IMAGE = "homebrew/brew:latest"
const NODE_IMAGE = "node:24-bookworm"
const NODE_25_IMAGE = "node:25-bookworm"
const PYTHON_IMAGE = "python:3.13-bookworm"
const GO_IMAGE = "golang:1.26-bookworm"
const RUST_IMAGE = "rust:1-bookworm"
const ONNX_BUILD_IMAGE = "ubuntu:24.04"
const TAP_REPOSITORY = "joshyorko/homebrew-tools"
const GITHUB_AUTH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
const CODEX_DESKTOP_CONVERSION_REPO =
  process.env.CODEX_DESKTOP_CONVERSION_REPO || "https://github.com/joshyorko/codex-desktop-linux"
const CODEX_DESKTOP_CONVERSION_COMMIT =
  process.env.CODEX_DESKTOP_CONVERSION_COMMIT || readDefaultCodexDesktopConversionRef()
const CODEX_DESKTOP_PACKAGE_SOURCE = process.env.CODEX_DESKTOP_PACKAGE_SOURCE || "pinned"
const LEAN_CODEX_DESKTOP_LINUX_FEATURES = [
  "computer-use-linux",
  "node-repl-reaper",
  "read-aloud",
  "read-aloud-mcp",
  "chronicle-skysight",
  "record-and-replay",
]
const FULL_CODEX_DESKTOP_LINUX_FEATURES = [
  "agent-workspace",
  "api-key-model-visibility",
  "api-key-service-tier",
  "appshots",
  "authenticated-proxy",
  "automation-extensions",
  "chronicle-skysight",
  "computer-use-linux",
  "copilot-reasoning-effort",
  "directory-only-working-tree-watch",
  "frameless-titlebar",
  "global-dictation",
  "mcp-helper-reaper",
  "node-repl-reaper",
  "omarchy-theme",
  "persistent-status-panel",
  "pet-overlay",
  "project-group-last-updated-sort",
  "project-task-sort",
  "read-aloud",
  "read-aloud-mcp",
  "record-and-replay",
  "remote-control-ui",
  "remote-mobile-control",
  "shared-app-server-socket",
  "ui-tweaks",
]
const DEFAULT_CODEX_DESKTOP_LINUX_FEATURES = FULL_CODEX_DESKTOP_LINUX_FEATURES
const CODEX_DESKTOP_LINUX_FEATURES = process.env.CODEX_DESKTOP_LINUX_FEATURES === undefined
  ? DEFAULT_CODEX_DESKTOP_LINUX_FEATURES
  : parseLinuxFeatureList(process.env.CODEX_DESKTOP_LINUX_FEATURES)

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readDefaultCodexDesktopConversionRef(): string {
  const refFile = new URL("../../../codex-desktop-conversion.ref", import.meta.url)
  if (!existsSync(refFile)) {
    return "self-hosted"
  }

  const ref = readFileSync(refFile, "utf8")
    .split("\n")
    .map((line) => line.replace(/\s*#.*/, "").trim())
    .find((line) => line.length > 0)

  return ref ?? "self-hosted"
}

function parseTextLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function parseLinuxFeatureList(value: string): string[] {
  const normalized = value.trim().toLowerCase()
  if (normalized === "lean") {
    return [...LEAN_CODEX_DESKTOP_LINUX_FEATURES]
  }
  if (normalized === "full") {
    return [...FULL_CODEX_DESKTOP_LINUX_FEATURES]
  }
  if (normalized === "none") {
    return []
  }
  return value
    .split(/[\s,]+/)
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0)
}

function codexDesktopLinuxFeatureList(value?: string): string[] {
  return value === undefined ? CODEX_DESKTOP_LINUX_FEATURES : parseLinuxFeatureList(value)
}

function codexDesktopConversionCommit(value?: string): string {
  return value && value.length > 0 ? value : CODEX_DESKTOP_CONVERSION_COMMIT
}

function codexDesktopPackageSource(value?: string): "pinned" | "latest" {
  const source = (value && value.length > 0 ? value : CODEX_DESKTOP_PACKAGE_SOURCE).trim().toLowerCase()
  if (source !== "pinned" && source !== "latest") {
    throw new Error(`Unsupported Codex Desktop Linux package source '${source}'; expected pinned or latest`)
  }
  return source
}

function stripRequiredPrefix(value: string, prefix?: string): string {
  if (!prefix) {
    return value
  }

  if (!value.startsWith(prefix)) {
    throw new Error(`Expected ${value} to start with ${prefix}`)
  }

  return value.slice(prefix.length)
}

function githubApiRepoUrl(repoUrl: string): string {
  return repoUrl.replace("https://github.com/", "https://api.github.com/repos/")
}

function tapStagingCommands(packageId: string): string[] {
  switch (packageId) {
    case "rcc":
      return [
        "mkdir -p \"$tap_dir/Casks\"",
        "cp /tap/Casks/rcc.rb \"$tap_dir/Casks/\"",
      ]
    case "action-server":
      return [
        "mkdir -p \"$tap_dir/Casks\"",
        "cp /tap/Casks/action-server.rb \"$tap_dir/Casks/\"",
      ]
    case "devpod-linux":
      return [
        "mkdir -p \"$tap_dir/Casks\" \"$tap_dir/Formula\"",
        "cp /tap/Casks/devpod-linux.rb \"$tap_dir/Casks/\"",
        "cp /tap/Formula/devpod-appindicator-runtime-tools.rb \"$tap_dir/Formula/\"",
      ]
    case "t3code-cli-main":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/t3code-cli-main.rb \"$tap_dir/Formula/\"",
      ]
    case "antigravity-cli":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/antigravity-cli.rb \"$tap_dir/Formula/\"",
      ]
    case "chatgpt":
      return [
        "mkdir -p \"$tap_dir/Casks\"",
        "cp /tap/Casks/chatgpt.rb \"$tap_dir/Casks/\"",
      ]
    case "devsy":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/devsy.rb \"$tap_dir/Formula/\"",
      ]
    case "devsy-desktop":
      return [
        "mkdir -p \"$tap_dir/Casks\" \"$tap_dir/Formula\"",
        "cp /tap/Casks/devsy-desktop.rb \"$tap_dir/Casks/\"",
        "cp /tap/Formula/devsy.rb \"$tap_dir/Formula/\"",
      ]
    case "fizzy-cli-master":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/fizzy-cli-master.rb \"$tap_dir/Formula/\"",
      ]
    case "fizzy-popper-self-hosted":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/fizzy-popper-self-hosted.rb \"$tap_dir/Formula/\"",
      ]
    case "fizzy-symphony":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/fizzy-symphony.rb \"$tap_dir/Formula/\"",
      ]
    case "t3-code-linux":
      return [
        "mkdir -p \"$tap_dir/Casks\"",
        "cp /tap/Casks/t3-code-linux.rb \"$tap_dir/Casks/\"",
      ]
    case "codex-desktop-linux":
      return [
        "mkdir -p \"$tap_dir/Casks\"",
        "cp /tap/Casks/codex-desktop.rb \"$tap_dir/Casks/\"",
      ]
    case "headroom-self-hosted":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/headroom-self-hosted.rb \"$tap_dir/Formula/\"",
      ]
    case "vscode-insiders-linux":
      return [
        "mkdir -p \"$tap_dir/Casks\"",
        "cp /tap/Casks/vscode-insiders-linux.rb \"$tap_dir/Casks/\"",
      ]
    case "voxtype":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/voxtype.rb \"$tap_dir/Formula/\"",
      ]
    case "eitype":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/eitype.rb \"$tap_dir/Formula/\"",
      ]
    default:
      throw new Error(`tapStagingCommands is not implemented for package: ${packageId}`)
  }
}

async function gitChangedFiles(source: Directory, gitDir: Directory, baseRef: string, headRef: string): Promise<string[]> {
  const output = await dag
    .container()
    .from(NODE_IMAGE)
    .withExec([
      "bash",
      "-lc",
      "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*",
    ])
    .withMountedDirectory(TAP_DIR, source)
    .withMountedDirectory(`${TAP_DIR}/.git`, gitDir)
    .withWorkdir(TAP_DIR)
    .withExec([
      "bash",
      "-lc",
      [
        "set -euo pipefail",
        `if git merge-base "${baseRef}" "${headRef}" >/dev/null 2>&1; then`,
        `  git diff --name-only "${baseRef}...${headRef}"`,
        "else",
        `  git diff --name-only "${baseRef}" "${headRef}"`,
        "fi",
      ].join("\n"),
    ])
    .stdout()

  return parseTextLines(output)
}

type T3Build = {
  artifactPath: string
  assetName: string
  commit: string
  container: Container
  version: string
}

type FizzyBuild = {
  artifactPath: string
  assetName: string
  commit: string
  container: Container
  version: string
}

type FizzyPopperSelfHostedBuild = {
  artifactPath: string
  assetName: string
  commit: string
  container: Container
  version: string
}

type FizzySymphonyBuild = {
  artifactPath: string
  assetName: string
  commit: string
  container: Container
  version: string
}

type GitCommitApiResponse = {
  sha: string
  commit?: {
    author?: {
      date?: string
    }
    committer?: {
      date?: string
    }
  }
}

type VscodeBuild = {
  artifactPath: string
  assetName: string
  caskVersion: string
  commitSha: string
  container: Container
  packageVersion: string
  releaseBuild: string
  resolvedUrl: string
}

type VoxtypeBuild = {
  artifactPath: string
  assetName: string
  commit: string
  container: Container
  upstreamTag: string
  version: string
}

type EitypeBuild = {
  artifactPath: string
  assetName: string
  commit: string
  container: Container
  upstreamTag: string
  version: string
}

type DownloadedAsset = {
  assetName: string
  artifactPath: string
  sha256: string
  sourceUrl: string
}

type ChatgptBuild = {
  version: string
  container: Container
  amd64: DownloadedAsset
  arm64: DownloadedAsset
}

type RccBuild = {
  version: string
  container: Container
  linux: DownloadedAsset
  macosArm: DownloadedAsset
  macosIntel: DownloadedAsset
}

type ActionServerBuild = {
  version: string
  upstreamTag: string
  container: Container
  linux: DownloadedAsset
  macosArm: DownloadedAsset
  macosIntel?: DownloadedAsset
}

type DevpodBuild = {
  version: string
  upstreamTag: string
  container: Container
  asset: DownloadedAsset
}

type DevsyCliBuild = {
  version: string
  upstreamTag: string
  upstreamCommit: string
  container: Container
  amd64: DownloadedAsset
  arm64: DownloadedAsset
}

type DevsyDesktopBuild = {
  version: string
  upstreamTag: string
  upstreamCommit: string
  container: Container
  asset: DownloadedAsset
}

type T3CodeBuild = {
  artifactPath: string
  assetName: string
  commit: string
  version: string
  container: Container
  sha256: string
}

type HeadroomBuild = {
  artifactPath: string
  assetName: string
  commit: string
  container: Container
  sha256: string
  sourceRef: string
  treeHash: string
  version: string
}

type CodexDesktopLinuxOfficialBuild = {
  artifactPath: string
  assetName: string
  architecture: string
  buildMode: string
  commit: string
  container: Container
  featureProfileSha256: string
  linuxFeaturesEnabled: string[]
  packageSource: "pinned" | "latest"
  sha256: string
  upstreamPackagePath: string
  upstreamPackageSha256: string
  upstreamPackageUrl: string
  upstreamVersion: string
  version: string
}

type AutoUpdatePackageStatus = {
  id: string
  kind: string
  homebrew_path: string
  current_version: string
  upstream_version: string | null
  current_release_published: boolean
  needs_update: boolean
  skipped?: boolean
  skip_reason?: string
}

@object()
export class TapPipeline {
  source: Directory
  gitDir: Directory
  private githubToken?: Secret

  constructor(
    @argument({ defaultPath: "../.." }) source: Directory,
    @argument({ defaultPath: "../../.git" }) gitDir: Directory,
  ) {
    this.source = source
    this.gitDir = gitDir
  }

  @func()
  async listPackages(): Promise<string> {
    return json(packageSummaries())
  }

  @func()
  async detectChangedPackages(baseRef = "origin/main", headRef = "HEAD"): Promise<string> {
    const files = await gitChangedFiles(this.source, this.gitDir, baseRef, headRef)
    return json(changedCiPackagesFromPaths(files))
  }

  @func()
  async listAutoUpdateSlots(): Promise<string> {
    return json(
      slotSummaries().map((slot) => ({
        id: slot.id,
        description: slot.description,
        package_ids: slot.packageIds,
      })),
    )
  }

  @func()
  async packagesForAutoUpdateSlot(slotId: string): Promise<string> {
    return json(
      slotPackages(parseAutoUpdateSlotId(slotId)).map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        homebrew_path: entry.homebrewPath,
      })),
    )
  }

  @func()
  async autoUpdateStatus(
    slotId: string,
    githubToken?: Secret,
    codexDesktopConversionCommit?: string,
  ): Promise<string> {
    this.setGithubToken(githubToken)

    const entries = slotPackages(parseAutoUpdateSlotId(slotId))
    const statuses = await Promise.all(entries.map(async (entry): Promise<AutoUpdatePackageStatus> => {
      const currentVersion = await this.currentPackagedVersion(entry.id)
      const currentReleasePublished = await this.tapReleaseExists(entry.id, currentVersion)

      let upstreamVersion: string
      try {
        upstreamVersion = await this.resolveUpstreamVersion(entry.id, codexDesktopConversionCommit)
      } catch (error) {
        if (isTransientUpstreamProbeError(error)) {
          return {
            id: entry.id,
            kind: entry.kind,
            homebrew_path: entry.homebrewPath,
            current_version: currentVersion,
            upstream_version: null,
            current_release_published: currentReleasePublished,
            needs_update: false,
            skipped: true,
            skip_reason: error.message,
          }
        }

        throw error
      }

      return {
        id: entry.id,
        kind: entry.kind,
        homebrew_path: entry.homebrewPath,
        current_version: currentVersion,
        upstream_version: upstreamVersion,
        current_release_published: currentReleasePublished,
        needs_update:
          packagedVersionForUpstreamComparison(entry.id, currentVersion) !== upstreamVersion
          || !currentReleasePublished,
      }
    }))

    return json(statuses)
  }

  @func()
  async packagesNeedingAutoUpdate(slotId: string, githubToken?: Secret): Promise<string> {
    const entries = JSON.parse(await this.autoUpdateStatus(slotId, githubToken)) as AutoUpdatePackageStatus[]
    return json(entries.filter((entry) => entry.needs_update).map((entry) => entry.id))
  }

  private setGithubToken(githubToken?: Secret): void {
    if (githubToken) {
      this.githubToken = githubToken
    }
  }

  private packageEntry(packageId: string) {
    const entry = packageSummaries().find((candidate) => candidate.id === packageId)

    if (!entry) {
      throw new Error(`Unknown package: ${packageId}`)
    }

    return entry
  }

  private async currentPackagedVersion(packageId: string): Promise<string> {
    const entry = this.packageEntry(packageId)
    const contents = await this.source.file(entry.homebrewPath).contents()
    const match = contents.match(/^\s*version "([^"]+)"/m)

    if (!match) {
      throw new Error(`Failed to resolve packaged version from ${entry.homebrewPath}`)
    }

    return match[1]
  }

  private expectedTapReleaseTag(packageId: string, version: string): string {
    switch (packageId) {
      case "rcc":
        return `rcc-${version}`
      case "action-server":
        return `action-server-${version}`
      case "chatgpt":
        return `chatgpt-${version}`
      case "devpod-linux":
        return `devpod-linux-${version}`
      case "devsy":
        return `devsy-${version}`
      case "devsy-desktop":
        return `devsy-desktop-${version.split(",", 1)[0]}`
      case "buzz-linux":
        return `buzz-linux-${version.replace(/,/g, "-")}`
      case "t3code-cli-main":
        return `t3code-cli-main-${version}`
      case "fizzy-cli-master":
        return `fizzy-cli-master-${version}`
      case "fizzy-popper-self-hosted":
        return `fizzy-popper-self-hosted-${version}`
      case "fizzy-symphony":
        return `fizzy-symphony-${version}`
      case "t3-code-linux":
        return `t3-code-linux-${version.split(",", 1)[0]}`
      case "codex-desktop-linux":
        return `codex-desktop-linux-${version}`
      case "headroom-self-hosted":
        return `headroom-self-hosted-${version}`
      case "vscode-insiders-linux":
        return `vscode-insiders-linux-${version.replace(/,/g, "-")}`
      case "voxtype":
        return `voxtype-${version}`
      case "eitype":
        return `eitype-${version}`
      default:
        throw new Error(`expectedTapReleaseTag is not implemented for package: ${packageId}`)
    }
  }

  private async tapReleaseExists(packageId: string, version: string): Promise<boolean> {
    const releaseTag = this.expectedTapReleaseTag(packageId, version)
    const url = `https://api.github.com/repos/${TAP_REPOSITORY}/releases/tags/${encodeURIComponent(releaseTag)}`
    const existsScript = renderGithubApiFetchScript()
      .replace(
        "  if (response.ok) {",
        [
          "  if (response.status === 404) {",
          "    await writeStdout(\"false\")",
          "    completed = true",
          "    break",
          "  }",
          "  if (response.ok) {",
        ].join("\n"),
      )
      .replace("    await writeStdout(await response.text())", "    await writeStdout(\"true\")")
    const output = await this.githubApiContainer()
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        existsScript,
        url,
      ])
      .stdout()

    return output.trim() === "true"
  }

  private t3BaseContainer(): Container {
    const rustToolchain = dag.container().from(RUST_IMAGE)

    return dag
      .container()
      .from(NODE_IMAGE)
      .withDirectory("/usr/local/cargo", rustToolchain.directory("/usr/local/cargo"))
      .withDirectory("/usr/local/rustup", rustToolchain.directory("/usr/local/rustup"))
      .withMountedCache(
        "/root/.bun/install/cache",
        dag.cacheVolume("tap-pipeline-bun-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withMountedCache(
        "/root/.npm",
        dag.cacheVolume("tap-pipeline-npm-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withMountedCache(
        "/root/.local/share/pnpm/store",
        dag.cacheVolume("tap-pipeline-pnpm-store-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl fakeroot g++ git imagemagick jq make python3 rpm tar unzip xz-utils && npm install -g node-gyp && corepack enable && corepack prepare pnpm@11.10.0 --activate && rm -rf /var/lib/apt/lists/*",
      ])
      .withExec(["bash", "-lc", "curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.9"])
      .withEnvVariable("CARGO_HOME", "/usr/local/cargo")
      .withEnvVariable("RUSTUP_HOME", "/usr/local/rustup")
      .withEnvVariable("PATH", "/root/.bun/bin:/root/.local/share/pnpm:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
  }

  private codexDesktopBaseContainer(): Container {
    const rustToolchain = dag.container().from(RUST_IMAGE)

    return dag
      .container()
      .from(NODE_IMAGE)
      .withFile("/usr/local/cargo/bin/rustup", rustToolchain.file("/usr/local/cargo/bin/rustup"), { permissions: 0o755 })
      .withDirectory("/usr/local/rustup", rustToolchain.directory("/usr/local/rustup"))
      .withMountedCache(
        "/root/.npm",
        dag.cacheVolume("tap-pipeline-codex-desktop-npm-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withMountedCache(
        "/root/.cache/codex-desktop/electron",
        dag.cacheVolume("tap-pipeline-codex-desktop-electron-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withMountedCache(
        "/root/.cache/codex-desktop/node-runtime",
        dag.cacheVolume("tap-pipeline-codex-desktop-node-runtime-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withEnvVariable("CARGO_HOME", "/usr/local/cargo")
      .withEnvVariable("RUSTUP_HOME", "/usr/local/rustup")
      .withEnvVariable("PATH", "/root/.local/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
      .withEnvVariable("DEBIAN_FRONTEND", "noninteractive")
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "export PATH=/usr/local/cargo/bin:$PATH",
          "ln -sf rustup /usr/local/cargo/bin/cargo",
          "ln -sf rustup /usr/local/cargo/bin/rustc",
          "cargo --version",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends 7zip ca-certificates curl dpkg-dev file g++ git gnupg gpgv jq make pkg-config python3 p7zip-full sudo tar unzip util-linux xz-utils",
          "npm install -g node-gyp",
          "rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
  }

  private goBaseContainer(): Container {
    return dag
      .container()
      .from(GO_IMAGE)
      .withMountedCache(
        "/go/pkg/mod",
        dag.cacheVolume("tap-pipeline-go-mod-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withMountedCache(
        "/root/.cache/go-build",
        dag.cacheVolume("tap-pipeline-go-build-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates nodejs npm tar && rm -rf /var/lib/apt/lists/*",
      ])
      .withEnvVariable("CGO_ENABLED", "0")
  }

  // The contract platform owns shared cache policy before every adapter is migrated.
  private rustBaseContainer(): Container {
    return dag
      .container()
      .from(RUST_IMAGE)
      .withMountedCache(
        "/usr/local/cargo/registry",
        dag.cacheVolume("tap-pipeline-cargo-registry-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withMountedCache(
        "/usr/local/cargo/git",
        dag.cacheVolume("tap-pipeline-cargo-git-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates nodejs build-essential clang cmake pkg-config git binutils libasound2-dev",
          "rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
      .withEnvVariable("PATH", "/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
  }

  private onnxRustBaseContainer(): Container {
    return dag
      .container()
      .from(ONNX_BUILD_IMAGE)
      .withMountedCache(
        "/root/.cargo/registry",
        dag.cacheVolume("tap-pipeline-cargo-registry-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withMountedCache(
        "/root/.cargo/git",
        dag.cacheVolume("tap-pipeline-cargo-git-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl nodejs build-essential clang cmake pkg-config git binutils libasound2-dev",
          "rm -rf /var/lib/apt/lists/*",
          "curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal",
        ].join("\n"),
      ])
      .withEnvVariable("PATH", "/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
  }

  private dictationBrewContainer(): Container {
    const brewPrefix = dag.container().from(BREW_IMAGE).directory("/home/linuxbrew/.linuxbrew")

    return dag
      .container()
      .from(ONNX_BUILD_IMAGE)
      .withUser("root")
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential ca-certificates clang curl git libasound2t64 libvulkan1 libxkbcommon0",
          "rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
      .withDirectory("/home/linuxbrew/.linuxbrew", brewPrefix)
      .withEnvVariable("HOME", "/home/ubuntu")
      .withEnvVariable("PATH", "/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
  }

  private withGithubAuth(container: Container): Container {
    if (this.githubToken) {
      return container.withSecretVariable("GH_TOKEN", this.githubToken)
    }

    if (GITHUB_AUTH_TOKEN) {
      return container.withEnvVariable("GH_TOKEN", GITHUB_AUTH_TOKEN)
    }

    return container
  }

  private githubApiContainer(): Container {
    return this.withGithubAuth(dag.container().from(NODE_IMAGE))
  }

  private rccReleaseMetadata(build: RccBuild): Record<string, unknown> {
    return releaseMetadataForPackage("rcc", {
      version: build.version,
      releaseTag: `rcc-${build.version}`,
      assetName: build.linux.assetName,
      artifactSha256: build.linux.sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/rcc-${build.version}/${build.linux.assetName}`,
      releaseTitle: `RCC ${build.version}`,
      releaseNotes: `Release bundle mirrored from joshyorko/rcc v${build.version}`,
      commitMessage: `Update rcc cask to v${build.version}`,
      upstream: {
        kind: "github_release",
        repo: "https://github.com/joshyorko/rcc",
        assetPrefix: "rcc-",
        version: build.version,
        commit: `v${build.version}`,
      },
    })
  }

  private actionServerReleaseMetadata(build: ActionServerBuild): Record<string, unknown> {
    return releaseMetadataForPackage("action-server", {
      version: build.version,
      releaseTag: `action-server-${build.version}`,
      assetName: build.linux.assetName,
      artifactSha256: build.linux.sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/action-server-${build.version}/${build.linux.assetName}`,
      releaseTitle: `Action Server ${build.version}`,
      releaseNotes: `Release bundle mirrored from ${build.upstreamTag}`,
      commitMessage: `Update action-server cask to v${build.version}`,
      upstream: {
        kind: "github_release",
        repo: "https://github.com/joshyorko/actions",
        assetPrefix: "action-server-",
        tagPrefix: "action-server-v",
        version: build.version,
        commit: build.upstreamTag,
      },
    })
  }

  private chatgptReleaseMetadata(build: ChatgptBuild): Record<string, unknown> {
    return {
      ...releaseMetadataForPackage("chatgpt", {
        version: build.version,
        releaseTag: `chatgpt-${build.version}`,
        assetName: build.amd64.assetName,
        artifactSha256: build.amd64.sha256,
        downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/chatgpt-${build.version}/${build.amd64.assetName}`,
        releaseTitle: `ChatGPT ${build.version}`,
        releaseNotes: `Verified official OpenAI Linux RPM snapshot ${build.version}`,
        commitMessage: `Update ChatGPT cask to ${build.version}`,
        upstream: {
          kind: "http_file",
          url: "https://persistent.oaistatic.com/codex-app-prod/linux/rpm/",
          version: build.version,
        },
      }),
      artifacts: [
        { name: build.amd64.assetName, sha256: build.amd64.sha256 },
        { name: build.arm64.assetName, sha256: build.arm64.sha256 },
      ],
    }
  }

  private devpodReleaseMetadata(build: DevpodBuild): Record<string, unknown> {
    return releaseMetadataForPackage("devpod-linux", {
      version: build.version,
      releaseTag: `devpod-linux-${build.version}`,
      assetName: build.asset.assetName,
      artifactSha256: build.asset.sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/devpod-linux-${build.version}/${build.asset.assetName}`,
      releaseTitle: `DevPod Linux ${build.version}`,
      releaseNotes: `Release bundle mirrored from skevetter/devpod ${build.upstreamTag}`,
      commitMessage: `Update devpod-linux cask to v${build.version}`,
      upstream: {
        kind: "github_release",
        repo: "https://github.com/skevetter/devpod",
        assetName: build.asset.assetName,
        version: build.version,
        commit: build.upstreamTag,
      },
    })
  }

  private devsyCliReleaseMetadata(build: DevsyCliBuild): Record<string, unknown> {
    return {
      ...releaseMetadataForPackage("devsy", {
        version: build.version,
        releaseTag: `devsy-${build.version}`,
        assetName: build.amd64.assetName,
        artifactSha256: build.amd64.sha256,
        downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/devsy-${build.version}/${build.amd64.assetName}`,
        releaseTitle: `Devsy CLI ${build.version}`,
        releaseNotes: `Verified CLI binaries mirrored from devsy-org/devsy ${build.upstreamTag} (${build.upstreamCommit})`,
        commitMessage: `Update devsy formula to v${build.version}`,
        upstream: {
          kind: "github_release",
          repo: "https://github.com/devsy-org/devsy",
          assetPrefix: "devsy-linux-",
          version: build.version,
          commit: build.upstreamCommit,
        },
      }),
      artifacts: [
        { name: build.amd64.assetName, sha256: build.amd64.sha256 },
        { name: build.arm64.assetName, sha256: build.arm64.sha256 },
      ],
    }
  }

  private devsyDesktopReleaseMetadata(build: DevsyDesktopBuild): Record<string, unknown> {
    return releaseMetadataForPackage("devsy-desktop", {
      version: build.version,
      releaseTag: `devsy-desktop-${build.version}`,
      assetName: build.asset.assetName,
      artifactSha256: build.asset.sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/devsy-desktop-${build.version}/${build.asset.assetName}`,
      releaseTitle: `Devsy Desktop ${build.version}`,
      releaseNotes: `Verified Linux AppImage mirrored from devsy-org/devsy ${build.upstreamTag} (${build.upstreamCommit})`,
      commitMessage: `Update devsy-desktop cask to v${build.version}`,
      upstream: {
        kind: "github_release",
        repo: "https://github.com/devsy-org/devsy",
        assetName: build.asset.assetName,
        version: build.version,
        commit: build.upstreamCommit,
      },
    })
  }

  private t3codeCliReleaseMetadata(build: T3Build, sha256: string): Record<string, unknown> {
    return releaseMetadataForPackage("t3code-cli-main", {
      version: build.version,
      releaseTag: `t3code-cli-main-${build.version}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/t3code-cli-main-${build.version}/${build.assetName}`,
      releaseTitle: `T3 Code CLI main ${build.version}`,
      releaseNotes: `CLI snapshot from pingdotgg/t3code@${build.commit}`,
      commitMessage: `Update t3code-cli-main formula to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/pingdotgg/t3code",
        ref: "main",
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private fizzyReleaseMetadata(build: FizzyBuild, sha256: string): Record<string, unknown> {
    return releaseMetadataForPackage("fizzy-cli-master", {
      version: build.version,
      releaseTag: `fizzy-cli-master-${build.version}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/fizzy-cli-master-${build.version}/${build.assetName}`,
      releaseTitle: `Fizzy CLI master ${build.version}`,
      releaseNotes: `CLI snapshot from basecamp/fizzy-cli@${build.commit}`,
      commitMessage: `Update fizzy-cli-master formula to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/basecamp/fizzy-cli",
        ref: "master",
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private fizzyPopperSelfHostedReleaseMetadata(
    build: FizzyPopperSelfHostedBuild,
    sha256: string,
  ): Record<string, unknown> {
    return releaseMetadataForPackage("fizzy-popper-self-hosted", {
      version: build.version,
      releaseTag: `fizzy-popper-self-hosted-${build.version}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/fizzy-popper-self-hosted-${build.version}/${build.assetName}`,
      releaseTitle: `fizzy-popper self-hosted ${build.version}`,
      releaseNotes: `CLI snapshot from joshyorko/fizzy-popper@${build.commit} (self-hosted)`,
      commitMessage: `Update fizzy-popper-self-hosted formula to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/joshyorko/fizzy-popper",
        ref: "self-hosted",
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private fizzySymphonyReleaseMetadata(
    build: FizzySymphonyBuild,
    sha256: string,
  ): Record<string, unknown> {
    return releaseMetadataForPackage("fizzy-symphony", {
      version: build.version,
      releaseTag: `fizzy-symphony-${build.version}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/fizzy-symphony-${build.version}/${build.assetName}`,
      releaseTitle: `fizzy-symphony ${build.version}`,
      releaseNotes: `CLI snapshot from joshyorko/fizzy-symphony@${build.commit} (main)`,
      commitMessage: `Update fizzy-symphony formula to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/joshyorko/fizzy-symphony",
        ref: "main",
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private t3CodeReleaseMetadata(build: T3CodeBuild): Record<string, unknown> {
    return releaseMetadataForPackage("t3-code-linux", {
      version: build.version,
      releaseTag: `t3-code-linux-${build.version}`,
      assetName: build.assetName,
      artifactSha256: build.sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/t3-code-linux-${build.version}/${build.assetName}`,
      releaseTitle: `T3 Code Linux ${build.version}`,
      releaseNotes: `Linux desktop AppImage built from pingdotgg/t3code@${build.commit}`,
      commitMessage: `Update t3-code-linux cask to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/pingdotgg/t3code",
        ref: "main",
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private codexDesktopOfficialReleaseMetadata(
    build: CodexDesktopLinuxOfficialBuild,
  ): Record<string, unknown> {
    return {
      package: "codex-desktop-linux",
      kind: "codex_desktop_linux_cask",
      homebrew_path: "Casks/codex-desktop.rb",
      version: build.version,
      release_tag: `codex-desktop-linux-${build.version}`,
      asset_name: build.assetName,
      artifact_sha256: build.sha256,
      download_url: `https://github.com/${TAP_REPOSITORY}/releases/download/codex-desktop-linux-${build.version}/${build.assetName}`,
      release_title: `Codex Desktop Linux ${build.version}`,
      release_notes: `Built from PatchRaptor main commit ${build.commit} using OpenAI Linux package ${build.upstreamVersion}; the native updater is disabled for Homebrew ownership of upgrades.`,
      commit_message: `Build Codex Desktop Linux cask ${build.version}`,
      upstream: {
        kind: "git",
        repo: CODEX_DESKTOP_CONVERSION_REPO,
        ref: build.commit,
        commit: build.commit,
        official_package_version: build.upstreamVersion,
        official_package_path: build.upstreamPackagePath,
        official_package_url: build.upstreamPackageUrl,
        official_package_sha256: build.upstreamPackageSha256,
        package_source: build.packageSource,
        architecture: build.architecture,
      },
      source_repository: CODEX_DESKTOP_CONVERSION_REPO,
      source_commit: build.commit,
      official_package_version: build.upstreamVersion,
      official_package_path: build.upstreamPackagePath,
      official_package_url: build.upstreamPackageUrl,
      official_package_sha256: build.upstreamPackageSha256,
      package_source: build.packageSource,
      architecture: build.architecture,
      build_mode: build.buildMode,
      feature_profile_sha256: build.featureProfileSha256,
      linux_features_enabled: build.linuxFeaturesEnabled,
    }
  }

  private renderCodexDesktopOfficialCask(downloadUrl: string, version: string, sha256: string): string {
    return `cask "codex-desktop" do
  arch intel: "amd64"
  os linux: "linux"

  version "${version}"
  sha256 x86_64_linux: "${sha256}"

  url "${downloadUrl}"
  name "ChatGPT Community"
  desc "Unofficial ChatGPT Community Linux desktop app built from ilysenko/codex-desktop-linux"
  homepage "https://github.com/ilysenko/codex-desktop-linux"

  livecheck do
    skip "Built from the pinned PatchRaptor main commit by the tap release pipeline."
  end

  binary "usr/bin/codex-desktop"
  artifact "usr/share/applications/codex-desktop.desktop",
           target: "#{Dir.home}/.local/share/applications/codex-desktop.desktop"
  artifact "usr/share/icons/hicolor/256x256/apps/codex-desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png"

  preflight do
    package = Dir["#{staged_path}/*.deb"].first
    raise "unable to find ChatGPT Community .deb in #{staged_path}" unless package

    system "ar", "x", package, chdir: staged_path
    data_archive = Dir["#{staged_path}/data.tar.*"].first
    raise "unable to find data archive in #{package}" unless data_archive

    case data_archive
    when /\\.tar\\.gz$/
      system "tar", "-xzf", data_archive, "-C", staged_path
    when /\\.tar\\.xz$/
      system "tar", "-xJf", data_archive, "-C", staged_path
    when /\\.tar\\.zst$/
      system "sh", "-c", "unzstd -c '#{data_archive}' | tar -xf - -C '#{staged_path}'"
    else
      system "tar", "-xf", data_archive, "-C", staged_path
    end

    desktop_file = "#{staged_path}/usr/share/applications/codex-desktop.desktop"
    desktop_contents = File.read(desktop_file)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/codex-desktop %u")
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png"
    )
    File.write(desktop_file, desktop_contents)

    launcher_path = "#{staged_path}/usr/bin/codex-desktop"
    launcher_contents = <<~SH
      #!/usr/bin/env bash
      set -euo pipefail
      launcher="$(readlink -f "\${BASH_SOURCE[0]}")"
      app_root="$(cd "$(dirname "$launcher")/../../opt/codex-desktop" && pwd)"
      exec "$app_root/start.sh" "$@"
    SH
    File.write(launcher_path, launcher_contents)
    FileUtils.chmod(0755, launcher_path)
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/codex-desktop.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png",
  ]

  caveats <<~EOS
    Launch Codex Desktop with:
      codex-desktop

    This unofficial ChatGPT Community build is maintained by ilysenko and
    packaged from the PatchRaptor conversion. It is separate from the official
    OpenAI ChatGPT cask. Homebrew owns upgrades; the native package updater is omitted.
  EOS
end
`
  }

  private vscodeReleaseMetadata(build: VscodeBuild, sha256: string): Record<string, unknown> {
    return releaseMetadataForPackage("vscode-insiders-linux", {
      version: build.caskVersion,
      releaseTag: `vscode-insiders-linux-${build.caskVersion.replace(/,/g, "-")}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/vscode-insiders-linux-${build.caskVersion.replace(/,/g, "-")}/${build.assetName}`,
      releaseTitle: `VS Code Insiders Linux ${build.caskVersion}`,
      releaseNotes: `Packaged from official RPM ${build.resolvedUrl} (${build.packageVersion}-${build.releaseBuild})`,
      commitMessage: `Update vscode-insiders-linux cask to ${build.caskVersion}`,
      upstream: {
        kind: "rpm",
        sourceUrl: build.resolvedUrl,
        version: build.caskVersion,
        commit: build.commitSha,
      },
    })
  }

  private voxtypeReleaseMetadata(build: VoxtypeBuild, sha256: string): Record<string, unknown> {
    return releaseMetadataForPackage("voxtype", {
      version: build.version,
      releaseTag: `voxtype-${build.version}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/voxtype-${build.version}/${build.assetName}`,
      releaseTitle: `Voxtype ${build.version} Homebrew artifact`,
      releaseNotes: `Homebrew artifact built from peteonrails/voxtype ${build.upstreamTag}`,
      commitMessage: `Update voxtype formula to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/peteonrails/voxtype",
        ref: `refs/tags/${build.upstreamTag}`,
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private eitypeReleaseMetadata(build: EitypeBuild, sha256: string): Record<string, unknown> {
    return releaseMetadataForPackage("eitype", {
      version: build.version,
      releaseTag: `eitype-${build.version}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/eitype-${build.version}/${build.assetName}`,
      releaseTitle: `Eitype ${build.version} Homebrew artifact`,
      releaseNotes: `Homebrew artifact built from Adam-D-Lewis/eitype ${build.upstreamTag}`,
      commitMessage: `Update eitype formula to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/Adam-D-Lewis/eitype",
        ref: `refs/tags/${build.upstreamTag}`,
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private async buildT3Artifact(tap: Directory, ref: string, version?: string): Promise<T3Build> {
    const entry = this.packageEntry("t3code-cli-main")

    if (entry.upstream.kind !== "git" || entry.autoUpdate.kind !== "git_head_sha") {
      throw new Error("Expected t3code-cli-main to use a git-head auto-update strategy")
    }

    const resolvedGitHead = version && version.length > 0
      ? undefined
      : await this.resolveGitHeadVersion(entry.upstream.repo, ref, entry.autoUpdate)
    const upstreamRef = dag.git(entry.upstream.repo).ref(resolvedGitHead?.commit ?? ref)
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : resolvedGitHead?.version

    if (!resolvedVersion) {
      throw new Error("Failed to resolve t3code-cli-main version")
    }

    const assetName = `t3code-cli-main-${resolvedVersion}.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = this.t3BaseContainer()
      .withDirectory("/tap", tap)
      .withMountedCache(
        "/upstream/native/resource-monitor/target",
        dag.cacheVolume("tap-pipeline-t3-resource-monitor-target-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "mkdir -p /upstream",
          "git -C /upstream init",
          `git -C /upstream remote add origin ${JSON.stringify(entry.upstream.repo)}`,
          `git -C /upstream fetch --depth=1 --no-tags origin ${JSON.stringify(commit)}`,
          "git -C /upstream checkout --detach FETCH_HEAD",
          "rm -rf /upstream/.git",
        ].join("\n"),
      ])
      .withWorkdir("/upstream")
      .withExec(["pnpm", "install", "--frozen-lockfile"])
      .withExec(["pnpm", "--filter", "@t3tools/web", "run", "build"])
      .withExec(["pnpm", "--filter", "t3", "run", "build:bundle"])
      .withExec(["bash", "-lc", "rm -rf apps/server/dist/client && cp -R apps/web/dist apps/server/dist/client"])
      .withExec(["bash", "/tap/scripts/build-t3code-resource-monitor.sh", "/upstream"])
      .withExec([
        "node",
        "/tap/scripts/package-t3code-cli-main.mjs",
        "--upstream-dir",
        "/upstream",
        "--version",
        resolvedVersion,
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      assetName,
      commit,
      container,
      version: resolvedVersion,
    }
  }

  private async buildFizzyArtifact(tap: Directory, ref: string, version?: string): Promise<FizzyBuild> {
    const upstreamRef = dag.git("https://github.com/basecamp/fizzy-cli").ref(ref)
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : `master.${commit.slice(0, 12)}`
    const assetName = `fizzy-cli-master-${resolvedVersion}-homebrew-x86_64-linux.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = this.goBaseContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamRef.tree({ discardGitDir: true }))
      .withWorkdir("/upstream")
      .withExec([
        "go",
        "build",
        "-trimpath",
        "-ldflags",
        `-s -w -X main.version=${resolvedVersion}`,
        "-o",
        "/tmp/fizzy",
        "./cmd/fizzy",
      ])
      .withExec([
        "node",
        "/tap/scripts/package-fizzy-cli-master.mjs",
        "--upstream-dir",
        "/upstream",
        "--binary",
        "/tmp/fizzy",
        "--version",
        resolvedVersion,
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      assetName,
      commit,
      container,
      version: resolvedVersion,
    }
  }

  private async buildFizzyPopperSelfHostedArtifact(
    tap: Directory,
    ref: string,
    version?: string,
  ): Promise<FizzyPopperSelfHostedBuild> {
    const entry = this.packageEntry("fizzy-popper-self-hosted")

    if (entry.upstream.kind !== "git" || entry.autoUpdate.kind !== "git_head_sha") {
      throw new Error("Expected fizzy-popper-self-hosted to use a git-head auto-update strategy")
    }

    const resolvedGitHead = version && version.length > 0
      ? undefined
      : await this.resolveGitHeadVersion(entry.upstream.repo, ref, entry.autoUpdate)
    const upstreamRef = dag.git(entry.upstream.repo).ref(resolvedGitHead?.commit ?? ref)
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : resolvedGitHead?.version

    if (!resolvedVersion) {
      throw new Error("Failed to resolve fizzy-popper-self-hosted version")
    }

    const assetName = `fizzy-popper-self-hosted-${resolvedVersion}.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = dag
      .container()
      .from(NODE_IMAGE)
      .withMountedCache(
        "/root/.npm",
        dag.cacheVolume("tap-pipeline-fizzy-popper-npm-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tar && rm -rf /var/lib/apt/lists/*",
      ])
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamRef.tree({ discardGitDir: true }))
      .withWorkdir("/upstream")
      .withExec(["npm", "ci"])
      .withExec(["npm", "test"])
      .withExec(["npm", "run", "typecheck"])
      .withExec(["npm", "run", "build"])
      .withExec(["npm", "pack", "--pack-destination", "/tmp"])
      .withExec([
        "node",
        "/tap/scripts/package-fizzy-popper-self-hosted.mjs",
        "--upstream-dir",
        "/upstream",
        "--npm-pack-dir",
        "/tmp",
        "--version",
        resolvedVersion,
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      assetName,
      commit,
      container,
      version: resolvedVersion,
    }
  }

  private async buildFizzySymphonyArtifact(
    tap: Directory,
    ref: string,
    version?: string,
  ): Promise<FizzySymphonyBuild> {
    const entry = this.packageEntry("fizzy-symphony")

    if (entry.upstream.kind !== "git" || entry.autoUpdate.kind !== "git_head_sha") {
      throw new Error("Expected fizzy-symphony to use a git-head auto-update strategy")
    }

    const resolvedGitHead = version && version.length > 0
      ? undefined
      : await this.resolveGitHeadVersion(entry.upstream.repo, ref, entry.autoUpdate)
    const upstreamRef = dag.git(entry.upstream.repo).ref(resolvedGitHead?.commit ?? ref)
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : resolvedGitHead?.version

    if (!resolvedVersion) {
      throw new Error("Failed to resolve fizzy-symphony version")
    }

    const assetName = `fizzy-symphony-${resolvedVersion}.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = dag
      .container()
      .from(NODE_25_IMAGE)
      .withMountedCache(
        "/root/.npm",
        dag.cacheVolume("tap-pipeline-fizzy-symphony-npm-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tar && rm -rf /var/lib/apt/lists/*",
      ])
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamRef.tree({ discardGitDir: true }))
      .withWorkdir("/upstream")
      .withExec(["npm", "ci"])
      .withExec(["npm", "test"])
      .withExec(["npm", "run", "build", "--if-present"])
      .withExec(["npm", "pack", "--pack-destination", "/tmp"])
      .withExec([
        "node",
        "/tap/scripts/package-fizzy-symphony.mjs",
        "--upstream-dir",
        "/upstream",
        "--npm-pack-dir",
        "/tmp",
        "--version",
        resolvedVersion,
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      assetName,
      commit,
      container,
      version: resolvedVersion,
    }
  }

  private async buildCodexDesktopLinuxOfficialArtifact(
    tap: Directory,
    requestedConversionCommit?: string,
    requestedPackageSource?: string,
  ): Promise<CodexDesktopLinuxOfficialBuild> {
    const packageSource = codexDesktopPackageSource(requestedPackageSource)
    const upstreamRef = dag.git(CODEX_DESKTOP_CONVERSION_REPO).ref(
      codexDesktopConversionCommit(requestedConversionCommit),
    )
    const commit = await upstreamRef.commit()
    const upstreamTree = upstreamRef.tree({ discardGitDir: true })
    const pins = JSON.parse(await upstreamTree.file("nix/upstream-linux-packages.json").contents()) as {
      version: string
      amd64: { repositoryPath: string, sha256: string }
    }
    const featureConfig = JSON.parse(
      await tap.file("config/codex-desktop-linux-features.json").contents(),
    ) as { enabled?: unknown }
    if (!Array.isArray(featureConfig.enabled) || featureConfig.enabled.some((feature) => typeof feature !== "string")) {
      throw new Error("config/codex-desktop-linux-features.json must contain an enabled string array")
    }
    const enabled = [...new Set(featureConfig.enabled as string[])].sort()
    const canonicalFeatureConfig = json({ enabled })
    const featureProfileSha256 = createHash("sha256").update(canonicalFeatureConfig).digest("hex")
    const featureChecks = enabled
      .map((feature) => `test -f linux-features/${feature}/feature.json || { echo "Enabled Linux feature id not found in this checkout: ${feature}" >&2; exit 1; }`)
      .join("\n")
    let packageVersion = pins.version
    let upstreamPackagePath = pins.amd64.repositoryPath
    let upstreamPackageSha256 = pins.amd64.sha256
    let upstreamPackageUrl = `https://persistent.oaistatic.com/codex-app-prod/linux/deb/${upstreamPackagePath}`
    let packagePath = "/work/chatgpt.deb"
    let container = this.codexDesktopBaseContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamTree)
      .withNewFile("/upstream/linux-features/features.homebrew.json", canonicalFeatureConfig)
      .withWorkdir("/upstream")

    if (packageSource === "latest") {
      container = container.withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "mkdir -p /work/upstream-download",
          "node scripts/lib/upstream-linux-package.js --output-dir /work/upstream-download --metadata /work/upstream-linux-package.json --key-base64 assets/openai-codex-linux-repository-key.gpg.base64 --arch amd64 --repository https://persistent.oaistatic.com/codex-app-prod/linux/deb",
        ].join("\n"),
      ])
      const latest = JSON.parse(await container.file("/work/upstream-linux-package.json").contents()) as {
        version: string
        repositoryPath: string
        sha256: string
        repository: string
        path: string
      }
      packageVersion = latest.version
      upstreamPackagePath = latest.repositoryPath
      upstreamPackageSha256 = latest.sha256
      upstreamPackageUrl = `${latest.repository.replace(/\/+$/, "")}/${latest.repositoryPath}`
      packagePath = latest.path
    }

    const version = codexDesktopBuildVersion(packageVersion, commit, enabled)
    const assetName = `codex-desktop-linux-${version}-amd64.deb`
    const artifactPath = `/tmp/${assetName}`
    container = container.withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "export PATH=/usr/local/cargo/bin:$PATH",
          "mkdir -p /work",
          featureChecks,
          packageSource === "pinned"
            ? `curl -fL --retry 3 -o /work/chatgpt.deb ${JSON.stringify(upstreamPackageUrl)}\nprintf '%s  /work/chatgpt.deb\\n' ${JSON.stringify(upstreamPackageSha256)} | sha256sum -c -`
            : `printf '%s  ${packagePath}\\n' ${JSON.stringify(upstreamPackageSha256)} | sha256sum -c -\ncp ${JSON.stringify(packagePath)} /work/chatgpt.deb`,
          "CODEX_LINUX_FEATURES_CONFIG=linux-features/features.homebrew.json make build-native-feature-helpers",
          "CODEX_LINUX_FEATURES_CONFIG=linux-features/features.homebrew.json PACKAGE_WITH_UPDATER=0 CODEX_INSTALL_DIR=/upstream/codex-app ./install.sh /work/chatgpt.deb",
          `CODEX_LINUX_FEATURES_CONFIG=linux-features/features.homebrew.json PACKAGE_WITH_UPDATER=0 PACKAGE_VERSION=${JSON.stringify(version)} make deb`,
          "deb=$(find dist -maxdepth 1 -type f -name 'codex-desktop_*.deb' -print -quit)",
          "test -n \"$deb\"",
          "test \"$(dpkg-deb -f \"$deb\" Package)\" = chatgpt || test \"$(dpkg-deb -f \"$deb\" Package)\" = codex-desktop",
          `test "$(dpkg-deb -f \"$deb\" Version)" = ${JSON.stringify(version)}`,
          `cp "$deb" ${JSON.stringify(artifactPath)}`,
        ].join("\n"),
      ])
    const sha256 = await this.sha256For(container, artifactPath)

    return {
      artifactPath,
      assetName,
      architecture: "amd64",
      buildMode: "patchraptor-main-official-deb-no-updater",
      commit,
      container,
      featureProfileSha256,
      linuxFeaturesEnabled: enabled,
      sha256,
      packageSource,
      upstreamPackagePath,
      upstreamPackageSha256,
      upstreamPackageUrl,
      upstreamVersion: packageVersion,
      version,
    }
  }

  private async buildVscodeArtifact(tap: Directory, sourceUrl?: string, version?: string): Promise<VscodeBuild> {
    const metadata = await this.resolveVscodeMetadata(sourceUrl)
    const resolvedUrl = metadata.resolvedUrl
    const packageVersion = metadata.packageVersion
    const releaseBuild = metadata.releaseBuild
    const commitSha = metadata.commitSha
    const caskVersion = version && version.length > 0 ? version : metadata.caskVersion
    const assetName = `vscode-insiders-linux-${caskVersion.replace(/,/g, "-")}.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = dag
      .container()
      .from(NODE_IMAGE)
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates cpio curl jq rpm tar && rm -rf /var/lib/apt/lists/*",
      ])
      .withDirectory("/tap", tap)
      .withExec(["bash", "-lc", `curl -fsSL "${resolvedUrl}" -o /tmp/vscode-insiders-source.rpm`])
      .withExec([
        "node",
        "/tap/scripts/package-vscode-insiders-linux.mjs",
        "--source-rpm",
        "/tmp/vscode-insiders-source.rpm",
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      assetName,
      caskVersion,
      commitSha,
      container,
      packageVersion,
      releaseBuild,
      resolvedUrl,
    }
  }

  private async buildVoxtypeArtifact(
    tap: Directory,
    ref?: string,
    version?: string,
    features: string[] = [],
  ): Promise<VoxtypeBuild> {
    const upstreamTag = ref && ref.length > 0
      ? ref.replace(/^refs\/tags\//, "")
      : (await this.fetchJson("https://api.github.com/repos/peteonrails/voxtype/releases/latest") as { tag_name: string }).tag_name
    const upstreamRef = dag.git("https://github.com/peteonrails/voxtype").ref(`refs/tags/${upstreamTag}`)
    const upstreamTree = upstreamRef.tree({ discardGitDir: true })
    const commit = await upstreamRef.commit()
    const cargoToml = await upstreamTree.file("Cargo.toml").contents()
    const versionMatch = cargoToml.match(/^version = "([^"]+)"/m)

    if (!versionMatch) {
      throw new Error("Failed to resolve Voxtype version from Cargo.toml")
    }

    const resolvedVersion = version && version.length > 0 ? version : versionMatch[1]
    const assetName = `voxtype-${resolvedVersion}-homebrew-x86_64-linux.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const cargoBuild = ["cargo", "build", "--locked", "--release"]
    const cargoFeatures = [...features]
    if (cargoFeatures.includes("cohere")) {
      cargoFeatures.push("ort/download-binaries", "ort/tls-rustls")
    }
    if (cargoFeatures.length > 0) {
      cargoBuild.push("--features", cargoFeatures.join(","))
    }
    const targetCache = features.length > 0
      ? `tap-pipeline-cargo-target-voxtype-${features.join("-")}-ubuntu-24-04`
      : "tap-pipeline-cargo-target-voxtype"
    const instructionGate = [
      "set -euo pipefail",
      "cp target/release/voxtype /tmp/voxtype-avx2",
      "zmm_count=$(objdump -d /tmp/voxtype-avx2 | grep -c zmm || true)",
      "avx512_count=$(objdump -d /tmp/voxtype-avx2 | grep -cE 'vpternlog|vpermt2|vpblendm|\\{1to[0-9]+\\}' || true)",
      "gfni_count=$(objdump -d /tmp/voxtype-avx2 | grep -cE 'vgf2p8|gf2p8' || true)",
      "printf 'zmm_count=%s\\navx512_count=%s\\ngfni_count=%s\\n' \"$zmm_count\" \"$avx512_count\" \"$gfni_count\"",
      ...(features.length === 0
        ? [
            "test \"$zmm_count\" = 0",
            "test \"$avx512_count\" = 0",
            "test \"$gfni_count\" = 0",
          ]
        : ["printf '%s\\n' 'ONNX Runtime kernels are runtime-dispatched; counts are informational.'"]),
    ]

    const buildContainer = features.length > 0 ? this.onnxRustBaseContainer() : this.rustBaseContainer()
    const container = buildContainer
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamTree)
      .withMountedCache(
        "/upstream/target",
        dag.cacheVolume(targetCache),
        { sharing: CacheSharingMode.Locked },
      )
      .withWorkdir("/upstream")
      .withEnvVariable(
        "RUSTFLAGS",
        "-C target-cpu=haswell -C target-feature=-avx512f,-avx512bw,-avx512cd,-avx512dq,-avx512vl,-gfni",
      )
      .withEnvVariable("GGML_NATIVE", "OFF")
      .withEnvVariable("GGML_AVX512", "OFF")
      .withEnvVariable("GGML_AVX_VNNI", "OFF")
      .withEnvVariable("GGML_AVX512_VNNI", "OFF")
      .withEnvVariable("ORT_STRATEGY", features.length > 0 ? "download" : "system")
      .withEnvVariable(
        "CMAKE_C_FLAGS",
        "-mno-avx512f -mno-avx512vl -mno-avx512bw -mno-avx512dq -mno-avx512cd -mno-gfni -mno-avxvnni",
      )
      .withEnvVariable(
        "CMAKE_CXX_FLAGS",
        "-mno-avx512f -mno-avx512vl -mno-avx512bw -mno-avx512dq -mno-avx512cd -mno-gfni -mno-avxvnni",
      )
      .withExec(cargoBuild)
      .withExec([
        "bash",
        "-lc",
        instructionGate.join("\n"),
      ])
      .withExec([
        "node",
        "/tap/scripts/package-voxtype.mjs",
        "--upstream-dir",
        "/upstream",
        "--binary",
        "/tmp/voxtype-avx2",
        "--version",
        resolvedVersion,
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      assetName,
      commit,
      container,
      upstreamTag,
      version: resolvedVersion,
    }
  }

  private async buildVoxtypePrebuiltArtifact(
    tap: Directory,
    ref: string,
    version?: string,
  ): Promise<VoxtypeBuild> {
    const upstreamTag = ref.replace(/^refs\/tags\//, "")
    const upstreamRef = dag.git("https://github.com/peteonrails/voxtype").ref(`refs/tags/${upstreamTag}`)
    const upstreamTree = upstreamRef.tree({ discardGitDir: true })
    const commit = await upstreamRef.commit()
    const cargoToml = await upstreamTree.file("Cargo.toml").contents()
    const versionMatch = cargoToml.match(/^version = "([^"]+)"/m)

    if (!versionMatch) {
      throw new Error("Failed to resolve Voxtype version from Cargo.toml")
    }

    const resolvedVersion = version && version.length > 0 ? version : versionMatch[1]
    const assetName = `voxtype-${resolvedVersion}-homebrew-x86_64-linux.tar.gz`
    const artifactPath = `/tmp/${assetName}`
    const releaseBase = `https://github.com/peteonrails/voxtype/releases/download/${upstreamTag}`
    const upstreamAsset = `voxtype-${resolvedVersion}-linux-x86_64-vulkan`
    const checksums = await this.fetchText(`${releaseBase}/SHA256SUMS.txt`)
    const checksumLine = checksums
      .split("\n")
      .find((line) => line.endsWith(`  ${upstreamAsset}`))
    const checksum = checksumLine?.split(/\s+/, 1)[0]

    if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) {
      throw new Error(`Missing checksum for Voxtype release asset ${upstreamAsset}`)
    }

    const binaryPath = "/tmp/voxtype-prebuilt"
    const container = this.githubApiContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamTree)
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        renderAssetDownloadScript(),
        `${releaseBase}/${upstreamAsset}`,
        binaryPath,
      ])
      .withExec([
        "bash",
        "-lc",
        `printf '%s  %s\\n' ${JSON.stringify(checksum)} ${JSON.stringify(binaryPath)} | sha256sum -c - && chmod 0755 ${JSON.stringify(binaryPath)}`,
      ])

    return {
      artifactPath,
      assetName,
      commit,
      container,
      upstreamTag,
      version: resolvedVersion,
    }
  }

  private async buildEitypeArtifact(tap: Directory, ref?: string, version?: string): Promise<EitypeBuild> {
    const upstreamTag = ref && ref.length > 0
      ? ref.replace(/^refs\/tags\//, "")
      : (await this.fetchJson("https://api.github.com/repos/Adam-D-Lewis/eitype/releases/latest") as { tag_name: string }).tag_name
    const upstreamRef = dag.git("https://github.com/Adam-D-Lewis/eitype").ref(`refs/tags/${upstreamTag}`)
    const upstreamTree = upstreamRef.tree({ discardGitDir: true })
    const commit = await upstreamRef.commit()
    const cargoToml = await upstreamTree.file("Cargo.toml").contents()
    const versionMatch = cargoToml.match(/^version = "([^"]+)"/m)

    if (!versionMatch) {
      throw new Error("Failed to resolve Eitype version from Cargo.toml")
    }

    const resolvedVersion = version && version.length > 0 ? version : versionMatch[1]
    const assetName = `eitype-${resolvedVersion}-homebrew-x86_64-linux.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = this.rustBaseContainer()
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libxkbcommon-dev",
          "rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamTree)
      .withMountedCache(
        "/upstream/target",
        dag.cacheVolume("tap-pipeline-cargo-target-eitype"),
        { sharing: CacheSharingMode.Locked },
      )
      .withWorkdir("/upstream")
      .withExec(["cargo", "build", "--locked", "--release", "--bin", "eitype"])
      .withExec([
        "node",
        "/tap/scripts/package-eitype.mjs",
        "--upstream-dir",
        "/upstream",
        "--binary",
        "target/release/eitype",
        "--version",
        resolvedVersion,
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      assetName,
      commit,
      container,
      upstreamTag,
      version: resolvedVersion,
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const output = await this.githubApiContainer()
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        renderGithubApiFetchScript(),
        url,
      ])
      .stdout()

    return JSON.parse(output)
  }

  private async resolveLatestStableRelease(repository: string): Promise<{
    tagName: string
    publishedAt?: string
  }> {
    return selectLatestStableRelease(
      await this.fetchJson(`https://api.github.com/repos/${repository}/releases/latest`),
      repository,
    )
  }

  private async downloadVoxtypeCompanions(version: string, tagName: string): Promise<{
    audioBridgePath: string
    container: Container
    osdGtk4Path: string
    osdPath: string
  }> {
    const releaseBase = `https://github.com/peteonrails/voxtype/releases/download/${tagName}`
    const checksums = await this.fetchText(`${releaseBase}/SHA256SUMS.txt`)
    const assets = [
      { name: `voxtype-${version}-linux-x86_64-osd`, path: "/tmp/voxtype-osd" },
      { name: `voxtype-${version}-linux-x86_64-osd-gtk4`, path: "/tmp/voxtype-osd-gtk4" },
      { name: `voxtype-${version}-linux-x86_64-audio-bridge`, path: "/tmp/voxtype-audio-bridge" },
    ]
    let container = this.githubApiContainer()

    for (const asset of assets) {
      const checksumLine = checksums
        .split("\n")
        .find((line) => line.endsWith(`  ${asset.name}`))
      const checksum = checksumLine?.split(/\s+/, 1)[0]
      if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) {
        throw new Error(`Missing checksum for Voxtype release asset ${asset.name}`)
      }
      container = container
        .withExec([
          "node",
          "--input-type=module",
          "-e",
          renderAssetDownloadScript(),
          `${releaseBase}/${asset.name}`,
          asset.path,
        ])
        .withExec([
          "bash",
          "-lc",
          `printf '%s  %s\\n' ${JSON.stringify(checksum)} ${JSON.stringify(asset.path)} | sha256sum -c - && chmod 0755 ${JSON.stringify(asset.path)}`,
        ])
    }

    return {
      audioBridgePath: assets[2].path,
      container,
      osdGtk4Path: assets[1].path,
      osdPath: assets[0].path,
    }
  }

  private async smokeDictationArtifacts(
    tap: Directory,
    voxtype: VoxtypeBuild,
    eitype: EitypeBuild,
    voxtypeFormula: string,
    eitypeFormula: string,
    voxtypeSha256: string,
    eitypeSha256: string,
  ): Promise<string> {
    const smokeTap = tap
      .withFile("Formula/voxtype.rb", dag.file("voxtype.rb", voxtypeFormula))
      .withFile("Formula/eitype.rb", dag.file("eitype.rb", eitypeFormula))

    return this.dictationBrewContainer()
      .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
      .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
      .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
      .withUser("ubuntu")
      .withDirectory("/tap", smokeTap)
      .withFile(`/artifacts/${voxtype.assetName}`, voxtype.container.file(voxtype.artifactPath))
      .withFile(`/artifacts/${eitype.assetName}`, eitype.container.file(eitype.artifactPath))
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "repo=$(brew --repository)",
          "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
          "mkdir -p \"$tap_dir/Formula\"",
          "cp /tap/Formula/voxtype.rb \"$tap_dir/Formula/\"",
          "cp /tap/Formula/eitype.rb \"$tap_dir/Formula/\"",
          `printf '%s  /artifacts/${voxtype.assetName}\\n' ${JSON.stringify(voxtypeSha256)} | sha256sum -c -`,
          `printf '%s  /artifacts/${eitype.assetName}\\n' ${JSON.stringify(eitypeSha256)} | sha256sum -c -`,
          "brew install test/tap/voxtype",
          "brew install test/tap/eitype",
          "brew test test/tap/voxtype",
          "brew test test/tap/eitype",
          "test -x \"$(brew --prefix)/bin/voxtype\"",
          "test -x \"$(brew --prefix)/bin/voxtype-osd\"",
          "test -x \"$(brew --prefix)/bin/voxtype-osd-gtk4\"",
          "test -x \"$(brew --prefix)/bin/voxtype-audio-bridge\"",
          "test -x \"$(brew --prefix)/bin/eitype\"",
          "voxtype --version",
          "eitype --version",
          "voxtype info engines | grep -Eiq '(^|[[:space:]])whisper([[:space:]]|$)'",
          "printf '%s\\n' 'Dagger dictation artifact smoke passed.'",
        ].join("\n"),
      ])
      .stdout()
  }

  private async fetchText(url: string): Promise<string> {
    return this.githubApiContainer()
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        [
          "const response = await fetch(process.argv[1])",
          "if (!response.ok) throw new Error(`Failed to fetch ${process.argv[1]}: ${response.status} ${response.statusText}`)",
          "process.stdout.write(await response.text())",
        ].join("\n"),
        url,
      ])
      .stdout()
  }

  private async resolveChatgptVersion(): Promise<string> {
    const entry = this.packageEntry("chatgpt")
    if (entry.autoUpdate.kind !== "deb_packages_version") {
      throw new Error("Expected chatgpt to use a Debian Packages version strategy")
    }

    const packages = await this.fetchText(entry.autoUpdate.url)
    const version = parseDebianPackageVersion(packages, "chatgpt")
    if (!version) {
      throw new Error(`Unable to find a ChatGPT version in ${entry.autoUpdate.url}`)
    }
    return version
  }

  private async resolveCodexDesktopVersion(requestedConversionCommit?: string): Promise<string> {
    const commit = await dag.git(CODEX_DESKTOP_CONVERSION_REPO)
      .ref(codexDesktopConversionCommit(requestedConversionCommit))
      .commit()
    const featureConfig = JSON.parse(
      await this.source.file("config/codex-desktop-linux-features.json").contents(),
    ) as { enabled?: unknown }
    if (!Array.isArray(featureConfig.enabled) || featureConfig.enabled.some((feature) => typeof feature !== "string")) {
      throw new Error("config/codex-desktop-linux-features.json must contain an enabled string array")
    }

    return codexDesktopBuildVersion(
      await this.resolveChatgptVersion(),
      commit,
      featureConfig.enabled as string[],
    )
  }

  private async buildChatgptArtifacts(): Promise<ChatgptBuild> {
    const version = await this.resolveChatgptVersion()
    const amd64Name = `chatgpt-${version}-1.x86_64.rpm`
    const arm64Name = `chatgpt-${version}-1.aarch64.rpm`
    let container = dag.container().from(NODE_IMAGE)
    container = this.downloadAsset(
      container,
      `https://persistent.oaistatic.com/codex-app-prod/linux/rpm/x86_64/${amd64Name}`,
      `/tmp/${amd64Name}`,
    )
    container = this.downloadAsset(
      container,
      `https://persistent.oaistatic.com/codex-app-prod/linux/rpm/aarch64/${arm64Name}`,
      `/tmp/${arm64Name}`,
    )

    return {
      version,
      container,
      amd64: {
        assetName: amd64Name,
        artifactPath: `/tmp/${amd64Name}`,
        sha256: await this.sha256For(container, `/tmp/${amd64Name}`),
        sourceUrl: `https://persistent.oaistatic.com/codex-app-prod/linux/rpm/x86_64/${amd64Name}`,
      },
      arm64: {
        assetName: arm64Name,
        artifactPath: `/tmp/${arm64Name}`,
        sha256: await this.sha256For(container, `/tmp/${arm64Name}`),
        sourceUrl: `https://persistent.oaistatic.com/codex-app-prod/linux/rpm/aarch64/${arm64Name}`,
      },
    }
  }

  private async resolveGitHeadVersion(
    repo: string,
    ref: string,
    options: {
      includeCommitDate?: boolean
      prefix?: string
      shaLength?: number
    },
  ): Promise<{ commit: string, version: string }> {
    const commit = await this.fetchJson(`${githubApiRepoUrl(repo)}/commits/${ref}`) as GitCommitApiResponse
    const committedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date

    return {
      commit: commit.sha,
      version: formatGitHeadVersion({
        committedAt,
        includeCommitDate: options.includeCommitDate,
        prefix: options.prefix,
        sha: commit.sha,
        shaLength: options.shaLength,
      }),
    }
  }

  private async resolveVscodeMetadata(sourceUrl?: string): Promise<{
    resolvedUrl: string
    packageVersion: string
    releaseBuild: string
    commitSha: string
    caskVersion: string
  }> {
    const resolvedSourceUrl = sourceUrl ?? "https://update.code.visualstudio.com/latest/linux-rpm-x64/insider"
    const resolvedUrl = (await dag
      .container()
      .from(NODE_IMAGE)
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        [
          "const url = process.argv[1]",
          "const response = await fetch(url, { method: 'HEAD', redirect: 'follow' })",
          "if (!response.ok) {",
          "  throw new Error(`Failed to resolve ${url}: ${response.status}`)",
          "}",
          "process.stdout.write(response.url)",
        ].join("\n"),
        resolvedSourceUrl,
      ])
      .stdout()).trim()

    const match = resolvedUrl.match(/\/download\/insider\/([0-9a-f]+)\/code-insiders-([0-9.]+)-(.+)\.x86_64\.rpm$/)

    if (!match) {
      throw new Error(`Failed to parse VS Code Insiders metadata from ${resolvedUrl}`)
    }

    const [, commitSha, packageVersion, releaseBuild] = match
    const commitShort = commitSha.slice(0, 12)

    return {
      resolvedUrl,
      packageVersion,
      releaseBuild,
      commitSha,
      caskVersion: `${packageVersion},${releaseBuild},${commitShort}`,
    }
  }

  private async resolveUpstreamVersion(packageId: string, codexDesktopConversionCommit?: string): Promise<string> {
    const entry = this.packageEntry(packageId)

    switch (entry.autoUpdate.kind) {
      case "github_release_latest_tag": {
        const repo = entry.upstream.kind === "github_release" || entry.upstream.kind === "git"
          ? entry.upstream.repo
          : undefined

        if (!repo) {
          throw new Error(`Expected GitHub-backed upstream for ${packageId}`)
        }

        const release = await this.fetchJson(`${githubApiRepoUrl(repo)}/releases/latest`) as {
          tag_name: string
        }
        return stripRequiredPrefix(release.tag_name, entry.autoUpdate.stripPrefix)
      }
      case "git_head_sha": {
        if (entry.upstream.kind !== "git") {
          throw new Error(`Expected git upstream for ${packageId}`)
        }

        const ref = entry.autoUpdate.ref
        return (await this.resolveGitHeadVersion(entry.upstream.repo, ref, entry.autoUpdate)).version
      }
      case "rpm_redirect": {
        const sourceUrl = entry.autoUpdate.sourceUrl
          ?? (entry.upstream.kind === "rpm" ? entry.upstream.sourceUrl : undefined)

        if (!sourceUrl) {
          throw new Error(`Expected rpm source URL for ${packageId}`)
        }

        return (await this.resolveVscodeMetadata(sourceUrl)).caskVersion
      }
      case "deb_packages_version":
        return packageId === "codex-desktop-linux"
          ? this.resolveCodexDesktopVersion(codexDesktopConversionCommit)
          : this.resolveChatgptVersion()
      case "manual":
        throw new Error(`${packageId} is manually updated: ${entry.autoUpdate.reason}`)
    }
  }

  private downloadAsset(container: Container, url: string, path: string): Container {
    const authenticatedContainer = new URL(url).hostname === "github.com"
      ? this.withGithubAuth(container)
      : container

    return authenticatedContainer.withExec([
      "node",
      "--input-type=module",
      "-e",
      renderAssetDownloadScript(),
      url,
      path,
    ])
  }

  private async sha256For(container: Container, path: string): Promise<string> {
    return (
      await container.withExec(["sha256sum", path]).stdout()
    ).trim().split(/\s+/)[0]
  }

  private async buildRccArtifacts(): Promise<RccBuild> {
    const release = await this.fetchJson("https://api.github.com/repos/joshyorko/rcc/releases/latest") as {
      tag_name: string
      assets: Array<{ name: string; browser_download_url: string }>
    }
    const version = release.tag_name.replace(/^v/, "")

    const resolveAsset = (name: string): { name: string; browser_download_url: string } => {
      const asset = release.assets.find((candidate) => candidate.name === name)

      if (!asset) {
        throw new Error(`Missing RCC release asset: ${name}`)
      }

      return asset
    }

    const linuxAsset = resolveAsset("rcc-linux64")
    const macosArmAsset = resolveAsset("rcc-macosarm64")
    const macosIntelAsset = resolveAsset("rcc-macos64")

    let container = this.githubApiContainer()
    container = this.downloadAsset(container, linuxAsset.browser_download_url, "/tmp/rcc-linux64")
    container = this.downloadAsset(container, macosArmAsset.browser_download_url, "/tmp/rcc-macosarm64")
    container = this.downloadAsset(container, macosIntelAsset.browser_download_url, "/tmp/rcc-macos64")

    return {
      version,
      container,
      linux: {
        assetName: linuxAsset.name,
        artifactPath: "/tmp/rcc-linux64",
        sha256: await this.sha256For(container, "/tmp/rcc-linux64"),
        sourceUrl: linuxAsset.browser_download_url,
      },
      macosArm: {
        assetName: macosArmAsset.name,
        artifactPath: "/tmp/rcc-macosarm64",
        sha256: await this.sha256For(container, "/tmp/rcc-macosarm64"),
        sourceUrl: macosArmAsset.browser_download_url,
      },
      macosIntel: {
        assetName: macosIntelAsset.name,
        artifactPath: "/tmp/rcc-macos64",
        sha256: await this.sha256For(container, "/tmp/rcc-macos64"),
        sourceUrl: macosIntelAsset.browser_download_url,
      },
    }
  }

  private async buildActionServerArtifacts(): Promise<ActionServerBuild> {
    const releases = await this.fetchJson("https://api.github.com/repos/joshyorko/actions/releases?per_page=10") as Array<{
      tag_name: string
      assets: Array<{ name: string; browser_download_url: string }>
    }>
    const release = releases.find((candidate) => candidate.tag_name.startsWith("action-server-v"))

    if (!release) {
      throw new Error("No action-server release found")
    }

    const version = release.tag_name.replace(/^action-server-v/, "")
    const resolveOptionalAsset = (name: string): { name: string; browser_download_url: string } | undefined =>
      release.assets.find((candidate) => candidate.name === name)
    const linuxAsset = resolveOptionalAsset("action-server-linux64")
    const macosArmAsset = resolveOptionalAsset("action-server-macosarm64")

    if (!linuxAsset || !macosArmAsset) {
      throw new Error("Action Server release is missing required linux or macOS arm assets")
    }

    const macosIntelAsset = resolveOptionalAsset("action-server-macos64")

    let container = this.githubApiContainer()
    container = this.downloadAsset(container, linuxAsset.browser_download_url, "/tmp/action-server-linux64")
    container = this.downloadAsset(container, macosArmAsset.browser_download_url, "/tmp/action-server-macosarm64")

    if (macosIntelAsset) {
      container = this.downloadAsset(container, macosIntelAsset.browser_download_url, "/tmp/action-server-macos64")
    }

    return {
      version,
      upstreamTag: release.tag_name,
      container,
      linux: {
        assetName: linuxAsset.name,
        artifactPath: "/tmp/action-server-linux64",
        sha256: await this.sha256For(container, "/tmp/action-server-linux64"),
        sourceUrl: linuxAsset.browser_download_url,
      },
      macosArm: {
        assetName: macosArmAsset.name,
        artifactPath: "/tmp/action-server-macosarm64",
        sha256: await this.sha256For(container, "/tmp/action-server-macosarm64"),
        sourceUrl: macosArmAsset.browser_download_url,
      },
      macosIntel: macosIntelAsset ? {
        assetName: macosIntelAsset.name,
        artifactPath: "/tmp/action-server-macos64",
        sha256: await this.sha256For(container, "/tmp/action-server-macos64"),
        sourceUrl: macosIntelAsset.browser_download_url,
      } : undefined,
    }
  }

  private async buildDevpodArtifact(): Promise<DevpodBuild> {
    const releases = await this.fetchJson("https://api.github.com/repos/skevetter/devpod/releases?per_page=20") as Array<{
      draft: boolean
      prerelease: boolean
      tag_name: string
      assets: Array<{ name: string; browser_download_url: string }>
    }>
    const release = releases.find((candidate) => !candidate.draft && !candidate.prerelease)

    if (!release) {
      throw new Error("No stable DevPod release found")
    }

    const asset = release.assets.find((candidate) => candidate.name === "DevPod_linux_amd64.deb")

    if (!asset) {
      throw new Error("DevPod release is missing DevPod_linux_amd64.deb")
    }

    const version = release.tag_name.replace(/^v/, "")
    let container = this.githubApiContainer()
    container = this.downloadAsset(container, asset.browser_download_url, `/tmp/${asset.name}`)

    return {
      version,
      upstreamTag: release.tag_name,
      container,
      asset: {
        assetName: asset.name,
        artifactPath: `/tmp/${asset.name}`,
        sha256: await this.sha256For(container, `/tmp/${asset.name}`),
        sourceUrl: asset.browser_download_url,
      },
    }
  }

  private async resolveDevsyRelease(): Promise<DevsyRelease & { commit: string }> {
    const release = await this.fetchJson("https://api.github.com/repos/devsy-org/devsy/releases/latest") as DevsyRelease

    resolveStableDevsyRelease(release)

    const ref = await this.fetchJson(
      `https://api.github.com/repos/devsy-org/devsy/git/ref/tags/${encodeURIComponent(release.tag_name)}`,
    ) as {
      object: {
        sha: string
        type: "commit" | "tag"
        url: string
      }
    }
    let commit = ref.object.sha

    if (ref.object.type === "tag") {
      const tag = await this.fetchJson(ref.object.url) as { object: { sha: string } }
      commit = tag.object.sha
    }

    return { ...release, commit }
  }

  private verifyGithubDigest(asset: DevsyReleaseAsset, sha256: string): void {
    verifyDevsyGithubDigest(asset, sha256)
  }

  private async buildDevsyCliArtifacts(): Promise<DevsyCliBuild> {
    const release = await this.resolveDevsyRelease()
    const resolved = resolveStableDevsyRelease(release)
    const amd64Asset = resolved.amd64
    const arm64Asset = resolved.arm64

    let container = this.githubApiContainer()
    container = this.downloadAsset(container, amd64Asset.browser_download_url, `/tmp/${amd64Asset.name}`)
    container = this.downloadAsset(container, arm64Asset.browser_download_url, `/tmp/${arm64Asset.name}`)
    const amd64Sha256 = await this.sha256For(container, `/tmp/${amd64Asset.name}`)
    const arm64Sha256 = await this.sha256For(container, `/tmp/${arm64Asset.name}`)
    this.verifyGithubDigest(amd64Asset, amd64Sha256)
    this.verifyGithubDigest(arm64Asset, arm64Sha256)

    return {
      version: resolved.version,
      upstreamTag: resolved.upstreamTag,
      upstreamCommit: release.commit,
      container,
      amd64: {
        assetName: amd64Asset.name,
        artifactPath: `/tmp/${amd64Asset.name}`,
        sha256: amd64Sha256,
        sourceUrl: amd64Asset.browser_download_url,
      },
      arm64: {
        assetName: arm64Asset.name,
        artifactPath: `/tmp/${arm64Asset.name}`,
        sha256: arm64Sha256,
        sourceUrl: arm64Asset.browser_download_url,
      },
    }
  }

  private async buildDevsyDesktopArtifact(): Promise<DevsyDesktopBuild> {
    const release = await this.resolveDevsyRelease()
    const resolved = resolveStableDevsyRelease(release)
    const appImageAsset = resolved.desktop

    let container = this.githubApiContainer()
    container = this.downloadAsset(container, appImageAsset.browser_download_url, `/tmp/${appImageAsset.name}`)
    const sha256 = await this.sha256For(container, `/tmp/${appImageAsset.name}`)
    this.verifyGithubDigest(appImageAsset, sha256)

    return {
      version: resolved.version,
      upstreamTag: resolved.upstreamTag,
      upstreamCommit: release.commit,
      container,
      asset: {
        assetName: appImageAsset.name,
        artifactPath: `/tmp/${appImageAsset.name}`,
        sha256,
        sourceUrl: appImageAsset.browser_download_url,
      },
    }
  }

  private async buildT3CodeArtifact(tap: Directory, ref: string, version?: string): Promise<T3CodeBuild> {
    const entry = this.packageEntry("t3-code-linux")

    if (entry.upstream.kind !== "git" || entry.autoUpdate.kind !== "git_head_sha") {
      throw new Error("Expected t3-code-linux to use a git-head auto-update strategy")
    }

    const resolvedGitHead = version && version.length > 0
      ? undefined
      : await this.resolveGitHeadVersion(entry.upstream.repo, ref, entry.autoUpdate)
    const upstreamRef = dag.git(entry.upstream.repo).ref(resolvedGitHead?.commit ?? ref)
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : resolvedGitHead?.version

    if (!resolvedVersion) {
      throw new Error("Failed to resolve t3-code-linux version")
    }

    const assetName = `T3-Code-${resolvedVersion}-x86_64.AppImage`
    const artifactPath = `/tmp/${assetName}`

    const container = this.t3BaseContainer()
      .withEnvVariable("ENABLE_V8_FUNCTIONS", "false")
      .withDirectory("/tap", tap)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "mkdir -p /upstream",
          "git -C /upstream init",
          `git -C /upstream remote add origin ${JSON.stringify(entry.upstream.repo)}`,
          `git -C /upstream fetch --depth=1 --no-tags origin ${JSON.stringify(commit)}`,
          "git -C /upstream checkout --detach FETCH_HEAD",
          "rm -rf /upstream/.git",
        ].join("\n"),
      ])
      .withWorkdir("/upstream")
      .withExec(["pnpm", "install", "--frozen-lockfile"])
      .withExec([
        "pnpm",
        "dist:desktop:linux",
        "--output-dir",
        "/tmp/t3-code-linux-dist",
      ])
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "appimage=$(find /tmp/t3-code-linux-dist -maxdepth 1 -type f -name 'T3-Code-*.AppImage' -print -quit)",
          "test -n \"$appimage\"",
          `cp "$appimage" ${JSON.stringify(artifactPath)}`,
          `chmod +x ${JSON.stringify(artifactPath)}`,
        ].join("\n"),
      ])
    const sha256 = await this.sha256For(container, artifactPath)

    return {
      artifactPath,
      assetName,
      commit,
      container,
      sha256,
      version: resolvedVersion,
    }
  }

  private async buildHeadroomArtifact(): Promise<HeadroomBuild> {
    const entry = this.packageEntry("headroom-self-hosted")
    if (entry.upstream.kind !== "git" || entry.autoUpdate.kind !== "git_head_sha") {
      throw new Error("Expected Headroom self-hosted to use a git-head upstream")
    }

    const sourceRef = entry.autoUpdate.ref
    const upstreamRef = dag.git(entry.upstream.repo).ref(sourceRef)
    const commit = await upstreamRef.commit()
    const commitMetadata = await this.fetchJson(
      `${githubApiRepoUrl(entry.upstream.repo)}/git/commits/${commit}`,
    ) as { tree?: { sha?: string } }
    const treeHash = commitMetadata.tree?.sha
    if (!treeHash) {
      throw new Error(`GitHub did not return a source tree hash for Headroom commit ${commit}`)
    }

    const version = `selfhosted.${commit.slice(0, 12)}`
    const assetName = `headroom-self-hosted-${version}.tar.gz`
    const artifactPath = `/tmp/${assetName}`
    const rustToolchain = dag.container().from(RUST_IMAGE)
    const buildProvenance = {
      package: "headroom-self-hosted",
      source_repository: entry.upstream.repo,
      source_ref: sourceRef,
      source_commit: commit,
      source_tree: treeHash,
      build_profile: "headroom-ai[proxy]",
      python: "3.13",
    }
    const container = dag
      .container()
      .from(PYTHON_IMAGE)
      .withDirectory("/usr/local/cargo", rustToolchain.directory("/usr/local/cargo"))
      .withDirectory("/usr/local/rustup", rustToolchain.directory("/usr/local/rustup"))
      .withEnvVariable("PATH", "/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin")
      .withDirectory("/source", upstreamRef.tree({ discardGitDir: true }))
      .withWorkdir("/source")
      .withNewFile("/work/package/provenance.json", json(buildProvenance))
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "mkdir -p /work/package/wheelhouse",
          "python -m pip wheel --disable-pip-version-check --no-cache-dir --wheel-dir /work/package/wheelhouse '.[proxy]'",
          "find /work/package/wheelhouse -maxdepth 1 -type f -name 'headroom_ai-*.whl' -print -quit | grep -q .",
          "test \"$(find /work/package/wheelhouse -maxdepth 1 -type f -name '*.whl' | wc -l)\" -gt 1",
          "python -m json.tool /work/package/provenance.json >/dev/null",
          `tar -czf ${JSON.stringify(artifactPath)} -C /work/package .`,
        ].join("\n"),
      ])
    const sha256 = await this.sha256For(container, artifactPath)

    return { artifactPath, assetName, commit, container, sha256, sourceRef, treeHash, version }
  }

  private renderHeadroomFormula(downloadUrl: string, version: string, sha256: string): string {
    return `class HeadroomSelfHosted < Formula
  desc "Self-hosted Headroom CLI and proxy from the pinned self-hosted source"
  homepage "https://github.com/joshyorko/headroom"
  url "${downloadUrl}"
  version "${version}"
  sha256 "${sha256}"
  license "Apache-2.0"

  livecheck do
    skip "Built from an exact self-hosted source commit by the tap release pipeline."
  end

  depends_on :linux
  depends_on "python@3.13"

  def install
    libexec.install Dir["*"]
    python = Formula["python@3.13"].opt_bin/"python3.13"
    system python, "-m", "venv", libexec/"venv"
    system libexec/"venv/bin/pip", "install", "--no-index", "--find-links=#{libexec}/wheelhouse", "headroom-ai[proxy]"

    (bin/"headroom").write <<~SH
      #!/bin/bash
      exec "#{libexec}/venv/bin/headroom" "$@"
    SH
  end

  test do
    assert_match "Usage", shell_output("#{bin}/headroom --help")
    assert_match "proxy", shell_output("#{bin}/headroom proxy --help")
  end
end
`
  }

  private headroomReleaseMetadata(build: HeadroomBuild) {
    const releaseTag = `headroom-self-hosted-${build.version}`
    return releaseMetadataForPackage("headroom-self-hosted", {
      version: build.version,
      releaseTag,
      assetName: build.assetName,
      artifactSha256: build.sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.assetName}`,
      releaseTitle: `Headroom self-hosted ${build.version}`,
      releaseNotes: `Built from joshyorko/headroom:${build.sourceRef} commit ${build.commit} with the proxy dependency profile; Homebrew installation is offline from the retained wheelhouse.`,
      commitMessage: `Build Headroom self-hosted ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/joshyorko/headroom",
        ref: build.sourceRef,
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private headroomProvenance(build: HeadroomBuild): Record<string, string> {
    return {
      package: "headroom-self-hosted",
      source_repository: "https://github.com/joshyorko/headroom",
      source_ref: build.sourceRef,
      source_commit: build.commit,
      source_tree: build.treeHash,
      artifact_sha256: build.sha256,
      build_profile: "headroom-ai[proxy]",
      python: "3.13",
    }
  }

  private renderRccCask(build: RccBuild, releaseTag: string): string {
    return this.renderRccCaskWithUrls(build, {
      linux: `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.linux.assetName}`,
      macosArm: `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.macosArm.assetName}`,
      macosIntel: `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.macosIntel.assetName}`,
    })
  }

  private renderRccCaskWithUrls(
    build: RccBuild,
    urls: { linux: string; macosArm: string; macosIntel: string },
  ): string {
    return [
      "cask \"rcc\" do",
      `  version \"${build.version}\"`,
      "",
      "  livecheck do",
      "    skip \"Updated by the tap's GitHub Actions workflow.\"",
      "  end",
      "",
      "  on_macos do",
      "    on_arm do",
      `      sha256 \"${build.macosArm.sha256}\"`,
      `      url \"${urls.macosArm}\"`,
      `      binary \"${build.macosArm.assetName}\", target: \"rcc\"`,
      "    end",
      "",
      "    on_intel do",
      `      sha256 \"${build.macosIntel.sha256}\"`,
      `      url \"${urls.macosIntel}\"`,
      `      binary \"${build.macosIntel.assetName}\", target: \"rcc\"`,
      "    end",
      "  end",
      "",
      "  on_linux do",
      `    sha256 \"${build.linux.sha256}\"`,
      `    url \"${urls.linux}\"`,
      `    binary \"${build.linux.assetName}\", target: \"rcc\"`,
      "  end",
      "",
      "  name \"RCC\"",
      "  desc \"RCC - Repeatable Contained Code automation runtime\"",
      "  homepage \"https://github.com/joshyorko/rcc\"",
      "",
      "  caveats <<~EOS",
      "    If 'rcc' is not found after installation, refresh your shell's cache:",
      "      hash -r",
      "",
      "    Or start a new terminal session.",
      "  EOS",
      "end",
      "",
    ].join("\n")
  }

  private renderActionServerCask(build: ActionServerBuild, releaseTag: string): string {
    return this.renderActionServerCaskWithUrls(build, {
      linux: `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.linux.assetName}`,
      macosArm: `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.macosArm.assetName}`,
      macosIntel: build.macosIntel
        ? `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.macosIntel.assetName}`
        : undefined,
    })
  }

  private renderActionServerCaskWithUrls(
    build: ActionServerBuild,
    urls: { linux: string; macosArm: string; macosIntel?: string },
  ): string {
    const macIntelBlock = build.macosIntel ? [
      "    on_intel do",
      `      sha256 \"${build.macosIntel.sha256}\"`,
      `      url \"${urls.macosIntel}\"`,
      `      binary \"${build.macosIntel.assetName}\", target: \"action-server\"`,
      "    end",
      "",
    ] : []

    return [
      "cask \"action-server\" do",
      `  version \"${build.version}\"`,
      "",
      "  livecheck do",
      "    skip \"Updated by the tap's GitHub Actions workflow.\"",
      "  end",
      "",
      "  on_macos do",
      "    on_arm do",
      `      sha256 \"${build.macosArm.sha256}\"`,
      `      url \"${urls.macosArm}\"`,
      `      binary \"${build.macosArm.assetName}\", target: \"action-server\"`,
      "    end",
      "",
      ...macIntelBlock,
      "  end",
      "",
      "  on_linux do",
      `    sha256 \"${build.linux.sha256}\"`,
      `    url \"${urls.linux}\"`,
      `    binary \"${build.linux.assetName}\", target: \"action-server\"`,
      "  end",
      "",
      "  name \"Action Server\"",
      "  desc \"Action Server - Host AI agent actions via HTTP/MCP\"",
      "  homepage \"https://github.com/joshyorko/actions\"",
      "",
      "  caveats <<~EOS",
      "    If 'action-server' is not found after installation, refresh your shell's cache:",
      "      hash -r",
      "",
      "    Or start a new terminal session.",
      "",
      "    Usage:",
      "      action-server --help",
      "      action-server version",
      "  EOS",
      "end",
      "",
    ].join("\n")
  }

  private renderDevpodCask(baseContents: string, downloadUrl: string, version: string, sha256: string): string {
    const updatedContents = rewriteCaskUrl(
      baseContents
        .replace(/version ".*"/, `version "${version}"`)
        .replace(/sha256 x86_64_linux: (?::no_check|".*")/, `sha256 x86_64_linux: "${sha256}"`),
      downloadUrl,
    )

    return updatedContents.replace(
      /livecheck do\n(?:.*\n)*?\s+end\n/m,
      "livecheck do\n    skip \"Updated by the tap's GitHub Actions workflow.\"\n  end\n",
    )
  }

  private renderDevsyFormula(
    baseContents: string,
    build: DevsyCliBuild,
    urls: { amd64: string; arm64: string },
  ): string {
    return renderDevsyFormula(baseContents, {
      version: build.version,
      amd64Sha256: build.amd64.sha256,
      arm64Sha256: build.arm64.sha256,
      amd64Url: urls.amd64,
      arm64Url: urls.arm64,
    })
  }

  private renderDevsyDesktopCask(
    baseContents: string,
    downloadUrl: string,
    version: string,
    sha256: string,
  ): string {
    return renderDevsyDesktopCask(baseContents, { version, sha256, downloadUrl }, rewriteCaskUrl)
  }

  private renderT3CodeCask(baseContents: string, downloadUrl: string, version: string, sha256: string): string {
    const updatedContents = rewriteCaskUrl(
      baseContents
        .replace(/version ".*"/, `version "${version}"`)
        .replace(/sha256 x86_64_linux: (?::no_check|".*")/, `sha256 x86_64_linux: "${sha256}"`),
      downloadUrl,
    )

    return updatedContents.replace(
      /livecheck do\n(?:.*\n)*?\s+end\n/m,
      "livecheck do\n    skip \"Updated by the tap's GitHub Actions workflow.\"\n  end\n",
    )
  }

  @func()
  async ciCheck(
    packageId: string,
    githubToken?: Secret,
    codexDesktopConversionCommit?: string,
    codexDesktopPackageSource?: string,
  ): Promise<string> {
    this.setGithubToken(githubToken)

    const tap = this.source
    const ciConversionCommit = codexDesktopConversionCommit || "patchraptor-main"

    switch (packageId) {
      case "rcc": {
        const build = await this.buildRccArtifacts()
        const smokeTap = tap.withFile(
          "Casks/rcc.rb",
          dag.file(
            "rcc.rb",
            this.renderRccCaskWithUrls(build, {
              linux: `file:///artifacts/${build.linux.assetName}`,
              macosArm: `file:///artifacts/${build.macosArm.assetName}`,
              macosIntel: `file:///artifacts/${build.macosIntel.assetName}`,
            }),
          ),
        )

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.linux.assetName}`, build.container.file(build.linux.artifactPath))
          .withFile(`/artifacts/${build.macosArm.assetName}`, build.container.file(build.macosArm.artifactPath))
          .withFile(`/artifacts/${build.macosIntel.assetName}`, build.container.file(build.macosIntel.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("rcc"),
              "brew install --cask test/tap/rcc",
              "test -x \"$(brew --prefix)/bin/rcc\"",
              "rcc --version",
            ].join("\n"),
          ])
          .stdout()
      }
      case "action-server": {
        const build = await this.buildActionServerArtifacts()
        const smokeTap = tap.withFile(
          "Casks/action-server.rb",
          dag.file(
            "action-server.rb",
            this.renderActionServerCaskWithUrls(build, {
              linux: `file:///artifacts/${build.linux.assetName}`,
              macosArm: `file:///artifacts/${build.macosArm.assetName}`,
              macosIntel: build.macosIntel ? `file:///artifacts/${build.macosIntel.assetName}` : undefined,
            }),
          ),
        )

        let smoke = dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.linux.assetName}`, build.container.file(build.linux.artifactPath))
          .withFile(`/artifacts/${build.macosArm.assetName}`, build.container.file(build.macosArm.artifactPath))

        if (build.macosIntel) {
          smoke = smoke.withFile(`/artifacts/${build.macosIntel.assetName}`, build.container.file(build.macosIntel.artifactPath))
        }

        return smoke.withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("action-server"),
              "brew install --cask test/tap/action-server",
              "test -x \"$(brew --prefix)/bin/action-server\"",
              "action-server version",
            ].join("\n"),
          ])
          .stdout()
      }
      case "devpod-linux": {
        const build = await this.buildDevpodArtifact()
        const caskContents = await tap.file("Casks/devpod-linux.rb").contents()
        const updatedCask = this.renderDevpodCask(
          caskContents,
          `file:///artifacts/${build.asset.assetName}`,
          build.version,
          build.asset.sha256,
        )
        const smokeTap = tap.withFile("Casks/devpod-linux.rb", dag.file("devpod-linux.rb", updatedCask))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withUser("root")
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withExec([
            "bash",
            "-lc",
            "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends binutils zstd && rm -rf /var/lib/apt/lists/*",
          ])
          .withUser("linuxbrew")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.asset.assetName}`, build.container.file(build.asset.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("devpod-linux"),
              "brew install --cask test/tap/devpod-linux",
              "test -x \"$(brew --prefix)/bin/devpod\"",
              "test -x \"$(brew --prefix)/bin/devpod-desktop\"",
              "test -f \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
              "grep -q 'Exec=.*/bin/devpod-desktop %U' \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
              "grep -q 'x-scheme-handler/devpod' \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
              "test -f \"$HOME/.local/share/icons/hicolor/256x256@2/apps/devpod-desktop.png\"",
              "devpod version",
            ].join("\n"),
          ])
          .stdout()
      }
      case "t3code-cli-main": {
        const build = await this.buildT3Artifact(tap, "main")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const formulaContents = await tap.file("Formula/t3code-cli-main.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
        const smokeTap = tap.withFile("Formula/t3code-cli-main.rb", dag.file("t3code-cli-main.rb", updatedFormula))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withUser("linuxbrew")
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("t3code-cli-main"),
              "brew install test/tap/t3code-cli-main",
              "monitor=\"$(brew --prefix t3code-cli-main)/libexec/dist/resource-monitor/linux-x64/t3-resource-monitor\"",
              "test -x \"$monitor\"",
              "hello=\"$(\"$monitor\" </dev/null | head -n 1)\"",
              "\"$(brew --prefix node@24)/bin/node\" -e 'const value = JSON.parse(process.argv[1]); if (value.type !== \"hello\" || value.platform !== \"linux\" || value.arch !== \"x86_64\") process.exit(1)' \"$hello\"",
              "brew test test/tap/t3code-cli-main",
              "t3 --help",
            ].join("\n"),
          ])
          .stdout()
      }
      case "antigravity-cli": {
        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", tap)
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("antigravity-cli"),
              "brew install test/tap/antigravity-cli",
              "brew test test/tap/antigravity-cli",
              "agy --version",
              "agy --help",
            ].join("\n"),
          ])
          .stdout()
      }
      case "chatgpt": {
        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", tap)
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("chatgpt"),
              "brew install --cask test/tap/chatgpt",
              "test -x \"$(brew --prefix)/bin/chatgpt\"",
              "user_home=$(getent passwd \"$(id -un)\" | cut -d: -f6)",
              "test -f \"$user_home/.local/share/applications/chatgpt.desktop\"",
              "test -f \"$user_home/.local/share/pixmaps/chatgpt.png\"",
            ].join("\n"),
          ])
          .stdout()
      }
      case "devsy": {
        const build = await this.buildDevsyCliArtifacts()
        const formulaContents = await tap.file("Formula/devsy.rb").contents()
        const updatedFormula = this.renderDevsyFormula(formulaContents, build, {
          amd64: `file:///artifacts/${build.amd64.assetName}`,
          arm64: `file:///artifacts/${build.arm64.assetName}`,
        })
        const smokeTap = tap.withFile("Formula/devsy.rb", dag.file("devsy.rb", updatedFormula))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.amd64.assetName}`, build.container.file(build.amd64.artifactPath))
          .withFile(`/artifacts/${build.arm64.assetName}`, build.container.file(build.arm64.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("devsy"),
              "brew audit --formula test/tap/devsy",
              "brew install test/tap/devsy",
              "brew test --verbose test/tap/devsy",
              "devsy_home=/tmp/devsy-ci-home",
              "mkdir -p \"$devsy_home\"",
              `test "$(DEVSY_HOME="$devsy_home" devsy --version)" = "v${build.version}"`,
              "test -z \"$(find \"$devsy_home\" -type f -print -quit)\"",
            ].join("\n"),
          ])
          .stdout()
      }
      case "devsy-desktop": {
        const desktopBuild = await this.buildDevsyDesktopArtifact()
        const cliBuild = await this.buildDevsyCliArtifacts()
        const caskContents = await tap.file("Casks/devsy-desktop.rb").contents()
        const formulaContents = await tap.file("Formula/devsy.rb").contents()
        const updatedCask = this.renderDevsyDesktopCask(
          caskContents,
          `file:///artifacts/${desktopBuild.asset.assetName}`,
          desktopBuild.version,
          desktopBuild.asset.sha256,
        )
        const updatedFormula = this.renderDevsyFormula(formulaContents, cliBuild, {
          amd64: `file:///artifacts/${cliBuild.amd64.assetName}`,
          arm64: `file:///artifacts/${cliBuild.arm64.assetName}`,
        })
        const smokeTap = tap
          .withFile("Casks/devsy-desktop.rb", dag.file("devsy-desktop.rb", updatedCask))
          .withFile("Formula/devsy.rb", dag.file("devsy.rb", updatedFormula))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(
            `/artifacts/${desktopBuild.asset.assetName}`,
            desktopBuild.container.file(desktopBuild.asset.artifactPath),
          )
          .withFile(
            `/artifacts/${cliBuild.amd64.assetName}`,
            cliBuild.container.file(cliBuild.amd64.artifactPath),
          )
          .withFile(
            `/artifacts/${cliBuild.arm64.assetName}`,
            cliBuild.container.file(cliBuild.arm64.artifactPath),
          )
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("devsy-desktop"),
              "brew audit --formula test/tap/devsy",
              "brew audit --cask test/tap/devsy-desktop",
              "brew install test/tap/devsy",
              "brew install --cask test/tap/devsy-desktop",
              `test "$(devsy --version)" = "v${desktopBuild.version}"`,
              `test "$(readlink -f "$(brew --prefix)/bin/devsy")" = "$(brew --cellar)/devsy/${desktopBuild.version}/bin/devsy"`,
              "test -x \"$(brew --prefix)/bin/devsy-desktop\"",
              "! grep -q -- '--no-sandbox' \"$(brew --prefix)/bin/devsy-desktop\"",
              "test -f \"$HOME/.local/share/applications/devsy-desktop.desktop\"",
              "grep -q 'Exec=.*/bin/devsy-desktop %U' \"$HOME/.local/share/applications/devsy-desktop.desktop\"",
              "grep -q 'x-scheme-handler/devsy' \"$HOME/.local/share/applications/devsy-desktop.desktop\"",
              "test -f \"$HOME/.local/share/icons/hicolor/128x128/apps/devsy-desktop.png\"",
              "embedded_cli=$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -path '*/squashfs-root/resources/bin/devsy' -type f -print -quit)",
              "test -n \"$embedded_cli\"",
              `test "$(sha256sum "$embedded_cli" | awk '{print $1}')" = "${cliBuild.amd64.sha256}"`,
              "test -n \"$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -path '*/squashfs-root/usr/lib/libappindicator.so.1' -type f -print -quit)\"",
              "grep -q 'squashfs-root/AppRun' \"$(brew --prefix)/bin/devsy-desktop\"",
              "! grep -q 'exec .*\\.AppImage' \"$(brew --prefix)/bin/devsy-desktop\"",
              "test -n \"$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -path '*/squashfs-root/AppRun' -type f -perm -111 -print -quit)\"",
              "test -n \"$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -name 'Devsy_linux_x86_64.AppImage' -type f -perm -111 -print -quit)\"",
            ].join("\n"),
          ])
          .stdout()
      }
      case "fizzy-cli-master": {
        const build = await this.buildFizzyArtifact(tap, "master")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const formulaContents = await tap.file("Formula/fizzy-cli-master.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
        const smokeTap = tap.withFile("Formula/fizzy-cli-master.rb", dag.file("fizzy-cli-master.rb", updatedFormula))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("fizzy-cli-master"),
              "brew install test/tap/fizzy-cli-master",
              "brew test test/tap/fizzy-cli-master",
              "fizzy --version",
            ].join("\n"),
          ])
          .stdout()
      }
      case "fizzy-popper-self-hosted": {
        const build = await this.buildFizzyPopperSelfHostedArtifact(tap, "self-hosted")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const formulaContents = await tap.file("Formula/fizzy-popper-self-hosted.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
        const smokeTap = tap.withFile(
          "Formula/fizzy-popper-self-hosted.rb",
          dag.file("fizzy-popper-self-hosted.rb", updatedFormula),
        )

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("fizzy-popper-self-hosted"),
              "brew install test/tap/fizzy-popper-self-hosted",
              "brew test test/tap/fizzy-popper-self-hosted",
              "fizzy-popper --help",
            ].join("\n"),
          ])
          .stdout()
      }
      case "fizzy-symphony": {
        const build = await this.buildFizzySymphonyArtifact(tap, "main")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const formulaContents = await tap.file("Formula/fizzy-symphony.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
        const smokeTap = tap.withFile(
          "Formula/fizzy-symphony.rb",
          dag.file("fizzy-symphony.rb", updatedFormula),
        )

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("fizzy-symphony"),
              "brew install test/tap/fizzy-symphony",
              "brew test test/tap/fizzy-symphony",
              "fizzy-symphony --help",
            ].join("\n"),
          ])
          .stdout()
      }
      case "t3-code-linux": {
        const build = await this.buildT3CodeArtifact(tap, "main")
        const caskContents = await tap.file("Casks/t3-code-linux.rb").contents()
        const updatedCask = this.renderT3CodeCask(
          caskContents,
          `file:///artifacts/${build.assetName}`,
          build.version,
          build.sha256,
        )
        const smokeTap = tap.withFile("Casks/t3-code-linux.rb", dag.file("t3-code-linux.rb", updatedCask))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("t3-code-linux"),
              "brew install --cask test/tap/t3-code-linux",
              "test -x \"$(brew --prefix)/bin/t3-code-linux\"",
              "installed_dir=$(find \"$(brew --caskroom)/t3-code-linux\" -mindepth 1 -maxdepth 1 -type d -print -quit)",
              "test -n \"$installed_dir\"",
              "test -x \"$installed_dir/squashfs-root/AppRun\"",
              "grep -Fq 'squashfs-root/AppRun' \"$(brew --prefix)/bin/t3-code-linux\"",
              "! grep -Eq '^exec .*AppImage' \"$(brew --prefix)/bin/t3-code-linux\"",
              "test -f \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
              "grep -q 'Exec=.*/bin/t3-code-linux %U' \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
              "test -f \"$HOME/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png\"",
            ].join("\n"),
          ])
          .stdout()
      }
      case "headroom-self-hosted": {
        const build = await this.buildHeadroomArtifact()
        const formula = this.renderHeadroomFormula(
          `file:///artifacts/${build.assetName}`,
          build.version,
          build.sha256,
        )
        const smokeTap = tap.withNewFile("Formula/headroom-self-hosted.rb", formula)

        return dag
          .container()
          .from(BREW_IMAGE)
          .withUser("linuxbrew")
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("headroom-self-hosted"),
              "brew install test/tap/headroom-self-hosted",
              "brew test test/tap/headroom-self-hosted",
              "test -x \"$(brew --prefix)/bin/headroom\"",
              "headroom --help",
              "headroom proxy --help",
            ].join("\n"),
          ])
          .stdout()
      }
      case "codex-desktop-linux": {
        const officialBuild = await this.buildCodexDesktopLinuxOfficialArtifact(
          tap,
          ciConversionCommit,
          codexDesktopPackageSource,
        )
        const releaseUrl = `file:///artifacts/${officialBuild.assetName}`
        const officialCask = this.renderCodexDesktopOfficialCask(
          releaseUrl,
          officialBuild.version,
          officialBuild.sha256,
        )
        const smokeTap = tap.withFile(
          "Casks/codex-desktop.rb",
          dag.file("codex-desktop.rb", officialCask),
        )

        return dag
          .container()
          .from(BREW_IMAGE)
          .withUser("root")
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withExec([
            "bash",
            "-lc",
            "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends binutils tar xz-utils zstd && rm -rf /var/lib/apt/lists/*",
          ])
          .withUser("linuxbrew")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${officialBuild.assetName}`, officialBuild.container.file(officialBuild.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("codex-desktop-linux"),
              "CODEX_DESKTOP_SMOKE_TRACE=1",
              "set -x",
              "brew install --cask test/tap/codex-desktop",
              "test -x \"$(brew --prefix)/bin/codex-desktop\"",
              "installed_dir=$(find \"$(brew --caskroom)/codex-desktop\" -mindepth 1 -maxdepth 1 -type d ! -name '.metadata' -print -quit)",
              "test -x \"$installed_dir/opt/codex-desktop/ChatGPT\"",
              "test -x \"$installed_dir/opt/codex-desktop/start.sh\"",
              "! grep -Fq 'exec /opt/codex-desktop/start.sh' \"$(brew --prefix)/bin/codex-desktop\"",
              "codex-desktop --help >/tmp/codex-desktop-help.txt",
              "grep -q '^Usage:' /tmp/codex-desktop-help.txt",
              "test ! -e \"$installed_dir/usr/bin/codex-update-manager\"",
              "test -f \"$HOME/.local/share/applications/codex-desktop.desktop\"",
              "grep -Fq \"Exec=$(brew --prefix)/bin/codex-desktop %u\" \"$HOME/.local/share/applications/codex-desktop.desktop\"",
              "test -f \"$HOME/.local/share/icons/hicolor/256x256/apps/codex-desktop.png\"",
            ].join("\n"),
          ])
          .stdout()
      }

      case "vscode-insiders-linux": {
        const build = await this.buildVscodeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const caskContents = await tap.file("Casks/vscode-insiders-linux.rb").contents()
        const updatedCask = caskContents
          .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
          .replace(/version ".*"/, `version "${build.caskVersion}"`)
          .replace(/sha256 x86_64_linux: (?::no_check|".*")/, `sha256 x86_64_linux: "${sha256}"`)
        const smokeTap = tap.withFile("Casks/vscode-insiders-linux.rb", dag.file("vscode-insiders-linux.rb", updatedCask))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withUser("root")
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withExec([
            "bash",
            "-lc",
            "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends desktop-file-utils libglib2.0-bin shared-mime-info xdg-utils && rm -rf /var/lib/apt/lists/*",
          ])
          .withUser("linuxbrew")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("vscode-insiders-linux"),
              "mkdir -p \"$HOME/.local/share/applications\" \"$HOME/.local/share/icons/hicolor/512x512/apps\"",
              "printf '[Desktop Entry]\\nName=Legacy VS Code Insiders\\n' > \"$HOME/.local/share/applications/vscode-insiders-linux.desktop\"",
              "printf '[Desktop Entry]\\nName=Legacy VS Code Insiders URL Handler\\n' > \"$HOME/.local/share/applications/vscode-insiders-linux-url-handler.desktop\"",
              "printf 'legacy-icon' > \"$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png\"",
              "brew install --cask test/tap/vscode-insiders-linux",
              "test -x \"$(brew --prefix)/bin/code-insiders\"",
              "test -x \"$(brew --prefix)/bin/code-tunnel-insiders\"",
              "test -f \"$HOME/.local/share/applications/code-insiders.desktop\"",
              "test -f \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
              "test ! -e \"$HOME/.local/share/applications/vscode-insiders-linux.desktop\"",
              "test ! -e \"$HOME/.local/share/applications/vscode-insiders-linux-url-handler.desktop\"",
              "test -f \"$HOME/.local/share/mime/packages/code-insiders-workspace.xml\"",
              "test -f \"$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png\"",
              "test ! -e \"$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png\"",
              "grep -q 'CHROME_DESKTOP=code-insiders.desktop' \"$HOME/.local/share/applications/code-insiders.desktop\"",
              "grep -q 'Icon=.*/vscode-insiders.png' \"$HOME/.local/share/applications/code-insiders.desktop\"",
              "grep -q 'application/x-code-insiders-workspace;' \"$HOME/.local/share/applications/code-insiders.desktop\"",
              "grep -q -- '--open-url %U' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
              "grep -q 'Icon=.*/vscode-insiders.png' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
              "grep -q 'x-scheme-handler/vscode-insiders;' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
              "xdg-mime query default x-scheme-handler/vscode-insiders",
              "xdg-settings get default-url-scheme-handler vscode-insiders || true",
            ].join("\n"),
          ])
          .stdout()
      }
      case "voxtype": {
        const build = await this.buildVoxtypeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const formulaContents = await tap.file("Formula/voxtype.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
        const smokeTap = tap.withFile("Formula/voxtype.rb", dag.file("voxtype.rb", updatedFormula))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withUser("root")
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "apt-get update",
              "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libasound2",
              "rm -rf /var/lib/apt/lists/*",
            ].join("\n"),
          ])
          .withUser("linuxbrew")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("voxtype"),
              "brew install test/tap/voxtype",
              "test -x \"$(brew --prefix)/bin/voxtype\"",
              "test -f \"$(brew --prefix)/share/voxtype/default.toml\"",
              "brew test test/tap/voxtype",
              "voxtype --version",
            ].join("\n"),
          ])
          .stdout()
      }
      case "eitype": {
        const build = await this.buildEitypeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const formulaContents = await tap.file("Formula/eitype.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
        const smokeTap = tap.withFile("Formula/eitype.rb", dag.file("eitype.rb", updatedFormula))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withUser("root")
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withExec([
            "bash",
            "-lc",
            "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libxkbcommon0 && rm -rf /var/lib/apt/lists/*",
          ])
          .withUser("linuxbrew")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("eitype"),
              "brew install test/tap/eitype",
              "brew test test/tap/eitype",
              "test -x \"$(brew --prefix)/bin/eitype\"",
              "eitype --help",
            ].join("\n"),
          ])
          .stdout()
      }
      default:
        throw new Error(`ciCheck is not implemented for package: ${packageId}`)
    }
  }

  @func()
  async releaseMetadata(
    packageId: string,
    githubToken?: Secret,
    codexDesktopConversionCommit?: string,
    codexDesktopPackageSource?: string,
  ): Promise<string> {
    this.setGithubToken(githubToken)

    const tap = this.source

    switch (packageId) {
      case "rcc": {
        const build = await this.buildRccArtifacts()
        return json(this.rccReleaseMetadata(build))
      }
      case "action-server": {
        const build = await this.buildActionServerArtifacts()
        return json(this.actionServerReleaseMetadata(build))
      }
      case "devpod-linux": {
        const build = await this.buildDevpodArtifact()
        return json(this.devpodReleaseMetadata(build))
      }
      case "devsy": {
        const build = await this.buildDevsyCliArtifacts()
        return json(this.devsyCliReleaseMetadata(build))
      }
      case "devsy-desktop": {
        const build = await this.buildDevsyDesktopArtifact()
        return json(this.devsyDesktopReleaseMetadata(build))
      }
      case "t3code-cli-main": {
        const build = await this.buildT3Artifact(tap, "main")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(this.t3codeCliReleaseMetadata(build, sha256))
      }
      case "fizzy-cli-master": {
        const build = await this.buildFizzyArtifact(tap, "master")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(this.fizzyReleaseMetadata(build, sha256))
      }
      case "fizzy-popper-self-hosted": {
        const build = await this.buildFizzyPopperSelfHostedArtifact(tap, "self-hosted")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(this.fizzyPopperSelfHostedReleaseMetadata(build, sha256))
      }
      case "fizzy-symphony": {
        const build = await this.buildFizzySymphonyArtifact(tap, "main")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(this.fizzySymphonyReleaseMetadata(build, sha256))
      }
      case "t3-code-linux": {
        const build = await this.buildT3CodeArtifact(tap, "main")
        return json(this.t3CodeReleaseMetadata(build))
      }
      case "headroom-self-hosted": {
        const build = await this.buildHeadroomArtifact()
        return json(this.headroomReleaseMetadata(build))
      }
      case "codex-desktop-linux": {
        const build = await this.buildCodexDesktopLinuxOfficialArtifact(
          tap,
          codexDesktopConversionCommit,
          codexDesktopPackageSource,
        )
        return json(this.codexDesktopOfficialReleaseMetadata(build))
      }
      case "vscode-insiders-linux": {
        const build = await this.buildVscodeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(this.vscodeReleaseMetadata(build, sha256))
      }
      case "voxtype": {
        const build = await this.buildVoxtypeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(this.voxtypeReleaseMetadata(build, sha256))
      }
      case "eitype": {
        const build = await this.buildEitypeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(this.eitypeReleaseMetadata(build, sha256))
      }
      default:
        throw new Error(`releaseMetadata is not implemented for package: ${packageId}`)
    }
  }

  @func()
  async releaseBundle(
    packageId: string,
    githubToken?: Secret,
    codexDesktopConversionCommit?: string,
    codexDesktopPackageSource?: string,
  ): Promise<Directory> {
    this.setGithubToken(githubToken)

    const tap = this.source

    if (packageId === "buzz-linux") {
      const entry = this.packageEntry(packageId)
      if (entry.upstream.kind !== "github_release") {
        throw new Error("Expected GitHub release upstream for buzz-linux")
      }
      const version = await this.resolveUpstreamVersion(packageId)
      const sourceRef = await dag.git(entry.upstream.repo).tag(`desktop-v${version}`).commit()
      return dag.buzzLinuxSmoke().releaseBundle(tap, {
        sourceRepository: entry.upstream.repo,
        sourceRef,
        version,
        revision: "1",
      })
    }

    const ciLog = await this.ciCheck(
      packageId,
      githubToken,
      codexDesktopConversionCommit,
      codexDesktopPackageSource,
    )

    switch (packageId) {
      case "rcc": {
        const build = await this.buildRccArtifacts()
        const releaseTag = `rcc-${build.version}`
        const renderedCask = this.renderRccCask(build, releaseTag)
        const release = this.rccReleaseMetadata(build)

        return dag.directory()
          .withFile(`artifacts/${build.linux.assetName}`, build.container.file(build.linux.artifactPath))
          .withFile(`artifacts/${build.macosArm.assetName}`, build.container.file(build.macosArm.artifactPath))
          .withFile(`artifacts/${build.macosIntel.assetName}`, build.container.file(build.macosIntel.artifactPath))
          .withFile("homebrew/rcc.rb", dag.file("rcc.rb", renderedCask))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "action-server": {
        const build = await this.buildActionServerArtifacts()
        const releaseTag = `action-server-${build.version}`
        const renderedCask = this.renderActionServerCask(build, releaseTag)
        const release = this.actionServerReleaseMetadata(build)

        let bundle = dag.directory()
          .withFile(`artifacts/${build.linux.assetName}`, build.container.file(build.linux.artifactPath))
          .withFile(`artifacts/${build.macosArm.assetName}`, build.container.file(build.macosArm.artifactPath))
          .withFile("homebrew/action-server.rb", dag.file("action-server.rb", renderedCask))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))

        if (build.macosIntel) {
          bundle = bundle.withFile(`artifacts/${build.macosIntel.assetName}`, build.container.file(build.macosIntel.artifactPath))
        }

        return bundle
      }
      case "chatgpt": {
        const build = await this.buildChatgptArtifacts()
        const release = this.chatgptReleaseMetadata(build)
        const caskContents = await tap.file("Casks/chatgpt.rb").contents()
        const updatedCask = caskContents
          .replace(
            /url ".*"/,
            `url "https://github.com/${TAP_REPOSITORY}/releases/download/chatgpt-#{version}/chatgpt-#{version}-1.#{arch}.rpm"`,
          )
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 arm:[\s\S]*?x86_64_linux: ".*"/, [
            `sha256 arm:          "${build.arm64.sha256}",`,
            `       intel:        "${build.amd64.sha256}",`,
            `       arm64_linux:  "${build.arm64.sha256}",`,
            `       x86_64_linux: "${build.amd64.sha256}"`,
          ].join("\n"))

        return dag.directory()
          .withFile(`artifacts/${build.amd64.assetName}`, build.container.file(build.amd64.artifactPath))
          .withFile(`artifacts/${build.arm64.assetName}`, build.container.file(build.arm64.artifactPath))
          .withFile("homebrew/chatgpt.rb", dag.file("chatgpt.rb", updatedCask))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "devpod-linux": {
        const build = await this.buildDevpodArtifact()
        const releaseTag = `devpod-linux-${build.version}`
        const caskContents = await tap.file("Casks/devpod-linux.rb").contents()
        const updatedCask = this.renderDevpodCask(
          caskContents,
          `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.asset.assetName}`,
          build.version,
          build.asset.sha256,
        )
        const release = this.devpodReleaseMetadata(build)

        return dag.directory()
          .withFile(`artifacts/${build.asset.assetName}`, build.container.file(build.asset.artifactPath))
          .withFile("homebrew/devpod-linux.rb", dag.file("devpod-linux.rb", updatedCask))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "devsy": {
        const build = await this.buildDevsyCliArtifacts()
        const releaseTag = `devsy-${build.version}`
        const formulaContents = await tap.file("Formula/devsy.rb").contents()
        const updatedFormula = this.renderDevsyFormula(formulaContents, build, {
          amd64: `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.amd64.assetName}`,
          arm64: `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.arm64.assetName}`,
        })
        const release = this.devsyCliReleaseMetadata(build)

        return dag.directory()
          .withFile(`artifacts/${build.amd64.assetName}`, build.container.file(build.amd64.artifactPath))
          .withFile(`artifacts/${build.arm64.assetName}`, build.container.file(build.arm64.artifactPath))
          .withFile("homebrew/devsy.rb", dag.file("devsy.rb", updatedFormula))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "devsy-desktop": {
        const build = await this.buildDevsyDesktopArtifact()
        const releaseTag = `devsy-desktop-${build.version}`
        const caskContents = await tap.file("Casks/devsy-desktop.rb").contents()
        const updatedCask = this.renderDevsyDesktopCask(
          caskContents,
          `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.asset.assetName}`,
          build.version,
          build.asset.sha256,
        )
        const release = this.devsyDesktopReleaseMetadata(build)

        return dag.directory()
          .withFile(`artifacts/${build.asset.assetName}`, build.container.file(build.asset.artifactPath))
          .withFile("homebrew/devsy-desktop.rb", dag.file("devsy-desktop.rb", updatedCask))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "t3code-cli-main": {
        const build = await this.buildT3Artifact(tap, "main")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const release = this.t3codeCliReleaseMetadata(build, sha256)
        const formulaContents = await tap.file("Formula/t3code-cli-main.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "${String(release.download_url)}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile("homebrew/t3code-cli-main.rb", dag.file("t3code-cli-main.rb", updatedFormula))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "fizzy-cli-master": {
        const build = await this.buildFizzyArtifact(tap, "master")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const release = this.fizzyReleaseMetadata(build, sha256)
        const formulaContents = await tap.file("Formula/fizzy-cli-master.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "${String(release.download_url)}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile("homebrew/fizzy-cli-master.rb", dag.file("fizzy-cli-master.rb", updatedFormula))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "fizzy-popper-self-hosted": {
        const build = await this.buildFizzyPopperSelfHostedArtifact(tap, "self-hosted")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const release = this.fizzyPopperSelfHostedReleaseMetadata(build, sha256)
        const formulaContents = await tap.file("Formula/fizzy-popper-self-hosted.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "${String(release.download_url)}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile(
            "homebrew/fizzy-popper-self-hosted.rb",
            dag.file("fizzy-popper-self-hosted.rb", updatedFormula),
          )
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "fizzy-symphony": {
        const build = await this.buildFizzySymphonyArtifact(tap, "main")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const release = this.fizzySymphonyReleaseMetadata(build, sha256)
        const formulaContents = await tap.file("Formula/fizzy-symphony.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "${String(release.download_url)}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile(
            "homebrew/fizzy-symphony.rb",
            dag.file("fizzy-symphony.rb", updatedFormula),
          )
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "t3-code-linux": {
        const build = await this.buildT3CodeArtifact(tap, "main")
        const releaseTag = `t3-code-linux-${build.version}`
        const caskContents = await tap.file("Casks/t3-code-linux.rb").contents()
        const updatedCask = this.renderT3CodeCask(
          caskContents,
          `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.assetName}`,
          build.version,
          build.sha256,
        )
        const release = this.t3CodeReleaseMetadata(build)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile("homebrew/t3-code-linux.rb", dag.file("t3-code-linux.rb", updatedCask))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "headroom-self-hosted": {
        const build = await this.buildHeadroomArtifact()
        const release = this.headroomReleaseMetadata(build)
        const formula = this.renderHeadroomFormula(
          String(release.download_url),
          build.version,
          build.sha256,
        )

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withNewFile("homebrew/headroom-self-hosted.rb", formula)
          .withNewFile("release.json", json(release))
          .withNewFile("provenance.json", json(this.headroomProvenance(build)))
          .withNewFile("ci.log", ciLog)
      }
      case "codex-desktop-linux": {
        const build = await this.buildCodexDesktopLinuxOfficialArtifact(
          tap,
          codexDesktopConversionCommit,
          codexDesktopPackageSource,
        )
        const releaseTag = `codex-desktop-linux-${build.version}`
        const renderedCask = this.renderCodexDesktopOfficialCask(
          `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.assetName}`,
          build.version,
          build.sha256,
        )
        const release = this.codexDesktopOfficialReleaseMetadata(build)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile("homebrew/codex-desktop.rb", dag.file("codex-desktop.rb", renderedCask))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "vscode-insiders-linux": {
        const build = await this.buildVscodeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const release = this.vscodeReleaseMetadata(build, sha256)
        const caskContents = await tap.file("Casks/vscode-insiders-linux.rb").contents()
        const updatedCask = caskContents
          .replace(/url ".*"/, `url "${String(release.download_url)}"`)
          .replace(/version ".*"/, `version "${build.caskVersion}"`)
          .replace(/sha256 x86_64_linux: (?::no_check|".*")/, `sha256 x86_64_linux: "${sha256}"`)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile("homebrew/vscode-insiders-linux.rb", dag.file("vscode-insiders-linux.rb", updatedCask))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "voxtype": {
        const build = await this.buildVoxtypeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const release = this.voxtypeReleaseMetadata(build, sha256)
        const formulaContents = await tap.file("Formula/voxtype.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "${String(release.download_url)}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile("homebrew/voxtype.rb", dag.file("voxtype.rb", updatedFormula))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      case "eitype": {
        const build = await this.buildEitypeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const release = this.eitypeReleaseMetadata(build, sha256)
        const formulaContents = await tap.file("Formula/eitype.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "${String(release.download_url)}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile("homebrew/eitype.rb", dag.file("eitype.rb", updatedFormula))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
      }
      default:
        throw new Error(`releaseBundle is not implemented for package: ${packageId}`)
    }
  }

  /**
   * Build the latest stable Voxtype/Eitype pair for local Dakota installation.
   *
   * The generated formulae deliberately point at the bundle's container-local
   * artifact paths. The host installer rewrites those URLs to local file URLs
   * after exporting the directory; no GitHub release is required.
   */
  @func()
  async dictationBundle(githubToken?: Secret): Promise<Directory> {
    this.setGithubToken(githubToken)

    const tap = this.source
    const voxtypeRepository = "peteonrails/voxtype"
    const eitypeRepository = "Adam-D-Lewis/eitype"
    const voxtypeRelease = await this.resolveLatestStableRelease(voxtypeRepository)
    const eitypeRelease = await this.resolveLatestStableRelease(eitypeRepository)
    const voxtypeUpstreamTree = dag
      .git(`https://github.com/${voxtypeRepository}`)
      .ref(`refs/tags/${voxtypeRelease.tagName}`)
      .tree({ discardGitDir: true })

    const voxtypeBuild = await this.buildVoxtypePrebuiltArtifact(
      tap,
      `refs/tags/${voxtypeRelease.tagName}`,
    )
    const voxtypeCompanions = await this.downloadVoxtypeCompanions(
      voxtypeBuild.version,
      voxtypeRelease.tagName,
    )
    const voxtypeContainer = voxtypeBuild.container
      .withFile(voxtypeCompanions.osdPath, voxtypeCompanions.container.file(voxtypeCompanions.osdPath))
      .withFile(voxtypeCompanions.osdGtk4Path, voxtypeCompanions.container.file(voxtypeCompanions.osdGtk4Path))
      .withFile(voxtypeCompanions.audioBridgePath, voxtypeCompanions.container.file(voxtypeCompanions.audioBridgePath))
      .withExec([
        "node",
        "/tap/scripts/package-voxtype.mjs",
        "--upstream-dir",
        "/upstream",
        "--binary",
        "/tmp/voxtype-prebuilt",
        "--osd-binary",
        voxtypeCompanions.osdPath,
        "--osd-gtk4-binary",
        voxtypeCompanions.osdGtk4Path,
        "--audio-bridge-binary",
        voxtypeCompanions.audioBridgePath,
        "--version",
        voxtypeBuild.version,
        "--output",
        voxtypeBuild.artifactPath,
      ])
    const voxtype = { ...voxtypeBuild, container: voxtypeContainer }
    const eitype = await this.buildEitypeArtifact(
      tap,
      `refs/tags/${eitypeRelease.tagName}`,
    )
    const voxtypeSha256 = (
      await voxtype.container.withExec(["sha256sum", voxtype.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const eitypeSha256 = (
      await eitype.container.withExec(["sha256sum", eitype.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]

    const voxtypeVersionFromTag = voxtypeRelease.tagName.replace(/^v/, "")
    const eitypeVersionFromTag = eitypeRelease.tagName.replace(/^v/, "")
    if (voxtype.version !== voxtypeVersionFromTag) {
      throw new Error(
        `Voxtype release tag ${voxtypeRelease.tagName} does not match Cargo version ${voxtype.version}`,
      )
    }
    if (eitype.version !== eitypeVersionFromTag) {
      throw new Error(
        `Eitype release tag ${eitypeRelease.tagName} does not match Cargo version ${eitype.version}`,
      )
    }

    const voxtypeFormula = renderLocalFormula(
      await tap.file("Formula/voxtype.rb").contents(),
      voxtype.assetName,
      voxtype.version,
      voxtypeSha256,
    )
    const eitypeFormula = renderLocalFormula(
      await tap.file("Formula/eitype.rb").contents(),
      eitype.assetName,
      eitype.version,
      eitypeSha256,
    )
    const ciLog = await this.smokeDictationArtifacts(
      tap,
      voxtype,
      eitype,
      voxtypeFormula,
      eitypeFormula,
      voxtypeSha256,
      eitypeSha256,
    )
    const manifest = dictationManifest([
      {
        id: "voxtype",
        version: voxtype.version,
        upstreamTag: voxtypeRelease.tagName,
        upstreamCommit: voxtype.commit,
        artifact: voxtype.assetName,
        sha256: voxtypeSha256,
      },
      {
        id: "eitype",
        version: eitype.version,
        upstreamTag: eitypeRelease.tagName,
        upstreamCommit: eitype.commit,
        artifact: eitype.assetName,
        sha256: eitypeSha256,
      },
    ])

    return dag.directory()
      .withFile(`artifacts/${voxtype.assetName}`, voxtype.container.file(voxtype.artifactPath))
      .withFile(`artifacts/${eitype.assetName}`, eitype.container.file(eitype.artifactPath))
      .withNewFile("homebrew/voxtype.rb", voxtypeFormula)
      .withNewFile("homebrew/eitype.rb", eitypeFormula)
      .withNewFile("manifest.json", json(manifest))
      .withFile("acceptance/speech_long.wav", voxtypeUpstreamTree.file("tests/fixtures/vad/speech_long.wav"))
      .withNewFile("ci.log", ciLog)
  }

  @func()
  async recoveryExport(
    brewfile?: File,
    packageId?: string,
    fileServerBaseUrl = "http://127.0.0.1:8000/homebrew-tools-recovery",
    githubToken?: Secret,
  ): Promise<Directory> {
    if (brewfile && packageId) {
      throw new Error("Use either brewfile or packageId for recoveryExport, not both")
    }

    const entries = packageId
      ? parseRecoveryBrewfile(recoveryBrewfile(recoveryPackageSummaries().filter((entry) => entry.id === packageId)))
      : parseRecoveryBrewfile(brewfile ? await brewfile.contents() : recoveryBrewfile())
    const baseUrl = fileServerBaseUrl.replace(/\/+$/, "")
    let output = dag.directory().withNewFile("Brewfile", recoveryBrewfile(entries))
    const releases: Record<string, unknown>[] = []

    for (const entry of entries) {
      const bundle = await this.releaseBundle(entry.id, githubToken)
      const release = JSON.parse(await bundle.file("release.json").contents()) as Record<string, unknown>
      const renderedName = entry.homebrewPath.split("/").at(-1)

      if (!renderedName) {
        throw new Error(`Invalid Homebrew path for ${entry.id}: ${entry.homebrewPath}`)
      }

      const rendered = recoveryHomebrewContents(
        await bundle.file(`homebrew/${renderedName}`).contents(),
        entry.id,
        baseUrl,
      )
      const packageDirectory = dag.directory()
        .withDirectory("artifacts", bundle.directory("artifacts"))
        .withFile("release.json", bundle.file("release.json"))
        .withFile("ci.log", bundle.file("ci.log"))

      output = output
        .withDirectory(`packages/${entry.id}`, packageDirectory)
        .withNewFile(`tap/${entry.homebrewPath}`, rendered)
      releases.push({
        package: entry.id,
        kind: entry.kind,
        homebrew_path: `tap/${entry.homebrewPath}`,
        version: release.version,
        release_tag: release.release_tag,
      })
    }

    const checksumOutput = await dag.container()
      .from(NODE_IMAGE)
      .withMountedDirectory("/recovery", output)
      .withWorkdir("/recovery")
      .withExec([
        "bash",
        "-lc",
        "find packages -path '*/artifacts/*' -type f -print0 | sort -z | xargs -0 sha256sum",
      ])
      .stdout()
    const checksums = parseTextLines(checksumOutput).map((line) => {
      const [sha256, path] = line.split(/\s+/, 2)
      return { path, sha256 }
    })

    return output.withNewFile("manifest.json", json({
      schema_version: 1,
      file_server_base_url: baseUrl,
      tap_name: "joshyorko/tools",
      packages: releases.map((release) => ({
        ...release,
        artifacts: checksums
          .filter((artifact) => artifact.path.startsWith(`packages/${release.package}/artifacts/`))
          .map((artifact) => ({
            ...artifact,
            url: `${baseUrl}/${artifact.path}`,
          })),
      })),
    }))
  }

  @func()
  async codexDesktopOfflineSmoke(bundle: Directory): Promise<string> {
    const release = JSON.parse(await bundle.file("release.json").contents()) as {
      asset_name: string
      artifact_sha256: string
      package: string
    }
    if (release.package !== "codex-desktop-linux") {
      throw new Error(`Expected a Codex Desktop release bundle, got ${release.package}`)
    }

    const artifactPath = `artifacts/${release.asset_name}`
    const caskPath = "homebrew/codex-desktop.rb"
    const cask = (await bundle.file(caskPath).contents())
      .replace(/url ".*"/, `url "file:///artifacts/${release.asset_name}"`)
    const smokeTap = bundle.withFile("Casks/codex-desktop.rb", dag.file("codex-desktop.rb", cask))

    return dag
      .container()
      .from(BREW_IMAGE)
      .withUser("root")
      .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
      .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
      .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends binutils tar xz-utils zstd && rm -rf /var/lib/apt/lists/*",
      ])
      .withUser("linuxbrew")
      .withDirectory("/tap", smokeTap)
      .withFile(`/artifacts/${release.asset_name}`, bundle.file(artifactPath))
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "repo=$(brew --repository)",
          "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
          ...tapStagingCommands("codex-desktop-linux"),
          "CODEX_DESKTOP_SMOKE_TRACE=1",
          "set -x",
          `printf '%s  /artifacts/${release.asset_name}\\n' ${JSON.stringify(release.artifact_sha256)} | sha256sum -c -`,
          "brew install --cask test/tap/codex-desktop",
          "test -x \"$(brew --prefix)/bin/codex-desktop\"",
          "installed_dir=$(find \"$(brew --caskroom)/codex-desktop\" -mindepth 1 -maxdepth 1 -type d ! -name '.metadata' -print -quit)",
          "test -x \"$installed_dir/opt/codex-desktop/ChatGPT\"",
          "test -x \"$installed_dir/opt/codex-desktop/start.sh\"",
          "! grep -Fq 'exec /opt/codex-desktop/start.sh' \"$(brew --prefix)/bin/codex-desktop\"",
          "test ! -e \"$installed_dir/usr/bin/codex-update-manager\"",
          "build_info=$(find \"$installed_dir\" -path '*/.codex-linux/build-info.json' -print -quit)",
          "test -n \"$build_info\"",
          "grep -q 'upstream' \"$build_info\"",
          "staged_features=$(find \"$installed_dir\" -path '*/.codex-linux/linux-features-staged.json' -print -quit)",
          "test -n \"$staged_features\"",
          "codex-desktop --help >/tmp/codex-desktop-help.txt",
          "grep -q '^Usage:' /tmp/codex-desktop-help.txt",
          "codex-desktop --diagnose >/tmp/codex-desktop-diagnose.txt",
          "grep -q '/opt/codex-desktop/ChatGPT' /tmp/codex-desktop-diagnose.txt",
          "test -f \"$HOME/.local/share/applications/codex-desktop.desktop\"",
          "grep -Fq \"Exec=$(brew --prefix)/bin/codex-desktop %u\" \"$HOME/.local/share/applications/codex-desktop.desktop\"",
        ].join("\n"),
      ])
      .stdout()
  }

}
