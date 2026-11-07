import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { PACKAGE_REGISTRY } from "../src/library.ts"
import { artifactCheckPlan, rejectForbiddenShaCommand } from "../src/install-checks.ts"

const PACKAGE_IDS = PACKAGE_REGISTRY.map((entry) => entry.id)

test("artifact checks have an install plan for every registered package", () => {
  for (const packageId of PACKAGE_IDS) {
    const entry = PACKAGE_REGISTRY.find((candidate) => candidate.id === packageId)
    assert.ok(entry)
    const plan = artifactCheckPlan(packageId)

    assert.ok(plan.homebrewPaths.includes(entry.homebrewPath), `plan does not use the committed recipe for ${packageId}`)
    assert.equal(plan.kind, entry.homebrewPath.startsWith("Formula/") ? "formula" : "cask")
    assert.ok(plan.homebrewPaths.length > 0, `missing Homebrew input for ${packageId}`)
    assert.ok(plan.commands.some((command) => command.includes("brew install")), `missing install for ${packageId}`)
    assert.ok(plan.commands.some((command) => command.includes("brew info --json=v2")), `missing metadata check for ${packageId}`)
    if (plan.kind === "formula") {
      assert.ok(plan.commands.some((command) => command.startsWith("brew test ")), `missing formula test for ${packageId}`)
    }
  }
})

test("artifact plans fail closed instead of selecting a fallback package", () => {
  assert.throws(() => artifactCheckPlan("unknown-package"), /Unknown package artifact check/)

  for (const packageId of PACKAGE_IDS) {
    const plan = artifactCheckPlan(packageId)
    assert.doesNotMatch(plan.commands.join("\n"), /:no_check|brew install[^\n]+@latest|brew install[^\n]+latest/)
    assert.doesNotMatch(plan.commands.join("\n"), /sourceBuild|build[A-Z]|git clone|cargo build|pnpm install/)
    assert.doesNotMatch(plan.commands.join("\n"), /(^|\n)\s*!\s+(grep|test|find)\b/)
  }
})

test("published T3 artifact checks exercise the compiled Connect configuration", () => {
  const cli = artifactCheckPlan("t3code-cli-main").commands.join("\n")
  const desktop = artifactCheckPlan("t3-code-linux").commands.join("\n")

  assert.match(cli, /t3 connect --help/)
  assert.match(cli, /-u T3CODE_RELAY_URL/)
  assert.match(desktop, /resources\/app\.asar/)
  assert.match(desktop, /node \/tap\/scripts\/check-t3-connect-asar\.mjs/)
  assert.ok(artifactCheckPlan("t3-code-linux").systemPackages.includes("nodejs"))
})

test("forbidden checksum markers stop an artifact check", () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-check-negative-"))
  const recipe = join(root, "recipe.rb")
  try {
    writeFileSync(recipe, 'sha256 x86_64_linux: :no_check\n')
    assert.throws(() => execFileSync("bash", ["-lc", [
      "set -euo pipefail",
      rejectForbiddenShaCommand(recipe),
      "printf 'unexpected continuation\\n'",
    ].join("\n")]))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("dictation artifact checks provision the same runtime libraries as source CI", () => {
  for (const dependency of ["libasound2t64", "libvulkan1", "libxkbcommon0"]) {
    assert.ok(artifactCheckPlan("voxtype").systemPackages.includes(dependency), dependency)
  }
  assert.ok(artifactCheckPlan("eitype").systemPackages.includes("libxkbcommon0"))
})
