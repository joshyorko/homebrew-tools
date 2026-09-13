import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const icons = {
  chatgpt: "chatgpt",
  "t3-code-linux": "t3-code-linux",
  "vscode-insiders-linux": "vscode-insiders",
  "devsy-desktop": "devsy-desktop",
  "devpod-linux": "devpod-desktop",
}

for (const [token, expectedIcon] of Object.entries(icons)) {
  test(`${token} writes a persistent icon name with a sandbox HOME`, () => {
    const source = readFileSync(new URL(`../Casks/${token}.rb`, import.meta.url), "utf8")
    const rewrites = [...source.matchAll(/"(s\|\^Icon=\.\*\|Icon=[^"\n]+\|)"/g)]
    assert.ok(rewrites.length, "must exercise the cask's actual icon rewrite")
    const root = mkdtempSync(join(tmpdir(), "cask-icon-test-"))
    try {
      for (const [, rewrite] of rewrites) {
        const desktop = join(root, "app.desktop")
        writeFileSync(desktop, "[Desktop Entry]\nIcon=upstream\n")
        execFileSync("/bin/bash", ["-eu", "-c", `/bin/sed -i "${rewrite}" "$1"`, "test", desktop], {
          env: { ...process.env, HOME: join(root, "sandbox-home") },
        })
        const icon = readFileSync(desktop, "utf8").match(/^Icon=(.+)$/m)[1]
        assert.equal(icon, expectedIcon, "desktop entry must use the installed icon theme name")
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
