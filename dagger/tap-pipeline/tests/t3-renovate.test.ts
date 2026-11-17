import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const text = readFileSync(new URL("../../../.github/renovate.json5", import.meta.url), "utf8")
const config = ts.parseConfigFileTextToJson("renovate.json5", text).config

test("Renovate extracts only the authoritative pin and sorts day and build numerically", () => {
  const manager = config.customManagers.find((entry) => entry.depNameTemplate === "pingdotgg/t3code")
  const file = manager.managerFilePatterns[0]
  const filePattern = new RegExp(file.slice(1, -1))
  assert.ok(filePattern.test("config/t3-nightly.json"))
  for (const path of ["other/config/t3-nightly.json", "Formula/t3code-cli-main.rb", "config/t3-nightly.json.bak"]) assert.equal(filePattern.test(path), false)
  const extract = new RegExp(manager.matchStrings[0])
  const version = new RegExp(manager.versioningTemplate.slice("regex:".length))
  const groups = (v) => version.exec(v)?.groups
  for (const v of ["1.2.3", "1.2.3-preview.20261117.1", "latest"]) {
    assert.equal(extract.test(JSON.stringify({ tag: `v${v}` })), false)
    assert.equal(groups(v), undefined)
  }
  assert.equal(extract.exec('{"tag": "v1.2.3-nightly.20261117.100"}')?.groups?.currentValue, "1.2.3-nightly.20261117.100")
  assert.equal(groups("1.2.3-nightly.20261117.100")?.revision, "100")
  assert.ok(Number(groups("1.2.3-nightly.20261118.1")?.build) > Number(groups("1.2.3-nightly.20261117.100")?.build))
  assert.ok(Number(groups("1.2.3-nightly.20261117.100")?.revision) > Number(groups("1.2.3-nightly.20261117.99")?.revision))
})
test("local automerge permission applies only to the T3 pin and requires passing tests", () => {
  const rules = config.packageRules.filter((rule) => rule.automerge)
  assert.equal(rules.length, 1)
  assert.deepEqual(rules[0].matchPackageNames, ["pingdotgg/t3code"])
  assert.deepEqual(rules[0].matchFileNames, ["config/t3-nightly.json"])
  assert.equal(rules[0].ignoreTests, false)
  assert.equal(rules[0].platformAutomerge, false)
  assert.equal(rules[0].ignoreUnstable, false)
  assert.equal(config.homebrew.enabled, false)
  assert.deepEqual(config.ignorePaths, ["Casks/**", "Formula/**"])
})
