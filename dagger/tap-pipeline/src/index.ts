import { dag, CacheSharingMode, Container, Directory, File, argument, object, func } from "@dagger.io/dagger"
import {
  changedCiPackagesFromPaths,
  listAutoUpdateSlots as slotSummaries,
  packageSummaries,
  parseAutoUpdateSlotId,
  packagesForAutoUpdateSlot as slotPackages,
  releaseMetadataForPackage,
} from "./library.js"
import { rewriteCaskUrl } from "./cask-render.js"
import { renderGithubApiFetchScript } from "./github-api.js"

const TAP_DIR = "/tap"
const BREW_IMAGE = "homebrew/brew:latest"
const NODE_IMAGE = "node:24-bookworm"
const GO_IMAGE = "golang:1.26-bookworm"
const RUST_IMAGE = "rust:1-bookworm"
const TAP_REPOSITORY = "joshyorko/homebrew-tools"
const GITHUB_AUTH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function parseTextLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
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
    case "t3-code-linux":
      return [
        "mkdir -p \"$tap_dir/Casks\"",
        "cp /tap/Casks/t3-code-linux.rb \"$tap_dir/Casks/\"",
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

type T3CodeBuild = {
  version: string
  upstreamTag: string
  container: Container
  asset: DownloadedAsset
}

type AutoUpdatePackageStatus = {
  id: string
  kind: string
  homebrew_path: string
  current_version: string
  upstream_version: string
  current_release_published: boolean
  needs_update: boolean
}

@object()
export class TapPipeline {
  source: Directory
  gitDir: Directory

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
  async autoUpdateStatus(slotId: string): Promise<string> {
    const entries = slotPackages(parseAutoUpdateSlotId(slotId))
    const statuses = await Promise.all(entries.map(async (entry): Promise<AutoUpdatePackageStatus> => {
      const currentVersion = await this.currentPackagedVersion(entry.id)
      const upstreamVersion = await this.resolveUpstreamVersion(entry.id)
      const currentReleasePublished = await this.tapReleaseExists(entry.id, currentVersion)

      return {
        id: entry.id,
        kind: entry.kind,
        homebrew_path: entry.homebrewPath,
        current_version: currentVersion,
        upstream_version: upstreamVersion,
        current_release_published: currentReleasePublished,
        needs_update: currentVersion !== upstreamVersion || !currentReleasePublished,
      }
    }))

    return json(statuses)
  }

  @func()
  async packagesNeedingAutoUpdate(slotId: string): Promise<string> {
    const entries = JSON.parse(await this.autoUpdateStatus(slotId)) as AutoUpdatePackageStatus[]
    return json(entries.filter((entry) => entry.needs_update).map((entry) => entry.id))
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
      case "t3code-cli-main":
        return `t3code-cli-main-${version}`
      case "fizzy-cli-master":
        return `fizzy-cli-master-${version}`
      case "fizzy-popper-self-hosted":
        return `fizzy-popper-self-hosted-${version}`
      case "t3-code-linux":
        return `t3-code-linux-${version}`
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
    const output = await this.githubApiContainer()
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        renderGithubApiFetchScript({ successOutput: "true", notFoundOutput: "false" }),
        url,
      ])
      .stdout()

    return output.trim() === "true"
  }

  private t3BaseContainer(): Container {
    return dag
      .container()
      .from(NODE_IMAGE)
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
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl unzip python3 make g++ jq tar && npm install -g node-gyp && rm -rf /var/lib/apt/lists/*",
      ])
      .withExec(["bash", "-lc", "curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.9"])
      .withEnvVariable("PATH", "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
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

  private githubApiContainer(): Container {
    let container = dag.container().from(NODE_IMAGE)

    if (GITHUB_AUTH_TOKEN) {
      container = container.withEnvVariable("GH_TOKEN", GITHUB_AUTH_TOKEN)
    }

    return container
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

  private t3CodeReleaseMetadata(build: T3CodeBuild): Record<string, unknown> {
    return releaseMetadataForPackage("t3-code-linux", {
      version: build.version,
      releaseTag: `t3-code-linux-${build.version}`,
      assetName: build.asset.assetName,
      artifactSha256: build.asset.sha256,
      downloadUrl: `https://github.com/${TAP_REPOSITORY}/releases/download/t3-code-linux-${build.version}/${build.asset.assetName}`,
      releaseTitle: `T3 Code Linux ${build.version}`,
      releaseNotes: `Release bundle mirrored from pingdotgg/t3code ${build.upstreamTag}`,
      commitMessage: `Update t3-code-linux cask to v${build.version}`,
      upstream: {
        kind: "github_release",
        repo: "https://github.com/pingdotgg/t3code",
        assetPrefix: "T3-Code-",
        version: build.version,
        commit: build.upstreamTag,
      },
    })
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
    const upstreamRef = dag.git("https://github.com/pingdotgg/t3code").ref(ref)
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : `smoke.${commit.slice(0, 12)}`
    const assetName = `t3code-cli-main-${resolvedVersion}.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = this.t3BaseContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamRef.tree({ discardGitDir: true }))
      .withWorkdir("/upstream")
      .withExec([
        "node",
        "-e",
        [
          "const fs = require('node:fs');",
          "const path = 'apps/server/package.json';",
          "const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));",
          "pkg.version = process.argv[1];",
          "fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\\n`);",
        ].join(" "),
        resolvedVersion,
      ])
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withExec(["bun", "run", "build", "--filter=@t3tools/web", "--filter=t3"])
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
    const upstreamRef = dag.git("https://github.com/joshyorko/fizzy-popper").ref(ref)
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : `selfhosted.${commit.slice(0, 12)}`
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

  private async resolveUpstreamVersion(packageId: string): Promise<string> {
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
        const commit = await this.fetchJson(`${githubApiRepoUrl(entry.upstream.repo)}/commits/${ref}`) as {
          sha: string
        }
        const shaLength = entry.autoUpdate.shaLength ?? 12
        return `${entry.autoUpdate.prefix ?? ""}${commit.sha.slice(0, shaLength)}`
      }
      case "rpm_redirect": {
        const sourceUrl = entry.autoUpdate.sourceUrl
          ?? (entry.upstream.kind === "rpm" ? entry.upstream.sourceUrl : undefined)

        if (!sourceUrl) {
          throw new Error(`Expected rpm source URL for ${packageId}`)
        }

        return (await this.resolveVscodeMetadata(sourceUrl)).caskVersion
      }
    }
  }

  private downloadAsset(container: Container, url: string, path: string): Container {
    const authenticatedContainer = GITHUB_AUTH_TOKEN
      ? container.withEnvVariable("GH_TOKEN", GITHUB_AUTH_TOKEN)
      : container

    return authenticatedContainer.withExec([
      "node",
      "--input-type=module",
      "-e",
      [
        "import { writeFile } from 'node:fs/promises'",
        "const [url, path] = process.argv.slice(1)",
        "const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'tap-pipeline' }",
        "if (process.env.GH_TOKEN) {",
        "  headers.Authorization = `Bearer ${process.env.GH_TOKEN}`",
        "}",
        "const response = await fetch(url, { headers })",
        "if (!response.ok) {",
        "  throw new Error(`Failed to download ${url}: ${response.status}`)",
        "}",
        "await writeFile(path, Buffer.from(await response.arrayBuffer()))",
      ].join("\n"),
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

  private async buildT3CodeArtifact(): Promise<T3CodeBuild> {
    const release = await this.fetchJson("https://api.github.com/repos/pingdotgg/t3code/releases/latest") as {
      tag_name: string
      assets: Array<{ name: string; browser_download_url: string }>
    }
    const asset = release.assets.find((candidate) => /^T3-Code-.*-x86_64\.AppImage$/.test(candidate.name))

    if (!asset) {
      throw new Error("T3 Code release is missing the x86_64 AppImage asset")
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
  async ciCheck(packageId: string): Promise<string> {
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
              "brew test test/tap/t3code-cli-main",
              "t3 --help",
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
      case "t3-code-linux": {
        const build = await this.buildT3CodeArtifact()
        const caskContents = await tap.file("Casks/t3-code-linux.rb").contents()
        const updatedCask = this.renderT3CodeCask(
          caskContents,
          `file:///artifacts/${build.asset.assetName}`,
          build.version,
          build.asset.sha256,
        )
        const smokeTap = tap.withFile("Casks/t3-code-linux.rb", dag.file("t3-code-linux.rb", updatedCask))

        return dag
          .container()
          .from(BREW_IMAGE)
          .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
          .withEnvVariable("HOMEBREW_NO_ENV_HINTS", "1")
          .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
          .withDirectory("/tap", smokeTap)
          .withFile(`/artifacts/${build.asset.assetName}`, build.container.file(build.asset.artifactPath))
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
              "test -f \"$HOME/.local/share/icons/hicolor/1024x1024/apps/t3-code-linux.png\"",
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
  async releaseMetadata(packageId: string): Promise<string> {
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
      case "t3-code-linux": {
        const build = await this.buildT3CodeArtifact()
        return json(this.t3CodeReleaseMetadata(build))
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
  async releaseBundle(packageId: string): Promise<Directory> {
    const ciLog = await this.ciCheck(packageId)
    const tap = this.source

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
      case "t3-code-linux": {
        const build = await this.buildT3CodeArtifact()
        const releaseTag = `t3-code-linux-${build.version}`
        const caskContents = await tap.file("Casks/t3-code-linux.rb").contents()
        const updatedCask = this.renderT3CodeCask(
          caskContents,
          `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.asset.assetName}`,
          build.version,
          build.asset.sha256,
        )
        const release = this.t3CodeReleaseMetadata(build)

        return dag.directory()
          .withFile(`artifacts/${build.asset.assetName}`, build.container.file(build.asset.artifactPath))
          .withFile("homebrew/t3-code-linux.rb", dag.file("t3-code-linux.rb", updatedCask))
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
}
