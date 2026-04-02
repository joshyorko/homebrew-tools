import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const UPSTREAM_REPO = "https://github.com/peteonrails/voxtype"
const BUILD_IMAGE = "ubuntu:22.04"
const BREW_IMAGE = "homebrew/brew:latest"
const FORMULA_PATH = "Formula/voxtype.rb"

@object()
export class VoxtypeSmoke {
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
          "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl build-essential clang cmake pkg-config libasound2-dev git binutils nodejs npm python3 tar",
          "rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
      .withExec([
        "bash",
        "-lc",
        "curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y",
      ])
      .withEnvVariable(
        "PATH",
        "/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      )
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
  }

  private async artifactBuild(tap: Directory, ref: string, version?: string): Promise<{
    artifactPath: string
    assetName: string
    commit: string
    container: Container
    version: string
  }> {
    const upstreamRef = dag.git(UPSTREAM_REPO).ref(ref)
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

    const container = this.baseContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamTree)
      .withWorkdir("/upstream")
      .withExec([
        "cargo",
        "build",
        "--locked",
        "--release",
      ])
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "cp target/release/voxtype /tmp/voxtype-avx2",
          "zmm_count=$(objdump -d /tmp/voxtype-avx2 | grep -c zmm || true)",
          "avx512_count=$(objdump -d /tmp/voxtype-avx2 | grep -cE 'vpternlog|vpermt2|vpblendm|\\{1to[0-9]+\\}' || true)",
          "gfni_count=$(objdump -d /tmp/voxtype-avx2 | grep -cE 'vgf2p8|gf2p8' || true)",
          "printf 'zmm_count=%s\\navx512_count=%s\\ngfni_count=%s\\n' \"$zmm_count\" \"$avx512_count\" \"$gfni_count\"",
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

  /**
   * Build and export the packaged Voxtype artifact for a specific upstream ref.
   */
  @func()
  async packageArtifact(tap: Directory, ref = "refs/tags/v0.6.4", version = ""): Promise<File> {
    const build = await this.artifactBuild(tap, ref, version)
    return build.container.file(build.artifactPath)
  }

  /**
   * Build Voxtype from upstream source, package it with the tap helper,
   * install it through Linuxbrew in-container, and run a basic CLI smoke test.
   */
  @func()
  async smokeTest(tap: Directory, ref = "refs/tags/v0.6.4", version = ""): Promise<string> {
    const build = await this.artifactBuild(tap, ref, version)
    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const formulaContents = await tap.file(FORMULA_PATH).contents()
    const updatedFormula = formulaContents
      .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
      .replace(/version ".*"/, `version "${build.version}"`)
      .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
    const smokeTap = tap.withFile(FORMULA_PATH, dag.file("voxtype.rb", updatedFormula))
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
          `echo "upstream_commit=${build.commit}"`,
          `echo "packaged_version=${build.version}"`,
          `echo "artifact_sha256=${sha256}"`,
          "mkdir -p \"$tap_dir\"",
          "cp -R /tap/. \"$tap_dir/\"",
          "ls -la \"$tap_dir/Formula\"",
          "brew install test/tap/voxtype",
          "test -x \"$(brew --prefix)/bin/voxtype\"",
          "test -f \"$(brew --prefix)/share/voxtype/default.toml\"",
          "brew test test/tap/voxtype",
          "echo '--- package contents ---'",
          "tar -tzf /artifacts/" + build.assetName + " | sed -n '1,20p'",
          "echo '--- default config sample ---'",
          "sed -n '1,20p' \"$(brew --prefix)/share/voxtype/default.toml\"",
          "echo '--- voxtype version ---'",
          "voxtype --version",
        ].join("\n"),
      ])
      .stdout()

    if (!output.includes(build.version)) {
      throw new Error(`Smoke test did not produce expected Voxtype version output:\n${output}`)
    }

    return output
  }
}
