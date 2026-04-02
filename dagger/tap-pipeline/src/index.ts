import { dag, Container, Directory, File, argument, object, func } from "@dagger.io/dagger"
import {
  changedCiPackagesFromPaths,
  packageSummaries,
  packagesDueAt,
  releaseMetadataForPackage,
} from "./library.js"

const TAP_DIR = "/tap"
const BREW_IMAGE = "homebrew/brew:latest"
const NODE_IMAGE = "node:24-bookworm"
const TAP_REPOSITORY = "joshyorko/homebrew-tools"

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
    case "t3code-cli-main":
      return [
        "mkdir -p \"$tap_dir/Formula\"",
        "cp /tap/Formula/t3code-cli-main.rb \"$tap_dir/Formula/\"",
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
      `set -euo pipefail; git diff --name-only "${baseRef}...${headRef}"`,
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
  async planUpdates(nowIso?: string): Promise<string> {
    const resolvedNow = nowIso ?? new Date().toISOString()
    return json(
      packagesDueAt(new Date(resolvedNow)).map((entry) => ({
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
      .from("ubuntu:22.04")
      .withMountedCache("/root/.cargo/registry", dag.cacheVolume("tap-pipeline-cargo-registry-cache"))
      .withMountedCache("/root/.cargo/git", dag.cacheVolume("tap-pipeline-cargo-git-cache"))
      .withMountedCache("/root/.rustup", dag.cacheVolume("tap-pipeline-rustup-cache"))
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl build-essential clang cmake pkg-config git binutils",
          "rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
      .withExec([
        "bash",
        "-lc",
        "curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y",
      ])
      .withEnvVariable("PATH", "/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
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

  @func()
  async ciCheck(packageId: string): Promise<string> {
    const tap = this.source

    switch (packageId) {
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
      case "t3code-cli-main": {
        const build = await this.buildT3Artifact(tap, "main")
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(
          releaseMetadataForPackage(packageId, {
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
          }),
        )
      }
      case "vscode-insiders-linux": {
        const build = await this.buildVscodeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(
          releaseMetadataForPackage(packageId, {
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
          }),
        )
      }
      case "voxtype": {
        const build = await this.buildVoxtypeArtifact(tap)
        const sha256 = (
          await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
        ).trim().split(/\s+/)[0]
        return json(
          releaseMetadataForPackage(packageId, {
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
          }),
        )
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
        const release = JSON.parse(
          await this.releaseMetadata(packageId),
        ) as Record<string, unknown>

        return dag.directory()
          .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
          .withFile("homebrew/t3code-cli-main.rb", dag.file("t3code-cli-main.rb", updatedFormula))
          .withFile("release.json", dag.file("release.json", json(release)))
          .withFile("ci.log", dag.file("ci.log", ciLog))
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
        const release = JSON.parse(
          await this.releaseMetadata(packageId),
        ) as Record<string, unknown>

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
        const formulaContents = await tap.file("Formula/voxtype.rb").contents()
        const updatedFormula = formulaContents
          .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
          .replace(/version ".*"/, `version "${build.version}"`)
          .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
        const release = JSON.parse(
          await this.releaseMetadata(packageId),
        ) as Record<string, unknown>

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
