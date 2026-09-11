import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { PACKAGE_REGISTRY } from "../src/library.ts"
import { artifactCheckPlan, buzzArtifactVerificationCommands, rejectForbiddenShaCommand } from "../src/install-checks.ts"

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

test("Buzz artifact verification keeps the existing portable runtime assertions", () => {
  const commands = buzzArtifactVerificationCommands("/tmp/Buzz.AppImage")
  const script = commands.join("\n")
  const buzzSource = readFileSync(new URL("../../buzz-linux-smoke/src/index.ts", import.meta.url), "utf8")

  for (const marker of [
    "squashfs-root/AppRun",
    "squashfs-root/usr/bin/buzz-desktop",
    "squashfs-root/usr/bin/buzz-desktop.bin",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    'unset "$var"',
    "libwayland-client.so",
    "libglib-2.0.so",
    "libgst*.so",
  ]) {
    assert.ok(script.includes(marker), marker)
    assert.ok(marker.startsWith("unset") ? buzzSource.includes("unset") : buzzSource.includes(marker), `Buzz source lost ${marker}`)
  }
})

test("Buzz Brew runtime bootstrap uses the Ubuntu 24.04 runtime package name", () => {
  const buzzSource = readFileSync(new URL("../../buzz-linux-smoke/src/index.ts", import.meta.url), "utf8")
  assert.match(buzzSource, /desktop-file-utils xdg-utils libasound2t64 libgtk-3-0/)
  assert.doesNotMatch(buzzSource, /apt-get install[^\n]*desktop-file-utils[^\n]*\blibasound2\b/)
})

test("Buzz forbidden bundled libraries stop verification before later commands", () => {
  const root = mkdtempSync(join(tmpdir(), "buzz-forbidden-libraries-"))
  try {
    mkdirSync(join(root, "squashfs-root/usr/lib"), { recursive: true })
    const command = buzzArtifactVerificationCommands("/tmp/Buzz.AppImage")
      .find((value) => value.includes("libglib-2.0.so"))
    assert.ok(command)
    const run = () => spawnSync("bash", ["-c", `set -euo pipefail\n${command}\nprintf continued`], { cwd: root, encoding: "utf8" })
    assert.equal(run().status, 0)
    writeFileSync(join(root, "squashfs-root/usr/lib/libglib-2.0.so.0"), "forbidden")
    const rejected = run()
    assert.equal(rejected.status, 1)
    assert.equal(rejected.stdout, "")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
