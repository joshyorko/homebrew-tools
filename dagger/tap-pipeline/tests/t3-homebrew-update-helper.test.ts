import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import test from "node:test"

const repoRoot = new URL("../../../", import.meta.url)
const helperPath = new URL("scripts/t3-homebrew-update.sh", repoRoot)
const originalVersion = "main.20261106111159.6577c6b61851"
const availableVersion = "main.20261107123456.112233445566"

type FixtureOptions = {
  readonly currentFormula?: string
  readonly currentCask?: string
  readonly appVersion?: string
  readonly availableFormula?: string
  readonly availableFormulaRevision?: number
  readonly availableCask?: string
  readonly activeService?: boolean
  readonly failCask?: boolean
  readonly mismatchInstalledCask?: boolean
}

function makeFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "t3-homebrew-update-"))
  const home = join(root, "home")
  const state = join(root, "state")
  const fakeState = join(root, "fake-state")
  const bin = join(root, "bin")
  const eventLog = join(root, "events.log")
  const desktopExitMarker = join(root, "desktop-exited")
  const prefix = join(home, "fake-homebrew")
  const cellar = join(prefix, "Cellar")
  const currentFormula = options.currentFormula ?? originalVersion
  const currentCask = options.currentCask ?? originalVersion
  const availableFormula = options.availableFormula ?? availableVersion
  const availableRevision = options.availableFormulaRevision ?? 0
  const availableFull = availableRevision > 0 ? `${availableFormula}_${availableRevision}` : availableFormula
  const availableCask = options.availableCask ?? availableFull
  const appVersion = options.appVersion ?? originalVersion

  mkdirSync(home, { recursive: true })
  mkdirSync(state, { recursive: true })
  mkdirSync(fakeState, { recursive: true })
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(cellar, "t3code-cli-main", currentFormula), { recursive: true })
  writeFileSync(join(cellar, "t3code-cli-main", currentFormula, "INSTALL_RECEIPT.json"), JSON.stringify({source:{tap:"joshyorko/tools"}}))
  mkdirSync(join(prefix, "Caskroom", "t3-code-linux", ".metadata"), { recursive: true })
  mkdirSync(join(prefix, "bin"), { recursive: true })
  for (const [name, value] of Object.entries({
    linked_formula: currentFormula,
    current_cask: currentCask,
    available_formula: availableFormula,
    available_revision: String(availableRevision),
    available_full: availableFull,
    available_cask: availableCask,
    original_version: currentFormula,
    installed_formula_versions: currentFormula,
  })) {
    writeFileSync(join(fakeState, name), `${value}\n`)
  }
  if (options.activeService) writeFileSync(join(fakeState, "service-active"), "active\n")
  writeFileSync(join(fakeState, "service-enabled"), "enabled\n")
  writeFileSync(join(prefix, "Caskroom", "t3-code-linux", ".metadata", "INSTALL_RECEIPT.json"),
    `{"source":{"tap":"joshyorko/tools","version":"${currentCask}"}}\n`)

  const rubyParser = `import { readFileSync } from "node:fs"
const source = process.argv[2] ?? ""
const data = JSON.parse(readFileSync(0, "utf8"))
const formula = data.formulae?.find((entry) => entry.name === "t3code-cli-main")
if (source.includes("foreign installed tap") && data.source?.tap !== "joshyorko/tools") process.exit(1)
if (source.includes('data.fetch("source").fetch("tap")')) {
  if (data.source?.tap !== "joshyorko/tools") process.exit(1)
} else if (source.includes("PkgVersion.parse")) {
  const versions = (formula?.installed ?? []).map((entry) => entry.version).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (!versions.length) process.exit(1)
  process.stdout.write(versions.at(-1) + "\\n")
} else if (source.includes('linked = formula["linked_keg"]')) {
  if (!formula?.linked_keg) process.exit(1)
  process.stdout.write(formula.linked_keg + "\\n")
} else if (source.includes('formula.fetch("versions")')) {
  if (!formula) process.exit(1)
  const stable = formula.versions.stable
  process.stdout.write(stable + (formula.revision ? "_" + formula.revision : "") + "\\n")
} else if (source.includes('cask = data.fetch("casks")')) {
  const cask = data.casks?.find((entry) => entry.token === "t3-code-linux")
  if (!cask) process.exit(1)
  process.stdout.write(cask.version + "\\n")
} else if (source.includes('source.fetch("version")')) {
  const version = data.source?.version
  if (!version) process.exit(1)
  process.stdout.write(version + "\\n")
} else if (source.includes('value = data.fetch(')) {
  const key = source.match(/data.fetch\\(\\"([^\\"]+)\\"\\)/)?.[1]
  if (!key || !(key in data)) process.exit(1)
  process.stdout.write(String(data[key]) + "\\n")
} else {
  process.exit(1)
}
`
  writeFileSync(join(fakeState, "fake-ruby.mjs"), rubyParser)

  const brew = `#!/usr/bin/env bash
set -euo pipefail
printf 'brew|%s\\n' "$*" >> "$EVENT_LOG"
command="$1"
shift
case "$command" in
  --prefix) printf '%s\\n' "$FAKE_PREFIX" ;;
  --cellar) printf '%s\\n' "$FAKE_CELLAR" ;;
  ruby)
    [[ "$1" == -rjson && "$2" == -e ]] || exit 36
    exec "$NODE_BINARY" "$FAKE_STATE_DIR/fake-ruby.mjs" "$3" ;;
  update) exit 0 ;;
  info)
    installed=false
    for arg in "$@"; do [[ "$arg" == --installed ]] && installed=true; done
    if [[ "$installed" == true ]]; then
      linked="$(cat "$FAKE_STATE_DIR/linked_formula")"
      installed_json=""
      while IFS= read -r version; do
        [[ -n "$version" ]] || continue
        [[ -n "$installed_json" ]] && installed_json="$installed_json,"
        installed_json="$installed_json"'{"version":"'"$version"'"}'
      done < "$FAKE_STATE_DIR/installed_formula_versions"
      printf '{"formulae":[{"name":"t3code-cli-main","tap":"joshyorko/tools","versions":{"stable":"%s"},"revision":%s,"linked_keg":"%s","installed":[%s]}]}\\n' \\
        "$(cat "$FAKE_STATE_DIR/available_formula")" "$(cat "$FAKE_STATE_DIR/available_revision")" "$linked" "$installed_json"
    elif [[ " $* " == *" --cask "* ]]; then
      printf '{"casks":[{"token":"t3-code-linux","tap":"joshyorko/tools","version":"%s"}]}\\n' "$(cat "$FAKE_STATE_DIR/available_cask")"
    else
      printf '{"formulae":[{"name":"t3code-cli-main","tap":"joshyorko/tools","versions":{"stable":"%s"},"revision":%s}]}\\n' \\
        "$(cat "$FAKE_STATE_DIR/available_formula")" "$(cat "$FAKE_STATE_DIR/available_revision")"
    fi ;;
  fetch) exit 0 ;;
  upgrade)
    [[ -f "$DESKTOP_EXIT_MARKER" ]] || { echo "Desktop is still running" >&2; exit 90; }
    if [[ " $* " == *" --formula "* ]]; then
      version="$(cat "$FAKE_STATE_DIR/available_full")"
      mkdir -p "$FAKE_CELLAR/t3code-cli-main/$version"
      printf '%s\\n' '{"source":{"tap":"joshyorko/tools"}}' > "$FAKE_CELLAR/t3code-cli-main/$version/INSTALL_RECEIPT.json"
      printf '%s\\n' "$version" >> "$FAKE_STATE_DIR/installed_formula_versions"
      printf '%s\\n' "$version" > "$FAKE_STATE_DIR/linked_formula"
    elif [[ " $* " == *" --cask "* ]]; then
      if [[ "$FAIL_CASK" == true ]]; then exit 32; fi
      version="$(cat "$FAKE_STATE_DIR/available_cask")"
      [[ "$MISMATCH_INSTALLED_CASK" != true ]] || version="$MISMATCH_CASK_VERSION"
      printf '{"source":{"tap":"joshyorko/tools","version":"%s"}}\\n' "$version" > "$FAKE_PREFIX/Caskroom/t3-code-linux/.metadata/INSTALL_RECEIPT.json"
    else
      exit 37
    fi ;;
  uninstall)
    [[ "$HOMEBREW_NO_AUTOREMOVE" == 1 ]] || exit 91
    version="$(cat "$FAKE_STATE_DIR/available_full")"
    rm -rf -- "$FAKE_CELLAR/t3code-cli-main/$version"
    grep -Fvx "$version" "$FAKE_STATE_DIR/installed_formula_versions" > "$FAKE_STATE_DIR/installed_formula_versions.tmp" || true
    mv "$FAKE_STATE_DIR/installed_formula_versions.tmp" "$FAKE_STATE_DIR/installed_formula_versions" ;;
  link)
    printf '%s\\n' "$(cat "$FAKE_STATE_DIR/original_version")" > "$FAKE_STATE_DIR/linked_formula" ;;
  *) exit 38 ;;
esac
`
  const systemctl = `#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl|%s\\n' "$*" >> "$EVENT_LOG"
if [[ "$1" == --user ]]; then shift; fi
case "$1" in
  show-environment|daemon-reload) exit 0 ;;
  is-active)
    if [[ -f "$FAKE_STATE_DIR/service-active" ]]; then exit 0; fi
    exit 3 ;;
  is-enabled)
    if [[ -f "$FAKE_STATE_DIR/service-enabled" ]]; then exit 0; fi
    exit 1 ;;
  stop)
    rm -f "$FAKE_STATE_DIR/service-active"
    printf 'service.stop\\n' >> "$EVENT_LOG" ;;
  start)
    touch "$FAKE_STATE_DIR/service-active"
    printf 'service.start\\n' >> "$EVENT_LOG" ;;
  *) exit 39 ;;
esac
`
  const ss = `#!/usr/bin/env bash
printf 'fake.ss|%s\\n' "$*" >> "$EVENT_LOG"
exit 0
`
  const pgrep = `#!/usr/bin/env bash
printf 'fake.pgrep|%s\\n' "$*" >> "$EVENT_LOG"
exit 1
`
  const desktop = `#!/usr/bin/env bash
printf 'desktop.relaunch\\n' >> "$EVENT_LOG"
`
  for (const [name, contents, path] of [
    ["brew", brew, bin],
    ["systemctl", systemctl, bin],
    ["ss", ss, bin],
    ["pgrep", pgrep, bin],
    ["t3-code-linux", desktop, join(prefix, "bin")],
  ] as const) {
    writeFileSync(join(path, name), contents, { mode: 0o755 })
  }

  const env = {
    HOME: home,
    XDG_STATE_HOME: state,
    XDG_CONFIG_HOME: join(home, ".config"),
    PATH: `${bin}:/usr/bin:/bin`,
    EVENT_LOG: eventLog,
    FAKE_STATE_DIR: fakeState,
    FAKE_PREFIX: prefix,
    FAKE_CELLAR: cellar,
    NODE_BINARY: process.execPath,
    ORIGINAL_VERSION: currentFormula,
    AVAILABLE_VERSION: availableFull,
    FAIL_CASK: options.failCask ? "true" : "false",
    MISMATCH_INSTALLED_CASK: options.mismatchInstalledCask ? "true" : "false",
    MISMATCH_CASK_VERSION: `${availableCask}-mismatch`,
    DESKTOP_EXIT_MARKER: desktopExitMarker,
    DESKTOP_PID_FILE: join(fakeState, "desktop.pid"),
    APP_VERSION: appVersion,
  }
  const run = (args: string[]) => {
    assert.ok(existsSync(helperPath), "Homebrew update helper exists")
    return spawnSync("bash", [helperPath.pathname, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      timeout: 10_000,
    })
  }
  const events = () => existsSync(eventLog) ? readFileSync(eventLog, "utf8").trim().split("\n") : []
  const resultPath = join(state, "t3code", "homebrew-update", "result.json")

  return { root, home, state, fakeState, prefix, cellar, eventLog, desktopExitMarker, env, run, events, resultPath, currentFormula, availableFull, availableCask, appVersion }
}

