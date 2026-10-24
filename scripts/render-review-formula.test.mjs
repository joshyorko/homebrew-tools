import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import test from "node:test"

const script = new URL("./render-review-formula.mjs", import.meta.url).pathname
const args = [script, "--version", "0.1.0", "--x86-64-sha256", "a".repeat(64), "--aarch64-sha256", "b".repeat(64)]

test("stable formula preserves architecture-specific verified assets and appliance layout", () => {
  const formula = execFileSync(process.execPath, args, { encoding: "utf8" })
  assert.match(formula, /download\/v0\.1\.0\/review-x86_64\.tar\.gz/)
  assert.match(formula, /download\/v0\.1\.0\/review-aarch64\.tar\.gz/)
  for (const dependency of ["apptainer", "squashfuse", "gh"]) assert.ok(formula.includes(`depends_on "${dependency}"`))
  assert.match(formula, /bin\.install "review"/)
  assert.match(formula, /libexec\.install "launcher", "build.json", "build.txt", "LICENSE", "NOTICE"/)
  assert.doesNotMatch(formula, /independent|:no_check/)
  assert.equal(execFileSync("ruby", ["-c"], { input: formula, encoding: "utf8" }).trim(), "Syntax OK")
})

test("candidate formula accepts local assets without remote publication", () => {
  const formula = execFileSync(process.execPath, [...args, "--candidate-url", "file:///artifacts/review.tar.gz"], { encoding: "utf8" })
  assert.equal(formula.match(/url "file:\/\/\/artifacts\/review.tar.gz"/g)?.length, 2)
})

test("renderer refuses missing checksums, prereleases, and unsafe candidate URLs", () => {
  for (const invalid of [
    [script, "--version", "0.1.0"],
    [...args, "--version", "0.1.0-dev"],
    [...args, "--candidate-url", 'file:///artifacts/"escape'],
  ]) assert.notEqual(spawnSync(process.execPath, invalid).status, 0)
})
