import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const repo = new URL("../../../", import.meta.url)
const readRepoFile = (path: string) => readFileSync(new URL(path, repo), "utf8")
const formula = readRepoFile("Formula/t3code-cli-main.rb")
const cask = readRepoFile("Casks/t3-code-linux.rb")
const guide = readRepoFile("docs/t3-homebrew-lifecycle.md")
const migrationPath = new URL("scripts/migrate-t3-homebrew-service.sh", repo)

test("T3 CLI formula service runs the Homebrew launcher with a usable user environment", () => {
  assert.match(formula, /service do\n[\s\S]*?run \[opt_bin\/"t3", "serve"\]/)
  assert.match(formula, /T3CODE_HOME:\s*"#\{ENV\["HOME"\]\}\/\.t3"/)
  assert.match(formula, /T3CODE_TELEMETRY_ENABLED:\s*"false"/)
  assert.match(formula, /PATH:\s*\[[\s\S]*?\.local\/bin[\s\S]*?\.opencode\/bin/)
  assert.match(formula, /Formula\["node@24"\]\.opt_bin/)
})

test("T3 Desktop keeps the upstream no-feed behavior without a fake updater source", () => {
  assert.doesNotMatch(cask, /feedUrl|app-update\.yml|electron-updater/i)
  assert.match(guide, /Automatic updates are not available because no update feed is\s+configured/)
  assert.match(guide, /limits\.updates\.mode=off[\s\S]*?\/etc\/t3code\/policy\.json/)
  assert.match(guide, /system-wide, not scoped to this cask/)
  assert.match(guide, /Desktop update button does\s+not invoke `brew upgrade`/)
})

test("migration is reviewable by default and limits changes to named legacy units", () => {
  assert.ok(existsSync(migrationPath), "operator migration script exists")
  const script = readFileSync(migrationPath, "utf8")
  assert.match(script, /t3code-homebrew\.service/)
  assert.match(script, /t3code\.service/)
  assert.match(script, /--user/)
  assert.match(script, /brew services start t3code-cli-main/)
  assert.match(script, /--apply/)
  assert.doesNotMatch(script, /rm\s+-rf|\.t3\/(?:userdata|runtime)|service install/)
})

function fakeCommands(home: string) {
  const bin = join(home, "bin")
  mkdirSync(bin, { recursive: true })
  const log = join(home, "commands.log")
  const systemctl = `#!/bin/bash
printf 'systemctl %s\\n' "$*" >> "$COMMAND_LOG"
shift
active_file="$HOME/active-units"
enabled_file="$HOME/enabled-units"
if [[ ! -f "$active_file" ]]; then printf '%s\\n' "$LEGACY_ACTIVE" | tr ' ' '\\n' > "$active_file"; fi
if [[ ! -f "$enabled_file" ]]; then printf '%s\\n' "$LEGACY_ENABLED" | tr ' ' '\\n' > "$enabled_file"; fi
case "$1" in
  show-environment) exit 0 ;;
  is-active) grep -Fxq "$3" "$active_file" ;;
  is-enabled) grep -Fxq "$3" "$enabled_file" ;;
  show)
    case "$3" in
      --property=FragmentPath)
        if [[ $BAD_FRAGMENT == true ]]; then printf '%s\\n' /etc/systemd/user/foreign.service; else printf '%s\\n' "$HOME/.config/systemd/user/$2"; fi ;;
      --property=ExecStart)
        if [[ $2 == t3code.service ]]; then printf '%s\\n' '/home/josh/.t3/runtime/versions/0.1.7/t3 __service-launcher'; else printf '%s\\n' '/home/linuxbrew/.linuxbrew/bin/t3 serve'; fi ;;
      *) exit 1 ;;
    esac ;;
  stop|disable)
    file="$active_file"
    [[ "$1" == disable ]] && file="$enabled_file"
    grep -Fvx "$2" "$file" > "$file.tmp" || true
    mv "$file.tmp" "$file"
    if [[ "$1" == disable && $FAIL_DISABLE == true ]]; then exit 1; fi
    exit 0 ;;
  start|enable)
    file="$active_file"
    [[ "$1" == enable ]] && file="$enabled_file"
    grep -Fxq "$2" "$file" || printf '%s\\n' "$2" >> "$file" ;;
  *) exit 1 ;;
esac
`
  const ss = `#!/bin/bash
printf 'ss %s\\n' "$*" >> "$COMMAND_LOG"
if [[ $LISTENER == true ]]; then printf '%s\\n' 'LISTEN 0 4096 127.0.0.1:3773 0.0.0.0:*'; fi
`
  const brew = `#!/bin/bash
printf 'brew %s\\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  "services start t3code-cli-main")
    if [[ $FAIL_BREW == true ]]; then
      if [[ $PARTIAL_BREW == true ]]; then printf '%s\\n' sh.brew.t3code-cli-main.service >> "$HOME/active-units"; fi
      exit 1
    fi
    if [[ $BREW_NO_START != true ]]; then printf '%s\\n' sh.brew.t3code-cli-main.service >> "$HOME/active-units"; fi ;;
  "services stop t3code-cli-main")
    grep -Ev '^(sh\\.brew|homebrew|homebrew\\.mxcl)\\.t3code-cli-main\\.service$' "$HOME/active-units" > "$HOME/active-units.tmp" || true
    mv "$HOME/active-units.tmp" "$HOME/active-units" ;;
esac
exit 0
`
  writeFileSync(join(bin, "systemctl"), systemctl, { mode: 0o755 })
  writeFileSync(join(bin, "brew"), brew, { mode: 0o755 })
  writeFileSync(join(bin, "ss"), ss, { mode: 0o755 })
  return { bin, log }
}

test("migration dry run does not change either service", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.equal(result.status, 0, `${result.stderr}\n${readFileSync(log, "utf8")}`)
    assert.match(result.stdout, /Legacy units to stop: t3code-homebrew\.service/)
    const commands = readFileSync(log, "utf8")
    assert.doesNotMatch(commands, /systemctl --user (?:stop|disable) /)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration disables the legacy server before starting Homebrew and is repeatable", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const script = readFileSync(migrationPath, "utf8")
    const result = spawnSync("bash", ["-c", script, "migration", "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.equal(result.status, 0, `${result.stderr}\n${readFileSync(log, "utf8")}`)
    const firstRunCommands = readFileSync(log, "utf8")
    assert.ok(firstRunCommands.indexOf("systemctl --user stop t3code-homebrew.service") < firstRunCommands.indexOf("brew services start t3code-cli-main"))
    assert.ok(firstRunCommands.indexOf("systemctl --user disable t3code-homebrew.service") < firstRunCommands.indexOf("brew services start t3code-cli-main"))
    assert.equal((firstRunCommands.match(/brew services start t3code-cli-main/g) ?? []).length, 1)

    const repeat = spawnSync("bash", ["-c", script, "migration", "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.equal(repeat.status, 0, repeat.stderr)
    const commands = readFileSync(log, "utf8").slice(firstRunCommands.length)
    assert.doesNotMatch(commands, /systemctl --user (?:stop|disable) t3code-homebrew\.service/)
    assert.equal((commands.match(/brew services start t3code-cli-main/g) ?? []).length, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration supports the upstream-installed t3code.service launcher", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code.service",
        LEGACY_ENABLED: "t3code.service",
      },
    })
    assert.equal(result.status, 0, result.stderr)
    const commands = readFileSync(log, "utf8")
    assert.match(commands, /systemctl --user stop t3code\.service/)
    assert.match(commands, /systemctl --user disable t3code\.service/)
    assert.match(commands, /brew services start t3code-cli-main/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration restores the legacy server if Homebrew activation fails", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const script = readFileSync(migrationPath, "utf8")
    const result = spawnSync("bash", ["-c", script, "migration", "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        FAIL_BREW: "true",
        PARTIAL_BREW: "true",
      },
    })
    assert.notEqual(result.status, 0)
    const commands = readFileSync(log, "utf8")
    assert.match(commands, /brew services stop t3code-cli-main/)
    assert.match(commands, /systemctl --user enable t3code-homebrew\.service/)
    assert.match(commands, /systemctl --user start t3code-homebrew\.service/)
    assert.doesNotMatch(commands, /\.t3\/(?:userdata|runtime)/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration restores prior states after a disable command partially fails", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        FAIL_DISABLE: "true",
      },
    })
    assert.notEqual(result.status, 0)
    const commands = readFileSync(log, "utf8")
    assert.match(commands, /systemctl --user enable t3code-homebrew\.service/)
    assert.match(commands, /systemctl --user start t3code-homebrew\.service/)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
    assert.match(readFileSync(join(home, "active-units"), "utf8"), /t3code-homebrew\.service/)
    assert.match(readFileSync(join(home, "enabled-units"), "utf8"), /t3code-homebrew\.service/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration rolls back if brew reports success without an active Homebrew unit", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        BREW_NO_START: "true",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Homebrew services reported success without an active T3 service/)
    const commands = readFileSync(log, "utf8")
    assert.match(commands, /systemctl --user enable t3code-homebrew\.service/)
    assert.match(commands, /systemctl --user start t3code-homebrew\.service/)
    assert.match(readFileSync(join(home, "active-units"), "utf8"), /t3code-homebrew\.service/)
    assert.match(readFileSync(join(home, "enabled-units"), "utf8"), /t3code-homebrew\.service/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration refuses to start beside an unexplained listener on port 3773", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        LISTENER: "true",
      },
    })
    assert.notEqual(result.status, 0)
    const commands = readFileSync(log, "utf8")
    assert.match(result.stderr, /listener remains on port 3773/)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
    assert.doesNotMatch(commands, /systemctl --user start t3code-homebrew\.service/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration refuses to reconcile two active legacy T3 services", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service t3code.service",
        LEGACY_ENABLED: "t3code-homebrew.service t3code.service",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Both legacy T3 services are active/)
    const commands = readFileSync(log, "utf8")
    assert.doesNotMatch(commands, /systemctl --user (?:stop|disable) /)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration refuses when a Homebrew service is already active beside a legacy server", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service sh.brew.t3code-cli-main.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Homebrew service and a legacy T3 service are both active/)
    const commands = readFileSync(log, "utf8")
    assert.doesNotMatch(commands, /systemctl --user (?:stop|disable) t3code-homebrew\.service/)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration refuses active legacy units outside the user's unit directories", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        BAD_FRAGMENT: "true",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Refusing to change t3code-homebrew\.service/)
    const commands = readFileSync(log, "utf8")
    assert.doesNotMatch(commands, /systemctl --user (?:stop|disable) t3code-homebrew\.service/)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
