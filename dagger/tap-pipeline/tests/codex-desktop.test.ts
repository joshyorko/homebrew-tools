import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const repoRoot = new URL("../../..", import.meta.url)
const scriptPath = new URL("../../../scripts/package-codex-desktop-linux.mjs", import.meta.url)
const conversionPatchScriptPath = new URL(
  "../../../scripts/patch-codex-desktop-conversion.mjs",
  import.meta.url,
)

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o755 })
}

function createConvertedAppFixture(root: string): string {
  const appDir = join(root, "codex-app")
  mkdirSync(join(appDir, "resources/node-runtime/bin"), { recursive: true })
  mkdirSync(join(appDir, ".codex-linux"), { recursive: true })
  mkdirSync(join(appDir, "content/webview"), { recursive: true })

  writeExecutable(
    join(appDir, "start.sh"),
    "#!/usr/bin/env bash\nset -euo pipefail\necho \"fixture desktop launch:$*\"\n",
  )
  writeExecutable(join(appDir, "electron"), "#!/usr/bin/env bash\necho electron fixture\n")
  writeExecutable(
    join(appDir, "resources/node-runtime/bin/node"),
    "#!/usr/bin/env bash\nif [ \"${1:-}\" = -v ]; then echo v22.22.2; else echo node fixture; fi\n",
  )
  writeFileSync(join(appDir, "resources/app.asar"), "fixture-asar")
  writeFileSync(join(appDir, "version"), "41.3.0\n")
  writeFileSync(join(appDir, ".codex-linux/codex-desktop.png"), "fixture-png")

  return appDir
}

