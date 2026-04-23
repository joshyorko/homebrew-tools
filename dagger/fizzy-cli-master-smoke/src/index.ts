import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const UPSTREAM_REPO = "https://github.com/basecamp/fizzy-cli"
const GO_IMAGE = "golang:1.26-bookworm"
const BREW_IMAGE = "homebrew/brew:latest"
const FORMULA_PATH = "Formula/fizzy-cli-master.rb"

@object()
export class FizzyCliMasterSmoke {
  private baseContainer(): Container {
    return dag
      .container()
      .from(GO_IMAGE)
      .withExec([
        "bash",
        "-lc",
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates nodejs npm tar && rm -rf /var/lib/apt/lists/*",
      ])
      .withEnvVariable("CGO_ENABLED", "0")
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
    const resolvedVersion = version && version.length > 0 ? version : `master.${commit.slice(0, 12)}`
    const assetName = `fizzy-cli-master-${resolvedVersion}-homebrew-x86_64-linux.tar.gz`
    const artifactPath = `/tmp/${assetName}`

    const container = this.baseContainer()
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

  @func()
  async packageArtifact(tap: Directory, ref = "master", version = ""): Promise<File> {
    const build = await this.artifactBuild(tap, ref, version)
    return build.container.file(build.artifactPath)
  }

  @func()
  async smokeTest(tap: Directory, ref = "master", version = ""): Promise<string> {
    const build = await this.artifactBuild(tap, ref, version)
    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
    const formulaContents = await tap.file(FORMULA_PATH).contents()
    const updatedFormula = formulaContents
      .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
      .replace(/version ".*"/, `version "${build.version}"`)
      .replace(/sha256 ".*"/, `sha256 "${sha256}"`)
    const smokeTap = tap.withFile(FORMULA_PATH, dag.file("fizzy-cli-master.rb", updatedFormula))
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
          "cp /tap/Formula/fizzy-cli-master.rb \"$tap_dir/Formula/\"",
          "brew install test/tap/fizzy-cli-master",
          "test -x \"$(brew --prefix)/bin/fizzy\"",
          "brew test test/tap/fizzy-cli-master",
          "echo '--- package contents ---'",
          `tar -tzf /artifacts/${build.assetName} | sed -n '1,20p'`,
          "echo '--- fizzy version ---'",
          "fizzy --version",
          "echo '--- fizzy completion bash ---'",
          "fizzy completion bash | sed -n '1,5p'",
        ].join("\n"),
      ])
      .stdout()

    if (!output.includes(build.version)) {
      throw new Error(`Smoke test did not produce expected Fizzy version output:\n${output}`)
    }

    return output
  }
}
