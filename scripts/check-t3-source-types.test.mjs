import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import test from "node:test"
import { diagnostics, regressions, baselineFixture } from "./check-t3-source-types.mjs"

const diagnostic = (line = 2) => `src/example.ts:${line}:3 - error TS2322: Invalid assignment.`
test("deduplicates repeated checker summaries without dropping separate locations", () => {
  assert.equal(diagnostics(`${diagnostic()}\n${diagnostic()}\n${diagnostic(4)}`).length, 2)
  assert.equal(diagnostics(`\x1b[31m${diagnostic()}\x1b[0m`).length, 1)
})
test("permits only measured existing errors in untouched files", () => {
  const baseline = diagnostics(diagnostic())
  assert.equal(regressions(baseline, diagnostics(diagnostic(8)), new Set()).length, 0)
  assert.equal(regressions(baseline, diagnostics(diagnostic()), new Set(["src/example.ts"])).length, 1)
  assert.equal(regressions(baseline, diagnostics(`${diagnostic()}\n${diagnostic(4)}`), new Set()).length, 1)
  assert.equal(regressions(baseline, diagnostics(diagnostic().replace("TS2322", "TS2345")), new Set()).length, 1)
})

test("reads server diagnostics and refuses unfamiliar compiler failures", () => {
  const plain = "./src/cli/pair.ts(593,45): error TS2379: Invalid optional property."
  const pretty = "src/cli/pair.ts:593:45 - error TS2379: Invalid optional property."
  assert.deepEqual(diagnostics(plain), diagnostics(pretty))
  assert.equal(diagnostics(`${plain}\n${pretty}`).length, 1)
  assert.equal(regressions(diagnostics(plain), diagnostics(plain), new Set(["src/cli/pair.ts"])).length, 1)
  assert.throws(() => diagnostics("error TS18003: No inputs were found."), /Unrecognized compiler error/)
  assert.deepEqual(diagnostics("src/cli/pair.ts(1,1): suggestion TS377141: Add a brand."), [])
})

test("baseline reversal preserves the adjusted Homebrew fixture", () => {
  const file = 'import * as LoopbackTunnel from "../preview/LoopbackTunnel.ts";\nimport * as PreviewManager from "../preview/Manager.ts";\n      Layer.mock(LoopbackTunnel.LoopbackTunnel, {}),\n      Layer.mock(PreviewManager.PreviewManager, {\n'
  assert.equal(baselineFixture(file), 'import * as PreviewManager from "../preview/Manager.ts";\n      Layer.mock(PreviewManager.PreviewManager, {\n')
})

test("the actual attachment patch reverses after the tunnel fixture is normalized", () => {
  const root = mkdtempSync(join(tmpdir(), "t3-baseline-"))
  try {
    const patch = fileURLToPath(new URL("../patches/t3-homebrew-service-attach.patch", import.meta.url))
    const path = "apps/desktop/src/app/DesktopApp.homebrew.test.ts"
    execFileSync("git", ["init", "-q", root])
    execFileSync("git", ["-C", root, "apply", `--include=${path}`, patch])
    const fixture = join(root, path)
    const original = readFileSync(fixture, "utf8")
    const adjusted = original.replace('import * as PreviewManager', 'import * as LoopbackTunnel from "../preview/LoopbackTunnel.ts";\nimport * as PreviewManager').replace('      Layer.mock(PreviewManager.PreviewManager, {', '      Layer.mock(LoopbackTunnel.LoopbackTunnel, {}),\n      Layer.mock(PreviewManager.PreviewManager, {')
    writeFileSync(fixture, baselineFixture(adjusted))
    execFileSync("git", ["-C", root, "apply", "--reverse", "--check", `--include=${path}`, patch])
    assert.equal(readFileSync(fixture, "utf8"), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