async function startDesktopProcess(fixture: ReturnType<typeof makeFixture>) {
  const child = spawn("bash", ["-c", 'sleep 1 & desktop_pid=$!; printf "%s\\n" "$desktop_pid" > "$DESKTOP_PID_FILE"; wait "$desktop_pid"; : > "$DESKTOP_EXIT_MARKER"'], {
    env: { ...process.env, ...fixture.env },
    stdio: "ignore",
  })
  const pidFile = join(fixture.fakeState, "desktop.pid")
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (existsSync(pidFile)) return resolve()
      if (child.exitCode !== null) return reject(new Error("fake Desktop supervisor exited before publishing its child PID"))
      setTimeout(check, 10)
    }
    check()
  })
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  const pid = Number(readFileSync(pidFile, "utf8").trim())
  assert.ok(Number.isSafeInteger(pid) && pid > 0)
  return { supervisor: child, pid, exited }
}

function check(fixture: ReturnType<typeof makeFixture>) {
  const result = fixture.run(["check", "--json", "--app-version", fixture.appVersion])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function assertPackageOutput(output: Record<string, unknown>, version: string) {
  assert.equal(output.source, "joshyorko/tools")
  assert.equal(output.sourceCommit, version.match(/\.([0-9a-f]{12})(?:_[0-9]+)?$/)?.[1])
  assert.equal(output.formula, version)
  assert.equal(output.cask, version)
}

function readResult(path: string) {
  assert.ok(existsSync(path), "one-shot result file is written")
  const result: unknown = JSON.parse(readFileSync(path, "utf8"))
  assert.ok(typeof result === "object" && result !== null && !Array.isArray(result))
  const recorded = result as { outcome?: unknown; version?: unknown; message?: unknown }
  assert.deepEqual(Object.keys(recorded).sort(), ["message", "outcome", "version"])
  assert.ok(recorded.outcome === "installed" || recorded.outcome === "failed")
  assert.equal(typeof recorded.version, "string")
  assert.equal(typeof recorded.message, "string")
  return recorded
}

async function waitForEvent(fixture: ReturnType<typeof makeFixture>, event: string) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (fixture.events().includes(event)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for ${event}`)
}

test("check --json reports a matched installed pair as current", () => {
  const fixture = makeFixture({
    currentFormula: originalVersion,
    currentCask: originalVersion,
    availableFormula: originalVersion,
    availableCask: originalVersion,
  })
  try {
    const output = check(fixture)
    assert.equal(output.status, "current")
    assert.equal(output.currentVersion, originalVersion)
    assert.equal(output.availableVersion, originalVersion)
    assertPackageOutput(output, originalVersion)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("check --json reports a matched newer pair as available", () => {
  const fixture = makeFixture()
  try {
    const output = check(fixture)
    assert.equal(output.status, "available")
    assert.equal(output.currentVersion, originalVersion)
    assert.equal(output.availableVersion, availableVersion)
    assertPackageOutput(output, availableVersion)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("candidate version mismatch fails closed without changing either package", () => {
  const fixture = makeFixture({ availableCask: "main.20261107123456.deadbeefdead" })
  try {
    const result = fixture.run(["check", "--json", "--app-version", originalVersion])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /current Homebrew CLI and Desktop candidates do not match/)
    assert.doesNotMatch(fixture.events().join("\n"), /brew\|(fetch|upgrade|install|uninstall|link) /)
    assert.equal(readFileSync(join(fixture.fakeState, "linked_formula"), "utf8").trim(), originalVersion)
    assert.equal(readFileSync(join(fixture.prefix, "Caskroom", "t3-code-linux", ".metadata", "INSTALL_RECEIPT.json"), "utf8").includes(originalVersion), true)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("check uses the matching formula revision and cask version while accepting the Desktop base version", () => {
  const fixture = makeFixture({
    currentFormula: `${originalVersion}_1`,
    currentCask: `${originalVersion}_1`,
    appVersion: originalVersion,
    availableFormula: availableVersion,
    availableFormulaRevision: 1,
    availableCask: `${availableVersion}_1`,
  })
  try {
    const output = check(fixture)
    assert.equal(output.status, "available")
    assert.equal(output.availableVersion, `${availableVersion}_1`)
    assertPackageOutput(output, `${availableVersion}_1`)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("check refuses an app version that differs from its installed cask receipt", () => {
  const fixture = makeFixture({ appVersion: "main.20261105000000.000000000000" })
  try {
    const result = fixture.run(["check", "--json", "--app-version", fixture.appVersion])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /running Desktop does not match the installed Homebrew cask/)
    assert.doesNotMatch(fixture.events().join("\n"), /brew\|(fetch|upgrade|install|uninstall|link) /)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("prepare fetches both matching candidates without changing packages or service state", () => {
  const fixture = makeFixture()
  try {
    const checked = check(fixture)
    assert.equal(checked.status, "available")
    const result = fixture.run(["prepare", "--app-version", originalVersion, "--version", availableVersion])
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.status, "prepared")
    assert.equal(output.currentVersion, originalVersion)
    assert.equal(output.availableVersion, availableVersion)
    assertPackageOutput(output, availableVersion)
    const events = fixture.events().join("\n")
    assert.match(events, /brew\|fetch --formula joshyorko\/tools\/t3code-cli-main/)
    assert.match(events, /brew\|fetch --cask joshyorko\/tools\/t3-code-linux/)
    assert.doesNotMatch(events, /brew\|(upgrade|install|uninstall|link) /)
    assert.equal(readFileSync(join(fixture.fakeState, "linked_formula"), "utf8").trim(), originalVersion)
    assert.equal(existsSync(join(fixture.fakeState, "service-active")), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("apply waits, updates the matched pair, restores the active service, and relaunches Desktop", async () => {
  const fixture = makeFixture({ activeService: true })
  const desktop = await startDesktopProcess(fixture)
  try {
    assert.equal(check(fixture).status, "available")
    const result = fixture.run(["apply", "--app-version", originalVersion, "--version", availableVersion, "--wait-for-pid", String(desktop.pid)])
    await desktop.exited
    assert.equal(result.status, 0, result.stderr)
    await waitForEvent(fixture, "desktop.relaunch")
    const events = fixture.events()
    const stop = events.indexOf("service.stop")
    const portCheck = events.findIndex((event) => event.startsWith("fake.ss|"))
    const formulaUpgrade = events.findIndex((event) => event.includes("upgrade --formula"))
    const caskUpgrade = events.findIndex((event) => event.includes("upgrade --cask"))
    const start = events.indexOf("service.start")
    const relaunch = events.indexOf("desktop.relaunch")
    assert.ok(existsSync(fixture.desktopExitMarker), "test Desktop process exited before installation")
    assert.ok(stop >= 0 && portCheck > stop && formulaUpgrade > portCheck && caskUpgrade > formulaUpgrade && start > caskUpgrade && relaunch > start, events.join("\n"))
    assert.match(events.join("\n"), /fake\.pgrep\|/)
    assert.equal(readFileSync(join(fixture.fakeState, "linked_formula"), "utf8").trim(), availableVersion)
    assert.equal(readFileSync(join(fixture.prefix, "Caskroom", "t3-code-linux", ".metadata", "INSTALL_RECEIPT.json"), "utf8").includes(availableVersion), true)
    const recorded = readResult(fixture.resultPath)
    assert.equal(recorded.outcome, "installed")
    assert.equal(recorded.version, availableVersion)
  } finally {
    await desktop.exited
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("apply leaves a previously inactive service inactive", async () => {
  const fixture = makeFixture()
  const desktop = await startDesktopProcess(fixture)
  try {
    assert.equal(check(fixture).status, "available")
    const result = fixture.run(["apply", "--app-version", originalVersion, "--version", availableVersion, "--wait-for-pid", String(desktop.pid)])
    assert.equal(result.status, 0, result.stderr)
    await waitForEvent(fixture, "desktop.relaunch")
    assert.equal(existsSync(join(fixture.fakeState, "service-active")), false)
    assert.doesNotMatch(fixture.events().join("\n"), /service\.(stop|start)/)
    assert.match(fixture.events().join("\n"), /desktop\.relaunch/)
    assert.equal(readResult(fixture.resultPath).outcome, "installed")
  } finally {
    await desktop.exited
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("cask failure uses Homebrew transactional rollback, restores the retained CLI keg and active service", async () => {
  const fixture = makeFixture({ activeService: true, failCask: true })
  const desktop = await startDesktopProcess(fixture)
  try {
    assert.equal(check(fixture).status, "available")
    const result = fixture.run(["apply", "--app-version", originalVersion, "--version", availableVersion, "--wait-for-pid", String(desktop.pid)])
    await desktop.exited
    assert.notEqual(result.status, 0)
    await waitForEvent(fixture, "desktop.relaunch")
    const events = fixture.events()
    const formulaUpgrade = events.findIndex((event) => event.includes("upgrade --formula"))
    const caskUpgrade = events.findIndex((event) => event.includes("upgrade --cask"))
    const formulaUninstall = events.findIndex((event) => event.includes("uninstall --formula --ignore-dependencies joshyorko/tools/t3code-cli-main"))
    const formulaRelink = events.findIndex((event) => event.includes("link --overwrite joshyorko/tools/t3code-cli-main"))
    const serviceStart = events.indexOf("service.start")
    const relaunch = events.indexOf("desktop.relaunch")
    assert.ok(formulaUpgrade >= 0 && caskUpgrade > formulaUpgrade && formulaUninstall > caskUpgrade && formulaRelink > formulaUninstall && serviceStart > formulaRelink && relaunch > serviceStart, events.join("\n"))
    assert.equal(readFileSync(join(fixture.fakeState, "linked_formula"), "utf8").trim(), originalVersion)
    assert.equal(readFileSync(join(fixture.prefix, "Caskroom", "t3-code-linux", ".metadata", "INSTALL_RECEIPT.json"), "utf8").includes(originalVersion), true)
    assert.equal(existsSync(join(fixture.fakeState, "service-active")), true)
    const recorded = readResult(fixture.resultPath)
    assert.equal(recorded.outcome, "failed")
    assert.equal(recorded.version, originalVersion)
  } finally {
    await desktop.exited
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("recovery mismatch leaves the service stopped and records failure", async () => {
  const fixture = makeFixture({ activeService: true, mismatchInstalledCask: true })
  const desktop = await startDesktopProcess(fixture)
  try {
    assert.equal(check(fixture).status, "available")
    const result = fixture.run(["apply", "--app-version", originalVersion, "--version", availableVersion, "--wait-for-pid", String(desktop.pid)])
    await desktop.exited
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(join(fixture.fakeState, "service-active")), false)
    assert.doesNotMatch(fixture.events().join("\n"), /service\.start|desktop\.relaunch/)
    const recorded = readResult(fixture.resultPath)
    assert.equal(recorded.outcome, "failed")
    assert.equal(recorded.version, originalVersion)
    assert.match(String(recorded.message), /automatic recovery/i)
  } finally {
    await desktop.exited
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("relaunch closes the updater lock before the next update check", async () => {
  const fixture = makeFixture()
  const desktop = await startDesktopProcess(fixture)
  const pidFile = join(fixture.root, "launcher.pid")
  try {
    writeFileSync(join(fixture.prefix, "bin", "t3-code-linux"), `#!/bin/bash\nprintf '%s' "$$" > '${pidFile}'\nprintf 'desktop.relaunch\\n' >> "$EVENT_LOG"\nsleep 10\n`, { mode: 0o755 })
    check(fixture)
    const applied = fixture.run(["apply", "--app-version", originalVersion, "--version", availableVersion, "--wait-for-pid", String(desktop.pid)])
    await desktop.exited
    assert.equal(applied.status, 0, applied.stderr)
    await waitForEvent(fixture, "desktop.relaunch")
    const checked = fixture.run(["check", "--json", "--app-version", availableVersion])
    assert.equal(checked.status, 0, checked.stderr)
  } finally {
    if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM") } catch {} }
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("a stale handoff is refused before readiness while Desktop remains open", async () => {
  const fixture = makeFixture()
  const desktop = await startDesktopProcess(fixture)
  try {
    check(fixture)
    writeFileSync(join(fixture.state, "t3code", "homebrew-update", "snapshot", "metadata"), JSON.stringify({ currentVersion: availableVersion, appVersion: originalVersion }))
    const applied = fixture.run(["apply", "--app-version", originalVersion, "--version", availableVersion, "--wait-for-pid", String(desktop.pid)])
    await desktop.exited
    assert.notEqual(applied.status, 0)
    assert.equal(readResult(fixture.resultPath).outcome, "failed")
    assert.doesNotMatch(fixture.events().join("\n"), /desktop\.relaunch/)
    assert.doesNotMatch(fixture.events().join("\n"), /brew\|upgrade /)
  } finally { rmSync(fixture.root, { recursive: true, force: true }) }
})

test("a same-version cask from a foreign tap is refused", () => {
  const fixture = makeFixture()
  try {
    writeFileSync(join(fixture.prefix, "Caskroom", "t3-code-linux", ".metadata", "INSTALL_RECEIPT.json"), JSON.stringify({ source: { version: originalVersion, tap: "foreign/tools" } }))
    const result = fixture.run(["check", "--json", "--app-version", originalVersion])
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(fixture.events().join("\n"), /brew\|(?:update|upgrade|fetch) /)
  } finally { rmSync(fixture.root, { recursive: true, force: true }) }
})

test("migration refuses the lifecycle lock held by the updater", async () => {
  const fixture = makeFixture()
  const ready = join(fixture.root, "lock-ready")
  let holder: ReturnType<typeof spawn> | undefined
  try {
    check(fixture)
    const lock = join(fixture.state, "t3code", "homebrew-update", "update.lock")
    holder = spawn("bash", ["-c", 'exec 9>"$1"; flock 9; touch "$2"; sleep 3', "holder", lock, ready], { stdio: "ignore" })
    for (let i = 0; i < 100 && !existsSync(ready); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(existsSync(ready))
    const migration = new URL("scripts/migrate-t3-homebrew-service.sh", repoRoot)
    const result = spawnSync("bash", [migration.pathname, "--apply"], { encoding: "utf8", env: { ...process.env, ...fixture.env } })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Another T3 Homebrew migration/)
    assert.doesNotMatch(fixture.events().join("\n"), /service\.(?:start|stop)|brew\|upgrade/)
  } finally { holder?.kill("SIGTERM"); rmSync(fixture.root, { recursive: true, force: true }) }
})
