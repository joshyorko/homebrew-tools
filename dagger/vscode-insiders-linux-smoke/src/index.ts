import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const DEFAULT_SOURCE_URL = "https://update.code.visualstudio.com/api/update/linux-x64/insider/latest"
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
    archiveSha256: string
    caskVersion: string
    packageVersion: string
    resolvedUrl: string
    commitSha: string
  }> {
    const metadataContainer = this.baseContainer()
      .withEnvVariable("SOURCE_URL", sourceUrl)
      .withExec([
        "node",
        "--input-type=module",
        "-e",
        [
          "const response = await fetch(process.env.SOURCE_URL)",
          "if (!response.ok) throw new Error(`Failed to resolve ${process.env.SOURCE_URL}: ${response.status}`)",
          "const update = await response.json()",
          "if (typeof update.productVersion !== 'string' || !/^\\d+(?:\\.\\d+)+-insider$/.test(update.productVersion)) throw new Error('Invalid VS Code Insiders productVersion')",
          "if (typeof update.version !== 'string' || !/^[0-9a-f]{40}$/.test(update.version)) throw new Error('Invalid VS Code Insiders commit hash')",
          "if (typeof update.sha256hash !== 'string' || !/^[0-9a-f]{64}$/i.test(update.sha256hash)) throw new Error('Invalid VS Code Insiders archive SHA256')",
          "process.stdout.write(JSON.stringify({ archiveSha256: update.sha256hash.toLowerCase(), caskVersion: `${update.productVersion},${update.version}`, commitSha: update.version, packageVersion: update.productVersion, resolvedUrl: `https://update.code.visualstudio.com/commit:${update.version}/linux-x64/insider` }))",
        ].join("\n"),
      ])

    return JSON.parse(await metadataContainer.stdout())
  }

  private async artifactBuild(
    tap: Directory,
    sourceUrl: string,
    version?: string,
  ): Promise<{
    artifactPath: string
    archiveSha256: string
    assetName: string
    caskVersion: string
    container: Container
    packageVersion: string
    resolvedUrl: string
    commitSha: string
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
        "--source-archive",
        "/tmp/vscode-insiders-source.tar.gz",
        "--source-sha256",
        metadata.archiveSha256,
        "--output",
        artifactPath,
      ])

    return {
      artifactPath,
      archiveSha256: metadata.archiveSha256,
      assetName,
      caskVersion,
      container,
      packageVersion: metadata.packageVersion,
      resolvedUrl: metadata.resolvedUrl,
      commitSha: metadata.commitSha,
    }
  }

  /**
   * Build and export the packaged VS Code Insiders artifact from Microsoft's commit-pinned Linux archive.
   */
  @func()
  async packageArtifact(tap: Directory, sourceUrl = DEFAULT_SOURCE_URL, version = ""): Promise<File> {
    const build = await this.artifactBuild(tap, sourceUrl, version)
    return build.container.file(build.artifactPath)
  }

  /**
   * Package the latest Microsoft Linux archive, install the cask through Linuxbrew,
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
      .replace(/sha256 x86_64_linux: (?::no_check|".*")/, `sha256 x86_64_linux: "${sha256}"`)
    const smokeTap = tap.withFile(CASK_PATH, dag.file("vscode-insiders-linux.rb", updatedCask))
    const output = await dag
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
          "rm -f /etc/apt/sources.list.d/github-cli.list",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends desktop-file-utils libglib2.0-bin shared-mime-info xdg-utils",
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
          `echo "resolved_url=${build.resolvedUrl}"`,
          `echo "upstream_archive_sha256=${build.archiveSha256}"`,
          `echo "packaged_version=${build.caskVersion}"`,
          `echo "artifact_sha256=${sha256}"`,
          "mkdir -p \"$tap_dir\"",
          "cp -R /tap/. \"$tap_dir/\"",
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
          "grep -q '^Icon=vscode-insiders$' \"$HOME/.local/share/applications/code-insiders.desktop\"",
          "grep -q 'application/x-code-insiders-workspace;' \"$HOME/.local/share/applications/code-insiders.desktop\"",
          "grep -q -- '--open-url %U' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
          "grep -q '^Icon=vscode-insiders$' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
          "grep -q 'x-scheme-handler/vscode-insiders;' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
          "pkg_path=$(find \"$(brew --prefix)/Caskroom/vscode-insiders-linux\" -path '*/usr/share/code-insiders/resources/app/package.json' -print -quit)",
          "test -n \"$pkg_path\"",
          "test \"$(jq -r '.desktopName' \"$pkg_path\")\" = 'code-insiders.desktop'",
          "product_json_path=$(dirname \"$pkg_path\")/product.json",
          "test \"$(jq -r '.configurationDefaults[\"update.mode\"]' \"$product_json_path\")\" = 'none'",
          "test \"$(jq -r 'has(\"updateUrl\")' \"$product_json_path\")\" = 'false'",
          "installed_package_version=$(jq -r '.version' \"$pkg_path\")",
          `test "\$installed_package_version" = "${build.packageVersion}"`,
          "xdg_handler=$(xdg-mime query default x-scheme-handler/vscode-insiders)",
          "test \"$xdg_handler\" = 'code-insiders-url-handler.desktop'",
          "if command -v xdg-settings >/dev/null 2>&1; then",
          "  xdg_settings_handler=$(xdg-settings get default-url-scheme-handler vscode-insiders || true)",
          "  if [ -n \"$xdg_settings_handler\" ]; then",
          "    test \"$xdg_settings_handler\" = 'code-insiders-url-handler.desktop'",
          "  fi",
          "fi",
          "if command -v gio >/dev/null 2>&1; then",
          "  gio_mime_output=$(gio mime x-scheme-handler/vscode-insiders)",
          "  case \"$gio_mime_output\" in",
          "    *code-insiders-url-handler.desktop*) ;;",
          "    *)",
          "      echo \"$gio_mime_output\"",
          "      exit 1",
          "      ;;",
          "  esac",
          "fi",
          "echo '--- installed package version ---'",
          "grep -m1 '\"version\"' \"$pkg_path\"",
          "echo '--- Microsoft archive SHA256 ---'",
          `printf '%s\\n' "${build.archiveSha256}"`,
          "echo '--- xdg-mime default ---'",
          "printf '%s\\n' \"$xdg_handler\"",
        ].join("\n"),
      ])
      .stdout()

    if (!output.includes(build.packageVersion)) {
      throw new Error(`Smoke test did not produce expected VS Code version output:\n${output}`)
    }

    return output
  }
}
