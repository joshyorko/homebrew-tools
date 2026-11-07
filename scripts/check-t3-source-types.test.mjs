import assert from "node:assert/strict"
import test from "node:test"
import { diagnostics, regressions } from "./check-t3-source-types.mjs"

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
