#!/usr/bin/env bash
set -euo pipefail

# Run this inside a clean Linuxbrew/Wolfi environment. The formula path points at
# the checked-out PR branch, so the smoke never falls back to the default tap.
formula_path="${FORMULA_PATH:-$PWD/Formula/codex-memoryd.rb}"
test -f "$formula_path"
command -v brew >/dev/null

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ENV_HINTS=1
export HOMEBREW_NO_INSTALL_FROM_API=1
export HOME="$(mktemp -d)"

tap_dir="$(brew --repository)/Library/Taps/joshyorko/homebrew-tools"
brew tap-new --no-git joshyorko/tools >/dev/null
mkdir -p "$tap_dir/Formula"
cp "$formula_path" "$tap_dir/Formula/codex-memoryd.rb"

brew install joshyorko/tools/codex-memoryd
codex-memoryd --version
brew test joshyorko/tools/codex-memoryd
codex-memoryd init --bind 127.0.0.1:8989
db="$HOME/.codex-memoryd/memory.db"
export MEMORYD_TEST_DB="$db"
python3 - <<'PY'
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request

with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
bind = f"127.0.0.1:{port}"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
child = subprocess.Popen(
    ["codex-memoryd", "--db", os.environ["MEMORYD_TEST_DB"], "serve", "--bind", bind],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("foreground MemoryD exited before health check")
        try:
            with opener.open(f"http://{bind}/healthz", timeout=1) as response:
                if json.load(response).get("ok") is True:
                    break
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    else:
        raise RuntimeError("foreground MemoryD health check timed out")
finally:
    # This is the unreaped child started above, never a PID read from disk.
    if child.poll() is None:
        child.terminate()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if child.poll() is None:
            child.kill()
        child.wait(timeout=5)
PY
test -s "$db"
db_sha="$(sha256sum "$db" | awk '{print $1}')"

# Exercise an actual Homebrew upgrade using the same verified archive under
# a higher Homebrew revision. This also works with timestamped master builds.
# The user database is outside the formula
# prefix and MUST survive the replacement.
awk '{ print } /^  version / { print "  revision 1" }' "$formula_path" > "$tap_dir/Formula/codex-memoryd.rb"
brew upgrade joshyorko/tools/codex-memoryd
test -s "$db"
test "$(sha256sum "$db" | awk '{print $1}')" = "$db_sha"

brew uninstall codex-memoryd
test -s "$db"
test "$(sha256sum "$db" | awk '{print $1}')" = "$db_sha"

# Verify the official tunnel client remains independently installable.
brew install openai/tools/tunnel-client
tunnel-client --version
