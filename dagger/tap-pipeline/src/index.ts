import { dag, Container, Directory, File, argument, object, func } from "@dagger.io/dagger"
import {
  changedCiPackagesFromPaths,
  listAutoUpdateSlots as slotSummaries,
  packageSummaries,
  parseAutoUpdateSlotId,
  packagesForAutoUpdateSlot as slotPackages,
  releaseMetadataForPackage,
} from "./library.js"

const TAP_DIR = "/tap"
const BREW_IMAGE = "homebrew/brew:latest"
const NODE_IMAGE = "node:24-bookworm"
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

  private t3BaseContainer(): Container {
    return dag
      .container()
      .from(NODE_IMAGE)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("tap-pipeline-bun-cache"))
      .withMountedCache("/root/.npm", dag.cacheVolume("tap-pipeline-npm-cache"))
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl unzip python3 make g++ jq tar && npm install -g node-gyp && rm -rf /var/lib/apt/lists/*",
      ])
      .withExec(["bash", "-lc", "curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.9"])
      .withEnvVariable("PATH", "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
  }

  // The contract platform owns shared cache policy before every adapter is migrated.
  private rustBaseContainer(): Container {
    return dag
      .container()
      .from(RUST_IMAGE)
      .withMountedCache("/usr/local/cargo/registry", dag.cacheVolume("tap-pipeline-cargo-registry-cache"))
      .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("tap-pipeline-cargo-git-cache"))
      .withMountedCache("/usr/local/rustup", dag.cacheVolume("tap-pipeline-rustup-cache"))
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
      releaseNotes: `Homebrew artifact built from peteonrails/voxtype@${build.version}`,
      commitMessage: `Update voxtype formula to ${build.version}`,
      upstream: {
        kind: "git",
        repo: "https://github.com/peteonrails/voxtype",
        ref: "refs/tags/v0.6.4",
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

  private async buildVscodeArtifact(tap: Directory, sourceUrl?: string, version?: string): Promise<VscodeBuild> {
    const resolvedSourceUrl = sourceUrl ?? "https://update.code.visualstudio.com/latest/linux-rpm-x64/insider"
    const metadataContainer = dag
      .container()
      .from(NODE_IMAGE)
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates cpio curl jq rpm tar && rm -rf /var/lib/apt/lists/*",
      ])
      .withEnvVariable("SOURCE_URL", resolvedSourceUrl)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "resolved_url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \"$SOURCE_URL\")",
          "curl -fsSL \"$resolved_url\" -o /tmp/vscode-insiders-source.rpm",
          "package_version=$(rpm -qp --queryformat '%{VERSION}' /tmp/vscode-insiders-source.rpm)",
          "release_build=$(rpm -qp --queryformat '%{RELEASE}' /tmp/vscode-insiders-source.rpm)",
          "commit_sha=$(printf '%s' \"$resolved_url\" | sed -nE 's#^.*/download/insider/([0-9a-f]+)/.*#\\1#p')",
          "commit_short=${commit_sha:0:12}",
          "printf 'resolved_url=%s\\npackage_version=%s\\nrelease_build=%s\\ncask_version=%s,%s,%s\\ncommit_sha=%s\\n' \"$resolved_url\" \"$package_version\" \"$release_build\" \"$package_version\" \"$release_build\" \"$commit_short\" \"$commit_sha\"",
        ].join("\n"),
      ])

    const metadata = Object.fromEntries(
      parseTextLines(await metadataContainer.stdout()).map((line) => {
        const [key, ...rest] = line.split("=")
        return [key, rest.join("=")]
      }),
    )

    const resolvedUrl = String(metadata.resolved_url)
    const packageVersion = String(metadata.package_version)
    const releaseBuild = String(metadata.release_build)
    const commitSha = String(metadata.commit_sha)
    const caskVersion = version && version.length > 0 ? version : String(metadata.cask_version)
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

  private async buildVoxtypeArtifact(tap: Directory, ref = "refs/tags/v0.6.4", version?: string): Promise<VoxtypeBuild> {
    const upstreamRef = dag.git("https://github.com/peteonrails/voxtype").ref(ref)
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
      version: resolvedVersion,
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const output = await this.githubApiContainer()
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        [
          "const url = process.argv[1]",
          "const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'tap-pipeline' }",
          "if (process.env.GH_TOKEN) {",
          "  headers.Authorization = `Bearer ${process.env.GH_TOKEN}`",
          "}",
          "const response = await fetch(url, { headers })",
          "if (!response.ok) {",
          "  throw new Error(`Failed to fetch ${url}: ${response.status}`)",
          "}",
          "process.stdout.write(JSON.stringify(await response.json()))",
        ].join("\n"),
        url,
      ])
      .stdout()

    return JSON.parse(output)
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
      "  desc \"Sema4.ai Action Server - Host AI agent actions via HTTP/MCP\"",
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
    return baseContents
      .replace(/version ".*"/, `version "${version}"`)
      .replace(/sha256 x86_64_linux: (?::no_check|".*")/, `sha256 x86_64_linux: "${sha256}"`)
      .replace(/url ".*",\n\s+verified: ".*"/, `url "${downloadUrl}"`)
      .replace(
        /livecheck do\n(?:.*\n)*?\s+end\n/m,
        "livecheck do\n    skip \"Updated by the tap's GitHub Actions workflow.\"\n  end\n",
      )
  }

  private renderT3CodeCask(baseContents: string, downloadUrl: string, version: string, sha256: string): string {
    return baseContents
      .replace(/version ".*"/, `version "${version}"`)
      .replace(/sha256 x86_64_linux: (?::no_check|".*")/, `sha256 x86_64_linux: "${sha256}"`)
      .replace(/url ".*",\n\s+verified: ".*"/, `url "${downloadUrl}"`)
      .replace(
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
      default:
        throw new Error(`releaseBundle is not implemented for package: ${packageId}`)
    }
  }
}
