export type PackageKind =
  | "source_build_node_formula"
  | "rpm_repack_cask"
  | "source_build_rust_formula"
  | "source_build_go_formula"
  | "github_release_binary_cask"
  | "github_release_deb_cask"
  | "github_release_appimage_cask"
  | "codex_desktop_linux_cask"

export type AutoUpdateSlotId =
  | "rcc-daily"
  | "action-server-daily"
  | "desktop-6h"
  | "vscode-insiders-2h"
  | "t3-daily"
  | "t3-code-6h"
  | "fizzy-daily"

export type UpstreamSource =
  | {
      kind: "git"
      repo: string
      ref: string
    }
  | {
      kind: "rpm"
      sourceUrl: string
    }
  | {
      kind: "http_file"
      url: string
    }
  | {
      kind: "github_release"
      repo: string
      assetName?: string
      assetPrefix?: string
      tagPrefix?: string
    }

export type AutoUpdateStrategy =
  | {
      kind: "github_release_latest_tag"
      stripPrefix?: string
    }
  | {
      kind: "git_head_sha"
      prefix?: string
      ref: string
      shaLength?: number
      includeCommitDate?: boolean
    }
  | {
      kind: "rpm_redirect"
      sourceUrl?: string
    }
  | {
      kind: "http_header_fingerprint"
      prefix?: string
      shaLength?: number
    }

export type PackageRegistryEntry = {
  id: string
  kind: PackageKind
  homebrewPath: string
  supportsPrCi: boolean
  autoUpdate: AutoUpdateStrategy
  upstream: UpstreamSource
}

export type AutoUpdateSlot = {
  id: AutoUpdateSlotId
  description: string
  packageIds: string[]
}

export type ReleaseMetadata = {
  package: string
  kind: PackageKind
  homebrew_path: string
  version: string
  release_tag: string
  asset_name: string
  artifact_sha256: string
  download_url: string
  release_title: string
  release_notes: string
  commit_message: string
  upstream: UpstreamSource & {
    version?: string
    commit?: string
  }
}

export type ResolvedUpstream = {
  version: string
  commit?: string
  ref?: string
  sourceUrl?: string
}

export type BuiltArtifact = {
  assetName: string
  artifactSha256: string
}

export type RenderedHomebrew = {
  homebrewPath: string
  contents: string
}

export type ReleaseBundleLayout = {
  artifactsDir: "artifacts"
  homebrewDir: "homebrew"
  releaseJsonPath: "release.json"
  ciLogPath: "ci.log"
}

export interface TapPackageAdapter {
  resolveUpstream(): Promise<ResolvedUpstream>
  buildArtifact(): Promise<BuiltArtifact>
  renderHomebrew(downloadUrl: string, artifactSha256: string): Promise<RenderedHomebrew>
  validateCi(): Promise<string>
  validateRelease(): Promise<string>
  releaseMetadata(): Promise<ReleaseMetadata>
}
