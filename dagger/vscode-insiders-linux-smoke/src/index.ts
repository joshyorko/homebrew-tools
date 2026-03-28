import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const DEFAULT_SOURCE_URL = "https://update.code.visualstudio.com/latest/linux-x64/insider"
const NODE_IMAGE = "node:24-bookworm"
const BREW_IMAGE = "homebrew/brew:latest"
const CASK_PATH = "Casks/vscode-insiders-linux.rb"

@object()
export class VscodeInsidersLinuxSmoke {
  private baseContainer(): Container {
    return dag
      .container()
      .from(NODE_IMAGE)
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl jq tar && rm -rf /var/lib/apt/lists/*",
      ])
  }

  private async resolveMetadata(sourceUrl: string): Promise<{
    caskVersion: string
    packageVersion: string
    resolvedUrl: string
  }> {
    const metadataContainer = this.baseContainer()
      .withEnvVariable("SOURCE_URL", sourceUrl)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "resolved_url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \"$SOURCE_URL\")",
          "curl -fsSL \"$resolved_url\" -o /tmp/vscode-insiders-source.tar.gz",
          "package_version=$(tar -xOf /tmp/vscode-insiders-source.tar.gz VSCode-linux-x64/resources/app/package.json | jq -r '.version')",
          "build_id=$(printf '%s' \"$resolved_url\" | sed -nE 's#^.*/code-insider-x64-([0-9]+)\\.tar\\.gz$#\\1#p')",
          "commit_sha=$(printf '%s' \"$resolved_url\" | sed -nE 's#^.*/download/insider/([0-9a-f]+)/.*#\\1#p')",
          "commit_short=${commit_sha:0:12}",
          "base_version=${package_version%-insider}",
          "printf 'resolved_url=%s\\npackage_version=%s\\ncask_version=%s,%s,%s\\n' \"$resolved_url\" \"$package_version\" \"$base_version\" \"$build_id\" \"$commit_short\"",
        ].join(" && "),
      ])

    const metadata = await metadataContainer.stdout()
    const entries = Object.fromEntries(
      metadata
        .trim()
        .split("\n")
        .map((line) => {
          const [key, ...rest] = line.split("=")
          return [key, rest.join("=")]
        }),
    )

    return {
      caskVersion: entries.cask_version,
      packageVersion: entries.package_version,
      resolvedUrl: entries.resolved_url,
    }
  }

  private async artifactBuild(
    tap: Directory,
    sourceUrl: string,
    version?: string,
  ): Promise<{
    artifactPath: string
    assetName: string
    caskVersion: string
    container: Container
    packageVersion: string
    resolvedUrl: string
  }> {
    const metadata = await this.resolveMetadata(sourceUrl)
    const caskVersion = version && version.length > 0 ? version : metadata.caskVersion
    const assetName = `vscode-insiders-linux-${caskVersion.replace(/,/g, "-")}.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = this.baseContainer()
      .withDirectory("/tap", tap)
      .withExec(["bash", "-lc", `curl -fsSL "${metadata.resolvedUrl}" -o /tmp/vscode-insiders-source.tar.gz`])
      .withExec([
        "node",
        "/tap/scripts/package-vscode-insiders-linux.mjs",
        "--source-tarball",
        "/tmp/vscode-insiders-source.tar.gz",
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      assetName,
      caskVersion,
      container,
      packageVersion: metadata.packageVersion,
      resolvedUrl: metadata.resolvedUrl,
    }
  }

  /**
   * Build and export the packaged VS Code Insiders artifact from the current upstream Linux tarball.
   */
  @func()
  async packageArtifact(tap: Directory, sourceUrl = DEFAULT_SOURCE_URL, version = ""): Promise<File> {
    const build = await this.artifactBuild(tap, sourceUrl, version)
    return build.container.file(build.artifactPath)
  }

  /**
   * Package the latest upstream Linux tarball, install the cask through Linuxbrew,
   * and verify the CLI launcher plus desktop integration work as expected.
   */
  @func()
  async smokeTest(tap: Directory, sourceUrl = DEFAULT_SOURCE_URL, version = ""): Promise<string> {
    const build = await this.artifactBuild(tap, sourceUrl, version)
    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const caskContents = await tap.file(CASK_PATH).contents()
    const updatedCask = caskContents
      .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
      .replace(/version ".*"/, `version "${build.caskVersion}"`)
      .replace(/sha256 x86_64_linux: ".*"/, `sha256 x86_64_linux: "${sha256}"`)
    const smokeTap = tap.withFile(CASK_PATH, dag.file("vscode-insiders-linux.rb", updatedCask))
    const output = await dag
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
          `echo "resolved_url=${build.resolvedUrl}"`,
          `echo "packaged_version=${build.caskVersion}"`,
          `echo "artifact_sha256=${sha256}"`,
          "mkdir -p \"$tap_dir\"",
          "cp -R /tap/. \"$tap_dir/\"",
          "brew install --cask test/tap/vscode-insiders-linux",
          "test -x \"$(brew --prefix)/bin/code-insiders\"",
          "test -x \"$(brew --prefix)/bin/code-tunnel-insiders\"",
          "test -f \"$HOME/.local/share/applications/vscode-insiders-linux.desktop\"",
          "test -f \"$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png\"",
          "grep -q 'CHROME_DESKTOP=vscode-insiders-linux.desktop' \"$HOME/.local/share/applications/vscode-insiders-linux.desktop\"",
          "pkg_path=$(find \"$(brew --prefix)/Caskroom/vscode-insiders-linux\" -path '*/VSCode-linux-x64/resources/app/package.json' | head -n1)",
          "test -n \"$pkg_path\"",
          "test \"$(jq -r '.desktopName' \"$pkg_path\")\" = 'vscode-insiders-linux.desktop'",
          "echo '--- installed package version ---'",
          "grep -m1 '\"version\"' \"$pkg_path\"",
        ].join(" && "),
      ])
      .stdout()

    if (!output.includes(build.packageVersion)) {
      throw new Error(`Smoke test did not produce expected VS Code version output:\n${output}`)
    }

    return output
  }
}
