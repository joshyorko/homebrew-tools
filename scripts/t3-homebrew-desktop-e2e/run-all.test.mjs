import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const source = "26e769d6c4fd955429595828ac572efeca006168"
function runCase(overrides, check) {
  const root = mkdtempSync(join(tmpdir(), "t3-attachment-evidence-"))
  try {
    const scripts = join(root, "scripts")
    const bin = join(root, "bin")
    mkdirSync(scripts)
    mkdirSync(bin)
    copyFileSync(new URL("./run-all.sh", import.meta.url), join(scripts, "run-all.sh"))
    writeFileSync(join(root, "candidate.AppImage"), "fixture")
    writeFileSync(join(bin, "docker"), '#!/bin/sh\nif [ "$1" = build ]; then exit "${SETUP_EXIT:-0}"; fi\n', { mode: 0o755 })
    writeFileSync(join(scripts, "run.sh"), `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$2"
printf '{"scenario":"%s","sourceCommit":"%s"}\\n' "$3" "$REPORT_SOURCE" > "$2/report.json"
if [[ "$3" == "$FAIL_SCENARIO" ]]; then exit 42; fi
`)
    const output = join(root, "evidence")
    const result = spawnSync("bash", [join(scripts, "run-all.sh"), join(root, "candidate.AppImage"), output, source], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REPORT_SOURCE: source, FAIL_SCENARIO: "", SETUP_EXIT: "0", ...overrides },
    })
    assert.equal(result.status, 0, result.stderr)
    check(JSON.parse(readFileSync(join(output, "acceptance.json"), "utf8")))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("exports a passing verdict only after all four reports match the immutable source", () => runCase({}, (result) => {
  assert.equal(result.passed, true)
  assert.deepEqual(result.scenarios.map(r => r.scenario), ["service-attach", "unknown-owner", "package-mismatch", "manual-settings"])
}))
test("retains a failure verdict while continuing the remaining scenarios", () => runCase({ FAIL_SCENARIO: "service-attach" }, (result) => {
  assert.equal(result.passed, false)
  assert.equal(result.scenarios[0].exitCode, 42)
  assert.equal(result.scenarios.at(-1).passed, true)
}))
test("refuses a mismatched artifact source despite zero scenario exit statuses", () => runCase({ REPORT_SOURCE: "a".repeat(40) }, (result) => {
  assert.equal(result.passed, false)
  assert.ok(result.scenarios.every(r => r.exitCode === 0 && !r.sourceMatches))
}))
test("exports setup failure evidence without admitting any GUI scenario", () => runCase({ SETUP_EXIT: "17" }, (result) => {
  assert.equal(result.passed, false)
  assert.equal(result.setupExitCode, 17)
  assert.ok(result.scenarios.every(r => r.exitCode === null))
}))
