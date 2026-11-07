#!/usr/bin/env bash
set -euo pipefail
Xvfb :99 -screen 0 1280x900x24 > /tmp/xvfb.log 2>&1 &
exec dbus-run-session -- bash -euo pipefail -c '
  head -c 32 /dev/urandom | base64 | gnome-keyring-daemon --unlock --components=secrets > /tmp/keyring.log 2>&1
  exec node "/work/runner/${E2E_SCRIPT:-e2e.mjs}"
'
