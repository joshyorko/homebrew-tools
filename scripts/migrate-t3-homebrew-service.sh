#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: migrate-t3-homebrew-service.sh [--apply]

Without --apply, inspect the named legacy T3 user services and print the planned
switch. With --apply, serialize the migration, temporarily mask the named legacy
units, then start the Homebrew-owned t3code-cli-main service. Legacy unit files
and ~/.t3 are preserved.
EOF
}

apply=false
case "${1:-}" in
  "") ;;
  --apply) apply=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

if [[ "$(uname -s)" != Linux ]]; then
  echo "T3 Homebrew service migration requires Linux with a systemd user manager." >&2
  exit 1
fi

for command in brew systemctl; do
  command -v "$command" >/dev/null || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

systemctl --user show-environment >/dev/null || {
  echo "The systemd user manager is unavailable; no service was changed." >&2
  exit 1
}

if $apply; then
  umask 077
  for command in flock pgrep; do
    command -v "$command" >/dev/null || {
      echo "Required command not found: $command; no service was changed." >&2
      exit 1
    }
  done

  lock_dir="${XDG_RUNTIME_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}}"
  if [[ ! -d "$lock_dir" ]]; then
    mkdir -p "$lock_dir"
    chmod 700 "$lock_dir"
  fi
  if [[ ! -O "$lock_dir" || ! -w "$lock_dir" ]]; then
    echo "The migration lock directory must be writable and owned by this user: $lock_dir" >&2
    exit 1
  fi
  exec 9>"$lock_dir/t3code-homebrew-service-migration.lock"
  flock -n 9 || {
    echo "Another T3 Homebrew migration is running; no service was changed." >&2
    exit 1
  }

  brew list --formula t3code-cli-main >/dev/null || {
    echo "Install the t3code-cli-main formula before migrating; no service was changed." >&2
    exit 1
  }
fi

legacy_units=(t3code-homebrew.service t3code.service)
active_units=()
enabled_units=()
units_to_mask=()
backup_dir="${XDG_STATE_HOME:-$HOME/.local/state}/t3code-homebrew-service-migration/legacy"
same_unit_file() {
  local current="$1" backup="$2"
  if [[ -L "$current" && -L "$backup" ]]; then
    [[ "$(readlink "$current")" == "$(readlink "$backup")" ]]
  else
    [[ -f "$current" && -f "$backup" ]] && cmp -s -- "$current" "$backup"
  fi
}
declare -A unit_fragment_paths=()
declare -A unit_backup_paths=()
declare -A unit_active_state=()
declare -A unit_enabled_state=()
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
target_units=(
  sh.brew.t3code-cli-main.service
  homebrew.t3code-cli-main.service
  homebrew.mxcl.t3code-cli-main.service
)
unit_active=false
unit_enabled=false
probe_unit_state() {
  local unit="$1" load_state active_state unit_file_state
  if ! load_state="$(systemctl --user show "$unit" --property=LoadState --value)"; then
    return 1
  fi
  if [[ "$load_state" == not-found ]]; then
    unit_active=false
    unit_enabled=false
    return 0
  fi
  case "$load_state" in
    loaded|masked|merged) ;;
    *) return 1 ;;
  esac

  if ! active_state="$(systemctl --user show "$unit" --property=ActiveState --value)"; then
    return 1
  fi
  case "$active_state" in
    active|activating|reloading|deactivating|maintenance) unit_active=true ;;
    inactive|failed) unit_active=false ;;
    *) return 1 ;;
  esac

  if ! unit_file_state="$(systemctl --user show "$unit" --property=UnitFileState --value)"; then
    return 1
  fi
  case "$unit_file_state" in
    enabled|enabled-runtime|linked|linked-runtime|linked-overwrite|alias|static|indirect|generated|transient)
      unit_enabled=true
      ;;
    masked-runtime)
      # A lower-priority runtime mask does not override a loaded unit in ~/.config.
      unit_enabled=true
      ;;
    disabled|masked|not-found|bad)
      unit_enabled=false
      ;;
    *) return 1 ;;
  esac
  return 0
}
target_active_now=false
target_enabled_now=false
target_probe_ok=true
probe_target_services() {
  local unit
  target_active_now=false
  target_enabled_now=false
  target_probe_ok=true
  for unit in "${target_units[@]}"; do
    if ! probe_unit_state "$unit"; then
      target_probe_ok=false
      return
    fi
    $unit_active && target_active_now=true
    $unit_enabled && target_enabled_now=true
  done
  return 0
}
probe_target_services
if ! $target_probe_ok; then
  echo "Could not determine Homebrew T3 service state; no service was changed." >&2
  exit 1
fi
target_was_active="$target_active_now"
target_was_enabled="$target_enabled_now"

