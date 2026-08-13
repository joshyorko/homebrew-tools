import { readFileSync } from "node:fs"

import type { AutoUpdateSlot, AutoUpdateSlotId, PackageRegistryEntry, ReleaseMetadata } from "./types.js"

type GitHeadVersionInput = {
  committedAt?: string
  includeCommitDate?: boolean
  prefix?: string
  sha: string
  shaLength?: number
}

export class TransientUpstreamProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TransientUpstreamProbeError"
  }
}

export function isTransientUpstreamProbeError(error: unknown): error is TransientUpstreamProbeError {
  return error instanceof TransientUpstreamProbeError
}

function compactUtcTimestamp(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid commit date: ${value}`)
  }

  return date.toISOString().replace(/\D/g, "").slice(0, 14)
}

export function formatGitHeadVersion(input: GitHeadVersionInput): string {
  const shortSha = input.sha.slice(0, input.shaLength ?? 12)

  if (!input.includeCommitDate) {
    return `${input.prefix ?? ""}${shortSha}`
  }

  if (!input.committedAt) {
    throw new Error("A commit date is required for timestamped git-head versions")
  }

  return `${input.prefix ?? ""}${compactUtcTimestamp(input.committedAt)}.${shortSha}`
}

export function packagedVersionForUpstreamComparison(packageId: string, version: string): string {
  return ["buzz-linux", "devsy-desktop", "t3-code-linux"].includes(packageId) ? version.split(",", 1)[0] : version
}

export const PACKAGE_REGISTRY: PackageRegistryEntry[] = [
  {
    id: "t3code-cli-main",
    kind: "source_build_node_formula",
    homebrewPath: "Formula/t3code-cli-main.rb",
    supportsPrCi: true,
    supportsReleaseBundle: true,
    autoUpdate: {
      kind: "git_head_sha",
      ref: "main",
      prefix: "main.",
      shaLength: 12,
      includeCommitDate: true,
    },
    upstream: {
      kind: "git",
      repo: "https://github.com/pingdotgg/t3code",
      ref: "main",
    },
  },
  {
    id: "antigravity-cli",
    kind: "http_binary_formula",
    homebrewPath: "Formula/antigravity-cli.rb",
    supportsPrCi: true,
    supportsReleaseBundle: false,
    autoUpdate: {
      kind: "manual",
      reason: "Google publishes Antigravity CLI through a platform manifest; update after verifying checksums.",
    },
    upstream: {
      kind: "http_file",
      url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.0.6-6458082025406464/linux-x64/cli_linux_x64.tar.gz",
    },
  },
  {
    id: "chatgpt",
    kind: "rpm_repack_cask",
    homebrewPath: "Casks/chatgpt.rb",
    supportsPrCi: true,
    supportsReleaseBundle: true,
    autoUpdate: {
      kind: "deb_packages_version",
      url: "https://persistent.oaistatic.com/codex-app-prod/linux/deb/dists/stable/main/binary-amd64/Packages",
    },
    upstream: {
      kind: "http_file",
      url: "https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb",
    },
  },
  {
    id: "codex-desktop-linux",
    kind: "codex_desktop_linux_cask",
    homebrewPath: "Casks/codex-desktop.rb",
    supportsPrCi: true,
    supportsReleaseBundle: true,
    autoUpdate: {
      kind: "manual",
      reason: "Pinned to the verified PatchRaptor official Linux package migration.",
    },
    upstream: {
      kind: "git",
      repo: "https://github.com/joshyorko/codex-desktop-linux",
      ref: "380fb5654dac67a49c3e23849411f5f99a09f93a",
    },
  },
  {
    id: "devsy",
    kind: "http_binary_formula",
    homebrewPath: "Formula/devsy.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
      stripPrefix: "v",
    },
    upstream: {
      kind: "github_release",
      repo: "https://github.com/devsy-org/devsy",
      assetPrefix: "devsy-linux-",
    },
  },
  {
    id: "devsy-desktop",
    kind: "github_release_appimage_cask",
    homebrewPath: "Casks/devsy-desktop.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
      stripPrefix: "v",
    },
    upstream: {
      kind: "github_release",
      repo: "https://github.com/devsy-org/devsy",
      assetName: "Devsy_linux_x86_64.AppImage",
    },
  },
  {
    id: "buzz-linux",
    kind: "source_build_rust_appimage_cask",
    homebrewPath: "Casks/buzz-linux.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
      stripPrefix: "desktop-v",
    },
    upstream: {
      kind: "github_release",
      repo: "https://github.com/block/buzz",
    },
  },
  {
    id: "fizzy-cli-master",
    kind: "source_build_go_formula",
    homebrewPath: "Formula/fizzy-cli-master.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "git_head_sha",
      ref: "master",
      prefix: "master.",
      shaLength: 12,
    },
    upstream: {
      kind: "git",
      repo: "https://github.com/basecamp/fizzy-cli",
      ref: "master",
    },
  },
  {
    id: "fizzy-popper-self-hosted",
    kind: "source_build_node_formula",
    homebrewPath: "Formula/fizzy-popper-self-hosted.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "git_head_sha",
      ref: "self-hosted",
      prefix: "selfhosted.",
      shaLength: 12,
      includeCommitDate: true,
    },
    upstream: {
      kind: "git",
      repo: "https://github.com/joshyorko/fizzy-popper",
      ref: "self-hosted",
    },
  },
  {
    id: "fizzy-symphony",
    kind: "source_build_node_formula",
    homebrewPath: "Formula/fizzy-symphony.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "git_head_sha",
      ref: "main",
      prefix: "main.",
      shaLength: 12,
      includeCommitDate: true,
    },
    upstream: {
      kind: "git",
      repo: "https://github.com/joshyorko/fizzy-symphony",
      ref: "main",
    },
  },
  {
    id: "vscode-insiders-linux",
    kind: "rpm_repack_cask",
    homebrewPath: "Casks/vscode-insiders-linux.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "rpm_redirect",
    },
    upstream: {
      kind: "rpm",
      sourceUrl: "https://update.code.visualstudio.com/latest/linux-rpm-x64/insider",
    },
  },
  {
    id: "voxtype",
    kind: "source_build_rust_formula",
    homebrewPath: "Formula/voxtype.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
      stripPrefix: "v",
    },
    upstream: {
      kind: "git",
      repo: "https://github.com/peteonrails/voxtype",
      ref: "refs/tags/v0.6.5",
    },
  },
  {
    id: "eitype",
    kind: "source_build_rust_formula",
    homebrewPath: "Formula/eitype.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
    },
    upstream: {
      kind: "git",
      repo: "https://github.com/Adam-D-Lewis/eitype",
      ref: "refs/tags/0.2.0",
    },
  },
  {
    id: "rcc",
    kind: "github_release_binary_cask",
    homebrewPath: "Casks/rcc.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
      stripPrefix: "v",
    },
    upstream: {
      kind: "github_release",
      repo: "https://github.com/joshyorko/rcc",
      assetPrefix: "rcc-",
    },
  },
  {
    id: "action-server",
    kind: "github_release_binary_cask",
    homebrewPath: "Casks/action-server.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
      stripPrefix: "action-server-v",
    },
    upstream: {
      kind: "github_release",
      repo: "https://github.com/joshyorko/actions",
      assetPrefix: "action-server-",
      tagPrefix: "action-server-v",
    },
  },
  {
    id: "devpod-linux",
    kind: "github_release_deb_cask",
    homebrewPath: "Casks/devpod-linux.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
      stripPrefix: "v",
    },
    upstream: {
      kind: "github_release",
      repo: "https://github.com/skevetter/devpod",
      assetName: "DevPod_linux_amd64.deb",
    },
  },
  {
    id: "t3-code-linux",
    kind: "source_build_node_appimage_cask",
    homebrewPath: "Casks/t3-code-linux.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "git_head_sha",
      ref: "main",
      prefix: "main.",
      shaLength: 12,
      includeCommitDate: true,
    },
    upstream: {
      kind: "git",
      repo: "https://github.com/pingdotgg/t3code",
      ref: "main",
    },
  },
]

const TAP_RELEASE_URL_PREFIX = "https://github.com/joshyorko/homebrew-tools/releases/download/"
const RECOVERY_TAP_PREFIX = "joshyorko/tools/"

export function recoveryPackageSummaries(): PackageRegistryEntry[] {
  return packageSummaries().filter((entry) => entry.supportsReleaseBundle !== false)
}

export function recoveryBrewfile(entries = recoveryPackageSummaries()): string {
  const lines = entries.map((entry) => {
    const stanza = entry.homebrewPath.startsWith("Casks/") ? "cask" : "brew"
    return `${stanza} "${RECOVERY_TAP_PREFIX}${entry.id}"`
  })

  return `# Generated from dagger/tap-pipeline/src/library.ts package registry.\n${lines.join("\n")}\n`
}

