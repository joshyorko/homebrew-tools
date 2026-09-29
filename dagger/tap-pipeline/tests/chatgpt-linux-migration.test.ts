import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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
  --repository) printf '%s\\n' "$BREW_PREFIX/Homebrew/Library/Taps/joshyorko/homebrew-tools" ;;
  fetch) [[ "$2 $3" == "--cask joshyorko/tools/chatgpt-linux" ]] ;;
  uninstall)
    [[ "$2 $3" == "--cask joshyorko/tools/chatgpt" ]]
    test -f "$BREW_PREFIX/Homebrew/Library/Taps/joshyorko/homebrew-tools/Casks/chatgpt.rb"
    grep -qx 'cask "chatgpt" do' "$BREW_PREFIX/Homebrew/Library/Taps/joshyorko/homebrew-tools/Casks/chatgpt.rb"
    test -f "$BREW_PREFIX/var/homebrew-tools-chatgpt-linux-migration/old-caskroom/.metadata/INSTALL_RECEIPT.json"
    test ! -e "$BREW_PREFIX/var/homebrew-tools-chatgpt-linux-migration/old-caskroom/chatgpt"
    rm -rf "$BREW_PREFIX/Caskroom/chatgpt"
    rm -f "$BREW_PREFIX/bin/chatgpt" "$HOME/.local/share/applications/chatgpt.desktop" "$HOME/.local/share/icons/hicolor/512x512@2/apps/chatgpt.png"
    ;;
  install)
    [[ "$2 $3 $4" == "--cask --require-sha joshyorko/tools/chatgpt-linux" ]]
    mkdir -p "$BREW_PREFIX/Caskroom/chatgpt-linux/.metadata" "$BREW_PREFIX/bin" "$HOME/.local/share/applications"
    printf '%s\\n' '{"source":{"tap":"joshyorko/tools","path":"/tap/Casks/chatgpt-linux.rb"}}' > "$BREW_PREFIX/Caskroom/chatgpt-linux/.metadata/INSTALL_RECEIPT.json"
    if [[ "\${FAIL_NEW_INSTALL:-0}" == 1 ]]; then exit 42; fi
    touch "$BREW_PREFIX/bin/chatgpt" "$HOME/.local/share/applications/chatgpt.desktop"
    mkdir -p "$HOME/.local/share/icons/hicolor/512x512@2/apps"
    touch "$HOME/.local/share/icons/hicolor/512x512@2/apps/chatgpt.png"
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

