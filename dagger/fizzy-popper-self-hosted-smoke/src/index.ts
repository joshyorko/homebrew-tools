import { dag, CacheSharingMode, Container, Directory, File, object, func } from "@dagger.io/dagger"

const UPSTREAM_REPO = "https://github.com/joshyorko/fizzy-popper"
const NODE_IMAGE = "node:24-bookworm"
const BREW_IMAGE = "homebrew/brew:latest"
const FORMULA_PATH = "Formula/fizzy-popper-self-hosted.rb"

@object()
export class FizzyPopperSelfHostedSmoke {
  private baseContainer(): Container {
    return dag
      .container()
      .from(NODE_IMAGE)
      .withMountedCache(
        "/root/.npm",
        dag.cacheVolume("fizzy-popper-self-hosted-smoke-npm-cache"),
        { sharing: CacheSharingMode.Locked },
      )
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tar && rm -rf /var/lib/apt/lists/*",
      ])
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
    const resolvedVersion = version && version.length > 0 ? version : `selfhosted.${commit.slice(0, 12)}`
    const assetName = `fizzy-popper-self-hosted-${resolvedVersion}.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = this.baseContainer()
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

  @func()
  async packageArtifact(tap: Directory, ref = "self-hosted", version = ""): Promise<File> {
    const build = await this.artifactBuild(tap, ref, version)
    return build.container.file(build.artifactPath)
  }

  @func()
  async smokeTest(tap: Directory, ref = "self-hosted", version = ""): Promise<string> {
    const build = await this.artifactBuild(tap, ref, version)
    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const formulaContents = await tap.file(FORMULA_PATH).contents()
    const updatedFormula = formulaContents
      .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
      .replace(/version ".*"/, `version "${build.version}"`)
      .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
    const smokeTap = tap.withFile(FORMULA_PATH, dag.file("fizzy-popper-self-hosted.rb", updatedFormula))
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
          `echo "upstream_commit=${build.commit}"`,
          `echo "packaged_version=${build.version}"`,
          `echo "artifact_sha256=${sha256}"`,
          "mkdir -p \"$tap_dir/Formula\"",
          "cp /tap/Formula/fizzy-popper-self-hosted.rb \"$tap_dir/Formula/\"",
          "brew install test/tap/fizzy-popper-self-hosted",
          "test -x \"$(brew --prefix)/bin/fizzy-popper\"",
          "brew test test/tap/fizzy-popper-self-hosted",
          "echo '--- package contents ---'",
          `tar -tzf /artifacts/${build.assetName} | sed -n '1,20p'`,
          "echo '--- fizzy-popper help ---'",
          "fizzy-popper --help",
        ].join("\n"),
      ])
      .stdout()

    if (!output.includes("Usage: fizzy-popper") && !output.includes("Watch boards and dispatch agents")) {
      throw new Error(`Smoke test did not produce expected fizzy-popper help output:\n${output}`)
    }

    return output
  }
}