export function parseRecoveryBrewfile(contents: string): PackageRegistryEntry[] {
  const entries: PackageRegistryEntry[] = []

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.replace(/\s*#.*$/, "").trim()
    if (!line) continue

    const match = line.match(/^(?:brew|cask)\s+"joshyorko\/tools\/([^"\s]+)"$/)
    if (!match) {
      throw new Error(`Unsupported recovery Brewfile entry: ${rawLine}`)
    }

    const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === match[1])
    if (!entry) {
      throw new Error(`Unknown recovery package: ${match[1]}`)
    }
    if (entry.supportsReleaseBundle === false) {
      throw new Error(`${entry.id} does not have a standard release bundle`)
    }
    if (!entries.some((candidate) => candidate.id === entry.id)) {
      entries.push({ ...entry })
    }
  }

  if (entries.length === 0) {
    throw new Error("Recovery Brewfile does not select any packages")
  }

  return entries
}

export function recoveryHomebrewContents(contents: string, packageId: string, fileServerBaseUrl: string): string {
  const baseUrl = fileServerBaseUrl.replace(/\/+$/, "")
  return contents.replace(
    new RegExp(`${TAP_RELEASE_URL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^/]+/([^\"\\s]+)`, "g"),
    `${baseUrl}/packages/${packageId}/artifacts/$1`,
  )
}

