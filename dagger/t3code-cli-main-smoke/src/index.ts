import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const UPSTREAM_REPO = "https://github.com/pingdotgg/t3code"
const BUN_VERSION = "1.3.9"
const NODE_IMAGE = "node:24-bookworm"

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
    commit: string
    container: Container
    version: string
  }> {
    const upstreamRef = dag.git(UPSTREAM_REPO).ref(ref)
    const commit = await upstreamRef.commit()
    const resolvedVersion = version && version.length > 0 ? version : `smoke.${commit.slice(0, 12)}`
    const artifactPath = `/tmp/t3code-cli-main-${resolvedVersion}.tar.gz`

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
   * install runtime dependencies the same way the formula does, and run
   * a basic CLI smoke test.
   */
  @func()
  async smokeTest(tap: Directory, ref = "main"): Promise<string> {
    const build = await this.artifactBuild(tap, ref)

    const output = await build.container
      .withExec([
        "bash",
        "-lc",
        [
          "mkdir -p /opt/t3/libexec /opt/t3/bin",
          `tar -xzf ${build.artifactPath} -C /opt/t3/libexec`,
          "cd /opt/t3/libexec",
          "npm ci --omit=dev",
          "printf '%s\\n' '#!/bin/sh' 'exec node /opt/t3/libexec/dist/index.mjs \"$@\"' > /opt/t3/bin/t3",
          "chmod +x /opt/t3/bin/t3",
        ].join(" && "),
      ])
      .withExec([
        "bash",
        "-lc",
        [
          `echo "upstream_commit=${build.commit}"`,
          `echo "packaged_version=${build.version}"`,
          `sha256sum ${build.artifactPath}`,
          "echo '--- package contents ---'",
          `tar -tzf ${build.artifactPath} | sed -n '1,20p'`,
          "echo '--- t3 --help ---'",
          "/opt/t3/bin/t3 --help",
        ].join(" && "),
      ])
      .stdout()

    if (!output.includes("USAGE")) {
      throw new Error(`Smoke test did not produce expected CLI help output:\n${output}`)
    }

    return output
  }
}
