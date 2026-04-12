import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const UPSTREAM_REPO = "https://github.com/Adam-D-Lewis/eitype"
const UPSTREAM_REF = "refs/tags/0.2.0"
const BUILD_IMAGE = "rust:1-bookworm"
const BREW_IMAGE = "homebrew/brew:latest"
const FORMULA_PATH = "Formula/eitype.rb"

@object()
export class EitypeSmoke {
  private baseContainer(): Container {
    return dag
      .container()
      .from(BUILD_IMAGE)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "apt-get update",
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates build-essential clang cmake pkg-config libxkbcommon-dev git nodejs tar",
          "rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
  }

  private async artifactBuild(tap: Directory, ref: string, version?: string): Promise<{
    artifactPath: string
    assetName: string
    commit: string
    container: Container
    upstreamTag: string
    version: string
  }> {
    const upstreamTag = ref.replace(/^refs\/tags\//, "")
    const upstreamRef = dag.git(UPSTREAM_REPO).ref(ref)
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

    const container = this.baseContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamTree)
      .withWorkdir("/upstream")
      .withExec(["cargo", "build", "--locked", "--release", "--bin", "eitype"])
      .withExec([
        "node",
        "/tap/scripts/package-eitype.mjs",
        "--upstream-dir",
        "/upstream",
        "--binary",
        "/upstream/target/release/eitype",
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

  /**
   * Build and export the packaged Eitype artifact for a specific upstream ref.
   */
  @func()
  async packageArtifact(tap: Directory, ref = UPSTREAM_REF, version = ""): Promise<File> {
    const build = await this.artifactBuild(tap, ref, version)
    return build.container.file(build.artifactPath)
  }

  /**
   * Build Eitype from upstream source, package it with the tap helper,
   * install it through Linuxbrew in-container, and run a basic CLI smoke test.
   */
  @func()
  async smokeTest(tap: Directory, ref = UPSTREAM_REF, version = ""): Promise<string> {
    const build = await this.artifactBuild(tap, ref, version)
    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const formulaContents = await tap.file(FORMULA_PATH).contents()
    const updatedFormula = formulaContents
      .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
      .replace(/version ".*"/, `version "${build.version}"`)
      .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
    const smokeTap = tap.withFile(FORMULA_PATH, dag.file("eitype.rb", updatedFormula))
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
          `echo "upstream_commit=${build.commit}"`,
          `echo "upstream_tag=${build.upstreamTag}"`,
          `echo "packaged_version=${build.version}"`,
          `echo "artifact_sha256=${sha256}"`,
          "mkdir -p \"$tap_dir\"",
          "cp -R /tap/Formula \"$tap_dir/\"",
          "ls -la \"$tap_dir/Formula\"",
          "brew install test/tap/eitype",
          "test -x \"$(brew --prefix)/bin/eitype\"",
          "brew test test/tap/eitype",
          "echo '--- package contents ---'",
          "tar -tzf /artifacts/" + build.assetName,
          "echo '--- eitype --version ---'",
          "eitype --version",
        ].join("\n"),
      ])
      .stdout()

    if (!output.includes(build.version)) {
      throw new Error(`Smoke test did not produce expected Eitype version output:\n${output}`)
    }

    return output
  }
}