function loadAutoUpdateSlots(): AutoUpdateSlot[] {
  const file = readFileSync(new URL("../auto-update-slots.json", import.meta.url), "utf8")
  return JSON.parse(file) as AutoUpdateSlot[]
}

export const AUTO_UPDATE_SLOTS: AutoUpdateSlot[] = loadAutoUpdateSlots()

const CHANGED_PATHS: Array<[string, string[]]> = [
  [
    "t3code-cli-main",
    [
      "Formula/t3code-cli-main.rb",
      "scripts/package-t3code-cli-main.mjs",
      "scripts/build-t3code-resource-monitor.sh",
      "dagger/t3code-cli-main-smoke/",
    ],
  ],
  ["antigravity-cli", ["Formula/antigravity-cli.rb"]],
  ["chatgpt", ["Casks/chatgpt.rb"]],
  ["codex-desktop-linux", ["Casks/codex-desktop.rb"]],
  ["devsy", ["Formula/devsy.rb"]],
  ["devsy-desktop", ["Casks/devsy-desktop.rb"]],
  [
    "fizzy-cli-master",
    ["Formula/fizzy-cli-master.rb", "scripts/package-fizzy-cli-master.mjs", "dagger/fizzy-cli-master-smoke/"],
  ],
  [
    "fizzy-popper-self-hosted",
    [
      "Formula/fizzy-popper-self-hosted.rb",
      "scripts/package-fizzy-popper-self-hosted.mjs",
      "dagger/fizzy-popper-self-hosted-smoke/",
    ],
  ],
  [
    "fizzy-symphony",
    [
      "Formula/fizzy-symphony.rb",
      "scripts/package-fizzy-symphony.mjs",
      "dagger/fizzy-symphony-smoke/",
    ],
  ],
  [
    "vscode-insiders-linux",
    [
      "Casks/vscode-insiders-linux.rb",
      "scripts/package-vscode-insiders-linux.mjs",
      "dagger/vscode-insiders-linux-smoke/",
    ],
  ],
  [
    "voxtype",
    ["Formula/voxtype.rb", "scripts/package-voxtype.mjs", "dagger/voxtype-smoke/"],
  ],
  ["eitype", ["Formula/eitype.rb", "scripts/package-eitype.mjs", "dagger/eitype-smoke/"]],
  ["rcc", ["Casks/rcc.rb"]],
  ["action-server", ["Casks/action-server.rb"]],
  ["devpod-linux", ["Casks/devpod-linux.rb", "Formula/devpod-appindicator-runtime-tools.rb"]],
  ["buzz-linux", ["Casks/buzz-linux.rb", "dagger/buzz-linux-smoke/"]],
  ["t3-code-linux", ["Casks/t3-code-linux.rb"]],
]

