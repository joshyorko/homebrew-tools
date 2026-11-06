import assert from "node:assert/strict"
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
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
test("T3 Desktop uses the Homebrew provider without a fake updater feed", () => {
  assert.doesNotMatch(cask, /feedUrl|app-update\.yml|electron-updater/i)
  assert.match(guide, /Homebrew Desktop update button/)
  assert.match(guide, /system-wide/)
})

test("migration is reviewable by default and limits changes to named legacy units", () => {
  assert.ok(existsSync(migrationPath), "operator migration script exists")
  const script = readFileSync(migrationPath, "utf8")
  assert.match(script, /t3code-homebrew\.service/)
  assert.match(script, /t3code\.service/)
  assert.match(script, /--user/)
  assert.match(script, /brew services start t3code-cli-main/)
  assert.match(script, /--apply/)
  assert.match(script, /flock -n 9/)
  assert.match(script, /ln -s \/dev\/null/)
  assert.match(script, /t3code-homebrew-service-migration\/legacy/)
  assert.match(script, /pgrep -u/)
  assert.doesNotMatch(script, /rm\s+-rf|\.t3\/(?:userdata|runtime)|service install/)
})

test("systemd honors a mask at the original unit path over a runtime mask", (context) => {
  const version = spawnSync("systemd-analyze", ["--version"], { encoding: "utf8" })
  if (version.error || version.status !== 0) {
    context.skip("systemd-analyze is unavailable")
    return
  }

  const home = mkdtempSync(join(tmpdir(), "t3-systemd-unit-mask-"))
  try {
    const configDir = join(home, ".config/systemd/user")
    const runtimeDir = join(home, "runtime/systemd/user")
    mkdirSync(configDir, { recursive: true })
    mkdirSync(runtimeDir, { recursive: true })
    const unitPath = join(configDir, "t3code-homebrew.service")
    const runtimeMask = join(runtimeDir, "t3code-homebrew.service")
    writeFileSync(unitPath, "[Unit]\nDescription=isolated T3 unit lookup\n[Service]\nExecStart=/usr/bin/true\n")
    const env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_RUNTIME_DIR: join(home, "runtime"),
    }

    symlinkSync("/dev/null", runtimeMask)
    const runtimeResult = spawnSync("systemd-analyze", ["--user", "verify", "t3code-homebrew.service"], {
      encoding: "utf8",
      env,
    })
    assert.equal(runtimeResult.status, 0, `${runtimeResult.stdout}\n${runtimeResult.stderr}`)

    rmSync(unitPath)
    symlinkSync("/dev/null", unitPath)
    const sourcePathResult = spawnSync("systemd-analyze", ["--user", "verify", "t3code-homebrew.service"], {
      encoding: "utf8",
      env,
    })
    assert.notEqual(sourcePathResult.status, 0)
    assert.match(`${sourcePathResult.stdout}\n${sourcePathResult.stderr}`, /is masked/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("manual legacy recovery refuses to overwrite a unit changed after migration", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-manual-recovery-"))
  try {
    const { bin, log } = fakeCommands(home)
    const stateDir = join(home, ".local/state/t3code-homebrew-service-migration/legacy")
    const unit = "t3code-homebrew.service"
    const unitPath = join(home, ".config/systemd/user", unit)
    mkdirSync(stateDir, { recursive: true })
    mkdirSync(join(home, ".config/systemd/user"), { recursive: true })
    writeFileSync(unitPath, "[Service]\nExecStart=/another/changed/unit\n")
    writeFileSync(join(stateDir, unit), "[Service]\nExecStart=/home/linuxbrew/.linuxbrew/bin/t3 serve\n")
    writeFileSync(join(stateDir, `${unit}.path`), `${unitPath}\n`)
    writeFileSync(join(stateDir, `${unit}.state`), "active=true\nenabled=true\n")

    const recoveryBlock = guide.match(/For example, if `t3code-homebrew\.service` was the sole active unit:[\s\S]*?```bash\n([\s\S]*?)```/)?.[1]
    assert.ok(recoveryBlock, "manual recovery procedure is documented")
    const result = spawnSync("bash", ["-c", recoveryBlock], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_STATE_HOME: join(home, ".local/state"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Refusing to overwrite a changed legacy unit/)
    assert.match(readFileSync(unitPath, "utf8"), /another\/changed\/unit/)
    assert.equal(existsSync(log), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
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
unit_dir="\${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
if [[ ! -f "$active_file" ]]; then printf '%s\\n' "$LEGACY_ACTIVE" | tr ' ' '\\n' > "$active_file"; fi
if [[ ! -f "$enabled_file" ]]; then printf '%s\\n' "$LEGACY_ENABLED" | tr ' ' '\\n' > "$enabled_file"; fi
mkdir -p "$unit_dir"
for unit in t3code-homebrew.service t3code.service; do
  if [[ ! -e "$unit_dir/$unit" && ! -L "$unit_dir/$unit" ]]; then
    printf '[Service]\\nExecStart=/home/linuxbrew/.linuxbrew/bin/t3 serve\\n' > "$unit_dir/$unit"
  fi
done
case "$1" in
  show-environment) exit 0 ;;
  is-active) grep -Fxq "$3" "$active_file" ;;
  is-enabled)
    if [[ -L "$unit_dir/$3" && "$(readlink "$unit_dir/$3")" == /dev/null ]]; then exit 1; fi
    grep -Fxq "$3" "$enabled_file" ;;
  daemon-reload)
    if [[ $FAIL_DAEMON_RELOAD == true && ! -f "$HOME/reload-failed" ]]; then touch "$HOME/reload-failed"; exit 1; fi
    exit 0 ;;
  show)
    case "$3" in
      --property=LoadState)
        if [[ -L "$unit_dir/$2" && "$(readlink "$unit_dir/$2")" == /dev/null ]]; then printf '%s\\n' masked
        elif [[ -e "$unit_dir/$2" || -L "$unit_dir/$2" ]] || grep -Fxq "$2" "$active_file" || grep -Fxq "$2" "$enabled_file"; then printf '%s\\n' loaded
        else printf '%s\\n' not-found; fi ;;
      --property=ActiveState)
        if [[ $FAIL_SYSTEMD_QUERY == true && "$2" == t3code-homebrew.service ]]; then exit 1; fi
        if grep -Fxq "$2" "$active_file"; then printf '%s\\n' active; else printf '%s\\n' inactive; fi ;;
      --property=UnitFileState)
        if [[ -L "$unit_dir/$2" && "$(readlink "$unit_dir/$2")" == /dev/null ]]; then printf '%s\\n' masked
        elif grep -Fxq "$2" "$enabled_file"; then printf '%s\\n' enabled
        else printf '%s\\n' disabled; fi ;;
      --property=FragmentPath)
        if [[ $BAD_FRAGMENT == true ]]; then printf '%s\\n' /etc/systemd/user/foreign.service; else printf '%s\\n' "$HOME/.config/systemd/user/$2"; fi ;;
      --property=ExecStart)
        if [[ $BAD_EXECSTART == true ]]; then printf '%s\\n' '/home/josh/bin/t3 --api-key=synthetic-secret run'; elif [[ $2 == t3code.service ]]; then printf '%s\\n' '/home/josh/.t3/runtime/versions/0.1.7/t3 __service-launcher'; else printf '%s\\n' '/home/linuxbrew/.linuxbrew/bin/t3 serve'; fi ;;
      *) exit 1 ;;
    esac ;;
  stop)
    file="$active_file"
    grep -Fvx "$2" "$file" > "$file.tmp" || true
    mv "$file.tmp" "$file"
    exit 0 ;;
  start)
    file="$active_file"
    grep -Fxq "$2" "$file" || printf '%s\\n' "$2" >> "$file" ;;
  *) exit 1 ;;
