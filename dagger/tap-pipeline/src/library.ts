import type { AutoUpdateSlot, AutoUpdateSlotId, PackageRegistryEntry, ReleaseMetadata } from "./types.js"

export const PACKAGE_REGISTRY: PackageRegistryEntry[] = [
  {
    id: "t3code-cli-main",
    kind: "source_build_node_formula",
    homebrewPath: "Formula/t3code-cli-main.rb",
    supportsPrCi: true,
    upstream: {
      kind: "git",
      repo: "https://github.com/pingdotgg/t3code",
      ref: "main",
    },
  },
  {
    id: "vscode-insiders-linux",
    kind: "rpm_repack_cask",
    homebrewPath: "Casks/vscode-insiders-linux.rb",
    supportsPrCi: true,
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
    upstream: {
      kind: "git",
      repo: "https://github.com/peteonrails/voxtype",
      ref: "refs/tags/v0.6.4",
    },
  },
  {
    id: "rcc",
    kind: "github_release_binary_cask",
    homebrewPath: "Casks/rcc.rb",
    supportsPrCi: true,
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
    upstream: {
      kind: "github_release",
      repo: "https://github.com/pingdotgg/t3code",
      assetPrefix: "T3-Code-",
    },
  },
]

export const AUTO_UPDATE_SLOTS: AutoUpdateSlot[] = [
  {
    id: "rcc-daily",
    description: "Daily RCC refresh.",
    packageIds: ["rcc"],
  },
  {
    id: "action-server-daily",
    description: "Daily Action Server refresh.",
    packageIds: ["action-server"],
  },
  {
    id: "desktop-6h",
    description: "Six-hour desktop package refresh for VS Code Insiders, Voxtype, and DevPod.",
    packageIds: ["vscode-insiders-linux", "voxtype", "devpod-linux"],
  },
  {
    id: "vscode-insiders-2h",
    description: "Two-hour VS Code Insiders refresh between the larger desktop slots.",
    packageIds: ["vscode-insiders-linux"],
  },
  {
    id: "t3-daily",
    description: "Daily T3 package refresh for the CLI main build and Linux desktop cask.",
    packageIds: ["t3code-cli-main", "t3-code-linux"],
  },
  {
    id: "t3-code-6h",
    description: "Six-hour Linux desktop refresh for the T3 Code AppImage cask.",
    packageIds: ["t3-code-linux"],
  },
]

const CHANGED_PATHS: Array<[string, string[]]> = [
  [
    "t3code-cli-main",
    ["Formula/t3code-cli-main.rb", "scripts/package-t3code-cli-main.mjs", "dagger/t3code-cli-main-smoke/"],
  ],
  [
    "vscode-insiders-linux",
    [
      "Casks/vscode-insiders-linux.rb",
      "scripts/package-vscode-insiders-linux.mjs",
      "dagger/vscode-insiders-linux-smoke/",
    ],
  ],
  ["voxtype", ["Formula/voxtype.rb", "scripts/package-voxtype.mjs", "dagger/voxtype-smoke/"]],
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
