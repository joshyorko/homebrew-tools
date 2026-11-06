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

test("upgrade rollback definitions are recovered by the installed pair version", () => {
  assert.match(guide, /brew list --versions t3code-cli-main/)
  assert.match(guide, /brew list --cask --versions t3-code-linux/)
  assert.match(guide, /brew --cellar t3code-cli-main/)
  assert.match(guide, /INSTALL_RECEIPT\.json/)
  assert.match(guide, /source\.tap_git_head/)
  assert.match(guide, /git -C "\$tap_repo" show "\$jq_revision:Casks\/t3-code-linux\.rb"/)
  assert.match(guide, /grep -Fqx "  version \\"\$cli_version\\""/)
  assert.match(guide, /set -euo pipefail/)
  assert.equal((guide.match(/if \[\[ -z "\$cli_version" \|\| "\$cli_version" != "\$desktop_version" \]\]/g) ?? []).length, 3)
})

test("upgrade snapshot uses installed formula and cask receipt definitions", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-rollback-"))
  try {
    const tap = join(home, "tap")
    const bin = join(home, "bin")
    const cellar = join(home, "Cellar")
    const caskroom = join(home, "Caskroom")
    mkdirSync(join(tap, "Formula"), { recursive: true })
    mkdirSync(join(tap, "Casks"), { recursive: true })
    mkdirSync(bin)
    const installedVersion = "main.20260101000000.111111111111"
    const formulaPath = join(tap, "Formula/t3code-cli-main.rb")
    const caskPath = join(tap, "Casks/t3-code-linux.rb")
    const writePair = (marker: string) => {
      writeFileSync(formulaPath, `class T3codeCliMain < Formula\n  version "${installedVersion}"\n  # ${marker}\nend\n`)
      writeFileSync(caskPath, `cask "t3-code-linux" do\n  version "${installedVersion}"\n  # ${marker}\nend\n`)
    }
    const git = (args: string[]) => execFileSync("git", args, { cwd: tap, stdio: "ignore" })
    git(["init", "-q"])
    git(["config", "user.name", "T3 Test"])
    git(["config", "user.email", "t3-test@example.invalid"])
    writePair("INSTALLED_TAP_CASK")
    git(["add", "."])
    git(["commit", "-qm", "installed cask definition"])
    const installedTapRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tap, encoding: "utf8" }).trim()
    writePair("CURRENT_TAP_ONLY")
    git(["add", "."])
    git(["commit", "-qm", "same-version tap change"])

    const formulaKeg = join(cellar, "t3code-cli-main", installedVersion, ".brew")
    const caskMetadata = join(caskroom, "t3-code-linux", ".metadata", installedVersion, "20261106.123456")
    mkdirSync(formulaKeg, { recursive: true })
    mkdirSync(join(caskMetadata, "Casks"), { recursive: true })
    writeFileSync(join(formulaKeg, "t3code-cli-main.rb"), `class T3codeCliMain < Formula\n  version "${installedVersion}"\n  # INSTALLED_FORMULA_RECEIPT\nend\n`)
    writeFileSync(join(caskMetadata, "INSTALL_RECEIPT.json"), JSON.stringify({ source: { tap_git_head: installedTapRevision } }))
    writeFileSync(join(caskMetadata, "Casks", "t3-code-linux.rb"), `cask "t3-code-linux" do\n  version "${installedVersion}"\n  # INSTALLED_CASK_RECEIPT\nend\n`)

    writeFileSync(join(bin, "brew"), `#!/bin/bash
case "$*" in
  "--repo joshyorko/tools") printf '%s\\n' "$TAP_REPO" ;;
  "--cellar t3code-cli-main") printf '%s\\n' "$TAP_CELLAR" ;;
  "--caskroom") printf '%s\\n' "$TAP_CASKROOM" ;;
  "list --versions t3code-cli-main") printf '%s\\n' "t3code-cli-main ${installedVersion}" ;;
  "list --cask --versions t3-code-linux") printf '%s\\n' "t3-code-linux ${installedVersion}" ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 })

    const upgradeBlock = guide.match(/## Upgrade the CLI and Desktop together[\s\S]*?```bash\n([\s\S]*?)```/)?.[1]
    assert.ok(upgradeBlock, "upgrade snapshot and commands are documented")
    const result = spawnSync("bash", ["-c", upgradeBlock], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        TAP_REPO: tap,
        TAP_CELLAR: join(cellar, "t3code-cli-main"),
        TAP_CASKROOM: caskroom,
      },
    })
    assert.equal(result.status, 0, result.stderr)
    const rollbackDir = result.stdout.match(/Saved rollback definitions in ([^\n]+)/)?.[1]
    assert.ok(rollbackDir, "snapshot command prints its rollback directory")
    const savedFormula = readFileSync(join(rollbackDir, "t3code-cli-main.rb"), "utf8")
    const savedCask = readFileSync(join(rollbackDir, "t3-code-linux.rb"), "utf8")
    assert.match(savedFormula, /INSTALLED_FORMULA_RECEIPT/)
    assert.match(savedCask, /INSTALLED_TAP_CASK/)
    assert.doesNotMatch(savedFormula, /CURRENT_TAP_ONLY/)
    assert.doesNotMatch(savedCask, /CURRENT_TAP_ONLY/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("upgrade guards stop before brew update on pair or rollback snapshot errors", () => {
  const home = mkdtempSync(join(tmpdir(), "t3-homebrew-upgrade-guards-"))
  try {
    const bin = join(home, "bin")
    mkdirSync(bin)
    writeFileSync(join(bin, "brew"), `#!/bin/bash
printf 'brew %s\\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  "--repo joshyorko/tools") printf '%s\\n' "$TAP_REPO" ;;
  "--cellar t3code-cli-main") printf '%s\\n' "$TAP_CELLAR" ;;
  "--caskroom") printf '%s\\n' "$TAP_CASKROOM" ;;
  "list --versions t3code-cli-main")
    if [[ -f "$HOME/upgrade-started" ]]; then printf '%s\\n' "t3code-cli-main $POST_CLI_VERSION"; else printf '%s\\n' "t3code-cli-main $CLI_VERSION"; fi ;;
  "list --cask --versions t3-code-linux")
    if [[ -f "$HOME/upgrade-started" ]]; then printf '%s\\n' "t3-code-linux $POST_DESKTOP_VERSION"; else printf '%s\\n' "t3-code-linux $DESKTOP_VERSION"; fi ;;
  "upgrade joshyorko/tools/t3code-cli-main"|"upgrade --cask joshyorko/tools/t3-code-linux") touch "$HOME/upgrade-started" ;;
