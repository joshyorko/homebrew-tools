import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const script = fileURLToPath(new URL("./check-t3-patches.mjs", import.meta.url))
const routine = fileURLToPath(new URL("./t3-source-patches.mjs", import.meta.url))
const workflow = readFileSync(new URL("../.github/workflows/tap-auto-update.yml", import.meta.url), "utf8")

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "t3-patch-gate-"))
  try {
    const source = join(root, "source")
    const patches = join(root, "patches")
    mkdirSync(source)
    mkdirSync(patches)
    const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 })
    git("init", "-q")
    writeFileSync(join(source, "entry.txt"), "before\nbase\nafter\n")
    git("add", ".")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")
    const sha = git("rev-parse", "HEAD").trim()
    const patch = (name, from, to) => writeFileSync(join(patches, name), `diff --git a/entry.txt b/entry.txt\n--- a/entry.txt\n+++ b/entry.txt\n@@ -1,3 +1,3 @@\n before\n-${from}\n+${to}\n after\n`)
    patch("t3-homebrew-desktop-update.patch", "base", "desktop")
    patch("t3-homebrew-service-attach.patch", "desktop", "attached")
    patch("t3-homebrew-service-protect.patch", "base", "cli")
    run({ root, source, patches, sha, patch })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const check = (f) => spawnSync(process.execPath, [script, "--source-ref", f.sha,
  "--repository", f.source, "--patch-root", f.patches,
  "--package-ids", '["t3-code-linux","t3code-cli-main"]'], { encoding: "utf8", timeout: 30_000 })

test("real Git applies both variants to independent pristine trees in production order", () => fixture((f) => {
  const result = check(f)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(f.sha))
  const updater = result.stdout.indexOf("t3-homebrew-desktop-update.patch")
  const attachment = result.stdout.indexOf("t3-homebrew-service-attach.patch")
  assert.ok(updater >= 0 && updater < attachment)
  assert.match(result.stdout, /t3-homebrew-service-protect\.patch/)
  assert.equal(readFileSync(join(f.source, "entry.txt"), "utf8"), "before\nbase\nafter\n")
}))

test("incompatible context names the selected SHA, patch, file and failing hunk", () => fixture((f) => {
  f.patch("t3-homebrew-service-attach.patch", "incompatible", "attached")
  const result = check(f)
  assert.notEqual(result.status, 0)
  assert.ok(result.stderr.includes(f.sha), result.stderr)
  assert.match(result.stderr, /t3-homebrew-service-attach\.patch/)
  assert.match(result.stderr, /entry\.txt/)
  assert.match(result.stderr, /hunk|patch failed/i)
}))

test("failure stops the resolve sequence before either package build is admitted", () => fixture((f) => {
  f.patch("t3-homebrew-desktop-update.patch", "incompatible", "desktop")
  const marker = join(f.root, "builds")
  const code = `const {execFileSync}=require('node:child_process'); const fs=require('node:fs');
    execFileSync(process.execPath, ${JSON.stringify([script, "--source-ref", f.sha, "--repository", f.source, "--patch-root", f.patches, "--package-ids", '["t3-code-linux","t3code-cli-main"]'])});
    fs.writeFileSync(${JSON.stringify(marker)}, 'CLI and Desktop builds admitted');`
  const result = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 30_000 })
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(marker), false)
  assert.match(workflow, /  build:\n    needs: resolve/)
  assert.match(workflow.slice(0, workflow.indexOf("\n  codex-memoryd:")), /node scripts\/check-t3-patches\.mjs/)
}))

test("the same application routine works after packaging removes Git metadata", () => fixture((f) => {
  rmSync(join(f.source, ".git"), { recursive: true, force: true })
  const result = spawnSync(process.execPath, [routine, "--source", f.source,
    "--source-ref", f.sha, "--variant", "desktop", "--patch-root", f.patches], { encoding: "utf8", timeout: 10_000 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(f.source, "entry.txt"), "utf8"), "before\nattached\nafter\n")
}))

test("moving source refs are rejected before Git or package work", () => {
  const result = spawnSync(process.execPath, [script, "--source-ref", "main", "--package-ids", '["t3-code-linux"]'], { encoding: "utf8", timeout: 10_000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /immutable|40.*SHA/i)
})

test("manual acceptance rejects moving refs before the Dagger action and preserves PR defaults", () => {
  const ci = readFileSync(new URL("../.github/workflows/tap-ci.yml", import.meta.url), "utf8")
  const validation = ci.match(/- name: Validate acceptance replay source[\s\S]*?run: \|\n([\s\S]*?)(?=\n    - name:)/)?.[1]
  assert.ok(validation)
  const run = validation.replace(/^        /gm, "")
  for (const [event, ref, succeeds] of [
    ["workflow_dispatch", "main", false],
    ["workflow_dispatch", "26e769d6c4fd955429595828ac572efeca006168", true],
    ["pull_request", "", true],
  ]) {
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", run], {
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, GITHUB_EVENT_NAME: event, T3_SOURCE_REF: ref },
    })
    assert.equal(result.status === 0, succeeds, result.stderr)
  }
})
