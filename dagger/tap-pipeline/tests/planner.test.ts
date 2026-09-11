import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AUTO_UPDATE_SLOTS,
  PACKAGE_REGISTRY,
  ciPlanFromPaths,
  changedCiPackagesFromPaths,
  changedPackagesFromPaths,
  isTransientUpstreamProbeError,
  listAutoUpdateSlots,
  parseRecoveryBrewfile,
  packagesForAutoUpdateSlot,
  packagedVersionForUpstreamComparison,
  platformPathsChanged,
  recoveryBrewfile,
  recoveryHomebrewContents,
  recoveryPackageSummaries,
  TransientUpstreamProbeError,
} from "../src/library.ts"

const plannerScript = new URL("../../../scripts/plan-tap-ci.mjs", import.meta.url)

test("recovery inventory and Brewfile are derived from release-capable registry entries", () => {
  const packages = recoveryPackageSummaries()
  const brewfile = recoveryBrewfile(packages)

  assert.deepEqual(
    parseRecoveryBrewfile(brewfile).map((entry) => entry.id),
    packages.map((entry) => entry.id),
  )
  assert.equal(brewfile, readFileSync(new URL("../../../recovery/Brewfile", import.meta.url), "utf8"))
  assert.equal(packages.some((entry) => entry.id === "antigravity-cli"), false)
  assert.equal(packages.some((entry) => entry.id === "buzz-linux"), true)
})

test("recovery Brewfile rejects packages without a standard release bundle", () => {
  assert.throws(
    () => parseRecoveryBrewfile('brew "joshyorko/tools/antigravity-cli"\n'),
    /does not have a standard release bundle/,
  )
  assert.throws(() => parseRecoveryBrewfile('brew "homebrew/core/wget"\n'), /Unsupported recovery Brewfile entry/)
})

test("recovery Homebrew rendering points tap release assets at the local file server", () => {
  const rendered = recoveryHomebrewContents(
    [
      '  url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.2.3/devsy-linux-amd64"',
      '  url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.2.3/devsy-linux-arm64"',
    ].join("\n"),
    "devsy",
    "http://127.0.0.1:8000/brew-recovery/",
  )

  assert.equal(
    rendered,
    [
      '  url "http://127.0.0.1:8000/brew-recovery/packages/devsy/artifacts/devsy-linux-amd64"',
      '  url "http://127.0.0.1:8000/brew-recovery/packages/devsy/artifacts/devsy-linux-arm64"',
    ].join("\n"),
  )
})

test("package revisions compare against the first cask version component", () => {
  assert.equal(packagedVersionForUpstreamComparison("buzz-linux", "0.5.0,4"), "0.5.0")
  assert.equal(packagedVersionForUpstreamComparison("devsy-desktop", "1.14.1,1"), "1.14.1")
  assert.equal(
    packagedVersionForUpstreamComparison("t3-code-linux", "main.20260805060356.3c5bdb84a936,1"),
    "main.20260805060356.3c5bdb84a936",
  )
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
    "Casks/chatgpt.rb",
    "Formula/voxtype.rb",
    "Formula/eitype.rb",
    "README.md",
  ])

  assert.deepEqual([...changed].sort(), ["antigravity-cli", "chatgpt", "eitype", "rcc", "voxtype"])
})