function prepareTapHistory(prefix: string) {
  const tap = join(prefix, "Homebrew/Library/Taps/joshyorko/homebrew-tools")
  mkdirSync(join(tap, "Casks"), { recursive: true })
  const currentRecipe = readFileSync(new URL("../../../Casks/chatgpt-linux.rb", import.meta.url), "utf8")
  const oldVersion = currentRecipe.match(/^[ \t]*version "([^"]+)"/m)?.[1]
  assert.ok(oldVersion, "ChatGPT Linux cask fixture must declare a version")
  const oldRecipe = currentRecipe.replace(/^cask "chatgpt-linux" do$/m, 'cask "chatgpt" do')
  const oldCaskFile = join(tap, "Casks/chatgpt.rb")
  writeFileSync(oldCaskFile, oldRecipe)
  execFileSync("git", ["init", "-q", tap])
  execFileSync("git", ["-C", tap, "config", "user.email", "migration@example.invalid"])
  execFileSync("git", ["-C", tap, "config", "user.name", "migration test"])
  execFileSync("git", ["-C", tap, "add", "Casks/chatgpt.rb"])
  execFileSync("git", ["-C", tap, "commit", "-qm", "install legacy ChatGPT cask"])
  const installedHead = execFileSync("git", ["-C", tap, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  rmSync(oldCaskFile)
  writeFileSync(join(tap, "Casks/chatgpt-linux.rb"), currentRecipe)
  execFileSync("git", ["-C", tap, "add", "-A"])
  execFileSync("git", ["-C", tap, "commit", "-qm", "rename Linux ChatGPT cask"])
  return { tap, installedHead, oldCaskFile, oldVersion }
}

function createOldReceipt(prefix: string, home: string, tap: string) {
  const { tap: tapDirectory, installedHead, oldVersion } = prepareTapHistory(prefix)
  const receipt = join(prefix, "Caskroom/chatgpt/.metadata/INSTALL_RECEIPT.json")
  const versionDir = join(prefix, `Caskroom/chatgpt/${oldVersion}`)
  mkdirSync(join(versionDir, "usr/lib/chatgpt"), { recursive: true })
  mkdirSync(join(versionDir, "usr/share/applications"), { recursive: true })
  mkdirSync(join(versionDir, "usr/share/pixmaps"), { recursive: true })
  mkdirSync(join(prefix, "Caskroom/chatgpt/.metadata"), { recursive: true })
  writeFileSync(receipt, JSON.stringify({
    source: {
      tap,
      path: join(tapDirectory, "Casks/chatgpt.rb"),
      tap_git_head: installedHead,
      version: oldVersion,
    },
  }))
  const installedRecipe = join(
    prefix,
    `Caskroom/chatgpt/.metadata/${oldVersion}/20260926161611.544/Casks/chatgpt.json`,
  )
  mkdirSync(join(installedRecipe, ".."), { recursive: true })
  writeFileSync(installedRecipe, "{}")
  const launcher = join(versionDir, "usr/lib/chatgpt/codex-launcher")
  writeFileSync(launcher, "#!/bin/sh\nexit 0\n")
  chmodSync(launcher, 0o755)
  writeFileSync(join(versionDir, "usr/share/applications/chatgpt.desktop"), "Exec=/brew/bin/chatgpt %U\n")
  writeFileSync(join(versionDir, "usr/share/pixmaps/chatgpt.png"), "icon")
  mkdirSync(join(prefix, "bin"), { recursive: true })
  mkdirSync(join(home, ".local/share/applications"), { recursive: true })
  mkdirSync(join(home, ".local/share/icons/hicolor/512x512@2/apps"), { recursive: true })
  writeFileSync(join(home, ".local/share/applications/chatgpt.desktop"), "Exec=/brew/bin/chatgpt %U\n")
  writeFileSync(join(home, ".local/share/icons/hicolor/512x512@2/apps/chatgpt.png"), "old icon")
  const launcherLink = join(prefix, "bin/chatgpt")
  symlinkSync(launcher, launcherLink)
  return { oldCaskFile: join(tapDirectory, "Casks/chatgpt.rb") }
}


test("migration verifies the replacement before uninstalling the tap-owned cask", () => {
  const temp = fixture()
  try {
    const { oldCaskFile } = createOldReceipt(temp.prefix, temp.home, "joshyorko/tools")
    const userData = join(temp.home, ".config/ChatGPT/user-data.json")
    mkdirSync(join(temp.home, ".config/ChatGPT"), { recursive: true })
    writeFileSync(userData, "preserve me")
    const result = spawnSync("bash", [migrationScript.pathname], { env: temp.env, encoding: "utf8" })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readFileSync(temp.calls, "utf8").trim().split("\n"), [
      "--prefix",
      "fetch --cask joshyorko/tools/chatgpt-linux",
      "--repository joshyorko/tools",
      "uninstall --cask joshyorko/tools/chatgpt",
      "install --cask --require-sha joshyorko/tools/chatgpt-linux",
    ])
    assert.ok(readFileSync(join(temp.prefix, "Caskroom/chatgpt-linux/.metadata/INSTALL_RECEIPT.json"), "utf8"))
    assert.ok(existsSync(join(temp.home, ".local/share/applications/chatgpt.desktop")))
    assert.equal(readFileSync(userData, "utf8"), "preserve me")
    assert.equal(existsSync(oldCaskFile), false)
    assert.doesNotMatch(readFileSync(migrationScript, "utf8"), /--zap|zap:/)
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test("migration refuses an official or otherwise foreign old cask receipt", () => {
  const temp = fixture()
  try {
    createOldReceipt(temp.prefix, temp.home, "homebrew/cask")
    const result = spawnSync("bash", [migrationScript.pathname], { env: temp.env, encoding: "utf8" })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /No tap-owned old Linux ChatGPT cask receipt/)
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

test("migration restores the prior app and user data when the new install fails", () => {
  const temp = fixture()
  try {
    const { oldCaskFile } = createOldReceipt(temp.prefix, temp.home, "joshyorko/tools")
    const userData = join(temp.home, ".config/ChatGPT/user-data.json")
    mkdirSync(join(temp.home, ".config/ChatGPT"), { recursive: true })
    writeFileSync(userData, "preserve me")
    temp.env.FAIL_NEW_INSTALL = "1"
    const result = spawnSync("bash", [migrationScript.pathname], { env: temp.env, encoding: "utf8" })

    assert.equal(result.status, 42)
    assert.equal(readFileSync(userData, "utf8"), "preserve me")
    assert.ok(
      existsSync(join(temp.prefix, "Caskroom/chatgpt/.metadata/INSTALL_RECEIPT.json")),
      `${result.stderr}\n${result.stdout}`,
    )
    assert.equal(existsSync(join(temp.prefix, "Caskroom/chatgpt-linux/.metadata/INSTALL_RECEIPT.json")), false)
    assert.equal(readFileSync(join(temp.home, ".local/share/applications/chatgpt.desktop"), "utf8"), "Exec=/brew/bin/chatgpt %U\n")
    assert.equal(readFileSync(join(temp.home, ".local/share/icons/hicolor/512x512@2/apps/chatgpt.png"), "utf8"), "icon")
    assert.match(readFileSync(join(temp.prefix, "bin/chatgpt"), "utf8"), /^#!\/bin\/sh/)
    assert.equal(existsSync(oldCaskFile), false)
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test("migration reuses a completed rollback copy left before the state checkpoint", () => {
  const temp = fixture()
  try {
    const { oldCaskFile } = createOldReceipt(temp.prefix, temp.home, "joshyorko/tools")
    const migrationDir = join(temp.prefix, "var/homebrew-tools-chatgpt-linux-migration")
    const backup = join(migrationDir, "old-caskroom")
    mkdirSync(migrationDir, { recursive: true })
    execFileSync("cp", ["-al", `${join(temp.prefix, "Caskroom/chatgpt")}/.`, `${backup}/`])
    mkdirSync(join(migrationDir, "old-caskroom-staging.crash"), { recursive: true })
    writeFileSync(join(migrationDir, "old-caskroom-staging.crash/partial"), "orphaned partial copy")

    const result = spawnSync("bash", [migrationScript.pathname], { env: temp.env, encoding: "utf8" })

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    assert.deepEqual(readFileSync(temp.calls, "utf8").trim().split("\n"), [
      "--prefix",
      "fetch --cask joshyorko/tools/chatgpt-linux",
      "--repository joshyorko/tools",
      "uninstall --cask joshyorko/tools/chatgpt",
      "install --cask --require-sha joshyorko/tools/chatgpt-linux",
    ])
    assert.equal(existsSync(migrationDir), false)
    assert.equal(existsSync(oldCaskFile), false)
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test("migration refuses a partial final backup without nesting another caskroom copy", () => {
  const temp = fixture()
  try {
    createOldReceipt(temp.prefix, temp.home, "joshyorko/tools")
    const migrationDir = join(temp.prefix, "var/homebrew-tools-chatgpt-linux-migration")
    const backup = join(migrationDir, "old-caskroom")
    mkdirSync(join(backup, "chatgpt/.metadata"), { recursive: true })
    writeFileSync(join(backup, "chatgpt/.metadata/INSTALL_RECEIPT.json"), "nested partial backup")

    const result = spawnSync("bash", [migrationScript.pathname], { env: temp.env, encoding: "utf8" })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /Existing rollback backup is incomplete/)
    assert.deepEqual(readFileSync(temp.calls, "utf8").trim().split("\n"), [
      "--prefix",
      "fetch --cask joshyorko/tools/chatgpt-linux",
    ])
    assert.equal(readFileSync(join(backup, "chatgpt/.metadata/INSTALL_RECEIPT.json"), "utf8"), "nested partial backup")
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})