const PLATFORM_PATH_PREFIXES = [
  "dagger/tap-pipeline/",
  "scripts/apply-release-bundle.mjs",
]

export function packageSummaries(): PackageRegistryEntry[] {
  return PACKAGE_REGISTRY.map((entry) => ({ ...entry }))
}

export function changedPackagesFromPaths(paths: string[]): string[] {
  const seen = new Set<string>()

  for (const path of paths) {
    for (const [packageId, prefixes] of CHANGED_PATHS) {
      if (prefixes.some((prefix) => path === prefix || path.startsWith(prefix))) {
        seen.add(packageId)
      }
    }
  }

  return [...seen].sort()
}

export function platformPathsChanged(paths: string[]): boolean {
  return paths.some((path) => PLATFORM_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)))
}

export function changedCiPackagesFromPaths(paths: string[]): string[] {
  const changedPackages = new Set(changedPackagesFromPaths(paths))
  const sharedPipelineChanged = platformPathsChanged(paths)

  return PACKAGE_REGISTRY
    .filter((entry) => entry.supportsPrCi && (sharedPipelineChanged || changedPackages.has(entry.id)))
    .map((entry) => entry.id)
}

function packageEntryForId(packageId: string): PackageRegistryEntry {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === packageId)

  if (!entry) {
    throw new Error(`Unknown package: ${packageId}`)
  }

  return entry
}

function autoUpdateSlotForId(slotId: string): AutoUpdateSlot {
  const slot = AUTO_UPDATE_SLOTS.find((candidate) => candidate.id === slotId)

  if (!slot) {
    throw new Error(`Unknown auto-update slot: ${slotId}`)
  }

  return slot
}

export function parseAutoUpdateSlotId(slotId: string): AutoUpdateSlotId {
  return autoUpdateSlotForId(slotId).id
}

export function listAutoUpdateSlots(): AutoUpdateSlot[] {
  return AUTO_UPDATE_SLOTS.map((slot) => ({
    ...slot,
    packageIds: [...slot.packageIds],
  }))
}

export function packagesForAutoUpdateSlot(slotId: AutoUpdateSlotId): PackageRegistryEntry[] {
  const slot = autoUpdateSlotForId(slotId)

  return slot.packageIds.map((packageId) => packageEntryForId(packageId))
}

export function releaseMetadataForPackage(
  packageId: string,
  fields: {
    version: string
    releaseTag: string
    assetName: string
    artifactSha256: string
    downloadUrl: string
    releaseTitle: string
    releaseNotes: string
    commitMessage: string
    upstream: ReleaseMetadata["upstream"]
  },
): ReleaseMetadata {
  const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === packageId)

  if (!entry) {
    throw new Error(`Unknown package: ${packageId}`)
  }

  return {
    package: entry.id,
    kind: entry.kind,
    homebrew_path: entry.homebrewPath,
    version: fields.version,
    release_tag: fields.releaseTag,
    asset_name: fields.assetName,
    artifact_sha256: fields.artifactSha256,
    download_url: fields.downloadUrl,
    release_title: fields.releaseTitle,
    release_notes: fields.releaseNotes,
    commit_message: fields.commitMessage,
    upstream: fields.upstream,
  }
}