for unit in "${legacy_units[@]}"; do
  if ! probe_unit_state "$unit"; then
    echo "Could not determine systemd state for $unit; no service was changed." >&2
    exit 1
  fi
  is_active="$unit_active"
  is_enabled="$unit_enabled"
  if ! $is_active && ! $is_enabled; then
    continue
  fi

  fragment="$(systemctl --user show "$unit" --property=FragmentPath --value)"
  case "$fragment" in
    "$config_home/systemd/user/$unit"|"$HOME/.local/share/systemd/user/$unit") ;;
    *)
      echo "Refusing to change $unit because its unit file is outside this user's unit directories: $fragment" >&2
      exit 1
      ;;
  esac

  exec_start="$(systemctl --user show "$unit" --property=ExecStart --value)"
  if [[ ! "$exec_start" =~ (^|[[:space:]/])t3[[:space:]]+(serve|__service-launcher)([[:space:]]|$) ]]; then
    echo "Refusing to change $unit because ExecStart is not a recognized T3 server; no service was changed." >&2
    exit 1
  fi

  $is_active && active_units+=("$unit")
  $is_enabled && enabled_units+=("$unit")
  units_to_mask+=("$unit")
  unit_fragment_paths["$unit"]="$fragment"
  unit_backup_paths["$unit"]="$backup_dir/$unit"
  unit_active_state["$unit"]="$is_active"
  unit_enabled_state["$unit"]="$is_enabled"
done

