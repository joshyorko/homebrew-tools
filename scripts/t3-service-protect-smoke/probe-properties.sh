#!/usr/bin/env bash
set -euo pipefail
[[ -f /work/input/candidate.tar.gz && "$(cat /proc/1/comm)" == systemd ]]
unit="${1:-sh.brew.t3code-cli-main.service}"
case "$unit" in sh.brew.t3code-cli-main.service|dbus.service) ;; *) exit 2 ;; esac
systemctl --user show "$unit" --all --property=Id,LoadState,ActiveState,MainPID,FragmentPath,ExecStart,Environment,EnvironmentFiles,ControlGroup
unit_path="$(busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager GetUnit s "$unit" | sed -n 's/^o "\([^"]*\)"$/\1/p')"
[[ "$unit_path" == /org/freedesktop/systemd1/unit/* ]]
busctl --user get-property org.freedesktop.systemd1 "$unit_path" org.freedesktop.systemd1.Service EnvironmentFiles
