import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const UPSTREAM_REPO = "https://github.com/pingdotgg/t3code"
const BUN_VERSION = "1.3.9"
const NODE_IMAGE = "node:24-bookworm"
const BREW_IMAGE = "homebrew/brew:latest"
const FORMULA_PATH = "Formula/t3code-cli-main.rb"

@object()
export class T3CodeCliMainSmoke {
  private baseContainer(): Container {
    return dag
      .container()
      .from(NODE_IMAGE)
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl unzip python3 make g++ && rm -rf /var/lib/apt/lists/*",
      ])
      .withExec([
        "bash",
        "-lc",
        `curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}`,
      ])
      .withEnvVariable(
        "PATH",
        "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
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
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : `smoke.${commit.slice(0, 12)}`
    const assetName = `t3code-cli-main-${resolvedVersion}.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = this.baseContainer()
      .withDirectory("/tap", tap)
      .withDirectory("/upstream", upstreamRef.tree({ discardGitDir: true }))
      .withWorkdir("/upstream")
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

  /**
   * Build and export the packaged CLI artifact for a specific upstream ref.
   */
  @func()
  async packageArtifact(tap: Directory, ref = "main", version = ""): Promise<File> {
    const build = await this.artifactBuild(tap, ref, version)
    return build.container.file(build.artifactPath)
  }

  /**
   * Build the T3 CLI from upstream main, package it with the tap helper,
   * install it through Linuxbrew in-container, and run a basic CLI smoke test.
   */
  @func()
  async smokeTest(tap: Directory, ref = "main", version = ""): Promise<string> {
    const build = await this.artifactBuild(tap, ref, version)
    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const formulaContents = await tap.file(FORMULA_PATH).contents()
    const updatedFormula = formulaContents
      .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
      .replace(/version ".*"/, `version "${build.version}"`)
      .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
    const smokeTap = tap.withFile(FORMULA_PATH, dag.file("t3code-cli-main.rb", updatedFormula))
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
          "repo=$(brew --repository)",
          "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
          `echo "upstream_commit=${build.commit}"`,
          `echo "packaged_version=${build.version}"`,
          `echo "artifact_sha256=${sha256}"`,
          "mkdir -p \"$tap_dir\"",
          "cp -R /tap/. \"$tap_dir/\"",
          "ls -la \"$tap_dir/Formula\"",
          "brew install test/tap/t3code-cli-main",
          "test -f $(brew --prefix)/Cellar/t3code-cli-main/*/libexec/node_modules/node-addon-api/napi.h",
          "brew test test/tap/t3code-cli-main",
          "echo '--- package contents ---'",
          "tar -tzf /artifacts/" + build.assetName + " | sed -n '1,20p'",
          "echo '--- t3 --help ---'",
          "t3 --help",
        ].join(" && "),
      ])
      .stdout()

    if (!output.includes("USAGE")) {
      throw new Error(`Smoke test did not produce expected CLI help output:\n${output}`)
    }

    return output
  }
}
