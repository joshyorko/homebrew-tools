import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { publish, validatePair } from "./publish-t3-pin.mjs"

const sha = "a".repeat(40)
const tag = "v1.2.3-nightly.20261117.100"
const version = `${tag.slice(1)}.homebrew.1.${sha.slice(0, 12)}`
const source = { tag, version, commit: sha }
const env = { GITHUB_REPOSITORY: "joshyorko/homebrew-tools", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_run", T3_TAP_HEAD: sha }
const root = resolve(import.meta.dirname, "..")
function fixture(fn) {
  const repo = mkdtempSync(join(tmpdir(), "codex-t3-pin-test-"))
  try {
    mkdirSync(join(repo, "config"))
    writeFileSync(join(repo, "config/t3-nightly.json"), JSON.stringify({ tag }))
    const notes = { schemaVersion: 1, packageVersion: version, sourceCommit: sha, upstream: { tag, version: tag.slice(1), commit: sha }, releases: [] }
    const bundles = ["t3code-cli-main", "t3-code-linux"].map((id, i) => {
      const dir = join(repo, "bundles", id)
      for (const path of ["artifacts", "homebrew", "metadata/t3-nightly"]) mkdirSync(join(dir, path), { recursive: true })
      const homebrew_path = i ? "Casks/t3-code-linux.rb" : "Formula/t3code-cli-main.rb"
      const asset_name = `${id}-${version}.tar.gz`
      writeFileSync(join(dir, "artifacts", asset_name), id)
      writeFileSync(join(dir, "homebrew", homebrew_path.split("/").at(-1)), "verified candidate")
      writeFileSync(join(dir, `metadata/t3-nightly/${version}.json`), JSON.stringify(notes))
      const release = { package: id, homebrew_path, version, asset_name, artifact_sha256: createHash("sha256").update(id).digest("hex"), release_tag: `${id}-${version}`, release_title: id, release_notes: "notes", upstream: { repo: "https://github.com/pingdotgg/t3code", ref: tag, version: tag.slice(1), commit: sha }, upstream_notes_path: `metadata/t3-nightly/${version}.json`, upstream_notes: notes }
      writeFileSync(join(dir, "release.json"), JSON.stringify(release))
      return { dir, release }
    })
    const calls = []
    const releases = []
    const run = (cmd, args) => {
      calls.push([cmd, ...args])
      if (cmd === "node") return execFileSync(cmd, [join(root, "scripts", args[0].split("/").at(-1)), ...args.slice(1)], { encoding: "utf8" })
      if (cmd === "git") return args.includes("rev-parse") ? sha : ""
      if (args.includes("--slurp")) return JSON.stringify([releases])
      if (args[0] === "release" && args[1] === "create") {
        const bundle = bundles.find((b) => b.release.release_tag === args[2])
        releases.push({ tag_name: args[2], draft: false, assets: [{ name: bundle.release.asset_name, digest: `sha256:${bundle.release.artifact_sha256}` }] })
      }
      if (args[0] === "api" && args[1]?.includes("releases/tags/")) return JSON.stringify(releases.find((r) => args[1].endsWith(r.tag_name)))
      if (args.includes("--jq")) return sha
      return ""
    }
    fn({ repo, bundles, calls, run, bundleRoot: join(repo, "bundles") })
  } finally { rmSync(repo, { recursive: true, force: true }) }
}
test("both bundles require the declared tag, same immutable SHA, provenance and real digest", () => fixture(({ bundles }) => {
  assert.equal(validatePair({ pin: { tag }, source, bundles }).commit, sha)
  for (const mutate of [
    (b) => { b[1].release.upstream.commit = "b".repeat(40) },
    (b) => { b[1].release.upstream.ref = "latest" },
    (b) => { b[1].release.artifact_sha256 = "0".repeat(64) },
    (b) => { b[1].release.homebrew_path = "Formula/devsy.rb" },
    (b) => { b[1].release.upstream_notes = {} },
  ]) {
    const changed = structuredClone(bundles)
    mutate(changed)
    assert.throws(() => validatePair({ pin: { tag }, source, bundles: changed }))
  }
}))
test("publication rejects PRs and non-main dispatches before any command", () => {
  for (const bad of [{ GITHUB_REF: "refs/pull/1/merge" }, { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REPOSITORY: "other/repo" }]) {
    assert.throws(() => publish({ repo: root, env: { ...env, ...bad }, run: () => assert.fail("command ran") }), /trusted main/)
  }
})
test("verified pair publishes once, atomically stages both definitions and receipt, then no-ops", () => fixture((f) => {
  assert.equal(publish({ ...f, source, env }), "Published paired T3 release")
  assert.equal(f.calls.filter((c) => c[0] === "gh" && c[1] === "release").length, 2)
  const add = f.calls.find((c) => c.includes("add"))
  assert.ok(add.includes("Formula/t3code-cli-main.rb") && add.includes("Casks/t3-code-linux.rb"))
  assert.equal(JSON.parse(readFileSync(join(f.repo, "metadata/t3-nightly/published.json"))).commit, sha)
  f.calls.length = 0
  assert.equal(publish({ ...f, source, env }), "Already published")
  assert.equal(f.calls.some((c) => c.includes("create") || c.includes("push")), false)
}))
test("stale main or existing conflicting assets fail without overwriting releases", () => fixture((f) => {
  assert.throws(() => publish({ ...f, source, env, run: (cmd, args) => cmd === "gh" && args.includes("--jq") ? "b".repeat(40) : f.run(cmd, args) }), /Main changed/)
  assert.throws(() => publish({ ...f, source, env, run: (cmd, args) => cmd === "gh" && args.includes("--slurp") ? JSON.stringify([[{ tag_name: f.bundles[0].release.release_tag, draft: false, assets: [] }]]) : f.run(cmd, args) }), /refusing overwrite/)
  assert.equal(f.calls.some((c) => c.includes("create") || c.includes("push")), false)
}))
