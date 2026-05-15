import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const repoRoot = new URL("../../..", import.meta.url)
const scriptPath = new URL("../../../scripts/package-codex-desktop-linux.mjs", import.meta.url)

test("codex desktop skeleton artifact is metadata-only and runnable", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-desktop-test-"))
  const output = join(tmp, "codex-desktop-linux-test.tar.gz")
  const extractDir = join(tmp, "extract")

  try {
    execFileSync(
      process.execPath,
      [
        scriptPath.pathname,
        "--version",
        "research.test",
        "--conversion-commit",
        "43c8bd1b5d4ab2eb4be8eb474528d6050c51db9a",
        "--output",
        output,
      ],
      { cwd: repoRoot.pathname, stdio: "inherit" },
    )

    execFileSync("mkdir", ["-p", extractDir])
    execFileSync("tar", ["-xzf", output, "-C", extractDir])

    const metadata = JSON.parse(readFileSync(join(extractDir, "share/codex-desktop/release.json"), "utf8"))
    assert.equal(metadata.package, "codex-desktop-linux")
    assert.equal(metadata.redistributes_openai_payload, false)
    assert.equal(metadata.updater_enabled, false)
    assert.equal(metadata.codex_dmg_sha256, null)

    const report = JSON.parse(readFileSync(join(extractDir, "share/codex-desktop/renderer-report.json"), "utf8"))
    assert.equal(report.loopback_only_default, true)
    assert.equal(report.serves_extracted_renderer, false)

    const help = execFileSync(join(extractDir, "bin/codex-desktop"), ["--help"], { encoding: "utf8" })
    assert.match(help, /Usage: codex-desktop/)
    assert.match(help, /doctor/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("codex desktop formula documents conservative DMG posture", () => {
  const formula = readFileSync(new URL("../../../Formula/codex-desktop.rb", import.meta.url), "utf8")

  assert.match(formula, /class CodexDesktop < Formula/)
  assert.match(formula, /does not redistribute the proprietary Codex Desktop app payload/)
  assert.match(formula, /codex-desktop doctor/)
})
