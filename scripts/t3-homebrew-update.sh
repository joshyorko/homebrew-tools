#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly TAP="joshyorko/tools"
readonly FORMULA="t3code-cli-main"
readonly CASK="t3-code-linux"
readonly UNIT="homebrew.mxcl.t3code-cli-main.service"
readonly SERVICE_PORT="3773"

STATE_HOME="${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}"
STATE_DIR="${STATE_HOME}/t3code/homebrew-update"
SNAPSHOT_DIR="${STATE_DIR}/snapshot"
LOG_FILE="${STATE_DIR}/update.log"
BREW=""
PREFIX=""
CELLAR=""
APP_VERSION=""
TARGET_VERSION=""
READY_FILE=""
WAIT_PID=""
RESULT_WRITTEN=false
DESKTOP_LAUNCHED=false
RELAUNCH_SAFE=false
COMMAND_NAME=""
LAST_ERROR="The detached Homebrew update failed before completion."

usage() {
  cat >&2 <<'USAGE'
Usage:
  t3-homebrew-update.sh check --json --app-version VERSION
  t3-homebrew-update.sh prepare --app-version VERSION --version VERSION
  t3-homebrew-update.sh apply --app-version VERSION --version VERSION --wait-for-pid PID
USAGE
}

fail() {
  LAST_ERROR="$1"
  printf '%s\n' "$1" >&2
  exit 1
}

valid_package_version() {
  [[ "$1" =~ ^main\.[0-9]{14}\.[0-9a-f]{12}(_[0-9]+)?$ ]]
}

