#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: migrate-t3-homebrew-service.sh [--apply]

Without --apply, inspect the named legacy T3 user services and print the planned
switch. With --apply, stop and disable those services before starting the
Homebrew-owned t3code-cli-main service. Legacy unit files and ~/.t3 are preserved.
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
  brew list --formula t3code-cli-main >/dev/null || {
    echo "Install the t3code-cli-main formula before migrating; no service was changed." >&2
    exit 1
  }
fi

legacy_units=(t3code-homebrew.service t3code.service)
active_units=()
enabled_units=()
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
target_units=(
  sh.brew.t3code-cli-main.service
  homebrew.t3code-cli-main.service
  homebrew.mxcl.t3code-cli-main.service
)
target_is_active() {
  local unit
  for unit in "${target_units[@]}"; do
    systemctl --user is-active --quiet "$unit" && return 0
  done
  return 1
}
target_was_active=false
target_is_active && target_was_active=true

for unit in "${legacy_units[@]}"; do
  is_active=false
  is_enabled=false
  systemctl --user is-active --quiet "$unit" && is_active=true
  systemctl --user is-enabled --quiet "$unit" && is_enabled=true
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
    echo "Refusing to change $unit because ExecStart is not a recognized T3 server: $exec_start" >&2
    exit 1
  fi

  $is_active && active_units+=("$unit")
  $is_enabled && enabled_units+=("$unit")
done

if $target_was_active && ((${#active_units[@]} > 0)); then
  echo "The Homebrew service and a legacy T3 service are both active; stop the competing server manually before migrating." >&2
  exit 1
fi
if ((${#active_units[@]} > 1)); then
  echo "Both legacy T3 services are active; choose the single service to keep before migrating." >&2
  exit 1
fi

if ! $apply; then
  printf 'Legacy units to stop: %s\n' "${active_units[*]:-none}"
  printf 'Legacy units to disable: %s\n' "${enabled_units[*]:-none}"
  printf '%s\n' "Next: brew services start t3code-cli-main"
  printf '%s\n' "Review this plan, then rerun with --apply to perform it."
  exit 0
fi

changed=false
port_conflict=false
restore_legacy_services() {
  result=$?
  trap - EXIT
  if [[ "$result" -eq 0 || "$changed" != true ]]; then
    exit "$result"
  fi

  if ! $target_was_active && target_is_active; then
    echo "Homebrew partially started; stopping it before restoring the previous service." >&2
    if ! brew services stop t3code-cli-main; then
      echo "Could not stop the partially-started Homebrew service. Legacy services remain stopped to prevent a port conflict." >&2
      exit "$result"
    fi
  fi
  if target_is_active; then
    echo "Homebrew service is still active; legacy services remain stopped to prevent a port conflict." >&2
    exit "$result"
  fi

  if $port_conflict; then
    echo "A listener remains on port 3773; legacy services remain stopped and disabled until the listener is identified." >&2
    exit "$result"
  fi
  listeners="$(ss -H -ltn 'sport = :3773')" || {
    echo "Could not check port 3773; legacy services remain stopped and disabled." >&2
    exit "$result"
  }
  if [[ -n "$listeners" ]]; then
    echo "A listener remains on port 3773; legacy services remain stopped and disabled until the listener is identified." >&2
    exit "$result"
  fi

  echo "Homebrew service activation failed; restoring the previous legacy service states." >&2
  for unit in "${enabled_units[@]}"; do
    systemctl --user enable "$unit" >/dev/null || echo "Could not re-enable $unit." >&2
  done
  for unit in "${active_units[@]}"; do
    systemctl --user start "$unit" || echo "Could not restart $unit; see systemctl --user status $unit." >&2
  done
  exit "$result"
}
trap restore_legacy_services EXIT

for unit in "${active_units[@]}"; do
  changed=true
  systemctl --user stop "$unit"
done
for unit in "${enabled_units[@]}"; do
  changed=true
  systemctl --user disable "$unit"
done

if ! $target_was_active; then
  command -v ss >/dev/null || {
    echo "Required command not found: ss; no Homebrew service was started." >&2
    exit 1
  }
  listeners="$(ss -H -ltn 'sport = :3773')"
  if [[ -n "$listeners" ]]; then
    port_conflict=true
    echo "A process still listens on T3's default port 3773; no second server was started." >&2
    exit 1
  fi
fi

changed=true
brew services start t3code-cli-main
if ! target_is_active; then
  echo "Homebrew services reported success without an active T3 service." >&2
  exit 1
fi
changed=false
trap - EXIT
echo "Homebrew now owns the T3 Code server lifecycle. Legacy unit files and ~/.t3 data were preserved."