esac
`
  const ss = `#!/bin/bash
printf 'ss %s\\n' "$*" >> "$COMMAND_LOG"
if [[ $LISTENER == true ]]; then printf '%s\\n' 'LISTEN 0 4096 127.0.0.1:3773 0.0.0.0:*'; fi
`
  const pgrep = `#!/bin/bash
printf 'pgrep %s\\n' "$*" >> "$COMMAND_LOG"
[[ $SERVER_RUNNING == true ]]
`
  const flock = `#!/bin/bash
printf 'flock %s\\n' "$*" >> "$COMMAND_LOG"
if [[ $LOCK_HELD == true ]]; then exit 1; fi
exec /usr/bin/flock "$@"
`
  const brew = `#!/bin/bash
printf 'brew %s\\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  "services start t3code-cli-main")
    if [[ $FAIL_BREW == true ]]; then
      if [[ $PARTIAL_BREW == true ]]; then printf '%s\\n' sh.brew.t3code-cli-main.service >> "$HOME/active-units"; fi
      if [[ $PARTIAL_ENABLED == true ]]; then printf '%s\\n' sh.brew.t3code-cli-main.service >> "$HOME/enabled-units"; fi
      exit 1
    fi
    if [[ $BREW_NO_START != true ]]; then
      printf '%s\\n' sh.brew.t3code-cli-main.service >> "$HOME/active-units"
      printf '%s\\n' sh.brew.t3code-cli-main.service >> "$HOME/enabled-units"
    fi ;;
  "services stop t3code-cli-main")
    grep -Ev '^(sh\\.brew|homebrew|homebrew\\.mxcl)\\.t3code-cli-main\\.service$' "$HOME/active-units" > "$HOME/active-units.tmp" || true
    mv "$HOME/active-units.tmp" "$HOME/active-units"
    grep -Ev '^(sh\\.brew|homebrew|homebrew\\.mxcl)\\.t3code-cli-main\\.service$' "$HOME/enabled-units" > "$HOME/enabled-units.tmp" || true
    mv "$HOME/enabled-units.tmp" "$HOME/enabled-units" ;;