source_version() {
  local value="$1"
  if [[ "$value" =~ ^(main\.[0-9]{14}\.[0-9a-f]{12})(_[0-9]+)?$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '%s' "$value"
}

ensure_user_context() {
  [[ "${EUID}" -ne 0 ]] || fail "Run the T3 Homebrew updater as your desktop user, not root."
  [[ -n "${HOME:-}" && -d "$HOME" ]] || fail "The desktop user's HOME directory is unavailable."
  [[ -n "$APP_VERSION" ]] || fail "The running Desktop version was not provided."
  source_version "$APP_VERSION" >/dev/null || fail "The running Desktop version is not a recognized Homebrew build."
  if [[ -n "$TARGET_VERSION" ]]; then
    valid_package_version "$TARGET_VERSION" || fail "The requested Homebrew package version is invalid."
  fi
  if [[ -n "$WAIT_PID" && ! "$WAIT_PID" =~ ^[1-9][0-9]*$ ]]; then
    fail "The Desktop process identity is invalid."
  fi
}

ensure_state_dir() {
  case "$STATE_DIR/" in
    "$HOME/.t3/"*) fail "Updater state may not be stored inside ~/.t3." ;;
  esac
  mkdir -p -- "$STATE_DIR"
  [[ -d "$STATE_DIR" && ! -L "$STATE_DIR" ]] || fail "The updater state path is not a private directory."
  [[ "$(stat -c '%u' -- "$STATE_DIR")" == "$EUID" ]] || fail "The updater state directory is not owned by the desktop user."
  chmod 700 -- "$STATE_DIR"
  [[ ! -L "$STATE_DIR/update.lock" && ! -L "$STATE_DIR/update.log" ]] || fail "The updater state contains an unexpected symbolic link."
  : >> "$STATE_DIR/update.lock"
  : >> "$LOG_FILE"
  chmod 600 -- "$STATE_DIR/update.lock" "$LOG_FILE"
  command -v flock >/dev/null 2>&1 || fail "The flock command is required for safe Homebrew updates."
  exec {LOCK_FD}>"$STATE_DIR/update.lock"
  flock -n "$LOCK_FD" || fail "Another T3 Homebrew update is already running."
}

resolve_brew() {
  BREW="$(command -v brew || true)"
  [[ -n "$BREW" && -x "$BREW" ]] || fail "Homebrew is not available in the Desktop PATH."
  PREFIX="$("$BREW" --prefix 2>>"$LOG_FILE")" || fail "Could not determine the Homebrew prefix."
  CELLAR="$("$BREW" --cellar 2>>"$LOG_FILE")" || fail "Could not determine the Homebrew Cellar."
  CELLAR="$(realpath -e -- "$CELLAR" 2>>"$LOG_FILE")" || fail "Could not resolve the Homebrew Cellar."
  [[ -n "$PREFIX" && -n "$CELLAR" ]] || fail "Homebrew returned an incomplete installation path."
}

brew_run() {
  HOMEBREW_NO_AUTO_UPDATE=1 \
  HOMEBREW_NO_INSTALL_CLEANUP=1 \
  HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 \
  HOMEBREW_NO_ENV_HINTS=1 \
  HOMEBREW_NO_ASK=1 \
    "$BREW" "$@"
}

run_logged() {
  if "$@" >> "$LOG_FILE" 2>&1; then
    return 0
  else
    local status=$?
    return "$status"
  fi
}

ruby_parse() {
  local ruby_source="$1"
  "$BREW" ruby -rjson -e "$ruby_source"
}

formula_info() {
  local mode="$1"
  local -a mode_args=()
  local output
  [[ -z "$mode" ]] || mode_args+=("$mode")
  if ! output="$(brew_run info --json=v2 "${mode_args[@]}" --formula "$TAP/$FORMULA" 2>>"$LOG_FILE")"; then
    fail "Could not read the Homebrew formula metadata."
  fi
  printf '%s' "$output"
}

cask_info() {
  local output
  if ! output="$(brew_run info --json=v2 --cask "$TAP/$CASK" 2>>"$LOG_FILE")"; then
    fail "Could not read the Homebrew Desktop cask metadata."
  fi
  printf '%s' "$output"
}

formula_candidate_version() {
  local json="$1"
  local value
  value="$(printf '%s' "$json" | ruby_parse '
data = JSON.parse(STDIN.read)
formula = data.fetch("formulae").find { |entry| entry["name"] == "t3code-cli-main" }
raise "formula metadata missing" unless formula
raise "foreign formula tap" unless formula.fetch("tap") == "joshyorko/tools"
stable = formula.fetch("versions").fetch("stable")
revision = Integer(formula.fetch("revision", 0))
puts(revision.positive? ? "#{stable}_#{revision}" : stable)
')" || fail "Could not parse the formula version."
  valid_package_version "$value" || fail "The formula version is not a recognized paired T3 build."
  printf '%s' "$value"
}

formula_linked_version() {
  local json="$1"
  local value
  value="$(printf '%s' "$json" | ruby_parse '
data = JSON.parse(STDIN.read)
formula = data.fetch("formulae").find { |entry| entry["name"] == "t3code-cli-main" }
raise "installed formula metadata missing" unless formula
raise "foreign formula tap" unless formula.fetch("tap") == "joshyorko/tools"
linked = formula["linked_keg"]
raise "formula has no linked keg" unless linked.is_a?(String) && !linked.empty?
puts linked
')" || fail "Could not determine the linked Homebrew formula keg."
  valid_package_version "$value" || fail "The linked formula keg is not a recognized paired T3 build."
  printf '%s' "$value"
}

ensure_linked_formula_is_latest() {
  local json linked latest
  json="$(formula_info --installed)"
  linked="$(formula_linked_version "$json")"
  latest="$(printf '%s' "$json" | ruby_parse '
require "pkg_version"
data = JSON.parse(STDIN.read)
formula = data.fetch("formulae").find { |entry| entry["name"] == "t3code-cli-main" }
raise "installed formula metadata missing" unless formula
versions = formula.fetch("installed").map { |entry| PkgVersion.parse(entry.fetch("version")) }
raise "installed formula versions missing" if versions.empty?
puts versions.max
')" || fail "Could not determine the newest installed formula keg."
  [[ "$linked" == "$latest" ]] || fail "The linked T3 CLI keg is not the newest installed keg; refusing an update that cannot be rolled back safely."
}

cask_candidate_version() {
  local json="$1"
  local value
  value="$(printf '%s' "$json" | ruby_parse '
data = JSON.parse(STDIN.read)
cask = data.fetch("casks").find { |entry| entry["token"] == "t3-code-linux" }
raise "cask metadata missing" unless cask
raise "foreign cask tap" unless cask.fetch("tap") == "joshyorko/tools"
puts cask.fetch("version")
')" || fail "Could not parse the Desktop cask version."
  valid_package_version "$value" || fail "The cask version is not a recognized paired T3 build."
  printf '%s' "$value"
}

cask_receipt_path() {
  printf '%s' "$PREFIX/Caskroom/$CASK/.metadata/INSTALL_RECEIPT.json"
}

read_cask_receipt() {
  local receipt
  local json
  receipt="$(cask_receipt_path)"
  [[ -f "$receipt" && ! -L "$receipt" ]] || fail "The installed Desktop cask receipt is missing."
  json="$(cat -- "$receipt")" || fail "Could not read the installed Desktop cask receipt."
  printf '%s' "$json" | ruby_parse '
data = JSON.parse(STDIN.read)
source = data.fetch("source")
raise "foreign installed tap" unless source.fetch("tap") == "joshyorko/tools"
version = source.fetch("version")
raise "invalid cask version" unless version.is_a?(String)
puts version
'
}

installed_pair() {
  local formula_json formula_version cask_version
  formula_json="$(formula_info --installed)"
  formula_version="$(formula_linked_version "$formula_json")"
  local formula_receipt="$CELLAR/$FORMULA/$formula_version/INSTALL_RECEIPT.json"
  [[ -f "$formula_receipt" ]] || fail "The installed formula receipt is missing."
  ruby_parse 'data = JSON.parse(STDIN.read); raise "foreign installed formula tap" unless data.fetch("source").fetch("tap") == "joshyorko/tools"' < "$formula_receipt" || fail "The installed formula is not owned by the expected tap."
  cask_version="$(read_cask_receipt)"
  valid_package_version "$cask_version" || fail "The installed cask version is not a recognized paired T3 build."
  [[ "$formula_version" == "$cask_version" ]] || fail "The installed T3 CLI and Desktop package versions do not match."
  printf '%s\t%s' "$formula_version" "$cask_version"
}

candidate_pair() {
  local formula_json cask_json formula_version cask_version
  formula_json="$(formula_info "")"
  cask_json="$(cask_info)"
  formula_version="$(formula_candidate_version "$formula_json")"
  cask_version="$(cask_candidate_version "$cask_json")"
  [[ "$formula_version" == "$cask_version" ]] || fail "The current Homebrew CLI and Desktop candidates do not match; no packages were changed."
  printf '%s' "$formula_version"
}

snapshot_metadata() {
  local metadata="$SNAPSHOT_DIR/metadata"
  [[ -f "$metadata" && ! -L "$metadata" ]] || fail "A safe rollback snapshot is unavailable; run the Desktop update check again."
  cat -- "$metadata"
}

snapshot_value() {
  local key="$1"
  local json
  json="$(snapshot_metadata)"
  printf '%s' "$json" | ruby_parse "
data = JSON.parse(STDIN.read)
value = data.fetch(\"$key\")
puts value
"
}

safe_remove_snapshot() {
  if [[ -e "$SNAPSHOT_DIR" || -L "$SNAPSHOT_DIR" ]]; then
    [[ -d "$SNAPSHOT_DIR" && ! -L "$SNAPSHOT_DIR" ]] || fail "The rollback snapshot path is not a directory."
    [[ -f "$SNAPSHOT_DIR/.t3-homebrew-update-snapshot" ]] || fail "The rollback snapshot is not owned by this updater."
    rm -rf -- "$SNAPSHOT_DIR"
  fi
}

capture_snapshot() {
  local installed installed_version current_cask temp_dir
  ensure_linked_formula_is_latest
  installed="$(installed_pair)"
  IFS=$'\t' read -r installed_version current_cask <<< "$installed"
  [[ "$(source_version "$current_cask")" == "$APP_VERSION" ]] || fail "The running Desktop does not match the installed Homebrew cask. Close and relaunch the installed cask before updating."
  temp_dir="$(mktemp -d "$STATE_DIR/.snapshot.XXXXXX")"
  printf '%s\n' 't3-homebrew-update-snapshot-v1' > "$temp_dir/.t3-homebrew-update-snapshot"
  printf '{"currentVersion":"%s","appVersion":"%s"}\n' \
    "$installed_version" "$APP_VERSION" > "$temp_dir/metadata"
  chmod 600 -- "$temp_dir/.t3-homebrew-update-snapshot" "$temp_dir/metadata"
  chmod 700 -- "$temp_dir"
  safe_remove_snapshot
  mv -- "$temp_dir" "$SNAPSHOT_DIR"
}

verify_snapshot() {
  [[ -d "$SNAPSHOT_DIR" && ! -L "$SNAPSHOT_DIR" && -f "$SNAPSHOT_DIR/.t3-homebrew-update-snapshot" ]] || fail "A safe rollback snapshot is unavailable; run the Desktop update check again."
  [[ "$(snapshot_value currentVersion)" == "$(installed_pair | cut -f1)" ]] || fail "The installed T3 pair changed after the update check; check for updates again."
  [[ "$(snapshot_value appVersion)" == "$APP_VERSION" ]] || fail "The running Desktop version changed after the update check."
  ensure_linked_formula_is_latest
}

source_commit() {
  local base="$1"
  base="$(source_version "$base")" || return 1
  printf '%s' "${base##*.}"
}

paired_result() {
  local status="$1" current="$2" available="$3"
  local commit
  commit="$(source_commit "$available")" || fail "Could not identify the paired T3 source commit."
  printf '{"status":"%s","currentVersion":"%s","availableVersion":"%s","source":"%s","sourceCommit":"%s","formula":"%s","cask":"%s"}\n' \
    "$status" "$current" "$available" "$TAP" "$commit" "$available" "$available"
}

check_for_update() {
  local installed installed_version current_cask candidate current_base
  installed="$(installed_pair)"
  IFS=$'\t' read -r installed_version current_cask <<< "$installed"
  current_base="$(source_version "$current_cask")" || fail "The installed cask version is invalid."
  [[ "$current_base" == "$APP_VERSION" ]] || fail "The running Desktop does not match the installed Homebrew cask. Close and relaunch the installed cask before updating."
  capture_snapshot
  if ! run_logged "$BREW" update --quiet; then
    safe_remove_snapshot
    fail "Homebrew could not refresh the tap. Check the update log and retry."
  fi
  candidate="$(candidate_pair)"
  if [[ "$candidate" == "$installed_version" ]]; then
    safe_remove_snapshot
    paired_result "current" "$installed_version" "$candidate"
    return 0
  fi
  paired_result "available" "$installed_version" "$candidate"
}

prepare_update() {
  local installed candidate
  verify_snapshot
  installed="$(snapshot_value currentVersion)"
  candidate="$(candidate_pair)"
  [[ "$candidate" == "$TARGET_VERSION" ]] || fail "The tap package pair changed after the update check; check for updates again."
  [[ "$candidate" != "$installed" ]] || fail "The Homebrew T3 package pair is already current."
  if ! brew_run fetch --formula "$TAP/$FORMULA" >> "$LOG_FILE" 2>&1; then
    fail "Homebrew could not fetch the matching T3 CLI artifact."
  fi
  if ! brew_run fetch --cask "$TAP/$CASK" >> "$LOG_FILE" 2>&1; then
    fail "Homebrew could not fetch the matching T3 Desktop artifact."
  fi
  paired_result "prepared" "$installed" "$candidate"
}

service_active() {
  local status
  if systemctl --user is-active --quiet "$UNIT" >> "$LOG_FILE" 2>&1; then
    return 0
  else
    status=$?
  fi
  case "$status" in
    3|4) return 1 ;;
    *) return 2 ;;
  esac
}

