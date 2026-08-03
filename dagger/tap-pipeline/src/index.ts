import { dag, CacheSharingMode, Container, Directory, File, Secret, argument, object, func } from "@dagger.io/dagger"
import { existsSync, readFileSync } from "node:fs"
import {
  changedCiPackagesFromPaths,
  listAutoUpdateSlots as slotSummaries,
  packageSummaries,
  packagedVersionForUpstreamComparison,
  parseAutoUpdateSlotId,
  packagesForAutoUpdateSlot as slotPackages,
  formatGitHeadVersion,
  isTransientUpstreamProbeError,
  releaseMetadataForPackage,
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
const GO_IMAGE = "golang:1.26-bookworm"
const RUST_IMAGE = "rust:1-bookworm"
const TAP_REPOSITORY = "joshyorko/homebrew-tools"
const GITHUB_AUTH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
const CODEX_DESKTOP_CONVERSION_REPO =
  process.env.CODEX_DESKTOP_CONVERSION_REPO || "https://github.com/joshyorko/codex-desktop-linux"
const CODEX_DESKTOP_CONVERSION_COMMIT =
  process.env.CODEX_DESKTOP_CONVERSION_COMMIT || readDefaultCodexDesktopConversionRef()
const CODEX_DESKTOP_DMG_URL = "https://persistent.oaistatic.com/codex-app-prod/ChatGPT.dmg"
const CODEX_DESKTOP_MANUAL_VERSION = "research.20260514171029.43c8bd1b5d4a"
const LEAN_CODEX_DESKTOP_LINUX_FEATURES = [
  "node-repl-reaper",
  "open-target-discovery",
  "read-aloud",
  "read-aloud-mcp",
  "chronicle-skysight",
  "record-and-replay",
  "x11-ewmh-computer-use",
]
const FULL_CODEX_DESKTOP_LINUX_FEATURES = [
  "agent-workspace",
  "api-key-model-visibility",
  "api-key-service-tier",
  "appshots",
  "authenticated-proxy",
  "codex-wrapper-updater",
  "conversation-mode",
  "copilot-reasoning-effort",
  "frameless-titlebar",
  "global-dictation",
  "mcp-helper-reaper",
  "node-repl-reaper",
  "omarchy-theme",
  "open-target-discovery",
  "persistent-status-panel",
  "pet-overlay",
  "project-task-sort",
  "read-aloud",
  "read-aloud-mcp",
  "chronicle-skysight",
  "record-and-replay",
  "remote-control-ui",
  "remote-mobile-control",
  "ui-tweaks",
  "x11-ewmh-computer-use",
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

function compactHttpTimestamp(value: string): string {
  if (!value || value === "unknown") {
    return "00000000000000"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "00000000000000"
  }

  return date.toISOString().replace(/\D/g, "").slice(0, 14)
}

function compactVersionSegment(value: string): string {
  const segment = value.replace(/[^0-9A-Za-z]+/g, "").slice(0, 12)
  return segment.length > 0 ? segment : "unknown"
}

function codexDesktopConversionCommit(value?: string): string {
  return value && value.length > 0 ? value : CODEX_DESKTOP_CONVERSION_COMMIT
}

function codexDesktopPackageVersion(dmgVersion: string, conversionCommit?: string): string {
  return `${dmgVersion}.conv.${compactVersionSegment(codexDesktopConversionCommit(conversionCommit))}`
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
    case "codex-release":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/codex-release.rb \"$tap_dir/Formula/\"",
      ]
    case "antigravity-cli":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/antigravity-cli.rb \"$tap_dir/Formula/\"",
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

type CodexReleaseBuild = {
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

type CodexDesktopBuild = {
  ok: true
  artifactPath: string
  assetName: string
  container: Container
  conversionCommit: string
  metadata: Record<string, unknown>
  metadataPath: string
  version: string
}

type CodexDesktopBuildFailure = {
  ok: false
  container: Container
  conversionCommit: string
  exitCode: number
  version: string
}

type CodexDesktopBuildAttempt = CodexDesktopBuild | CodexDesktopBuildFailure

type CodexDesktopDmgMetadata = {
  cacheSegment: string
  contentLength: string
  etag: string
  lastModified: string
  resolvedUrl: string
  sourceUrl: string
  version: string
}

type CodexDesktopDmgProbeResult =
  | ({ ok: true } & Omit<CodexDesktopDmgMetadata, "version">)
  | {
      ok: false
      reason: string
      sourceUrl: string
      transient: true
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

  private async resolveCodexDesktopDmgMetadata(
    sourceUrl = CODEX_DESKTOP_DMG_URL,
    conversionCommit?: string,
    dmgCacheBuster?: string,
  ): Promise<CodexDesktopDmgMetadata> {
    const raw = JSON.parse((await dag
      .container()
      .from(NODE_IMAGE)
      .withEnvVariable("CODEX_DESKTOP_DMG_CACHE_BUSTER", dmgCacheBuster || "default")
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        [
          "import { createHash } from 'node:crypto'",
          "const sourceUrl = process.argv[1]",
          "async function probe(url) {",
          "  const attempts = [",
          "    { method: 'HEAD', timeout: 10_000 },",
          "    { method: 'HEAD', timeout: 20_000 },",
          "    { method: 'GET', timeout: 20_000 },",
          "  ]",
          "  let lastError",
          "  for (const attempt of attempts) {",
          "    try {",
          "      const response = await fetch(url, {",
          "        method: attempt.method,",
          "        redirect: 'follow',",
          "        signal: AbortSignal.timeout(attempt.timeout),",
          "      })",
          "      if (!response.ok) {",
          "        throw new Error(`Failed to resolve ${url}: ${response.status} ${response.statusText}`)",
          "      }",
          "      return response",
          "    } catch (error) {",
          "      lastError = error",
          "    }",
          "  }",
          "  throw lastError",
          "}",
          "let response",
          "try {",
          "  response = await probe(sourceUrl)",
          "} catch (error) {",
          "  process.stdout.write(JSON.stringify({",
          "    ok: false,",
          "    transient: true,",
          "    sourceUrl,",
          "    reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),",
          "  }))",
          "  process.exit(0)",
          "}",
          "const normalizedHeader = (name, fallback) => {",
          "  const value = response.headers.get(name)",
          "  return value && value.length > 0 ? value : fallback",
          "}",
          "const lastModified = normalizedHeader('last-modified', 'unknown')",
          "const etag = normalizedHeader('etag', 'no-etag').replace(/^\"|\"$/g, '')",
          "const contentLength = normalizedHeader('content-length', 'unknown')",
          "const cacheSegment = createHash('sha256')",
          "  .update(`${lastModified}|${etag}|${contentLength}\\n`)",
          "  .digest('hex')",
          "process.stdout.write(JSON.stringify({",
          "  ok: true,",
          "  sourceUrl,",
          "  resolvedUrl: response.url,",
          "  lastModified,",
          "  etag,",
          "  contentLength,",
          "  cacheSegment,",
          "}))",
        ].join("\n"),
        sourceUrl,
      ])
      .stdout()).trim()) as CodexDesktopDmgProbeResult

    if (!raw.ok) {
      throw new TransientUpstreamProbeError(`Skipped upstream probe for ${sourceUrl}: ${raw.reason}`)
    }

    return {
      cacheSegment: raw.cacheSegment,
      contentLength: raw.contentLength,
      etag: raw.etag,
      lastModified: raw.lastModified,
      resolvedUrl: raw.resolvedUrl,
      sourceUrl: raw.sourceUrl,
      version: codexDesktopPackageVersion(
        `dmg.${compactHttpTimestamp(raw.lastModified)}.${raw.cacheSegment.slice(0, 12)}`,
        conversionCommit,
      ),
    }
  }

  @func()
  async codexDesktopDmgReport(codexDmg: File): Promise<string> {
    return dag
      .container()
      .from(NODE_IMAGE)
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends file jq p7zip-full && rm -rf /var/lib/apt/lists/*",
      ])
      .withFile("/inputs/Codex.dmg", codexDmg)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "sha=$(sha256sum /inputs/Codex.dmg | awk '{print $1}')",
          "bytes=$(wc -c < /inputs/Codex.dmg | tr -d ' ')",
          "kind=$(file -b /inputs/Codex.dmg)",
          "entries=$({ 7zz l -ba /inputs/Codex.dmg || 7z l -ba /inputs/Codex.dmg || true; } 2>/dev/null | awk 'NR <= 200 {$1=$1; print}' | jq -R -s 'split(\"\\n\")[:-1]')",
          "jq -n --arg package codex-desktop-linux --arg repo \"" + CODEX_DESKTOP_CONVERSION_REPO + "\" --arg commit \"" + CODEX_DESKTOP_CONVERSION_COMMIT + "\" --arg sha \"$sha\" --arg bytes \"$bytes\" --arg kind \"$kind\" --argjson entries \"$entries\" '{package: $package, upstream_conversion_repo: $repo, upstream_conversion_commit: $commit, codex_dmg_sha256: $sha, codex_dmg_bytes: ($bytes | tonumber), codex_dmg_file_type: $kind, dmg_listing_sample: $entries}'",
        ].join("\n"),
      ])
      .stdout()
  }

  @func()
  async codexDesktopRendererReport(codexDmg?: File): Promise<string> {
    if (!codexDmg) {
      return json({
        package: "codex-desktop-linux",
        status: "not_started",
        browser_mode_status: "research",
        requires_codex_dmg_input: true,
        loopback_only_default: true,
      })
    }

    const dmgReport = JSON.parse(await this.codexDesktopDmgReport(codexDmg)) as Record<string, unknown>
    return json({
      ...dmgReport,
      status: "inspection_only",
      browser_mode_status: "research",
      serves_extracted_renderer: false,
      required_next_steps: [
        "Extract app metadata and detect Electron version from the explicit DMG input.",
        "Generate a renderer/preload surface inventory.",
        "Test a loopback-only browser shim against codex app-server.",
      ],
    })
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
      case "devpod-linux":
        return `devpod-linux-${version}`
      case "devsy":
        return `devsy-${version}`
      case "devsy-desktop":
        return `devsy-desktop-${version}`
      case "buzz-linux":
        return `buzz-linux-${version.replace(/,/g, "-")}`
      case "t3code-cli-main":
        return `t3code-cli-main-${version}`
      case "codex-release":
        return `codex-release-${version}`
      case "fizzy-cli-master":
        return `fizzy-cli-master-${version}`
      case "fizzy-popper-self-hosted":
        return `fizzy-popper-self-hosted-${version}`
      case "fizzy-symphony":
        return `fizzy-symphony-${version}`
      case "t3-code-linux":
        return `t3-code-linux-${version}`
      case "codex-desktop-linux":
        return `codex-desktop-linux-${version}`
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
    return dag
      .container()
      .from(NODE_IMAGE)
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
      .withMountedCache(
        "/root/.cargo/registry",
        dag.cacheVolume("tap-pipeline-codex-desktop-cargo-registry-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withMountedCache(
        "/root/.cargo/git",
        dag.cacheVolume("tap-pipeline-codex-desktop-cargo-git-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends 7zip ca-certificates curl file g++ git jq make pkg-config python3 p7zip-full sudo tar unzip xz-utils",
          "npm install -g node-gyp",
          "rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
      .withEnvVariable("PATH", "/root/.local/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
      .withEnvVariable("DEBIAN_FRONTEND", "noninteractive")
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

  private codexReleaseMetadata(build: CodexReleaseBuild, sha256: string): Record<string, unknown> {
    return releaseMetadataForPackage("codex-release", {
      version: build.version,
      releaseTag: `codex-release-${build.version}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/codex-release-${build.version}/${build.assetName}`,
      releaseTitle: `Codex release ${build.version}`,
      releaseNotes: `Codex fork snapshot from joshyorko/codex@${build.commit} (tap-release branch).`,
      commitMessage: `Update codex-release formula to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/joshyorko/codex",
        ref: "tap-release",
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private codexReleaseLocalMetadata(build: CodexReleaseBuild, sha256: string): Record<string, unknown> {
    return releaseMetadataForPackage("codex-release", {
      version: build.version,
      releaseTag: `codex-release-${build.version}`,
      assetName: build.assetName,
      artifactSha256: sha256,
      downloadUrl: "file://${CODEX_RELEASE_LOCAL_ARTIFACT}",
      releaseTitle: `Local Codex release ${build.version}`,
      releaseNotes: `Local-only Homebrew install bundle built from joshyorko/codex@${build.commit} on this machine.`,
      commitMessage: `Build local codex-release formula for ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/joshyorko/codex",
        ref: "tap-release",
        version: build.version,
        commit: build.commit,
      },
    })
  }

  private async buildLocalCodexReleaseArtifact(
    codexReleaseArtifact: File,
    codexCommit?: string,
  ): Promise<CodexReleaseBuild> {
    const assetName = await codexReleaseArtifact.name()
    const prefix = "codex-release-"
    const suffix = ".tar.gz"

    if (!assetName.startsWith(prefix) || !assetName.endsWith(suffix)) {
      throw new Error(`Expected artifact name like codex-release-<version>.tar.gz, got: ${assetName}`)
    }

    const version = assetName.slice(prefix.length, -suffix.length)
    const parsedCommit = version.split(".").at(-1) ?? "unknown"
    const artifactPath = `/inputs/${assetName}`
    const container = dag
      .container()
      .from(NODE_IMAGE)
      .withFile(artifactPath, codexReleaseArtifact)

    return {
      artifactPath,
      assetName,
      commit: codexCommit && codexCommit.length > 0 ? codexCommit : parsedCommit,
      container,
      version,
    }
  }

  private async renderCodexReleaseLocalFormula(version: string, sha256: string): Promise<string> {
    const formulaContents = await this.source.file("Formula/codex-release.rb").contents()

    return formulaContents
      .replace(/url ".*"/, 'url "file://#{ENV.fetch("CODEX_RELEASE_LOCAL_ARTIFACT")}"')
      .replace(/version ".*"/, `version "${version}"`)
      .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
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

  private codexDesktopReleaseMetadata(build: CodexDesktopBuild, sha256: string): Record<string, unknown> {
    return {
      package: "codex-desktop-linux",
      kind: "codex_desktop_linux_cask",
      homebrew_path: "Casks/codex-desktop.rb",
      version: build.version,
      release_tag: `codex-desktop-linux-${build.version}`,
      asset_name: build.assetName,
      artifact_sha256: sha256,
      download_url: "file://${CODEX_DESKTOP_LOCAL_ARTIFACT}",
      release_title: `Codex Desktop Linux ${build.version}`,
      release_notes: `Local-only Homebrew artifact built by converting the official upstream Codex.dmg from ${CODEX_DESKTOP_DMG_URL} into a Linux Electron runtime on this machine.`,
      commit_message: `Build local codex-desktop cask ${build.version}`,
      upstream: {
        kind: "http_file",
        url: CODEX_DESKTOP_DMG_URL,
        version: build.version,
        commit: build.conversionCommit,
      },
      ...build.metadata,
    }
  }

  private renderCodexDesktopLocalCask(version: string, sha256: string): string {
    return `cask "codex-desktop" do
  version "${version}"
  sha256 "${sha256}"

  url "file://#{ENV.fetch("CODEX_DESKTOP_LOCAL_ARTIFACT")}"
  name "Codex Desktop"
  desc "Linux runtime for a locally converted Codex Desktop app"
  homepage "https://github.com/joshyorko/homebrew-tools"

  livecheck do
    skip "Built locally from the official upstream Codex.dmg input."
  end

  depends_on formula: "desktop-file-utils"

  binary "bin/codex-desktop", target: "codex-desktop"
  artifact "share/applications/codex-desktop.desktop",
           target: "#{Dir.home}/.local/share/applications/codex-desktop.desktop"
  artifact "share/icons/hicolor/512x512/apps/codex-desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/codex-desktop.png"
  artifact "share/icons/hicolor/256x256/apps/codex-desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png"

  preflight do
    require "json"
    require "shellwords"
    require "time"
    cli_installer_url = "https://chatgpt.com/codex/install.sh"
    discover_codex_cli_path = lambda do
      path = which("codex")&.to_s || ["#{Dir.home}/.local/bin/codex", "#{HOMEBREW_PREFIX}/bin/codex"].find { |candidate| File.executable?(candidate) }
      path&.to_s
    end
    cli_path = discover_codex_cli_path.call
    cli_version_raw = cli_path ? %x{#{cli_path.shellescape} --version 2>&1}.strip : ""
    cli_version = cli_version_raw[/[0-9]+(?:\.[0-9]+)+(?:[-+][^[:space:]]+)?/] || ""
    cli_source = "none"
    cli_result = "failed"
    cli_version_status = "missing"
    codex_already_installed =
      !which("codex").nil? ||
      ["#{Dir.home}/.local/bin/codex", "#{HOMEBREW_PREFIX}/bin/codex"].any? do |candidate|
        File.executable?(candidate)
      end

    if ENV["CODEX_DESKTOP_SKIP_CLI_INSTALL"].to_s == "1"
      cli_source = "skipped"
      cli_result = "skipped"
      cli_version_status = cli_path ? "unknown" : "missing"
      opoo "Skipping Codex CLI install because CODEX_DESKTOP_SKIP_CLI_INSTALL=1"
    elsif codex_already_installed
      cli_source = "existing"
      cli_result = "existing"
      cli_version_status = "unknown"
      ohai "Codex CLI already available; skipping the official installer"
    else
      cli_source = "official-installer"
      ohai "Installing the Codex CLI from #{cli_installer_url}"
      system_command "/bin/sh",
                     args:         ["-c", "curl -fsSL #{cli_installer_url} | sh"],
                     print_stdout: true,
                     print_stderr: true
      cli_path = discover_codex_cli_path.call
      raise "Official Codex CLI installer completed without an executable codex command" unless cli_path && File.executable?(cli_path)
      cli_version_raw = %x{#{cli_path.shellescape} --version 2>&1}.strip
      cli_version = cli_version_raw[/[0-9]+(?:\.[0-9]+)+(?:[-+][^[:space:]]+)?/] || ""
      cli_result = "installed"
      cli_version_status = "unknown"
    end

    FileUtils.mkdir_p "#{staged_path}/share/codex-desktop"
    File.write "#{staged_path}/share/codex-desktop/cli-install-provenance.json",
               JSON.generate({
                 cli_path: cli_path,
                 cli_version: cli_version,
                 cli_version_raw: cli_version_raw,
                 cli_version_status: cli_version_status,
                 cli_source: cli_source,
                 cli_result: cli_result,
                 installer_url: cli_installer_url,
                 timestamp: Time.now.utc.iso8601,
               }) + "\n"

    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/512x512/apps"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/256x256/apps"

    desktop_file = "#{staged_path}/share/applications/codex-desktop.desktop"
    desktop_contents = File.read(desktop_file)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/codex-desktop desktop %U")
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/codex-desktop.png"
    )
    desktop_contents.gsub!(/^StartupWMClass=.*/, "StartupWMClass=Codex")
    desktop_contents << "StartupWMClass=Codex\\n" unless desktop_contents.match?(/^StartupWMClass=/)
    desktop_contents.gsub!(/^X-GNOME-WMClass=.*/, "X-GNOME-WMClass=Codex")
    desktop_contents << "X-GNOME-WMClass=Codex\\n" unless desktop_contents.match?(/^X-GNOME-WMClass=/)
    mime_type = "MimeType=x-scheme-handler/codex;x-scheme-handler/codex-browser-sidebar;"
    if desktop_contents.match?(/^MimeType=/)
      desktop_contents.gsub!(/^MimeType=.*/, mime_type)
    else
      desktop_contents << "#{mime_type}\\n"
    end
    File.write(desktop_file, desktop_contents)
  end

  postflight do
    applications_dir = "#{Dir.home}/.local/share/applications"
    desktop_id = "codex-desktop.desktop"
    desktop_target = "#{applications_dir}/#{desktop_id}"
    xdg_mime = [
      "/usr/bin/xdg-mime",
      "/bin/xdg-mime",
      "#{HOMEBREW_PREFIX}/bin/xdg-mime",
    ].find { |path| File.executable?(path) }
    update_desktop_database = [
      "/usr/bin/update-desktop-database",
      "/bin/update-desktop-database",
      "#{HOMEBREW_PREFIX}/bin/update-desktop-database",
    ].find { |path| File.executable?(path) }

    FileUtils.chmod 0755, desktop_target if File.exist?(desktop_target)
    if xdg_mime
      system xdg_mime, "default", desktop_id, "x-scheme-handler/codex"
      system xdg_mime, "default", desktop_id, "x-scheme-handler/codex-browser-sidebar"
    end
    system update_desktop_database, applications_dir if update_desktop_database
  end

  uninstall_postflight do
    require "socket"

    control_socket = "#{Dir.home}/.codex/app-server-control/app-server-control.sock"

    stale_control_socket = false
    if File.socket?(control_socket)
      begin
        UNIXSocket.open(control_socket).close
      rescue SystemCallError
        stale_control_socket = true
      end
    end

    if stale_control_socket
      FileUtils.rm_f control_socket
    end
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/codex-desktop.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/codex-desktop.png",
    "#{Dir.home}/.local/share/icons/hicolor/256x256/apps/codex-desktop.png",
  ]

  caveats <<~EOS
    This cask installs a local artifact generated on this machine from the official OpenAI DMG.
    No converted Codex Desktop app payload is distributed by the tap.

    The Codex CLI is installed from the official OpenAI installer during preflight:
      curl -fsSL https://chatgpt.com/codex/install.sh | sh
    It is no longer pulled in through a Homebrew 'codex' cask. Set
    CODEX_DESKTOP_SKIP_CLI_INSTALL=1 to skip this step if you manage 'codex' yourself.

    Launch from your app grid as Codex Desktop, or run:
      codex-desktop

    Logs and diagnostics:
      codex-desktop logs
      codex-desktop logs --follow
      codex-desktop doctor
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

  private async buildCodexReleaseArtifact(
    tap: Directory,
    ref: string,
    version?: string,
  ): Promise<CodexReleaseBuild> {
    void tap
    const entry = this.packageEntry("codex-release")

    if (entry.upstream.kind !== "git" || entry.autoUpdate.kind !== "git_head_sha") {
      throw new Error("Expected codex-release to use a git-head auto-update strategy")
    }

    const resolvedGitHead = version && version.length > 0
      ? undefined
      : await this.resolveGitHeadVersion(entry.upstream.repo, ref, entry.autoUpdate)
    const commit = resolvedGitHead?.commit ?? await dag.git(entry.upstream.repo).ref(ref).commit()
    const resolvedVersion = version && version.length > 0 ? version : resolvedGitHead?.version

    if (!resolvedVersion) {
      throw new Error("Failed to resolve codex-release version")
    }

    const assetName = `codex-release-${resolvedVersion}.tar.gz`
    const artifactPath = `/tmp/${assetName}`
    const releaseTag = `codex-release-${resolvedVersion}`
    const release = await this.fetchJson(
      `${githubApiRepoUrl(entry.upstream.repo)}/releases/tags/${encodeURIComponent(releaseTag)}`,
    ) as {
      assets: Array<{ name: string; browser_download_url: string }>
    }
    const asset = release.assets.find((candidate) => candidate.name === assetName)

    if (!asset) {
      const names = release.assets.map((candidate) => candidate.name).sort().join(", ") || "none"
      throw new Error(`Missing Codex Linux release asset ${assetName} on ${releaseTag}; found: ${names}`)
    }

    let container = this.githubApiContainer()
    container = this.downloadAsset(container, asset.browser_download_url, artifactPath)

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

  private async codexReleaseSmokeLog(tap: Directory, build: CodexReleaseBuild, sha256: string): Promise<string> {
    const formulaContents = await tap.file("Formula/codex-release.rb").contents()
    const updatedFormula = formulaContents
      .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
      .replace(/version ".*"/, `version "${build.version}"`)
      .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
    const smokeTap = tap.withFile("Formula/codex-release.rb", dag.file("codex-release.rb", updatedFormula))

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
          ...tapStagingCommands("codex-release"),
          "brew install test/tap/codex-release",
          "test -x \"$(brew --prefix)/bin/codex\"",
          "brew test test/tap/codex-release",
          "codex --help",
        ].join("\n"),
      ])
      .stdout()
  }

  private async buildCodexDesktopFixtureArtifact(tap: Directory): Promise<CodexDesktopBuild> {
    const version = "fixture.0"
    const assetName = `codex-desktop-linux-${version}.tar.gz`
    const artifactPath = `/tmp/${assetName}`
    const metadataPath = "/tmp/codex-desktop-linux-metadata.json"
    const container = dag
      .container()
      .from(NODE_IMAGE)
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tar && rm -rf /var/lib/apt/lists/*",
      ])
      .withDirectory("/tap", tap)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "tar --version | grep -q 'GNU tar'",
          "mkdir -p /work/fixture-app/resources/node-runtime/bin /work/fixture-app/resources/plugins/openai-bundled/plugins/computer-use/bin /work/fixture-app/resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/x64 /work/fixture-app/resources/plugins/openai-bundled/plugins/chrome/scripts /work/fixture-app/.codex-linux /work/fixture-app/content/webview/assets /work/reports",
          "cat > /work/fixture-app/start.sh <<'SH'",
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          "if [ \"${1:-}\" = web ] && [ \"${2:-}\" = --inspect ]; then",
          "  printf '%s\\n' '{\"package\":\"codex-desktop-linux\",\"mode\":\"devcontainer-web\",\"loopback_only_default\":true}'",
          "  exit 0",
          "fi",
          "if [ \"${1:-}\" = web ]; then",
          "  echo 'codex-desktop web is now served by: codex-desktop serve --workspace <path> --profile <path>' >&2",
          "  exit 64",
          "fi",
          "echo \"fixture desktop launch:$*\"",
          "echo \"fixture codex path:$(command -v codex || true)\"",
          "echo \"fixture chrome user data:${CODEX_CHROME_USER_DATA_DIR:-}\"",
          "echo \"fixture editor:${EDITOR:-}\"",
          "SH",
          "chmod +x /work/fixture-app/start.sh",
          "printf '#!/usr/bin/env bash\\necho electron fixture\\n' > /work/fixture-app/electron",
          "chmod +x /work/fixture-app/electron",
          "printf '#!/usr/bin/env bash\\ncase \"${1:-}\" in\\n  -v) echo v22.22.2 ;;\\n  *check-extension-installed.js) echo \"{\\\\\\\"installed\\\\\\\":true,\\\\\\\"registered\\\\\\\":true,\\\\\\\"enabled\\\\\\\":true}\" ;;\\n  *) echo node fixture ;;\\nesac\\n' > /work/fixture-app/resources/node-runtime/bin/node",
          "chmod +x /work/fixture-app/resources/node-runtime/bin/node",
          "printf '#!/usr/bin/env bash\\necho computer use fixture\\n' > /work/fixture-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux",
          "chmod +x /work/fixture-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux",
          "printf '#!/usr/bin/env bash\\necho cosmic fixture\\n' > /work/fixture-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-cosmic",
          "chmod +x /work/fixture-app/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-cosmic",
          "printf '#!/usr/bin/env bash\\necho chrome native host fixture\\n' > /work/fixture-app/resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/x64/extension-host",
          "chmod +x /work/fixture-app/resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/x64/extension-host",
          "printf '{\"extensionId\":\"hehggadaopoacecdllhhajmbjkdcmajg\",\"extensionHostName\":\"com.openai.codexextension\"}\\n' > /work/fixture-app/resources/plugins/openai-bundled/plugins/chrome/scripts/extension-id.json",
          "printf '#!/usr/bin/env node\\n' > /work/fixture-app/resources/plugins/openai-bundled/plugins/chrome/scripts/check-extension-installed.js",
          "printf 'fixture-asar' > /work/fixture-app/resources/app.asar",
          "printf '41.3.0\\n' > /work/fixture-app/version",
          "printf 'fixture-png' > /work/fixture-app/.codex-linux/codex-desktop.png",
          "printf 'official-app-icon' > /work/fixture-app/content/webview/assets/app-fixture_hash.png",
          "printf 'body{background-color:#0000}\\n[data-codex-window-type=electron]:not([data-codex-os=win32]) body{background:0 0}\\n[data-codex-window-type=electron]:not([data-codex-os=win32]) .app-shell-left-panel{background:color-mix(in srgb, var(--color-token-editor-background) 55%%, transparent)}\\n.main-surface{background-color:var(--color-token-main-surface-primary)}\\n' > /work/fixture-app/content/webview/assets/app-main-fixture.css",
          "printf 'const sshTitle = `SSH connections from this Mac`\\n' > /work/fixture-app/content/webview/assets/remote-connections-settings-fixture.js",
          "printf '{\"electronVersion\":\"41.3.0\",\"appDir\":\"/work/fixture-app\"}\\n' > /work/reports/rebuild-report.json",
          "printf '{\"mainBundle\":\"main.js\",\"patches\":[{\"id\":\"fixture\",\"status\":\"changed\"}]}\\n' > /work/reports/patch-report.json",
        ].join("\n"),
      ])
      .withExec([
        "node",
        "/tap/scripts/package-codex-desktop-linux.mjs",
        "--app-dir",
        "/work/fixture-app",
        "--version",
        version,
        "--conversion-commit",
        CODEX_DESKTOP_CONVERSION_COMMIT,
        "--rebuild-report",
        "/work/reports/rebuild-report.json",
        "--patch-report",
        "/work/reports/patch-report.json",
        "--metadata-output",
        metadataPath,
        "--output",
        artifactPath,
      ])

    const metadata = JSON.parse(await container.file(metadataPath).contents()) as Record<string, unknown>

    return {
      ok: true,
      artifactPath,
      assetName,
      container,
      conversionCommit: CODEX_DESKTOP_CONVERSION_COMMIT,
      metadata,
      metadataPath,
      version,
    }
  }

  private async buildCodexDesktopArtifact(
    tap: Directory,
    codexDmg: File,
    version = CODEX_DESKTOP_MANUAL_VERSION,
    dmgMetadata?: CodexDesktopDmgMetadata,
    requestedConversionCommit?: string,
    requestedLinuxFeatures?: string,
  ): Promise<CodexDesktopBuildAttempt> {
    const assetName = `codex-desktop-linux-${version}.tar.gz`
    const artifactPath = `/tmp/${assetName}`
    const metadataPath = "/work/codex-desktop-linux-metadata.json"
    const linuxFeatures = codexDesktopLinuxFeatureList(requestedLinuxFeatures)
    const conversionRef = dag.git(CODEX_DESKTOP_CONVERSION_REPO).ref(
      codexDesktopConversionCommit(requestedConversionCommit),
    )
    const conversionCommit = await conversionRef.commit()
    const installContainer = this.codexDesktopBaseContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/conversion", conversionRef.tree({ discardGitDir: true }))
      .withFile("/inputs/Codex.dmg", codexDmg)
      .withWorkdir("/conversion")
      .withEnvVariable("CODEX_INSTALL_DIR", "/work/codex-app")
      .withEnvVariable("CODEX_INSTALL_ALLOW_RUNNING", "1")
      .withEnvVariable("CODEX_LINUX_ENABLE_COMPUTER_USE_UI", "1")
      .withEnvVariable("CODEX_LINUX_FEATURES_CONFIG", "/work/linux-features.json")
      .withEnvVariable("CODEX_ELECTRON_CACHE_DIR", "/root/.cache/codex-desktop/electron")
      .withEnvVariable("CODEX_MANAGED_NODE_CACHE_DIR", "/root/.cache/codex-desktop/node-runtime")
      .withEnvVariable("CODEX_PATCH_REPORT_JSON", "/work/reports/patch-report.json")
      .withEnvVariable("CODEX_REBUILD_REPORT_JSON", "/work/reports/rebuild-report.json")
      .withEnvVariable("CODEX_ACCEPTANCE_DECISION_JSON", "/work/reports/upstream-dmg-decision.json")
      .withExec([
        "bash",
        "-lc",
        [
          "set +e",
          "(",
          "  set -euo pipefail",
          "  mkdir -p /work/reports",
          `  printf '%s\\n' '${JSON.stringify({ enabled: linuxFeatures })}' > /work/linux-features.json`,
          "  node /tap/scripts/patch-codex-desktop-conversion.mjs --conversion-dir /conversion",
          "  bash scripts/install-deps.sh",
          "  export PATH=\"/root/.local/bin:$PATH\"",
          "  command -v 7zz",
          "  ./install.sh --fresh /inputs/Codex.dmg",
          ")",
          "install_status=$?",
          "printf '%s\\n' \"$install_status\" > /work/reports/install-exit-code",
          "exit 0",
        ].join("\n"),
      ])

    const exitCode = Number(
      (await installContainer.file("/work/reports/install-exit-code").contents()).trim(),
    )
    if (exitCode !== 0) {
      return {
        ok: false,
        container: installContainer,
        conversionCommit,
        exitCode,
        version,
      }
    }

    const container = installContainer.withExec([
      "node",
      "/tap/scripts/package-codex-desktop-linux.mjs",
      "--app-dir",
      "/work/codex-app",
      "--version",
      version,
      "--conversion-repo",
      CODEX_DESKTOP_CONVERSION_REPO,
      "--conversion-commit",
      conversionCommit,
      "--codex-dmg",
      "/inputs/Codex.dmg",
      "--rebuild-report",
      "/work/reports/rebuild-report.json",
      "--patch-report",
      "/work/reports/patch-report.json",
      "--metadata-output",
      metadataPath,
      "--computer-use-ui-enabled",
      "true",
      "--output",
      artifactPath,
    ])
    const packageMetadata = JSON.parse(await container.file(metadataPath).contents()) as Record<string, unknown>
    const metadata: Record<string, unknown> = {
      ...packageMetadata,
      linux_features_enabled: linuxFeatures,
      linux_computer_use_ui_enabled: true,
    }

    if (dmgMetadata) {
      Object.assign(metadata, {
        codex_dmg_url: dmgMetadata.sourceUrl,
        codex_dmg_resolved_url: dmgMetadata.resolvedUrl,
        codex_dmg_last_modified: dmgMetadata.lastModified,
        codex_dmg_etag: dmgMetadata.etag,
        codex_dmg_content_length: dmgMetadata.contentLength,
        codex_dmg_cache_segment: dmgMetadata.cacheSegment,
      })
    }

    return {
      ok: true,
      artifactPath,
      assetName,
      container,
      conversionCommit,
      metadata,
      metadataPath,
      version,
    }
  }

  private async buildCodexDesktopArtifactFromUpstream(
    tap: Directory,
    requestedConversionCommit?: string,
    dmgCacheBuster?: string,
    requestedLinuxFeatures?: string,
  ): Promise<CodexDesktopBuildAttempt> {
    const dmgMetadata = await this.resolveCodexDesktopDmgMetadata(
      CODEX_DESKTOP_DMG_URL,
      requestedConversionCommit,
      dmgCacheBuster,
    )
    const downloadContainer = this.codexDesktopBaseContainer()
      .withEnvVariable("CODEX_DESKTOP_DMG_CACHE_BUSTER", dmgCacheBuster || dmgMetadata.cacheSegment)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "mkdir -p /inputs",
          `curl -fL --retry 3 -o /inputs/Codex.dmg "${CODEX_DESKTOP_DMG_URL}"`,
          "test -s /inputs/Codex.dmg",
        ].join("\n"),
      ])

    return this.buildCodexDesktopArtifact(
      tap,
      downloadContainer.file("/inputs/Codex.dmg"),
      dmgMetadata.version,
      dmgMetadata,
      requestedConversionCommit,
      requestedLinuxFeatures,
    )
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

  private async buildVoxtypeArtifact(tap: Directory, ref?: string, version?: string): Promise<VoxtypeBuild> {
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

    const container = this.rustBaseContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamTree)
      .withMountedCache(
        "/upstream/target",
        dag.cacheVolume("tap-pipeline-cargo-target-voxtype"),
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
      .withEnvVariable(
        "CMAKE_C_FLAGS",
        "-mno-avx512f -mno-avx512vl -mno-avx512bw -mno-avx512dq -mno-avx512cd -mno-gfni -mno-avxvnni",
      )
      .withEnvVariable(
        "CMAKE_CXX_FLAGS",
        "-mno-avx512f -mno-avx512vl -mno-avx512bw -mno-avx512dq -mno-avx512cd -mno-gfni -mno-avxvnni",
      )
      .withExec(["cargo", "build", "--locked", "--release"])
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "cp target/release/voxtype /tmp/voxtype-avx2",
          "zmm_count=$(objdump -d /tmp/voxtype-avx2 | grep -c zmm || true)",
          "avx512_count=$(objdump -d /tmp/voxtype-avx2 | grep -cE 'vpternlog|vpermt2|vpblendm|\\{1to[0-9]+\\}' || true)",
          "gfni_count=$(objdump -d /tmp/voxtype-avx2 | grep -cE 'vgf2p8|gf2p8' || true)",
          "test \"$zmm_count\" = 0",
          "test \"$avx512_count\" = 0",
          "test \"$gfni_count\" = 0",
        ].join("\n"),
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
      case "http_header_fingerprint": {
        if (entry.upstream.kind !== "http_file") {
          throw new Error(`Expected HTTP file upstream for ${packageId}`)
        }

        if (packageId !== "codex-desktop-linux") {
          throw new Error(`HTTP header fingerprint auto-update is not implemented for ${packageId}`)
        }

        return (await this.resolveCodexDesktopDmgMetadata(
          entry.upstream.url,
          codexDesktopConversionCommit,
        )).version
      }
      case "manual":
        throw new Error(`${packageId} is manually updated: ${entry.autoUpdate.reason}`)
    }
  }

  private downloadAsset(container: Container, url: string, path: string): Container {
    const authenticatedContainer = this.withGithubAuth(container)

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
  async ciCheck(packageId: string, githubToken?: Secret): Promise<string> {
    this.setGithubToken(githubToken)

    const tap = this.source

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
      case "codex-release": {
        const build = await this.buildCodexReleaseArtifact(tap, "tap-release")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return this.codexReleaseSmokeLog(tap, build, sha256)
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
              "test -f \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
              "grep -q 'Exec=.*/bin/t3-code-linux %U' \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
              "test -f \"$HOME/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png\"",
            ].join("\n"),
          ])
          .stdout()
      }
      case "codex-desktop-linux": {
        const build = await this.buildCodexDesktopFixtureArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        const updatedCask = this.renderCodexDesktopLocalCask(build.version, sha256)
          .replace(/^  depends_on formula: "desktop-file-utils"\n/m, "")
          .replace('url "file://#{ENV.fetch("CODEX_DESKTOP_LOCAL_ARTIFACT")}"', `url "file:///artifacts/${build.assetName}"`)
          .replace(/  preflight do[\s\S]*?  end\n\n  postflight do/, "  postflight do")
        const smokeTap = tap.withFile("Casks/codex-desktop.rb", dag.file("codex-desktop.rb", updatedCask))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withEnvVariable("CODEX_DESKTOP_SKIP_CLI_INSTALL", "1")
          .withEnvVariable("CODEX_DESKTOP_LOCAL_ARTIFACT", `/artifacts/${build.assetName}`)
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withExec([
            "bash",
            "-lc",
            [
              "set -euo pipefail",
              "repo=$(brew --repository)",
              "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
              ...tapStagingCommands("codex-desktop-linux"),
              "CODEX_DESKTOP_SKIP_CLI_INSTALL=1 brew install --cask test/tap/codex-desktop",
              "test -x \"$(brew --prefix)/bin/codex-desktop\"",
              "printf '#!/usr/bin/env bash\\necho codex cli fixture\\n' > \"$(brew --prefix)/bin/codex\"",
              "chmod +x \"$(brew --prefix)/bin/codex\"",
              "printf '#!/usr/bin/env bash\\necho code insiders fixture\\n' > \"$(brew --prefix)/bin/code-insiders\"",
              "chmod +x \"$(brew --prefix)/bin/code-insiders\"",
              "mkdir -p \"$HOME/.local/bin\" \"$HOME/.var/app/com.google.Chrome/config/google-chrome/Default\" \"$HOME/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts\"",
              "mkdir -p \"$HOME/.var/app/com.google.Chrome/config/google-chrome/Default/Extensions/hehggadaopoacecdllhhajmbjkdcmajg/1.1.4_0\"",
              "printf '{\"extensions\":{\"settings\":{\"hehggadaopoacecdllhhajmbjkdcmajg\":{\"state\":1}}}}\\n' > \"$HOME/.var/app/com.google.Chrome/config/google-chrome/Default/Preferences\"",
              "printf 'NAME=Bluefin\\nVARIANT_ID=bluefin\\nID_LIKE=\"ublue fedora\"\\n' > /tmp/codex-desktop-os-release",
              "printf '#!/usr/bin/env bash\\nprintf '\\''%s\\\\n'\\'' \"$*\" >> \"$HOME/flatpak.log\"\\ncase \"${1:-}:${2:-}\" in\\n  info:com.google.Chrome) exit 0 ;;\\n  info:--show-permissions)\\n    [ \"${3:-}\" = com.google.Chrome ] || exit 1\\n    printf '\\''[Context]\\\\nfilesystems=home;\\\\n\\\\n[Session Bus Policy]\\\\n'\\''\\n    [ -f \"$HOME/flatpak-host-spawn-enabled\" ] && printf '\\''org.freedesktop.Flatpak=talk\\\\n'\\''\\n    exit 0\\n    ;;\\n  override:--user)\\n    case \"$*\" in\\n      *'\\''--talk-name=org.freedesktop.Flatpak com.google.Chrome'\\''*) touch \"$HOME/flatpak-host-spawn-enabled\"; exit 0 ;;\\n    esac\\n    exit 1\\n    ;;\\n  run:com.google.Chrome) shift 2; echo flatpak chrome launch:\"$@\" ;;\\n  *) exit 1 ;;\\nesac\\n' > \"$HOME/.local/bin/flatpak\"",
              "chmod +x \"$HOME/.local/bin/flatpak\"",
              "codex-desktop --help",
              "codex-desktop desktop --smoke",
              "bluefin_wayland_env='PATH=/usr/bin:/bin XDG_SESSION_TYPE=wayland WAYLAND_DISPLAY=wayland-0 XDG_CURRENT_DESKTOP=GNOME CODEX_DESKTOP_OS_RELEASE_FILE=/tmp/codex-desktop-os-release'",
              "set +e",
              "app_grid_output=$(env $bluefin_wayland_env \"$(brew --prefix)/bin/codex-desktop\" desktop --smoke 2>&1)",
              "app_grid_status=$?",
              "set -e",
              "if [ \"$app_grid_status\" -ne 0 ]; then printf '%s\\n' \"$app_grid_output\"; printf '%s\\n' '--- flatpak log ---'; cat \"$HOME/flatpak.log\" 2>/dev/null || true; exit \"$app_grid_status\"; fi",
              "case \"$app_grid_output\" in *\"fixture desktop launch:--x11 --smoke\"*) ;; *) printf '%s\\n' \"$app_grid_output\"; exit 1 ;; esac",
              "case \"$app_grid_output\" in *\"fixture codex path:$(brew --prefix)/bin/codex\"*) ;; *) printf '%s\\n' \"$app_grid_output\"; exit 1 ;; esac",
              "case \"$app_grid_output\" in *\"fixture chrome user data:$HOME/.var/app/com.google.Chrome/config/google-chrome\"*) ;; *) printf '%s\\n' \"$app_grid_output\"; exit 1 ;; esac",
              "case \"$app_grid_output\" in *\"fixture editor:$(brew --prefix)/bin/code-insiders\"*) ;; *) printf '%s\\n' \"$app_grid_output\"; exit 1 ;; esac",
              "renderer_copy=$(find \"$(brew --prefix)/Caskroom/codex-desktop\" -path '*/content/webview/assets/remote-connections-settings-fixture.js' -print -quit 2>/dev/null || true)",
              "if [ -z \"$renderer_copy\" ]; then find \"$(brew --prefix)/Caskroom/codex-desktop\" -maxdepth 6 -type f | sort | head -40; exit 1; fi",
              "if ! grep -q 'SSH connections from this computer' \"$renderer_copy\"; then exit 1; fi",
              "if grep -q 'SSH connections from this Mac' \"$renderer_copy\"; then exit 1; fi",
              "remote_hosts_helper=$(find \"$(brew --prefix)/Caskroom/codex-desktop\" -path '*/share/codex-desktop/app/.codex-linux/remote-control-hosts.mjs' -print -quit 2>/dev/null || true)",
              "if [ -z \"$remote_hosts_helper\" ]; then find \"$(brew --prefix)/Caskroom/codex-desktop\" -path '*/share/codex-desktop/app/.codex-linux/*' -print | sort; exit 1; fi",
              "test -x \"$remote_hosts_helper\"",
              "remote_mobile_marker=$(find \"$(brew --prefix)/Caskroom/codex-desktop\" -path '*/share/codex-desktop/app/.codex-linux/remote-mobile-control-enabled' -print -quit 2>/dev/null || true)",
              "if [ -z \"$remote_mobile_marker\" ]; then find \"$(brew --prefix)/Caskroom/codex-desktop\" -path '*/share/codex-desktop/app/.codex-linux/*' -print | sort; exit 1; fi",
              "grep -qx 'remote-mobile-control' \"$remote_mobile_marker\"",
              "release_json=$(find \"$(brew --prefix)/Caskroom/codex-desktop\" -path '*/share/codex-desktop/release.json' -print -quit 2>/dev/null || true)",
              "if [ -z \"$release_json\" ]; then find \"$(brew --prefix)/Caskroom/codex-desktop\" -maxdepth 6 -type f | sort | head -40; exit 1; fi",
              "grep -q '\"linux_remote_mobile_control_autostart_marker\": true' \"$release_json\"",
              "settings_css=$(find \"$(brew --prefix)/Caskroom/codex-desktop\" -path '*/content/webview/assets/app-main-fixture.css' -print -quit 2>/dev/null || true)",
              "if [ -z \"$settings_css\" ]; then find \"$(brew --prefix)/Caskroom/codex-desktop\" -maxdepth 6 -type f | sort | head -40; exit 1; fi",
              "grep -Fq '[data-codex-window-type=electron][data-codex-os=linux] .window-fx-sidebar-surface{background:var(--color-token-bg-primary)}' \"$settings_css\"",
              "grep -Fq '[data-codex-window-type=electron][data-codex-os=linux] .app-shell-left-panel{background:var(--color-token-bg-primary)}' \"$settings_css\"",
              "deep_link_cache=/tmp/codex-desktop-deep-link-cache",
              "set +e",
              "deep_link_output=$(env $bluefin_wayland_env XDG_CACHE_HOME=\"$deep_link_cache\" \"$(brew --prefix)/bin/codex-desktop\" desktop 'codex://threads/new?prompt=secret&foo=bar' --smoke)",
              "deep_link_status=$?",
              "set -e",
              "if [ \"$deep_link_status\" -ne 0 ]; then printf '%s\\n' \"$deep_link_output\"; exit \"$deep_link_status\"; fi",
              "case \"$deep_link_output\" in *'fixture desktop launch:--x11 codex://threads/new?prompt=secret&foo=bar --smoke'*) ;; *) printf '%s\\n' \"$deep_link_output\"; exit 1 ;; esac",
              "grep -q 'deep-link args: codex://threads/new?query_keys=foo,prompt' \"$deep_link_cache/codex-desktop/launcher.log\"",
              "! grep -q secret \"$deep_link_cache/codex-desktop/launcher.log\"",
              "test -x \"$HOME/.cache/codex-desktop/flatpak-bin/google-chrome\"",
              "grep -q 'flatpak run com.google.Chrome' \"$HOME/.cache/codex-desktop/flatpak-bin/google-chrome\"",
              "test -x \"$HOME/.cache/codex-desktop/flatpak-bin/chrome\"",
              "grep -q 'flatpak run com.google.Chrome' \"$HOME/.cache/codex-desktop/flatpak-bin/chrome\"",
              "test -f \"$HOME/flatpak-host-spawn-enabled\"",
              "test -x \"$HOME/.var/app/com.google.Chrome/config/codex-desktop/com.openai.codexextension\"",
              "grep -q 'flatpak-spawn --host' \"$HOME/.var/app/com.google.Chrome/config/codex-desktop/com.openai.codexextension\"",
              "grep -Fq \"$(brew --prefix)/Caskroom/codex-desktop/fixture.0/share/codex-desktop/app/resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/x64/extension-host\" \"$HOME/.var/app/com.google.Chrome/config/codex-desktop/com.openai.codexextension\"",
              "grep -q 'chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/' \"$HOME/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts/com.openai.codexextension.json\"",
              "set +e",
              "doctor_output=$(env $bluefin_wayland_env \"$(brew --prefix)/bin/codex-desktop\" doctor)",
              "doctor_status=$?",
              "set -e",
              "if [ \"$doctor_status\" -ne 0 ]; then printf '%s\\n' \"$doctor_output\"; exit \"$doctor_status\"; fi",
              "case \"$doctor_output\" in *\"ok: Codex Chrome extension detected and enabled\"*) ;; *) printf '%s\\n' \"$doctor_output\"; exit 1 ;; esac",
              "case \"$doctor_output\" in *\"ok: Google Chrome Flatpak host-spawn permission\"*) ;; *) printf '%s\\n' \"$doctor_output\"; exit 1 ;; esac",
              "case \"$doctor_output\" in *\"ok: Google Chrome Flatpak native host wrapper targets current package\"*) ;; *) printf '%s\\n' \"$doctor_output\"; exit 1 ;; esac",
              "case \"$doctor_output\" in *\"ok: editor command code-insiders: $(brew --prefix)/bin/code-insiders\"*) ;; *) printf '%s\\n' \"$doctor_output\"; exit 1 ;; esac",
              "ozone_wayland_output=$(env $bluefin_wayland_env CODEX_DESKTOP_LINUX_OZONE=wayland \"$(brew --prefix)/bin/codex-desktop\" desktop --smoke)",
              "case \"$ozone_wayland_output\" in *\"fixture desktop launch:--wayland --smoke\"*) ;; *) printf '%s\\n' \"$ozone_wayland_output\"; exit 1 ;; esac",
              "case \"$ozone_wayland_output\" in *\"fixture desktop launch:--x11 --wayland\"*) printf '%s\\n' \"$ozone_wayland_output\"; exit 1 ;; esac",
              "explicit_wayland_output=$(env $bluefin_wayland_env \"$(brew --prefix)/bin/codex-desktop\" desktop --wayland --smoke)",
              "case \"$explicit_wayland_output\" in *\"fixture desktop launch:--wayland --smoke\"*) ;; *) printf '%s\\n' \"$explicit_wayland_output\"; exit 1 ;; esac",
              "case \"$explicit_wayland_output\" in *\"fixture desktop launch:--x11 --wayland\"*) printf '%s\\n' \"$explicit_wayland_output\"; exit 1 ;; esac",
              "explicit_x11_output=$(env $bluefin_wayland_env \"$(brew --prefix)/bin/codex-desktop\" desktop --x11 --smoke)",
              "case \"$explicit_x11_output\" in *\"fixture desktop launch:--x11 --smoke\"*) ;; *) printf '%s\\n' \"$explicit_x11_output\"; exit 1 ;; esac",
              "case \"$explicit_x11_output\" in *\"--x11 --x11\"*) printf '%s\\n' \"$explicit_x11_output\"; exit 1 ;; esac",
              "test -f \"$HOME/.local/share/applications/codex-desktop.desktop\"",
              "test -x \"$HOME/.local/share/applications/codex-desktop.desktop\"",
              "grep -q \"Exec=$(brew --prefix)/bin/codex-desktop desktop %U\" \"$HOME/.local/share/applications/codex-desktop.desktop\"",
              "grep -q 'x-scheme-handler/codex;x-scheme-handler/codex-browser-sidebar;' \"$HOME/.local/share/applications/codex-desktop.desktop\"",
              "test -f \"$HOME/.local/share/icons/hicolor/512x512/apps/codex-desktop.png\"",
              "test -f \"$HOME/.local/share/icons/hicolor/256x256/apps/codex-desktop.png\"",
              "codex-desktop logs --path",
              "web_report=$(codex-desktop web --inspect)",
              "case \"$web_report\" in *'\"mode\":\"devcontainer-web\"'*) ;; *) printf '%s\\n' \"$web_report\"; exit 1 ;; esac",
              "case \"$web_report\" in *'\"loopback_only_default\":true'*) ;; *) printf '%s\\n' \"$web_report\"; exit 1 ;; esac",
              "set +e",
              "codex-desktop web >/tmp/codex-desktop-web.out 2>&1",
              "web_status=$?",
              "set -e",
              "test \"$web_status\" -eq 64",
              "grep -q 'codex-desktop serve --workspace' /tmp/codex-desktop-web.out",
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
      case "codex-release": {
        const build = await this.buildCodexReleaseArtifact(tap, "tap-release")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(this.codexReleaseMetadata(build, sha256))
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
      case "codex-desktop-linux": {
        void codexDesktopConversionCommit
        throw new Error(
          "codex-desktop-linux is local-only and must not be published as release metadata. Use codex-desktop-local-bundle from scripts/install-codex-desktop-local.sh.",
        )
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
  ): Promise<Directory> {
    this.setGithubToken(githubToken)

    if (packageId === "codex-desktop-linux") {
      void codexDesktopConversionCommit
      throw new Error(
        "codex-desktop-linux is local-only and must not be published as a release bundle. Use codex-desktop-local-bundle from scripts/install-codex-desktop-local.sh.",
      )
    }

    const tap = this.source

    if (packageId === "codex-release") {
      const build = await this.buildCodexReleaseArtifact(tap, "tap-release")
      const sha256 = (
        await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
      ).trim().split(/\s+/)[0]
      const release = this.codexReleaseMetadata(build, sha256)
      const ciLog = await this.codexReleaseSmokeLog(tap, build, sha256)
      const formulaContents = await tap.file("Formula/codex-release.rb").contents()
      const updatedFormula = formulaContents
        .replace(/url ".*"/, `url "${String(release.download_url)}"`)
        .replace(/version ".*"/, `version "${build.version}"`)
        .replace(/sha256 ".*"/, `sha256 "${sha256}"`)

      return dag.directory()
        .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
        .withFile("homebrew/codex-release.rb", dag.file("codex-release.rb", updatedFormula))
        .withFile("release.json", dag.file("release.json", json(release)))
        .withFile("ci.log", dag.file("ci.log", ciLog))
    }

    const ciLog = await this.ciCheck(packageId, githubToken)

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
      case "codex-desktop-linux": {
        throw new Error(
          "codex-desktop-linux is local-only and must not be published as a release bundle. Use codex-desktop-local-bundle from scripts/install-codex-desktop-local.sh.",
        )
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

  @func()
  async codexDesktopReleaseBundle(
    codexDmg: File,
    githubToken?: Secret,
    codexDesktopConversionCommit?: string,
  ): Promise<Directory> {
    void codexDmg
    void githubToken
    void codexDesktopConversionCommit
    throw new Error(
      "codex-desktop-release-bundle is disabled because converted Codex Desktop app payloads are local-only. Use codex-desktop-local-bundle or scripts/install-codex-desktop-local.sh.",
    )
  }

  @func()
  async codexDesktopLocalBundle(
    codexDmg?: File,
    codexDesktopConversionCommit?: string,
    codexDesktopDmgCacheBuster?: string,
    codexDesktopLinuxFeatures?: string,
  ): Promise<Directory> {
    const build = codexDmg
      ? await this.buildCodexDesktopArtifact(
        this.source,
        codexDmg,
        CODEX_DESKTOP_MANUAL_VERSION,
        undefined,
        codexDesktopConversionCommit,
        codexDesktopLinuxFeatures,
      )
      : await this.buildCodexDesktopArtifactFromUpstream(
        this.source,
        codexDesktopConversionCommit,
        codexDesktopDmgCacheBuster,
        codexDesktopLinuxFeatures,
      )

    let decision: Record<string, unknown> = {
      verdict: "inconclusive",
      blockers: [],
      warnings: [],
      inconclusiveReasons: [
        `Conversion exited before an acceptance decision was exported (exit ${build.ok ? 0 : build.exitCode})`,
      ],
    }
    try {
      decision = JSON.parse(
        await build.container.file("/work/reports/upstream-dmg-decision.json").contents(),
      ) as Record<string, unknown>
    } catch {}

    let output = dag.directory()
      .withFile("result.json", dag.file("result.json", json(decision)))
    for (const [source, target] of [
      ["/work/reports/upstream-dmg-decision.json", "reports/upstream-dmg-decision.json"],
      ["/work/reports/patch-report.json", "reports/patch-report.json"],
      ["/work/reports/rebuild-report.json", "reports/rebuild-report.json"],
      ["/work/reports/install-exit-code", "reports/install-exit-code"],
    ]) {
      try {
        await build.container.file(source).contents()
        output = output.withFile(target, build.container.file(source))
      } catch {}
    }

    if (!build.ok) {
      return output
    }

    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const caskContents = this.renderCodexDesktopLocalCask(build.version, sha256)
    const codexDmgFile = codexDmg ?? build.container.file("/inputs/Codex.dmg")
    const dmgReport = JSON.parse(await this.codexDesktopDmgReport(codexDmgFile)) as Record<string, unknown>
    const localMetadata: Record<string, unknown> = {
      ...this.codexDesktopReleaseMetadata(build, sha256),
      distribution: "local-only",
      download_url: "file://${CODEX_DESKTOP_LOCAL_ARTIFACT}",
      release_notes: "Local-only Homebrew install bundle built from the official upstream Codex.dmg on this machine.",
      codex_dmg_sha256: dmgReport.codex_dmg_sha256,
      codex_dmg_bytes: dmgReport.codex_dmg_bytes,
    }

    return output
      .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
      .withFile("homebrew/codex-desktop.rb", dag.file("codex-desktop.rb", caskContents))
      .withFile("release.json", dag.file("release.json", json(localMetadata)))
      .withFile("renderer-report.json", dag.file("renderer-report.json", await this.codexDesktopRendererReport(codexDmgFile)))
  }

  @func()
  async codexReleaseLocalBundle(
    codexReleaseArtifact: File,
    codexCommit?: string,
  ): Promise<Directory> {
    const build = await this.buildLocalCodexReleaseArtifact(codexReleaseArtifact, codexCommit)
    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const formulaContents = await this.renderCodexReleaseLocalFormula(build.version, sha256)
    const localMetadata: Record<string, unknown> = {
      ...this.codexReleaseLocalMetadata(build, sha256),
      distribution: "local-only",
    }
    const ciLog = [
      "Local Codex release bundle.",
      `artifact=artifacts/${build.assetName}`,
      `formula=homebrew/codex-release.rb`,
      `sha256=${sha256}`,
      "",
    ].join("\n")

    return dag.directory()
      .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
      .withFile("homebrew/codex-release.rb", dag.file("codex-release.rb", formulaContents))
      .withFile("release.json", dag.file("release.json", json(localMetadata)))
      .withFile("ci.log", dag.file("ci.log", ciLog))
  }
}
