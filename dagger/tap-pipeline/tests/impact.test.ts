import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { nonsemanticScriptChange, packageFingerprint } from "../../../scripts/tap-ci-impact.mjs"
import { PACKAGE_REGISTRY } from "../src/library.ts"

const root = new URL("../../..", import.meta.url)
const index = "dagger/tap-pipeline/src/index.ts"
const read = (path: string) => readFileSync(new URL(path, root), "utf8")
function affected(path: string, edit: (text: string) => string) {
  const before = read(path)
  const after = edit(before)
  assert.notEqual(before, after, "fixture must change actual source")
  return PACKAGE_REGISTRY.filter((entry) => entry.supportsPrCi).filter((entry) =>
    packageFingerprint(read, entry.id) !== packageFingerprint((candidate: string) => candidate === path ? after : read(candidate), entry.id))
    .map((entry) => entry.id)
}

test("actual monolith package hook only affects codex-memoryd", () => {
  assert.deepEqual(affected(index, (text) => text.replace('return this.artifactCheck("codex-memoryd")', 'return this.artifactCheck("codex-memoryd").then((value) => value.trim())')), ["codex-memoryd"])
})
test("actual shared T3 base affects its consumers only", () => {
  assert.deepEqual(affected(index, (text) => text.replace('"pkg-config --exists libsecret-1"', '"pkg-config --exists libsecret-1 && true"')), ["t3code-cli-main", "t3-code-linux"])
})
test("shared Homebrew runtime affects all consumers", () => {
  assert.equal(affected(index, (text) => text.replace('ghcr.io/homebrew/brew:main', 'ghcr.io/homebrew/brew:changed')).length, 17)
})
test("AST preserves strings but ignores comments and formatting", () => {
  assert.deepEqual(affected(index, (text) => text.replace('private async buildRccArtifacts()', '// comment\n  private   async   buildRccArtifacts()')), [])
  assert.deepEqual(affected(index, (text) => text.replace('rcc-linux64', 'rcc-linux-new')), ["rcc"])
})
test("one registry entry and one artifact plan remain scoped", () => {
  assert.deepEqual(affected("dagger/tap-pipeline/src/library.ts", (text) => text.replace('https://github.com/joshyorko/rcc', 'https://github.com/example/rcc')), ["rcc"])
  assert.deepEqual(affected("dagger/tap-pipeline/src/install-checks.ts", (text) => text.replace('"codex-memoryd --version"', '"codex-memoryd --help"')), ["codex-memoryd"])
})
test("script formatting comparison preserves runtime strings and ASI", () => {
  assert.equal(nonsemanticScriptChange("builder.mjs", 'const x = "value"\n', '// comment\nconst   x = "value";\n'), true)
  assert.equal(nonsemanticScriptChange("builder.mjs", 'const x = `a b`', 'const x = `a  b`'), false)
  assert.equal(nonsemanticScriptChange("builder.mjs", 'function x() { return 1 }', 'function x() { return\n1 }'), false)
  assert.equal(nonsemanticScriptChange("builder.mjs", undefined, '// new'), false)
})
test("dependent registry entry impacts Desktop as well as its CLI", () => {
  assert.deepEqual(affected("dagger/tap-pipeline/src/library.ts", (text) => text.replace('homebrewPath: "Formula/devsy.rb"', 'homebrewPath: "Formula/devsy-next.rb"')), ["devsy"])
  const before = read("dagger/tap-pipeline/src/library.ts")
  const after = before.replace('homebrewPath: "Formula/devsy.rb"', 'homebrewPath: "Formula/devsy-next.rb"')
  const ids = ["devsy-desktop", "devsy"]
  assert.notEqual(packageFingerprint(read, "devsy-desktop", ids), packageFingerprint((path: string) => path.endsWith("library.ts") ? after : read(path), "devsy-desktop", ids))
})
