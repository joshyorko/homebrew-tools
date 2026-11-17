#!/usr/bin/env node
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseNightlyPin } from "../dagger/tap-pipeline/src/t3-nightly.ts"

const packages = ["t3code-cli-main", "t3-code-linux"]
const paths = ["Formula/t3code-cli-main.rb", "Casks/t3-code-linux.rb"]
const receiptPath = "metadata/t3-nightly/published.json"
const digest = (data) => createHash("sha256").update(data).digest("hex")

export function validatePair({ pin, source, bundles }) {
  const tag = parseNightlyPin(pin)
  if (source.tag !== tag || !/^[a-f0-9]{40}$/.test(source.commit) ||
      source.version !== `${tag.slice(1)}.homebrew.1.${source.commit.slice(0, 12)}`) throw new Error("Resolved source does not match pin")
  const artifacts = bundles.map(({ dir, release }, i) => {
    if (release.package !== packages[i] || release.homebrew_path !== paths[i] ||
        release.version !== source.version || release.release_tag !== `${packages[i]}-${source.version}` ||
        release.upstream?.repo !== "https://github.com/pingdotgg/t3code" ||
        release.upstream?.ref !== tag || release.upstream?.commit !== source.commit ||
        release.upstream_notes?.sourceCommit !== source.commit ||
        release.upstream_notes?.upstream?.tag !== tag ||
        release.upstream_notes_path !== `metadata/t3-nightly/${source.version}.json`) throw new Error("Paired release identity mismatch")
    if (typeof release.asset_name !== "string" || basename(release.asset_name) !== release.asset_name ||
        !/^[a-zA-Z0-9._-]+$/.test(release.asset_name)) throw new Error("Invalid asset name")
    const artifact = join(dir, "artifacts", release.asset_name)
    const sha256 = digest(readFileSync(artifact))
    if (sha256 !== release.artifact_sha256) throw new Error("Artifact digest mismatch")
    return { artifact, sha256, name: release.asset_name }
  })
  if (JSON.stringify(bundles[0].release.upstream_notes) !== JSON.stringify(bundles[1].release.upstream_notes)) throw new Error("Paired provenance differs")
  return { tag, commit: source.commit, version: source.version, artifacts }
}

export function publish({ repo, bundleRoot, source, env = process.env, run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }) {
  if (env.GITHUB_REPOSITORY !== "joshyorko/homebrew-tools" || env.GITHUB_REF !== "refs/heads/main" ||
      !["workflow_run", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME) || !/^[a-f0-9]{40}$/.test(env.T3_TAP_HEAD ?? "")) throw new Error("Publication requires trusted main context")
  const pin = JSON.parse(readFileSync(join(repo, "config/t3-nightly.json"), "utf8"))
  const bundles = packages.map((id) => {
    const dir = run("node", [join(repo, "scripts/resolve-release-bundle.mjs"), "--root", join(bundleRoot, id)]).trim()
    return { dir, release: JSON.parse(readFileSync(join(dir, "release.json"), "utf8")) }
  })
  const pair = validatePair({ pin, source, bundles })
  const assertMain = () => {
    const main = run("gh", ["api", "repos/joshyorko/homebrew-tools/git/ref/heads/main", "--jq", ".object.sha"]).trim()
    if (main !== env.T3_TAP_HEAD || run("git", ["-C", repo, "rev-parse", "HEAD"]).trim() !== env.T3_TAP_HEAD) throw new Error("Main changed; rerun acceptance and publication")
  }
  assertMain()
  const receipt = { tag: pair.tag, commit: pair.commit, version: pair.version, artifacts: pair.artifacts.map(({ name, sha256 }) => ({ name, sha256 })) }
  const receiptFile = join(repo, receiptPath)
  const alreadyPublished = existsSync(receiptFile) && JSON.stringify(JSON.parse(readFileSync(receiptFile, "utf8"))) === JSON.stringify(receipt)
    && bundles.every(({ dir, release }) => existsSync(join(repo, release.homebrew_path))
      && readFileSync(join(repo, release.homebrew_path), "utf8") === readFileSync(join(dir, "homebrew", basename(release.homebrew_path)), "utf8"))
  // Validate/apply BOTH bundles before any external mutation. This verifies retained notes too.
  for (const bundle of bundles) run("node", [join(repo, "scripts/apply-release-bundle.mjs"), "--bundle", bundle.dir, "--repo", repo])
  assertMain()
  const records = JSON.parse(run("gh", ["api", "--paginate", "--slurp", "repos/joshyorko/homebrew-tools/releases?per_page=100"])).flat()
  const verify = (release, i) => {
    const asset = release.assets.find((a) => a.name === pair.artifacts[i].name)
    if (release.draft || !asset || asset.digest !== `sha256:${pair.artifacts[i].sha256}`) throw new Error("Existing release differs; refusing overwrite")
  }
  // Check both existing releases before creating either missing release.
  const existing = bundles.map(({ release }) => records.find((r) => r.tag_name === release.release_tag))
  existing.forEach((release, i) => { if (release) verify(release, i) })
  for (const [i, bundle] of bundles.entries()) {
    const release = bundle.release
    if (!existing[i]) {
      const notes = join(bundle.dir, "publish-notes.md")
      writeFileSync(notes, release.release_notes)
      run("gh", ["release", "create", release.release_tag, pair.artifacts[i].artifact, "--repo", env.GITHUB_REPOSITORY, "--target", env.T3_TAP_HEAD, "--prerelease", "--latest=false", "--title", release.release_title, "--notes-file", notes])
      const uploaded = JSON.parse(run("gh", ["api", `repos/joshyorko/homebrew-tools/releases/tags/${release.release_tag}`]))
      verify(uploaded, i)
    }
  }
  if (alreadyPublished) return "Already published"
  mkdirSync(join(repo, "metadata/t3-nightly"), { recursive: true })
  writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n")
  assertMain()
  run("git", ["-C", repo, "add", ...paths, receiptPath, `metadata/t3-nightly/${source.version}.json`])
  run("git", ["-C", repo, "commit", "-m", `Publish paired T3 ${source.version}`])
  // No rebase or force: concurrent main updates reject the push and require a fresh run.
  run("git", ["-C", repo, "push", "origin", "HEAD:main"])
  return "Published paired T3 release"
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(publish({ repo: resolve(process.cwd()), bundleRoot: process.env.T3_BUNDLES, source: JSON.parse(process.env.T3_SOURCE_JSON) }))
}