if ((${#units_to_mask[@]} > 0)) && $target_was_active; then
  echo "A Homebrew T3 service is already active beside a legacy T3 unit; inspect and stop the competing server before migrating." >&2
  exit 1
fi
if ((${#units_to_mask[@]} > 0)) && $target_was_enabled; then
  echo "A Homebrew T3 service is already enabled beside a legacy T3 unit; inspect both service definitions before migrating." >&2
  exit 1
fi
if ((${#active_units[@]} > 1)); then
  echo "Both legacy T3 services are active; choose the single service to keep before migrating." >&2
  exit 1
fi

if ! $apply; then
  printf 'Legacy units to stop: %s\n' "${active_units[*]:-none}"
  printf 'Legacy units to preserve and mask in place: %s\n' "${units_to_mask[*]:-none}"
  printf '%s\n' "Next: brew services start t3code-cli-main"
  printf '%s\n' "Review this plan, then rerun with --apply to perform it."
  exit 0
fi

if ((${#units_to_mask[@]} > 0)); then
  if [[ ! -d "$backup_dir" ]]; then
    mkdir -p "$backup_dir"
    chmod 700 "$backup_dir"
  fi
  if [[ ! -O "$backup_dir" || ! -w "$backup_dir" ]]; then
    echo "The legacy-unit backup directory must be writable and owned by this user: $backup_dir" >&2
    exit 1
  fi
  for unit in "${units_to_mask[@]}"; do
    backup="${unit_backup_paths[$unit]}"
    if [[ -e "$backup" || -L "$backup" ]]; then
      if [[ -f "$backup.path" && "$(cat "$backup.path")" == "${unit_fragment_paths[$unit]}" ]] && same_unit_file "${unit_fragment_paths[$unit]}" "$backup"; then
        continue
      fi
      echo "A prior legacy-unit backup exists for $unit and does not match the current unit; inspect it before migrating again." >&2
      exit 1
    elif [[ -e "$backup.path" || -e "$backup.state" ]]; then
      echo "An incomplete prior legacy-unit backup exists for $unit; inspect it before migrating again." >&2
      exit 1
    fi
  done
fi

changed=false
port_conflict=false
server_conflict=false
homebrew_start_attempted=false
restore_legacy_services() {
  result=$?
  trap - EXIT
  if [[ "$result" -eq 0 || "$changed" != true ]]; then
    exit "$result"
  fi

  probe_target_services
  if ! $target_probe_ok; then
    echo "Could not verify Homebrew service state during recovery; legacy unit files remain preserved." >&2
    exit "$result"
  fi
  if $homebrew_start_attempted && ! $target_was_active && ! $target_was_enabled && { $target_active_now || $target_enabled_now; }; then
    echo "Homebrew partially registered; stopping and disabling it before restoring the previous service." >&2
    if ! brew services stop t3code-cli-main; then
      echo "Could not stop the partially-started Homebrew service. Legacy services remain stopped to prevent a port conflict." >&2
      exit "$result"
    fi
  fi
  probe_target_services
  if ! $target_probe_ok || $target_active_now || $target_enabled_now; then
    echo "Homebrew service remains active or enabled; legacy services remain stopped to prevent a competing server." >&2
    exit "$result"
  fi

  if $port_conflict || $server_conflict; then
    echo "Another server or listener remains; legacy units remain stopped and masked until it is identified." >&2
    exit "$result"
  fi

  legacy_still_active=false
  for unit in "${active_units[@]}"; do
    if ! probe_unit_state "$unit"; then
      echo "Could not determine whether $unit is still active; leaving its original unit preserved." >&2
      exit "$result"
    fi
    $unit_active && legacy_still_active=true
  done
  if $legacy_still_active && ! $homebrew_start_attempted; then
    echo "Restoring legacy unit files; the prior service is still active and will not be restarted." >&2
    restore_legacy_unit_files
    exit "$result"
  fi

  if pgrep -u "$UID" -f '(^|[ /])t3[[:space:]]+(serve|__service-launcher)([[:space:]]|$)|t3code-cli-main|@t3tools/cli' >/dev/null 2>&1; then
    echo "Another T3 server is still running; legacy units remain stopped and masked." >&2
    exit "$result"
  else
    process_status=$?
    if [[ "$process_status" -ne 1 ]]; then
      echo "Could not verify T3 server processes; legacy units remain stopped and masked." >&2
      exit "$result"
    fi
  fi

  listeners="$(ss -H -ltn 'sport = :3773')" || {
    echo "Could not check port 3773; legacy units remain stopped and masked." >&2
    exit "$result"
  }
  if [[ -n "$listeners" ]]; then
    echo "A listener remains on port 3773; legacy units remain stopped and masked until the listener is identified." >&2
    exit "$result"
  fi

  echo "Homebrew service activation failed; restoring the previous legacy service states." >&2
  restore_legacy_unit_files
  for unit in "${active_units[@]}"; do
    systemctl --user start "$unit" || echo "Could not restart $unit; see systemctl --user status $unit." >&2
  done
  exit "$result"
}

restore_legacy_unit_files() {
  local unit fragment backup restore_temp
  for unit in "${units_to_mask[@]}"; do
    fragment="${unit_fragment_paths[$unit]}"
    backup="${unit_backup_paths[$unit]}"
    if [[ ! -e "$backup" && ! -L "$backup" ]]; then
      continue
    fi

    if [[ -L "$fragment" && "$(readlink "$fragment")" == /dev/null ]]; then
      restore_temp="${fragment}.restore.$$"
      ln -P -- "$backup" "$restore_temp" || return 1
      mv -Tf -- "$restore_temp" "$fragment" || return 1
    elif [[ -L "$fragment" && -L "$backup" && "$(readlink "$fragment")" == "$(readlink "$backup")" ]]; then
      :
    elif [[ -f "$fragment" && -f "$backup" ]] && cmp -s -- "$fragment" "$backup"; then
      :
    elif [[ ! -e "$fragment" && ! -L "$fragment" ]]; then
      restore_temp="${fragment}.restore.$$"
      ln -P -- "$backup" "$restore_temp" || return 1
      mv -Tf -- "$restore_temp" "$fragment" || return 1
    else
      echo "Refusing to overwrite a changed unit file at $fragment." >&2
      return 1
    fi

    rm -f -- "$backup" "$backup.path" "$backup.state"
  done
  systemctl --user daemon-reload
}
trap restore_legacy_services EXIT

for unit in "${units_to_mask[@]}"; do
  changed=true
  fragment="${unit_fragment_paths[$unit]}"
  backup="${unit_backup_paths[$unit]}"
  if [[ ! -e "$backup" && ! -L "$backup" ]]; then
    ln -P -- "$fragment" "$backup"
  fi
  printf '%s\n' "$fragment" > "$backup.path"
  printf 'active=%s\nenabled=%s\n' "${unit_active_state[$unit]}" "${unit_enabled_state[$unit]}" > "$backup.state"
  mask_temp="${fragment}.mask.$$"
  if [[ -e "$mask_temp" || -L "$mask_temp" ]]; then
    echo "Temporary unit-mask path already exists: $mask_temp" >&2
    exit 1
  fi
  ln -s /dev/null "$mask_temp"
  mv -Tf -- "$mask_temp" "$fragment"
done
systemctl --user daemon-reload
for unit in "${active_units[@]}"; do
  changed=true
  systemctl --user stop "$unit"
done

if ! $target_was_active; then
  command -v ss >/dev/null || {
    echo "Required command not found: ss; no Homebrew service was started." >&2
    exit 1
  }
  if pgrep -u "$UID" -f '(^|[ /])t3[[:space:]]+(serve|__service-launcher)([[:space:]]|$)|t3code-cli-main|@t3tools/cli' >/dev/null 2>&1; then
    server_conflict=true
    echo "Another T3 server is still running, possibly on a non-default port; no second server was started." >&2
    exit 1
  else
    process_status=$?
    if [[ "$process_status" -ne 1 ]]; then
      server_conflict=true
      echo "Could not verify T3 server processes; no second server was started." >&2
      exit 1
    fi
  fi

  listeners="$(ss -H -ltn 'sport = :3773')" || {
    server_conflict=true
    echo "Could not check port 3773; no second server was started." >&2
    exit 1
  }
  if [[ -n "$listeners" ]]; then
    port_conflict=true
    echo "A process still listens on T3's default port 3773; no second server was started." >&2
    exit 1
  fi
fi

changed=true
homebrew_start_attempted=true
brew services start t3code-cli-main
probe_target_services
if ! $target_probe_ok || ! $target_active_now; then
  echo "Homebrew services reported success without an active T3 service." >&2
  exit 1
fi
changed=false
trap - EXIT
if ((${#units_to_mask[@]} > 0)); then
  echo "Homebrew now owns the T3 Code server lifecycle. Original legacy units are saved under $backup_dir and masked at their original paths; ~/.t3 data was not changed."
else
  echo "Homebrew now owns the T3 Code server lifecycle. No legacy unit needed migration; ~/.t3 data was not changed."
fi