port_is_clear() {
  local listeners
  command -v ss >/dev/null 2>&1 || return 2
  if ! listeners="$(ss -H -ltn "sport = :$SERVICE_PORT" 2>>"$LOG_FILE")"; then
    return 2
  fi
  [[ -z "$listeners" ]] || return 1
  return 0
}

wait_for_desktop_exit() {
  local attempt installed_cask_version
  for ((attempt = 0; attempt < 120; attempt++)); do
    if ! kill -0 "$WAIT_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if kill -0 "$WAIT_PID" 2>/dev/null; then
    fail "The Desktop process did not exit; Homebrew packages were not changed."
  fi
  installed_cask_version="$(read_cask_receipt)" || fail "The installed Desktop cask receipt is unavailable after Desktop exit."
  if command -v pgrep >/dev/null 2>&1; then
    for ((attempt = 0; attempt < 30; attempt++)); do
      if ! pgrep -u "$EUID" -f "$PREFIX/Caskroom/$CASK/$installed_cask_version/" >/dev/null 2>&1; then
        return 0
      fi
      sleep 1
    done
    fail "A T3 Desktop child process is still using the installed AppImage."
  else
    fail "The pgrep command is required to verify that the Desktop AppImage has exited."
  fi
}

write_result() {
  local status="$1"
  local message="$2"
  local version="$3"
  local temp_file
  temp_file="$(mktemp "$STATE_DIR/.result.XXXXXX")"
  printf '{"outcome":"%s","version":"%s","message":"%s"}\n' \
    "$(json_escape "$status")" "$(json_escape "$version")" "$(json_escape "$message")" > "$temp_file"
  chmod 600 -- "$temp_file"
  mv -f -- "$temp_file" "$STATE_DIR/result.json"
  RESULT_WRITTEN=true
}

