import { readFileSync } from "node:fs"

import type { AutoUpdateSlot, AutoUpdateSlotId, PackageRegistryEntry, ReleaseMetadata } from "./types.js"

type GitHeadVersionInput = {
  committedAt?: string
  includeCommitDate?: boolean
  prefix?: string
  sha: string
  shaLength?: number
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

export const PACKAGE_REGISTRY: PackageRegistryEntry[] = [
  {
    id: "codex-desktop-linux",
    kind: "codex_desktop_linux_cask",
    homebrewPath: "Casks/codex-desktop.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "http_header_fingerprint",
      prefix: "dmg.",
      shaLength: 12,
    },
    upstream: {
      kind: "http_file",
      url: "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg",
    },
  },
  {
    id: "t3code-cli-main",
    kind: "source_build_node_formula",
    homebrewPath: "Formula/t3code-cli-main.rb",
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
      stripPrefix: "v",
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
    kind: "github_release_appimage_cask",
    homebrewPath: "Casks/t3-code-linux.rb",
    supportsPrCi: true,
    autoUpdate: {
      kind: "github_release_latest_tag",
      stripPrefix: "v",
    },
    upstream: {
      kind: "github_release",
      repo: "https://github.com/pingdotgg/t3code",
      assetPrefix: "T3-Code-",
    },
  },
]

function loadAutoUpdateSlots(): AutoUpdateSlot[] {
  const file = readFileSync(new URL("../auto-update-slots.json", import.meta.url), "utf8")
  return JSON.parse(file) as AutoUpdateSlot[]
}

export const AUTO_UPDATE_SLOTS: AutoUpdateSlot[] = loadAutoUpdateSlots()

const CHANGED_PATHS: Array<[string, string[]]> = [
  [
    "codex-desktop-linux",
    ["Casks/codex-desktop.rb", "scripts/package-codex-desktop-linux.mjs"],
  ],
  [
    "t3code-cli-main",
    ["Formula/t3code-cli-main.rb", "scripts/package-t3code-cli-main.mjs", "dagger/t3code-cli-main-smoke/"],
  ],
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

  return PACKAGE_REGISTRY
    .filter((entry) => entry.supportsPrCi && changedPackages.has(entry.id))
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
