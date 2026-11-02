import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderDevsyDesktopCask } from "../src/devsy-render.ts"
import { rewriteCaskUrl } from "../src/cask-render.ts"

const cask = readFileSync(new URL("../../../Casks/devsy-desktop.rb", import.meta.url), "utf8")
const rendered = renderDevsyDesktopCask(cask, {
  version: "1.26.0", sha256: "a".repeat(64), downloadUrl: "https://example.invalid/Devsy_linux_x86_64.AppImage",
}, rewriteCaskUrl)
const shell = rendered.match(/run "\/bin\/bash", args: \["-eu", "-c", <<~'SH'\], chdir: "\{\{staged_path\}\}"\n([\s\S]*?)^    SH/m)?.[1]
assert.ok(shell, "generated cask must retain extraction preflight")
const script = shell.replaceAll("{{HOMEBREW_PREFIX}}", "/test/brew")
// Matches the upstream 1.26.0 AppImage entry, including protocol and window identity.
const desktop = `[Desktop Entry]
Name=Devsy
Exec=AppRun --no-sandbox %U
Terminal=false
Type=Application
Icon=devsy-desktop
StartupWMClass=sh.devsy.app
X-AppImage-Version=1.26.0
MimeType=x-scheme-handler/devsy;
Categories=Development;
`
const iconPath = "squashfs-root/usr/share/icons/hicolor/128x128/apps/devsy-desktop.png"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")

function fixture(root: string, names: string[]) {
  mkdirSync(join(root, "squashfs-root/usr/share/icons/hicolor/128x128/apps"), { recursive: true })
  writeFileSync(join(root, "squashfs-root/AppRun"), "#!/bin/sh\nexit 99\n")
  chmodSync(join(root, "squashfs-root/AppRun"), 0o755)
  writeFileSync(join(root, iconPath), png)
  for (const name of names) writeFileSync(join(root, "squashfs-root", name), desktop)
}

function assertIntegration(root: string) {
  const result = spawnSync("/bin/bash", ["-eu", "-c", script], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  const installed = readFileSync(join(root, "devsy-desktop.desktop"), "utf8")
  assert.match(installed, /^Exec=\/test\/brew\/bin\/devsy-desktop %U$/m)
  assert.match(installed, /^Icon=devsy-desktop$/m)
  assert.match(installed, /^StartupWMClass=sh.devsy.app$/m)
  assert.match(installed, /^MimeType=x-scheme-handler\/devsy;$/m)
  assert.deepEqual(readFileSync(join(root, "devsy-desktop.png")), readFileSync(join(root, iconPath)))
}

for (const name of ["devsy-desktop.desktop", "sh.devsy.app.desktop"]) {
  test(`rendered Devsy cask stages ${name} under the managed identity`, () => {
    const root = mkdtempSync(join(tmpdir(), "devsy-extraction-"))
    try {
      fixture(root, [name])
      assertIntegration(root)
      assert.equal(readFileSync(join(root, "squashfs-root", name), "utf8"), desktop)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

for (const scenario of ["missing", "unknown", "ambiguous", "no-icon", "no-AppRun"]) {
  test(`rendered Devsy cask rejects ${scenario} extraction metadata`, () => {
    const root = mkdtempSync(join(tmpdir(), "devsy-extraction-"))
    try {
      fixture(root, scenario === "ambiguous" ? ["devsy-desktop.desktop", "sh.devsy.app.desktop"]
        : scenario === "missing" ? [] : scenario === "unknown" ? ["unrelated.desktop"] : ["sh.devsy.app.desktop"])
      if (scenario === "no-icon") rmSync(join(root, iconPath))
      if (scenario === "no-AppRun") chmodSync(join(root, "squashfs-root/AppRun"), 0o644)
      const result = spawnSync("/bin/bash", ["-eu", "-c", script], { cwd: root, encoding: "utf8" })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /No supported desktop entry|Ambiguous desktop entries|No 128x128 icon|No executable AppRun/)
      assert.equal(existsSync(join(root, "devsy-desktop.png")), false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test("verified upstream AppImage extraction stages its real desktop and icon", { skip: !process.env.DEVSY_EXTRACTED_ROOT }, () => {
  const root = mkdtempSync(join(tmpdir(), "devsy-real-extraction-"))
  try {
    // Copy metadata only: this test never launches upstream application code.
    const upstream = process.env.DEVSY_EXTRACTED_ROOT!
    fixture(root, [])
    cpSync(join(upstream, "sh.devsy.app.desktop"), join(root, "squashfs-root/sh.devsy.app.desktop"))
    cpSync(join(upstream, "usr/share/icons/hicolor/128x128/apps/devsy-desktop.png"), join(root, iconPath))
    assertIntegration(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