launch_desktop() {
  local launcher="$PREFIX/bin/t3-code-linux"
  [[ -x "$launcher" ]] || return 1
  ( exec {LOCK_FD}>&-; exec nohup "$launcher" >> "$LOG_FILE" 2>&1 < /dev/null ) &
  DESKTOP_LAUNCHED=true
  return 0
}

restore_service() {
  local was_active="$1"
  [[ "$was_active" == true ]] || return 0
  systemctl --user daemon-reload >> "$LOG_FILE" 2>&1 || return 1
  systemctl --user start "$UNIT" >> "$LOG_FILE" 2>&1 || return 1
  systemctl --user is-active --quiet "$UNIT" >> "$LOG_FILE" 2>&1
}

rollback_pair() {
  local prior_version current_formula current_cask formula_json
  prior_version="$(snapshot_value currentVersion)"
  formula_json="$(formula_info --installed)" || return 1
  current_formula="$(formula_linked_version "$formula_json")" || return 1
  current_cask="$(read_cask_receipt)" || return 1
  [[ "$current_cask" == "$prior_version" ]] || return 1
  if [[ "$current_formula" != "$prior_version" ]]; then
    if ! brew_run uninstall --formula --ignore-dependencies "$TAP/$FORMULA" >> "$LOG_FILE" 2>&1; then return 1; fi
    if ! brew_run link --overwrite "$TAP/$FORMULA" >> "$LOG_FILE" 2>&1; then return 1; fi
  fi
  formula_json="$(formula_info --installed)" || return 1
  current_formula="$(formula_linked_version "$formula_json")" || return 1
  current_cask="$(read_cask_receipt)" || return 1
  [[ "$current_formula" == "$prior_version" && "$current_cask" == "$prior_version" ]]
}

