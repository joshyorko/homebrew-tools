import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "t3-nightly-promotion-"))
  const bundle = join(root, "bundle")
  const repo = join(root, "repo")
  const version = "0.1.10-nightly.20261116.4774.homebrew.1.16695c812fff"
  const commit = "16695c812fffe75e85f8cc3084d2c561aa3ca93f"
  const upstream = { tag: "v0.1.10-nightly.20261116.4774", version: "0.1.10-nightly.20261116.4774", commit }
  const notes = { schemaVersion: 1, packageVersion: version, sourceCommit: commit, upstream, releases: [upstream] }
  const path = `metadata/t3-nightly/${version}.json`
  const release = { package: "t3-code-linux", homebrew_path: "Casks/t3-code-linux.rb", version, upstream: { ref: upstream.tag, commit, version: upstream.version }, upstream_notes_path: path, upstream_notes: notes }
  mkdirSync(join(bundle, "homebrew"), { recursive: true })
  mkdirSync(join(bundle, "metadata/t3-nightly"), { recursive: true })
  mkdirSync(repo)
  writeFileSync(join(bundle, "homebrew/t3-code-linux.rb"), "cask fixture\n")
  const write = () => {
    writeFileSync(join(bundle, "release.json"), JSON.stringify(release))
    writeFileSync(join(bundle, path), JSON.stringify(notes))
  }
  write()
  const apply = () => execFileSync(process.execPath, [new URL("apply-release-bundle.mjs", import.meta.url).pathname, "--bundle", bundle, "--repo", repo], { stdio: "pipe" })
  return { root, bundle, repo, notes, release, path, write, apply, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("promotes the exact versioned nightly notes alongside its Homebrew candidate", () => {
  const f = fixture()
  try {
    f.apply()
    assert.deepEqual(JSON.parse(readFileSync(join(f.repo, f.path))), f.notes)
    assert.equal(readFileSync(join(f.repo, "Casks/t3-code-linux.rb"), "utf8"), "cask fixture\n")
    f.apply()
    assert.deepEqual(JSON.parse(readFileSync(join(f.repo, f.path))), f.notes)
  } finally { f.cleanup() }
})

test("rejects mismatched source and traversal metadata before changing the candidate", () => {
  for (const mismatch of ["commit", "path", "notes"]) {
    const f = fixture()
    try {
      if (mismatch === "commit") f.release.upstream.commit = "a".repeat(40)
      if (mismatch === "path") f.release.upstream_notes_path = "metadata/t3-nightly/../../outside.json"
      if (mismatch === "notes") f.release.upstream_notes = { ...f.notes, sourceCommit: "a".repeat(40) }
      f.write()
      assert.throws(f.apply)
      assert.throws(() => readFileSync(join(f.repo, "Casks/t3-code-linux.rb")))
    } finally { f.cleanup() }
  }
})

test("rejects symlinked notes destinations including dangling links", () => {
  for (const dangling of [false, true]) {
    const f = fixture()
    try {
      const outside = join(f.root, "outside")
      if (!dangling) mkdirSync(outside)
      symlinkSync(outside, join(f.repo, "metadata"))
      assert.throws(f.apply)
    } finally { f.cleanup() }
  }
})
