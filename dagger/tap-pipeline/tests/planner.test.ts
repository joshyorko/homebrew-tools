import test from "node:test"
import assert from "node:assert/strict"

import {
  PACKAGE_REGISTRY,
  changedCiPackagesFromPaths,
  changedPackagesFromPaths,
  packagesDueAt,
} from "../src/library.ts"

test("packagesDueAt respects the daily T3 cadence", () => {
  const dueAtScheduledMinute = packagesDueAt(new Date("2026-04-02T06:41:00Z")).map((entry) => entry.id)
  const dueLaterThatDay = packagesDueAt(new Date("2026-04-02T12:41:00Z")).map((entry) => entry.id)

  assert.ok(dueAtScheduledMinute.includes("t3code-cli-main"))
  assert.ok(!dueLaterThatDay.includes("t3code-cli-main"))
})

test("packagesDueAt cleanly no-ops when nothing matches the planner cadence", () => {
  const due = packagesDueAt(new Date("2026-04-02T06:02:00Z"))

  assert.deepEqual(due, [])
})

test("changedCiPackagesFromPaths only returns PR-enabled packages", () => {
  const changed = changedCiPackagesFromPaths([
    "Casks/rcc.rb",
    "Formula/voxtype.rb",
    "README.md",
  ])

  assert.deepEqual([...changed].sort(), ["rcc", "voxtype"])
})

test("every PR-enabled package has a changed-path trigger", () => {
  const fixtures: Record<string, string> = {
    "t3code-cli-main": "Formula/t3code-cli-main.rb",
    "vscode-insiders-linux": "Casks/vscode-insiders-linux.rb",
    voxtype: "Formula/voxtype.rb",
    rcc: "Casks/rcc.rb",
    "action-server": "Casks/action-server.rb",
    "devpod-linux": "Casks/devpod-linux.rb",
    "t3-code-linux": "Casks/t3-code-linux.rb",
  }

  for (const entry of PACKAGE_REGISTRY.filter((candidate) => candidate.supportsPrCi)) {
    assert.equal(
      changedPackagesFromPaths([fixtures[entry.id]]).includes(entry.id),
      true,
      `expected changed path fixture for ${entry.id}`,
    )
  }
})