esac
exit 0
`
  writeFileSync(join(bin, "systemctl"), systemctl, { mode: 0o755 })
  writeFileSync(join(bin, "brew"), brew, { mode: 0o755 })
  writeFileSync(join(bin, "ss"), ss, { mode: 0o755 })
  writeFileSync(join(bin, "pgrep"), pgrep, { mode: 0o755 })
  writeFileSync(join(bin, "flock"), flock, { mode: 0o755 })
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
        XDG_CONFIG_HOME: join(home, ".config"),
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

test("migration masks the legacy server before starting Homebrew and is repeatable", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const unitPath = join(home, ".config/systemd/user/t3code-homebrew.service")
    mkdirSync(join(home, ".config/systemd/user"), { recursive: true })
    writeFileSync(unitPath, "[Service]\nExecStart=/home/linuxbrew/.linuxbrew/bin/t3 serve\n")
    const originalInode = statSync(unitPath).ino
    const script = readFileSync(migrationPath, "utf8")
    const result = spawnSync("bash", ["-c", script, "migration", "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.equal(result.status, 0, `${result.stderr}\n${readFileSync(log, "utf8")}`)
    const firstRunCommands = readFileSync(log, "utf8")
    assert.ok(firstRunCommands.indexOf("systemctl --user stop t3code-homebrew.service") < firstRunCommands.indexOf("brew services start t3code-cli-main"))
    assert.equal((firstRunCommands.match(/brew services start t3code-cli-main/g) ?? []).length, 1)
    assert.equal(readlinkSync(unitPath), "/dev/null")
    const backupPath = join(home, ".local/state/t3code-homebrew-service-migration/legacy/t3code-homebrew.service")
    assert.equal(statSync(backupPath).ino, originalInode)
    assert.equal(readFileSync(`${backupPath}.path`, "utf8").trim(), unitPath)
    assert.match(readFileSync(`${backupPath}.state`, "utf8"), /active=true\nenabled=true/)
    assert.match(readFileSync(backupPath, "utf8"), /ExecStart=\/home\/linuxbrew/)
    assert.match(readFileSync(join(home, "active-units"), "utf8"), /sh\.brew\.t3code-cli-main\.service/)

    const repeat = spawnSync("bash", ["-c", script, "migration", "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
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
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code.service",
        LEGACY_ENABLED: "t3code.service",
      },
    })
    assert.equal(result.status, 0, result.stderr)
    const commands = readFileSync(log, "utf8")
    assert.match(commands, /systemctl --user stop t3code\.service/)
    assert.match(commands, /brew services start t3code-cli-main/)
    assert.equal(readlinkSync(join(home, ".config/systemd/user/t3code.service")), "/dev/null")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration reuses an exact preserved unit backup after operator restoration", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const unitPath = join(home, ".config/systemd/user/t3code-homebrew.service")
    const backupPath = join(home, ".local/state/t3code-homebrew-service-migration/legacy/t3code-homebrew.service")
    mkdirSync(join(home, ".config/systemd/user"), { recursive: true })
    mkdirSync(join(home, ".local/state/t3code-homebrew-service-migration/legacy"), { recursive: true })
    writeFileSync(unitPath, "[Service]\nExecStart=/home/linuxbrew/.linuxbrew/bin/t3 serve\n")
    writeFileSync(backupPath, readFileSync(unitPath))
    writeFileSync(`${backupPath}.path`, `${unitPath}\n`)
    writeFileSync(`${backupPath}.state`, "active=true\nenabled=true\n")

    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readlinkSync(unitPath), "/dev/null")
    assert.match(readFileSync(backupPath, "utf8"), /ExecStart=/)
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
        XDG_CONFIG_HOME: join(home, ".config"),
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
    assert.match(commands, /systemctl --user start t3code-homebrew\.service/)
    assert.doesNotMatch(commands, /\.t3\/(?:userdata|runtime)/)
    assert.equal(lstatSync(join(home, ".config/systemd/user/t3code-homebrew.service")).isSymbolicLink(), false)
    assert.doesNotMatch(readFileSync(join(home, ".config/systemd/user/t3code-homebrew.service"), "utf8"), /\/dev\/null/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration restores the original unit if systemd reload fails after masking", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        FAIL_DAEMON_RELOAD: "true",
      },
    })
    assert.notEqual(result.status, 0)
    const commands = readFileSync(log, "utf8")
    assert.equal((commands.match(/systemctl --user daemon-reload/g) ?? []).length, 2)
    assert.doesNotMatch(commands, /systemctl --user start t3code-homebrew\.service/)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
    assert.match(readFileSync(join(home, ".config/systemd/user/t3code-homebrew.service"), "utf8"), /ExecStart=/)
    assert.equal(existsSync(join(home, ".local/state/t3code-homebrew-service-migration/legacy/t3code-homebrew.service")), false)
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
        XDG_CONFIG_HOME: join(home, ".config"),
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
    assert.match(commands, /systemctl --user start t3code-homebrew\.service/)
    assert.equal(lstatSync(join(home, ".config/systemd/user/t3code-homebrew.service")).isSymbolicLink(), false)
    assert.equal(existsSync(join(home, ".local/state/t3code-homebrew-service-migration/legacy/t3code-homebrew.service")), false)
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
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        LISTENER: "true",
      },
    })
    assert.notEqual(result.status, 0)
    const commands = readFileSync(log, "utf8")
    assert.match(result.stderr, /T3's default port 3773/)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
    assert.doesNotMatch(commands, /systemctl --user start t3code-homebrew\.service/)
    assert.equal(readlinkSync(join(home, ".config/systemd/user/t3code-homebrew.service")), "/dev/null")
    assert.ok(existsSync(join(home, ".local/state/t3code-homebrew-service-migration/legacy/t3code-homebrew.service")))
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
        XDG_CONFIG_HOME: join(home, ".config"),
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
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service sh.brew.t3code-cli-main.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Homebrew T3 service is already active beside a legacy T3 unit/)
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
        XDG_CONFIG_HOME: join(home, ".config"),
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

test("migration refusal does not print unit ExecStart arguments", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        BAD_EXECSTART: "true",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ExecStart is not a recognized T3 server/)
    assert.doesNotMatch(result.stderr, /synthetic-secret/)
    assert.doesNotMatch(readFileSync(log, "utf8"), /synthetic-secret/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration refuses to proceed when systemd state queries fail", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        FAIL_SYSTEMD_QUERY: "true",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Could not determine systemd state for t3code-homebrew\.service/)
    const commands = readFileSync(log, "utf8")
    assert.doesNotMatch(commands, /systemctl --user stop t3code-homebrew\.service/)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
    assert.equal(lstatSync(join(home, ".config/systemd/user/t3code-homebrew.service")).isSymbolicLink(), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration removes an inactive but newly enabled Homebrew unit before restoring legacy", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
        FAIL_BREW: "true",
        PARTIAL_ENABLED: "true",
      },
    })
    assert.notEqual(result.status, 0)
    const commands = readFileSync(log, "utf8")
    assert.match(commands, /brew services stop t3code-cli-main/)
    assert.ok(commands.indexOf("brew services stop t3code-cli-main") < commands.indexOf("systemctl --user start t3code-homebrew.service"))
    assert.match(readFileSync(join(home, "enabled-units"), "utf8"), /t3code-homebrew\.service/)
    assert.doesNotMatch(readFileSync(join(home, "enabled-units"), "utf8"), /sh\.brew\.t3code-cli-main\.service/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration refuses a concurrent migration while its user lock is held", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        LOCK_HELD: "true",
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Another T3 Homebrew migration is running/)
    const commands = readFileSync(log, "utf8")
    assert.doesNotMatch(commands, /systemctl --user (?:mask|stop|disable) /)
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("migration refuses to start beside a T3 process on a non-default port", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-migration-"))
  try {
    const { bin, log } = fakeCommands(home)
    const result = spawnSync("bash", [migrationPath.pathname, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        SERVER_RUNNING: "true",
        LEGACY_ACTIVE: "t3code-homebrew.service",
        LEGACY_ENABLED: "t3code-homebrew.service",
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Another T3 server is still running/)
    const commands = readFileSync(log, "utf8")
    assert.doesNotMatch(commands, /brew services start t3code-cli-main/)
    assert.equal(readlinkSync(join(home, ".config/systemd/user/t3code-homebrew.service")), "/dev/null")
    assert.ok(existsSync(join(home, ".local/state/t3code-homebrew-service-migration/legacy/t3code-homebrew.service")))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