test("codex desktop artifact packages a converted DMG app layout", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-desktop-test-"))
  const output = join(tmp, "codex-desktop-linux-test.tar.gz")
  const extractDir = join(tmp, "extract")
  const appDir = createConvertedAppFixture(tmp)
  const dmgPath = join(tmp, "Codex.dmg")
  const rebuildReportPath = join(tmp, "rebuild-report.json")
  const patchReportPath = join(tmp, "patch-report.json")
  const metadataOutput = join(tmp, "metadata.json")

  try {
    writeFileSync(dmgPath, "fixture-dmg")
    writeFileSync(
      rebuildReportPath,
      `${JSON.stringify({ electronVersion: "41.3.0", appDir }, null, 2)}\n`,
    )
    writeFileSync(
      patchReportPath,
      `${JSON.stringify({ mainBundle: "main.js", patches: [{ id: "linux-launch", status: "changed" }] }, null, 2)}\n`,
    )

    execFileSync(
      process.execPath,
      [
        scriptPath.pathname,
        "--app-dir",
        appDir,
        "--version",
        "dmg.test",
        "--conversion-commit",
        "43c8bd1b5d4ab2eb4be8eb474528d6050c51db9a",
        "--codex-dmg",
        dmgPath,
        "--rebuild-report",
        rebuildReportPath,
        "--patch-report",
        patchReportPath,
        "--metadata-output",
        metadataOutput,
        "--output",
        output,
      ],
      { cwd: repoRoot.pathname, stdio: "inherit" },
    )

    execFileSync("mkdir", ["-p", extractDir])
    execFileSync("tar", ["-xzf", output, "-C", extractDir])

    const metadata = JSON.parse(readFileSync(join(extractDir, "share/codex-desktop/release.json"), "utf8"))
    assert.equal(metadata.package, "codex-desktop-linux")
    assert.equal(metadata.updater_enabled, false)
    assert.equal(metadata.electron_version, "41.3.0")
    assert.equal(metadata.managed_node_version, "v22.22.2")
    assert.match(metadata.codex_dmg_sha256, /^[a-f0-9]{64}$/)

    const exportedMetadata = JSON.parse(readFileSync(metadataOutput, "utf8"))
    assert.equal(exportedMetadata.app_payload_tree_sha256, metadata.app_payload_tree_sha256)

    const report = JSON.parse(readFileSync(join(extractDir, "share/codex-desktop/renderer-report.json"), "utf8"))
    assert.equal(report.loopback_only_default, true)
    assert.equal(report.serves_extracted_renderer, false)
    assert.equal(report.patch_count, 1)

    const help = execFileSync(join(extractDir, "bin/codex-desktop"), ["--help"], { encoding: "utf8" })
    assert.match(help, /Usage: codex-desktop/)
    assert.match(help, /desktop/)

    const launch = execFileSync(join(extractDir, "bin/codex-desktop"), ["desktop", "--smoke"], {
      encoding: "utf8",
    })
    assert.match(launch, /fixture desktop launch:--smoke/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("codex desktop formula documents the DMG conversion runtime", () => {
  const formula = readFileSync(new URL("../../../Formula/codex-desktop.rb", import.meta.url), "utf8")

  assert.match(formula, /class CodexDesktop < Formula/)
  assert.match(formula, /converts an explicit/)
  assert.match(formula, /codex-desktop doctor/)
})

test("codex desktop auto-update mirrors upstream DMG polling", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/tap-auto-update.yml", import.meta.url), "utf8")
  const pipeline = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")

  assert.match(workflow, /codex-desktop-2h/)
  assert.match(workflow, /13 \*\/2 \* \* \*/)
  assert.match(workflow, /release-bundle\s+--package-id="\$\{\{ matrix\.package_id \}\}"/)
  assert.match(pipeline, /https:\/\/persistent\.oaistatic\.com\/codex-app-prod\/Codex\.dmg/)
  assert.match(pipeline, /scripts\/install-deps\.sh/)
  assert.match(pipeline, /patch-codex-desktop-conversion\.mjs/)
  assert.doesNotMatch(pipeline, /ca-certificates cargo curl/)
  assert.doesNotMatch(pipeline, /p7zip-full rustc sudo/)
  assert.match(pipeline, /root\/\.local\/bin:\$PATH/)
})

test("codex desktop conversion patch handles Electron 42 native modules", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-desktop-patch-test-"))
  const conversionDir = join(tmp, "conversion")
  const moduleDir = join(tmp, "better-sqlite3")

  try {
    mkdirSync(join(conversionDir, "scripts/lib"), { recursive: true })
    mkdirSync(join(moduleDir, "src/util"), { recursive: true })

    writeFileSync(
      join(conversionDir, "scripts/lib/native-modules.sh"),
      [
        "#!/bin/bash",
        "build_native_modules() {",
        '    npm install "better-sqlite3@$bs3_build_ver" "node-pty@$npty_ver" --ignore-scripts 2>&1 >&2',
        "}",
      ].join("\n"),
    )
    writeFileSync(
      join(moduleDir, "src/better_sqlite3.cpp"),
      "\tv8::Local<v8::External> data = v8::External::New(isolate, addon);\n",
    )
    writeFileSync(
      join(moduleDir, "src/util/macros.cpp"),
      "#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())\n",
    )
    writeFileSync(
      join(moduleDir, "src/util/helpers.cpp"),
      ["\t\tfunc,", "\t\t0,", "\t\tdata"].join("\n"),
    )

    execFileSync(process.execPath, [conversionPatchScriptPath.pathname, "--conversion-dir", conversionDir], {
      cwd: repoRoot.pathname,
    })
    execFileSync(process.execPath, [conversionPatchScriptPath.pathname, "--better-sqlite3-dir", moduleDir], {
      cwd: repoRoot.pathname,
    })

    const nativeModules = readFileSync(join(conversionDir, "scripts/lib/native-modules.sh"), "utf8")
    assert.match(nativeModules, /patch-codex-desktop-conversion\.mjs" --better-sqlite3-dir/)

    const betterSqlite = readFileSync(join(moduleDir, "src/better_sqlite3.cpp"), "utf8")
    const macros = readFileSync(join(moduleDir, "src/util/macros.cpp"), "utf8")
    const helpers = readFileSync(join(moduleDir, "src/util/helpers.cpp"), "utf8")

    assert.match(betterSqlite, /External::New\(isolate, addon, v8::kExternalPointerTypeTagDefault\)/)
    assert.match(macros, /Value\(v8::kExternalPointerTypeTagDefault\)/)
    assert.match(helpers, /nullptr/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
