import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const migrationScript = new URL("../../../scripts/migrate-chatgpt-linux-cask.sh", import.meta.url)

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chatgpt-linux-migrate-"))
  const prefix = join(root, "prefix")
  const bin = join(root, "bin")
  const home = join(root, "home")
  const calls = join(root, "brew-calls")
  mkdirSync(bin, { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(
    join(bin, "brew"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$BREW_CALLS"
case "$1" in
  --prefix) printf '%s\\n' "$BREW_PREFIX" ;;
  fetch) [[ "$2 $3" == "--cask joshyorko/tools/chatgpt-linux" ]] ;;
  uninstall)
    [[ "$2 $3" == "--cask joshyorko/tools/chatgpt" ]]
    rm -rf "$BREW_PREFIX/Caskroom/chatgpt"
    ;;
  install)
    [[ "$2 $3 $4" == "--cask --require-sha joshyorko/tools/chatgpt-linux" ]]
    mkdir -p "$BREW_PREFIX/Caskroom/chatgpt-linux/.metadata" "$BREW_PREFIX/bin" "$HOME/.local/share/applications"
    printf '%s\\n' '{"source":{"tap":"joshyorko/tools","path":"/tap/Casks/chatgpt-linux.rb"}}' > "$BREW_PREFIX/Caskroom/chatgpt-linux/.metadata/INSTALL_RECEIPT.json"
    touch "$BREW_PREFIX/bin/chatgpt" "$HOME/.local/share/applications/chatgpt.desktop"
    chmod +x "$BREW_PREFIX/bin/chatgpt"
    ;;
  *) exit 2 ;;
esac
`,
  )
  chmodSync(join(bin, "brew"), 0o755)
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    BREW_PREFIX: prefix,
    BREW_CALLS: calls,
    HOMEBREW_NO_AUTO_UPDATE: "1",
    HOMEBREW_NO_ENV_HINTS: "1",
  }
  return { root, prefix, bin, home, calls, env }
}

function createOldReceipt(prefix: string, tap: string, sourcePath: string) {
  const receipt = join(prefix, "Caskroom/chatgpt/.metadata/INSTALL_RECEIPT.json")
  mkdirSync(join(prefix, "Caskroom/chatgpt/.metadata"), { recursive: true })
  writeFileSync(receipt, JSON.stringify({
    source: { tap, path: sourcePath, version: "26.924.22138" },
  }))
}

test("migration verifies the replacement before uninstalling the tap-owned cask", () => {
  const temp = fixture()
  try {
    createOldReceipt(temp.prefix, "joshyorko/tools", "/tap/Casks/chatgpt.rb")
    const userData = join(temp.home, ".config/ChatGPT/user-data.json")
    mkdirSync(join(temp.home, ".config/ChatGPT"), { recursive: true })
    writeFileSync(userData, "preserve me")
    const result = spawnSync("bash", [migrationScript.pathname], { env: temp.env, encoding: "utf8" })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readFileSync(temp.calls, "utf8").trim().split("\n"), [
      "--prefix",
      "fetch --cask joshyorko/tools/chatgpt-linux",
      "uninstall --cask joshyorko/tools/chatgpt",
      "install --cask --require-sha joshyorko/tools/chatgpt-linux",
    ])
    assert.ok(readFileSync(join(temp.prefix, "Caskroom/chatgpt-linux/.metadata/INSTALL_RECEIPT.json"), "utf8"))
    assert.ok(existsSync(join(temp.home, ".local/share/applications/chatgpt.desktop")))
    assert.equal(readFileSync(userData, "utf8"), "preserve me")
    assert.doesNotMatch(readFileSync(migrationScript, "utf8"), /--zap|zap:/)
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test("migration refuses an official or otherwise foreign old cask receipt", () => {
  const temp = fixture()
  try {
    createOldReceipt(temp.prefix, "homebrew/cask", "/tap/Casks/chatgpt.rb")
    const result = spawnSync("bash", [migrationScript.pathname], { env: temp.env, encoding: "utf8" })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /not this tap's old Linux cask/)
    assert.deepEqual(readFileSync(temp.calls, "utf8").trim().split("\n"), ["--prefix"])
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test("migration refuses to run outside Linux", () => {
  const temp = fixture()
  try {
    writeFileSync(join(temp.bin, "uname"), "#!/bin/sh\nprintf 'Darwin\\n'\n")
    chmodSync(join(temp.bin, "uname"), 0o755)
    const result = spawnSync("bash", [migrationScript.pathname], { env: temp.env, encoding: "utf8" })

    assert.equal(result.status, 64)
    assert.match(result.stderr, /only for the Linux ChatGPT cask/)
    assert.equal(existsSync(temp.calls), false)
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})