test("every PR-enabled package has a changed-path trigger", () => {
  const fixtures: Record<string, string> = {
    "t3code-cli-main": "Formula/t3code-cli-main.rb",
    "antigravity-cli": "Formula/antigravity-cli.rb",
    chatgpt: "Casks/chatgpt.rb",
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
    "codex-desktop-linux": "Casks/codex-desktop.rb",
    "headroom-self-hosted": "Formula/headroom-self-hosted.rb",
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

test("committed Codex Desktop feature choices schedule its package CI", () => {
  assert.deepEqual(
    changedPackagesFromPaths(["config/codex-desktop-linux-features.json"]),
    ["codex-desktop-linux"],
  )
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

test("package formula and cask edits use artifact checks", () => {
  assert.deepEqual(ciPlanFromPaths(["Casks/rcc.rb", "Formula/voxtype.rb"]), [
    {
      package_id: "voxtype",
      mode: "artifact",
      reason: "packaging changes: Formula/voxtype.rb",
    },
    {
      package_id: "rcc",
      mode: "artifact",
      reason: "packaging changes: Casks/rcc.rb",
    },
  ])
})

test("dependency formula edits route only to their package dependents", () => {
  assert.deepEqual(ciPlanFromPaths(["Formula/devpod-appindicator-runtime-tools.rb", "Formula/devsy.rb"]), [
    {
      package_id: "devsy",
      mode: "artifact",
      reason: "packaging changes: Formula/devsy.rb",
    },
    {
      package_id: "devsy-desktop",
      mode: "artifact",
      reason: "packaging changes: Formula/devsy.rb",
    },
    {
      package_id: "devpod-linux",
      mode: "artifact",
      reason: "packaging changes: Formula/devpod-appindicator-runtime-tools.rb",
    },
  ])
})

test("runtime test fixtures route to the package that consumes them", () => {
  assert.deepEqual(ciPlanFromPaths(["dagger/tap-pipeline/tests/fixtures/action-server-1.2.6.rb"]), [
    {
      package_id: "action-server",
      mode: "build",
      reason: "source/build changes: dagger/tap-pipeline/tests/fixtures/action-server-1.2.6.rb",
    },
  ])
})

test("package builders and source inputs use source builds", () => {
  assert.deepEqual(ciPlanFromPaths([
    "scripts/package-t3code-cli-main.mjs",
    "config/codex-desktop-linux-features.json",
  ]), [
    {
      package_id: "t3code-cli-main",
      mode: "build",
      reason: "source/build changes: scripts/package-t3code-cli-main.mjs",
    },
    {
      package_id: "codex-desktop-linux",
      mode: "build",
      reason: "source/build changes: config/codex-desktop-linux-features.json",
    },
  ])
})

test("tests and docs schedule no package builds", () => {
  assert.deepEqual(ciPlanFromPaths([
    "README.md",
    "AGENTS.md",
    "docs/tap-ci.md",
    "dagger/tap-pipeline/tests/planner.test.ts",
    "dagger/buzz-linux-smoke/tests/contract.test.mjs",
  ]), [])
})

test("unknown fixtures and test-like paths fail safe to source builds", () => {
  const plan = ciPlanFromPaths([
    "dagger/tap-pipeline/tests/fixtures/unknown.rb",
    "other/tests/fixture.txt",
    "other/notes.md",
  ])

  assert.equal(plan.length, 18)
  assert.equal(plan.every((entry) => entry.mode === "build"), true)
  assert.match(plan[0].reason, /unknown\.rb/)
  assert.match(plan[0].reason, /notes\.md/)
})

test("versioned cask leaves throw instead of claiming package evidence", () => {
  assert.throws(
    () => ciPlanFromPaths(["Casks/rcc@18.18.1.rb"]),
    /Unsupported versioned cask path.*Casks\/rcc@18\.18\.1\.rb/,
  )
  assert.throws(
    () => ciPlanFromPaths(["Casks/rcc@18.18.1.rb", "dagger/tap-pipeline/src/index.ts"]),
    /Unsupported versioned cask path.*Casks\/rcc@18\.18\.1\.rb/,
  )
})

test("unknown production changes fail safe to the full source-build matrix", () => {
  const plan = ciPlanFromPaths(["dagger/tap-pipeline/src/install-checks.ts"])
  const expectedPackageIds = [
    "t3code-cli-main",
    "antigravity-cli",
    "chatgpt",
    "codex-desktop-linux",
    "headroom-self-hosted",
    "devsy",
    "devsy-desktop",
    "buzz-linux",
    "fizzy-cli-master",
    "fizzy-popper-self-hosted",
    "fizzy-symphony",
    "vscode-insiders-linux",
    "voxtype",
    "eitype",
    "rcc",
    "action-server",
    "devpod-linux",
    "t3-code-linux",
  ]

  assert.deepEqual(plan.map(({ package_id, mode }) => ({ package_id, mode })), expectedPackageIds
    .map((package_id) => ({ package_id, mode: "build" })))
  assert.match(plan[0].reason, /fail-safe full source-build matrix/)
})

test("tap workflow changes fail safe to the full source-build matrix", () => {
  const plan = ciPlanFromPaths([".github/workflows/tap-ci.yml"])

  assert.equal(plan.length, 18)
  assert.equal(plan.every((entry) => entry.mode === "build"), true)
})

test("rename and delete diffs preserve both paths and keep deletion visible", () => {
  const fixture = mkdtempSync(join(tmpdir(), "tap-ci-planner-"))

  try {
    execFileSync("git", ["init", "-q"], { cwd: fixture })
    execFileSync("git", ["config", "user.email", "planner@example.invalid"], { cwd: fixture })
    execFileSync("git", ["config", "user.name", "planner"], { cwd: fixture })
    mkdirSync(join(fixture, "Casks"))
    writeFileSync(join(fixture, "Casks/rcc.rb"), "rcc")
    execFileSync("git", ["add", "."], { cwd: fixture })
    execFileSync("git", ["commit", "-qm", "base"], { cwd: fixture })
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8" }).trim()

    assert.deepEqual(runPlanner(fixture, "0".repeat(40), base, "push").map(({ package_id, mode }) => ({ package_id, mode })), [
      { package_id: "rcc", mode: "artifact" },
    ])
    assertPlannerFails(fixture, "missing-ref", base, "push")
    assertPlannerFails(fixture, base, "0".repeat(40), "push")

    renameSync(join(fixture, "Casks/rcc.rb"), join(fixture, "Casks/chatgpt.rb"))
    execFileSync("git", ["add", "-A"], { cwd: fixture })
    execFileSync("git", ["commit", "-qm", "rename"], { cwd: fixture })
    const renamed = runPlanner(fixture, base, "HEAD", "push")
    assert.deepEqual(renamed.map(({ package_id, mode }) => ({ package_id, mode })), [
      { package_id: "chatgpt", mode: "artifact" },
      { package_id: "rcc", mode: "artifact" },
    ])
    assert.match(renamed[0].reason, /Casks\/chatgpt\.rb/)
    assert.match(renamed[1].reason, /Casks\/rcc\.rb/)

    const renamedBase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8" }).trim()
    rmSync(join(fixture, "Casks/chatgpt.rb"))
    execFileSync("git", ["add", "-A"], { cwd: fixture })
    execFileSync("git", ["commit", "-qm", "delete"], { cwd: fixture })
    const deleted = runPlanner(fixture, renamedBase, "HEAD", "push")
    assert.deepEqual(deleted.map(({ package_id, mode }) => ({ package_id, mode })), [
      { package_id: "chatgpt", mode: "artifact" },
    ])
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("pull request planning uses merge-base while pushes compare exact before and head", () => {
  const fixture = mkdtempSync(join(tmpdir(), "tap-ci-compare-"))

  try {
    execFileSync("git", ["init", "-q"], { cwd: fixture })
    execFileSync("git", ["config", "user.email", "planner@example.invalid"], { cwd: fixture })
    execFileSync("git", ["config", "user.name", "planner"], { cwd: fixture })
    mkdirSync(join(fixture, "Casks"))
    mkdirSync(join(fixture, "Formula"))
    writeFileSync(join(fixture, "Casks/rcc.rb"), "base")
    execFileSync("git", ["add", "."], { cwd: fixture })
    execFileSync("git", ["commit", "-qm", "root"], { cwd: fixture })
    const root = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8" }).trim()

    writeFileSync(join(fixture, "Formula/voxtype.rb"), "main update")
    execFileSync("git", ["add", "."], { cwd: fixture })
    execFileSync("git", ["commit", "-qm", "main update"], { cwd: fixture })
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8" }).trim()

    execFileSync("git", ["checkout", "-q", "-b", "feature", root], { cwd: fixture })
    writeFileSync(join(fixture, "Casks/rcc.rb"), "feature change")
    execFileSync("git", ["add", "."], { cwd: fixture })
    execFileSync("git", ["commit", "-qm", "feature"], { cwd: fixture })
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8" }).trim()

    assert.deepEqual(runPlanner(fixture, base, head, "pull_request").map(({ package_id, mode }) => ({ package_id, mode })), [
      { package_id: "rcc", mode: "artifact" },
    ])
    assert.deepEqual(runPlanner(fixture, base, head, "push").map(({ package_id, mode }) => ({ package_id, mode })), [
      { package_id: "voxtype", mode: "artifact" },
      { package_id: "rcc", mode: "artifact" },
    ])
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

function runPlanner(cwd: string, baseRef: string, headRef: string, eventName = "push") {
  const result = plannerProcess(cwd, baseRef, headRef, eventName)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function assertPlannerFails(cwd: string, baseRef: string, headRef: string, eventName: string) {
  const result = plannerProcess(cwd, baseRef, headRef, eventName)
  assert.notEqual(result.status, 0)
}

function plannerProcess(cwd: string, baseRef: string, headRef: string, eventName: string) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", plannerScript.pathname],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, BASE_REF: baseRef, HEAD_REF: headRef, EVENT_NAME: eventName },
    },
  )
}

test("transient upstream probe errors are explicitly marked", () => {
  assert.equal(
    isTransientUpstreamProbeError(new TransientUpstreamProbeError("Skipped upstream probe for package")),
    true,
  )
  assert.equal(isTransientUpstreamProbeError(new Error("ordinary failure")), false)
})
