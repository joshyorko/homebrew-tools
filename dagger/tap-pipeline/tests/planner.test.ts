import test from "node:test"
import assert from "node:assert/strict"

import {
  AUTO_UPDATE_SLOTS,
  PACKAGE_REGISTRY,
  changedCiPackagesFromPaths,
  changedPackagesFromPaths,
  isTransientUpstreamProbeError,
  listAutoUpdateSlots,
  packagesForAutoUpdateSlot,
  packagedVersionForUpstreamComparison,
  platformPathsChanged,
  TransientUpstreamProbeError,
} from "../src/library.ts"

test("Buzz compares the upstream release against the first cask version component", () => {
  assert.equal(packagedVersionForUpstreamComparison("buzz-linux", "0.5.0,4"), "0.5.0")
  assert.equal(packagedVersionForUpstreamComparison("rcc", "18.18.0"), "18.18.0")
})

test("listAutoUpdateSlots returns the stable slot order", () => {
  assert.deepEqual(
    listAutoUpdateSlots().map((slot) => slot.id),
    AUTO_UPDATE_SLOTS.map((slot) => slot.id),
  )
})

test("packagesForAutoUpdateSlot resolves the expected package ids for every slot", () => {
  for (const slot of AUTO_UPDATE_SLOTS) {
    assert.deepEqual(
      packagesForAutoUpdateSlot(slot.id).map((entry) => entry.id),
      slot.packageIds,
      `expected ordered package ids for ${slot.id}`,
    )
  }
})

test("packagesForAutoUpdateSlot rejects unknown slots", () => {
  assert.throws(() => packagesForAutoUpdateSlot("imaginary-slot"), /Unknown auto-update slot/)
})

test("changedCiPackagesFromPaths only returns PR-enabled packages", () => {
  const changed = changedCiPackagesFromPaths([
    "Casks/rcc.rb",
    "Formula/antigravity-cli.rb",
    "Formula/voxtype.rb",
    "Formula/eitype.rb",
    "README.md",
  ])

  assert.deepEqual([...changed].sort(), ["antigravity-cli", "eitype", "rcc", "voxtype"])
})

test("every PR-enabled package has a changed-path trigger", () => {
  const fixtures: Record<string, string> = {
    "t3code-cli-main": "Formula/t3code-cli-main.rb",
    "codex-release": "Formula/codex-release.rb",
    "antigravity-cli": "Formula/antigravity-cli.rb",
    devsy: "Formula/devsy.rb",
    "devsy-desktop": "Casks/devsy-desktop.rb",
    "buzz-linux": "Casks/buzz-linux.rb",
    "fizzy-cli-master": "Formula/fizzy-cli-master.rb",
    "fizzy-popper-self-hosted": "Formula/fizzy-popper-self-hosted.rb",
    "fizzy-symphony": "Formula/fizzy-symphony.rb",
    "vscode-insiders-linux": "Casks/vscode-insiders-linux.rb",
    voxtype: "Formula/voxtype.rb",
    eitype: "Formula/eitype.rb",
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

test("platformPathsChanged detects shared orchestration changes", () => {
  assert.equal(platformPathsChanged(["dagger/tap-pipeline/src/index.ts"]), true)
  assert.equal(platformPathsChanged(["scripts/apply-release-bundle.mjs"]), true)
  assert.equal(platformPathsChanged(["README.md"]), false)
})

test("shared pipeline changes schedule every PR-enabled package", () => {
  assert.deepEqual(
    changedCiPackagesFromPaths(["dagger/tap-pipeline/src/index.ts"]),
    PACKAGE_REGISTRY.filter((entry) => entry.supportsPrCi).map((entry) => entry.id),
  )
})

test("resource monitor build helper schedules t3code CLI CI", () => {
  assert.deepEqual(changedCiPackagesFromPaths(["scripts/build-t3code-resource-monitor.sh"]), ["t3code-cli-main"])
})

test("transient upstream probe errors are explicitly marked", () => {
  assert.equal(
    isTransientUpstreamProbeError(new TransientUpstreamProbeError("Skipped upstream probe for package")),
    true,
  )
  assert.equal(isTransientUpstreamProbeError(new Error("ordinary failure")), false)
})