apply_update() {
  local installed candidate service_was_active=false package_attempted=false
  local update_ok=true rollback_ok=false service_restore_ok=false service_status pair_updated=false
  verify_snapshot
  installed="$(installed_pair | cut -f1)"
  candidate="$(candidate_pair)"
  [[ "$candidate" == "$TARGET_VERSION" ]] || {
    write_result "failed" "The tap package pair changed before installation; no packages were updated." "$installed"
    launch_desktop || true
    fail "The tap package pair changed before installation; check for updates again."
  }
  [[ "$installed" != "$TARGET_VERSION" ]] || {
    write_result "installed" "The Homebrew CLI and Desktop are already at the requested version." "$installed"
    safe_remove_snapshot
    launch_desktop || fail "The T3 packages are current, but the Desktop launcher could not be started."
    return 0
  }
  if service_active; then
    service_was_active=true
  else
    service_status=$?
    if [[ "$service_status" -ne 1 ]]; then
      write_result "failed" "Could not determine the Homebrew service state; no packages were changed." "$installed"
      launch_desktop || true
      fail "Could not determine the Homebrew service state; no packages were changed."
    fi
  fi
  RELAUNCH_SAFE=false
  if [[ "$service_was_active" == true ]]; then
    if ! systemctl --user stop "$UNIT" >> "$LOG_FILE" 2>&1; then
      if restore_service true; then
        write_result "failed" "Homebrew could not stop its T3 service; no packages were changed." "$installed"
        launch_desktop || true
      else
        write_result "failed" "Homebrew could not stop or restore its T3 service; no packages were changed. Review the update log." "$installed"
      fi
      fail "Homebrew could not stop its T3 service; no packages were changed."
    fi
    if service_active; then
      write_result "failed" "Homebrew could not stop its T3 service; no packages were changed." "$installed"
      fail "Homebrew T3 service remained active after stop; no packages were changed."
    else
      service_status=$?
      if [[ "$service_status" -ne 1 ]]; then
        write_result "failed" "Could not verify that the Homebrew T3 service stopped; no packages were changed." "$installed"
        fail "Could not verify that the Homebrew T3 service stopped; no packages were changed."
      fi
    fi
  fi
  if ! port_is_clear; then
    write_result "failed" "Could not prove port $SERVICE_PORT is free after stopping the Homebrew T3 service. No packages were changed; the service was left stopped." "$installed"
    fail "Could not prove port $SERVICE_PORT is free; no packages were changed and the service was left stopped."
  fi
  package_attempted=true
  if ! brew_run upgrade --formula --no-ask "$TAP/$FORMULA" >> "$LOG_FILE" 2>&1; then update_ok=false; fi
  if [[ "$update_ok" == true ]] && [[ "$(formula_linked_version "$(formula_info --installed)")" != "$TARGET_VERSION" ]]; then update_ok=false; fi
  if [[ "$update_ok" == true ]] && [[ "$(candidate_pair)" != "$TARGET_VERSION" ]]; then update_ok=false; fi
  if [[ "$update_ok" == true ]] && ! brew_run upgrade --cask --no-ask --no-quit "$TAP/$CASK" >> "$LOG_FILE" 2>&1; then update_ok=false; fi
  if [[ "$update_ok" == true ]] && [[ "$(installed_pair | cut -f1)" != "$TARGET_VERSION" ]]; then update_ok=false; fi

  if [[ "$update_ok" == true ]]; then pair_updated=true; fi

  if [[ "$pair_updated" == true ]]; then
    service_restore_ok=true
    if ! systemctl --user daemon-reload >> "$LOG_FILE" 2>&1; then service_restore_ok=false; fi
    if [[ "$service_restore_ok" == true && "$service_was_active" == true ]]; then
      if ! systemctl --user start "$UNIT" >> "$LOG_FILE" 2>&1; then service_restore_ok=false
      elif ! service_active; then service_restore_ok=false
      fi
    fi
    if [[ "$service_restore_ok" != true ]]; then
      write_result "failed" "Both Homebrew packages were installed at the matching version, but the Homebrew service could not be confirmed in its prior state. Review the update log before reconnecting." "$TARGET_VERSION"
      safe_remove_snapshot
      launch_desktop || fail "Both packages are paired, but service recovery failed and the Desktop launcher could not be started."
      fail "Both packages are paired, but Homebrew service recovery failed."
    fi
    if [[ "$service_was_active" == true ]]; then
      write_result "installed" "T3 Desktop and CLI were updated together from Homebrew tap $TAP. The Homebrew service was restarted after the update." "$TARGET_VERSION"
    else
      write_result "installed" "T3 Desktop and CLI were updated together from Homebrew tap $TAP. The Homebrew service remained stopped because it was inactive before the update." "$TARGET_VERSION"
    fi
    safe_remove_snapshot
    launch_desktop || fail "The T3 packages were updated, but the Desktop launcher could not be started."
    return 0
  fi

  if [[ "$package_attempted" == true ]] && rollback_pair; then rollback_ok=true; fi
  if [[ "$rollback_ok" == true ]]; then
    if restore_service "$service_was_active"; then service_restore_ok=true; fi
    if [[ "$service_restore_ok" == true ]]; then
      write_result "failed" "The paired Homebrew update failed. Homebrew restored the previous Desktop package, the previous CLI keg was relinked, and the prior service state was restored." "$(snapshot_value currentVersion)"
    else
      write_result "failed" "The paired Homebrew update failed. Homebrew restored the previous Desktop package and CLI keg, but the Homebrew service could not be restarted. Review the update log." "$(snapshot_value currentVersion)"
    fi
    safe_remove_snapshot
    launch_desktop || fail "The previous T3 versions were restored, but the Desktop launcher could not be started."
    fail "The paired Homebrew update failed and the previous package pair was restored."
  fi

  write_result "failed" "The paired Homebrew update failed and automatic recovery could not verify the previous pair. The Homebrew service was left stopped; inspect the update log before reconnecting." "$installed"
  fail "The paired Homebrew update failed and automatic recovery could not verify the previous pair. The service was left stopped."
}