esac
exit 0
`, { mode: 0o755 })
    writeFileSync(join(bin, "git"), `#!/bin/bash
printf 'git %s\\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  *"cat-file -e "*) [[ $MISSING_CASK_REVISION != true ]] ;;
  *show*Casks/t3-code-linux.rb*) printf 'cask "t3-code-linux" do\\n  version "%s"\\nend\\n' "$DESKTOP_HISTORY_VERSION" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })
    const upgradeBlock = guide.match(/## Upgrade the CLI and Desktop together[\s\S]*?```bash\n([\s\S]*?)```/)?.[1]
    assert.ok(upgradeBlock)

    for (const scenario of [
      { cli: "main.20260101000000.111111111111", desktop: "main.20260202000000.222222222222", caskRevisionMissing: false, formulaReceiptVersion: "main.20260101000000.111111111111", historyDesktop: "main.20260101000000.111111111111", postCli: "main.20260101000000.111111111111", postDesktop: "main.20260101000000.111111111111", upgraded: false },
      { cli: "main.20260101000000.111111111111", desktop: "main.20260101000000.111111111111", caskRevisionMissing: true, formulaReceiptVersion: "main.20260101000000.111111111111", historyDesktop: "main.20260101000000.111111111111", postCli: "main.20260101000000.111111111111", postDesktop: "main.20260101000000.111111111111", upgraded: false },
      { cli: "main.20260101000000.111111111111", desktop: "main.20260101000000.111111111111", caskRevisionMissing: false, formulaReceiptVersion: "main.20260202000000.222222222222", historyDesktop: "main.20260101000000.111111111111", postCli: "main.20260101000000.111111111111", postDesktop: "main.20260101000000.111111111111", upgraded: false },
      { cli: "main.20260101000000.111111111111", desktop: "main.20260101000000.111111111111", caskRevisionMissing: false, formulaReceiptVersion: "main.20260101000000.111111111111", historyDesktop: "main.20260101000000.111111111111", postCli: "main.20260101000000.111111111111", postDesktop: "main.20260202000000.222222222222", upgraded: true },
    ]) {
      const tap = join(home, "tap")
      const tapCellar = join(home, "Cellar", "t3code-cli-main")
      const tapCaskroom = join(home, "Caskroom")
      const caskMetadata = join(tapCaskroom, "t3-code-linux", ".metadata", scenario.desktop, "20261106.123456")
      mkdirSync(join(tapCellar, scenario.cli, ".brew"), { recursive: true })
      mkdirSync(join(caskMetadata, "Casks"), { recursive: true })
      writeFileSync(join(tapCellar, scenario.cli, ".brew/t3code-cli-main.rb"), `  version "${scenario.formulaReceiptVersion}"\n`)
      writeFileSync(join(caskMetadata, "INSTALL_RECEIPT.json"), JSON.stringify({ source: { tap_git_head: "a".repeat(40) } }))

      const commandLog = join(home, "commands.log")
      const result = spawnSync("bash", ["-c", upgradeBlock], {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}:${process.env.PATH}`,
          TAP_REPO: home,
          TAP_CELLAR: tapCellar,
          TAP_CASKROOM: tapCaskroom,
          COMMAND_LOG: commandLog,
          CLI_VERSION: scenario.cli,
          DESKTOP_VERSION: scenario.desktop,
          MISSING_CASK_REVISION: String(scenario.caskRevisionMissing),
          DESKTOP_HISTORY_VERSION: scenario.historyDesktop,
          POST_CLI_VERSION: scenario.postCli,
          POST_DESKTOP_VERSION: scenario.postDesktop,
        },
      })
      const commands = readFileSync(commandLog, "utf8")
      assert.notEqual(result.status, 0, `${JSON.stringify(scenario)}\n${result.stderr}\n${commands}`)
      if (scenario.upgraded) {
        assert.match(commands, /brew update[\s\S]*brew upgrade[\s\S]*brew upgrade --cask/)
        assert.match(result.stderr, /Upgraded T3 CLI\/Desktop versions do not match/)
      } else {
        assert.doesNotMatch(commands, /brew update|brew upgrade/)
      }
      rmSync(commandLog, { force: true })
    }
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
unit_dir="$HOME/.config/systemd/user"
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
