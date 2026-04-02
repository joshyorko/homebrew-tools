export type PackageKind =
  | "source_build_node_formula"
  | "rpm_repack_cask"
  | "source_build_rust_formula"
  | "github_release_binary_cask"
  | "github_release_deb_cask"
  | "github_release_appimage_cask"

export type UpdatePolicy = "auto" | "manual" | "force"

export type Cadence =
  | { everyMinutes: number; minute: number }
  | { daily: { hour: number; minute: number } }
  | { manual: true }

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
      kind: "github_release"
      repo: string
      assetName?: string
      assetPrefix?: string
      tagPrefix?: string
    }

export type PackageRegistryEntry = {
  id: string
  kind: PackageKind
  homebrewPath: string
  supportsPrCi: boolean
  supportsAutoUpdate: boolean
  updatePolicy: UpdatePolicy
  cadence: Cadence
  upstream: UpstreamSource
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
