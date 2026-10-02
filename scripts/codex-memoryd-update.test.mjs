import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { sourceVersion, renderFormula, TARGETS } from "./codex-memoryd-update.mjs"

const commit = "8146e6bd4bfe32651183d61f2dd1b12b84ab93cb"
const version = "20261002154624.8146e6bd4bfe"
const formula = readFileSync(new URL("../Formula/codex-memoryd.rb", import.meta.url), "utf8")
const checksums = TARGETS.map((target, index) => `${String(index + 1).repeat(64)}  codex-memoryd-${version}-${target}.tar.gz`).join("\n")

test("commit-derived versions are deterministic and reject malformed source identities", () => {
  assert.equal(sourceVersion({ sha: commit, commit: { committer: { date: "2026-10-02T15:46:24Z" } } }), version)
  assert.throws(() => sourceVersion({ sha: "master" }), /commit/)
  assert.throws(() => sourceVersion({ sha: commit, commit: { committer: { date: "invalid" } } }), /date/)
})

test("formula rendering preserves native lifecycle and all four platforms", () => {
  const rendered = renderFormula(formula, version, checksums)
  assert.match(rendered, new RegExp(`version "${version}"`))
  assert.equal((rendered.match(/homebrew-tools\/releases\/download/g) ?? []).length, 4)
  for (const target of TARGETS) assert.ok(rendered.includes(`codex-memoryd-#{version}-${target}.tar.gz`))
  assert.ok(rendered.includes('system bin/"codex-memoryd", "up"'))
  assert.ok(rendered.includes('assert_path_exists testpath/"runtime/memory.db"'))
  assert.ok(rendered.includes("tracks merged master commits"))
  assert.ok(!rendered.includes("Pinned to the immutable"))
})

test("a partial or ambiguous artifact set cannot update the formula", () => {
  assert.throws(() => renderFormula(formula, version, checksums.split("\n").slice(1).join("\n")), /missing/)
  assert.throws(() => renderFormula(formula, version, `${checksums}\n${checksums.split("\n")[0]}`), /Duplicate/)
  assert.throws(() => renderFormula(formula, "master", checksums), /version/)
  assert.throws(() => renderFormula(formula.replace(/^  version .*$/m, ""), version, checksums), /version/)
  assert.throws(() => renderFormula(formula, version, checksums.replace(/1{64}/, "invalid")), /checksum/)
})