parse_arguments() {
  local command_name="$1"
  shift
  while (($#)); do
    case "$1" in
      --app-version)
        [[ $# -ge 2 ]] || fail "--app-version requires a value."
        APP_VERSION="$2"
        shift 2
        ;;
      --version)
        [[ $# -ge 2 ]] || fail "--version requires a value."
        TARGET_VERSION="$2"
        shift 2
        ;;
      --wait-for-pid)
        [[ $# -ge 2 ]] || fail "--wait-for-pid requires a value."
        WAIT_PID="$2"
        shift 2
        ;;
      --ready-file)
        [[ $# -ge 2 && "$command_name" == apply ]] || fail "Invalid readiness handoff."
        READY_FILE="$2"
        shift 2
        ;;
      --json)
        [[ "$command_name" == check ]] || fail "--json is supported only by check."
        shift
        ;;
      *) usage; exit 2 ;;
    esac
  done
  [[ -n "$APP_VERSION" ]] || fail "--app-version is required."
  if [[ "$command_name" == check ]]; then
    [[ -z "$TARGET_VERSION" && -z "$WAIT_PID" ]] || fail "check does not accept an install version or process ID."
  else
    [[ -n "$TARGET_VERSION" ]] || fail "--version is required."
  fi
  if [[ "$command_name" == apply ]]; then
    [[ -n "$WAIT_PID" ]] || fail "--wait-for-pid is required."
  else
    [[ -z "$WAIT_PID" ]] || fail "--wait-for-pid is supported only by apply."
  fi
}

main() {
  local command_name="${1:-}"
  COMMAND_NAME="$command_name"
  [[ "$command_name" =~ ^(check|prepare|apply)$ ]] || { usage; exit 2; }
  parse_arguments "$@"
  ensure_user_context
  ensure_state_dir
  resolve_brew
  case "$command_name" in
    check)
      check_for_update
      ;;
    prepare)
      prepare_update
      ;;
    apply)
      verify_snapshot
      if [[ -n "$READY_FILE" ]]; then printf ready > "$READY_FILE"; fi
      wait_for_desktop_exit
      RELAUNCH_SAFE=true
      apply_update
      ;;
  esac
}

handoff_exit() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$COMMAND_NAME" == apply && -d "$STATE_DIR" && -n "$PREFIX" ]]; then
    if [[ "$RESULT_WRITTEN" != true ]]; then write_result failed "$LAST_ERROR" "$APP_VERSION" || true; fi
    if [[ "$RELAUNCH_SAFE" == true && "$DESKTOP_LAUNCHED" != true ]] && installed_pair >/dev/null 2>&1; then launch_desktop || true; fi
  fi
  exit "$status"
}
trap handoff_exit EXIT
main "$@"
