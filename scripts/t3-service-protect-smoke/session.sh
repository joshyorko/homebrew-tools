#!/usr/bin/env bash
set -euo pipefail
set -E
trap 'echo "Fixture failure at line $LINENO: $BASH_COMMAND" >&2' ERR
[[ "$(id -u)" == 0 ]]
user=linuxbrew
uid="$(id -u "$user")"
home="$(getent passwd "$user" | cut -d: -f6)"
prefix=/home/linuxbrew/.linuxbrew
unit=sh.brew.t3code-cli-main.service
unit_dir="$home/.config/systemd/user"
drop_in=90-t3code-protect.conf
mkdir -p "$unit_dir"
chown -R "$user:$user" "$home/.config"
as_user() {
  runuser -u "$user" -- env HOME="$home" XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" PATH="$prefix/bin:$prefix/sbin:/usr/local/bin:/usr/bin:/bin" HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ENV_HINTS=1 HOMEBREW_NO_INSTALL_FROM_API=1 HOMEBREW_DOWNLOAD_CONCURRENCY=1 HOMEBREW_MAKE_JOBS=2 T3CODE_TELEMETRY_ENABLED=false "$@"
}
record() {
  printf '%s\tPASS\n' "$1" >> /proof/scenarios.tsv
}
wait_active() {
  local previous_pid=0
  local stable=0
  local current_pid
  for _ in {1..60}; do
    current_pid="$(as_user systemctl --user show "$unit" --property=MainPID --value)"
    if as_user systemctl --user is-active --quiet "$unit" && [[ "$current_pid" != 0 && "$current_pid" == "$previous_pid" ]]; then
      stable=$((stable + 1))
      if [[ "$stable" == 3 ]]; then return; fi
    else
      stable=0
    fi
    previous_pid="$current_pid"
    sleep 1
  done
  as_user systemctl --user status "$unit"
  return 1
}
snapshot() {
  find /etc/systemd/system "$home/.config/systemd" -name "$drop_in" -type f -exec sha256sum {} + | sort
}
assert_file() {
  [[ "$(cat "$1")" == "$2" ]]
}
reject_without_changes() {
  local scenario="$1"
  local diagnostic="${2:-verify T3 service ownership:}"
  snapshot > /proof/before.sha256
  as_user t3 service protect --yes > "/proof/$scenario.log" 2>&1 || true
  snapshot > /proof/after.sha256
  cmp /proof/before.sha256 /proof/after.sha256
  grep -F "$diagnostic" "/proof/$scenario.log"
  ! grep -Eq 'Protection drop-ins installed|Protected T3 Code' "/proof/$scenario.log"
  record "$scenario"
}
for _ in {1..30}; do
  if systemctl show-environment >/dev/null 2>&1; then break; fi
  sleep 1
done
[[ "$(cat /proc/1/comm)" == systemd ]]
loginctl enable-linger "$user"
systemctl start "user@$uid.service"
python3 - "$prefix" <<'PY'
from pathlib import Path
import hashlib
import os
import re
import sys

source = Path("/work/input/t3code-cli-main.rb").read_text()
artifact = Path("/work/input/candidate.tar.gz")
version = re.search(r'^  version "([^"]+)"$', source, re.M)
assert version and version.group(1).endswith(os.environ["T3_PROTECT_SOURCE_SHA"][:12]), "The formula version does not identify the requested upstream source"
source, urls = re.subn(r'^  url "[^"]+"$', '  url "file:///work/input/candidate.tar.gz"', source, flags=re.M)
source, checksums = re.subn(r'^  sha256 "[^"]+"$', f'  sha256 "{hashlib.sha256(artifact.read_bytes()).hexdigest()}"', source, flags=re.M)
assert urls == checksums == 1
tap = Path(sys.argv[1]) / "Homebrew/Library/Taps/test/homebrew-protect"
(tap / "Formula").mkdir(parents=True, exist_ok=True)
(tap / "Formula/t3code-cli-main.rb").write_text(source)
PY
chown -R "$user:$user" "$prefix/Homebrew/Library/Taps/test"
as_user brew trust --formula test/protect/t3code-cli-main
as_user brew install test/protect/t3code-cli-main > /proof/install.log 2>&1
as_user brew test test/protect/t3code-cli-main > /proof/brew-test.log 2>&1
as_user brew info --json=v2 test/protect/t3code-cli-main > /proof/package.json
as_user t3 --version > /proof/cli-version.txt
as_user systemctl --user mask t3code.service
as_user brew services start test/protect/t3code-cli-main
wait_active
as_user python3 /work/runner/wait-http.py > /proof/homebrew-http.log
as_user systemctl --user show "$unit" > /proof/homebrew-before.properties
pid="$(as_user systemctl --user show "$unit" --property=MainPID --value)"
[[ "$pid" =~ ^[1-9][0-9]*$ ]]
cat "/proc/$pid/cgroup" > /proof/homebrew.cgroup
tr '\0' ' ' < "/proc/$pid/cmdline" > /proof/homebrew.cmdline
: > /proof/sudo.log
snapshot > /proof/before.sha256
as_user python3 /work/runner/preview.py t3 service protect > /proof/preview.log 2>&1
snapshot > /proof/after.sha256
cmp /proof/before.sha256 /proof/after.sha256
[[ ! -s /proof/sudo.log ]]
grep -F "$unit.d/$drop_in" /proof/preview.log
record preview-without-sudo
cp "$unit_dir/$unit" /proof/unit-before-confirmation.service
snapshot > /proof/before.sha256
as_user env "T3_PROTECT_EDIT_UNIT=$unit_dir/$unit" python3 /work/runner/preview.py t3 service protect > /proof/stale-confirmation.log 2>&1
snapshot > /proof/after.sha256
cmp /proof/before.sha256 /proof/after.sha256
[[ ! -s /proof/sudo.log ]]
cp /proof/unit-before-confirmation.service "$unit_dir/$unit"
chown "$user:$user" "$unit_dir/$unit"
as_user systemctl --user daemon-reload
[[ "$(as_user systemctl --user show "$unit" --property=MainPID --value)" == "$pid" ]]
record stale-definition-after-confirmation
as_user t3 service protect --yes > /proof/apply.log 2>&1
assert_file "$unit_dir/$unit.d/$drop_in" $'[Service]\nOOMScoreAdjust=-900'
[[ "$(as_user systemctl --user show "$unit" --property=MainPID --value)" == "$pid" ]]
[[ "$(as_user systemctl --user show "$unit" --property=OOMScoreAdjust --value)" == -900 ]]
cat "/proc/$pid/oom_score_adj" > /proof/running-score-before-restart.txt
configured_low="$(as_user systemctl --user show app.slice --property=MemoryLow --value)"
[[ "$configured_low" == 1610612736 ]]
python3 - "$pid" "$configured_low" <<'PY'
import json
from pathlib import Path
import sys

group = next(line.split(":", 2)[2] for line in Path(f"/proc/{sys.argv[1]}/cgroup").read_text().splitlines() if line.startswith("0::"))
parts = Path(group).parts[1:]
chain = []
for depth, unit_name in enumerate(parts, 1):
    directory = Path("/sys/fs/cgroup").joinpath(*parts[:depth])
    read = lambda name: (directory / name).read_text().strip() if (directory / name).exists() else None
    chain.append({"unit": unit_name, "memory.low": read("memory.low"), "memory.min": read("memory.min")})
app_low = next(row for row in chain if row["unit"] == "app.slice")["memory.low"]
if app_low is not None:
    assert app_low == "1610612736"
Path("/proof/memory-chain.json").write_text(json.dumps({"ancestors": chain, "configuredAppSliceLow": int(sys.argv[2]), "kernelMemoryControllerAvailable": app_low is not None}, indent=2) + "\n")
PY
grep -F 'brew services restart t3code-cli-main' /proof/apply.log
[[ "$(as_user systemctl --user show t3code.service --property=LoadState --value)" == masked ]]
record masked-native-and-active-homebrew
as_user t3 service protect --yes > /proof/reapply.log 2>&1
record repeated-protect
as_user brew services restart test/protect/t3code-cli-main
wait_active
pid="$(as_user systemctl --user show "$unit" --property=MainPID --value)"
[[ "$(cat "/proc/$pid/oom_score_adj")" == -900 ]]
cat "/proc/$pid/oom_score_adj" > /proof/running-score-after-restart.txt
record running-score-after-fixture-restart
as_user systemctl --user stop "$unit"
as_user t3 service protect --undo --yes > /proof/stopped-undo.log 2>&1
[[ ! -e "$unit_dir/$unit.d/$drop_in" ]]
as_user t3 service protect --undo --yes > /proof/repeated-undo.log 2>&1
record stopped-and-repeated-undo
custom_home="$home/review-custom-home"
mkdir -p "$custom_home" "$unit_dir/$unit.d"
printf '[Service]\nEnvironment=T3CODE_HOME=%s\nUnsetEnvironment=T3CODE_HOME\n' "$custom_home" > "$unit_dir/$unit.d/50-unset-home.conf"
chown -R "$user:$user" "$custom_home" "$unit_dir/$unit.d"
as_user systemctl --user daemon-reload
snapshot > /proof/before.sha256
unset_status=0
as_user t3 service protect --yes --base-dir "$custom_home" > /proof/unset-home.log 2>&1 || unset_status=$?
[[ "$unset_status" != 0 ]]
grep -F 'ambiguous environment unsets' /proof/unset-home.log
snapshot > /proof/after.sha256
cmp /proof/before.sha256 /proof/after.sha256
rm "$unit_dir/$unit.d/50-unset-home.conf"
as_user systemctl --user daemon-reload
record stopped-effective-home-unset
as_user brew services start test/protect/t3code-cli-main
wait_active
as_user t3 service protect --yes > /proof/before-brew-stop.log 2>&1
as_user brew services stop test/protect/t3code-cli-main
[[ ! -e "$unit_dir/$unit" && -f "$unit_dir/$unit.d/$drop_in" ]]
as_user t3 service protect --undo --yes > /proof/brew-stop-undo.log 2>&1
[[ ! -e "$unit_dir/$unit" && ! -e "$unit_dir/$unit.d/$drop_in" ]]
as_user t3 service protect --undo --yes > /proof/brew-stop-repeated-undo.log 2>&1
record homebrew-unregistered-unit-undo
as_user brew services start test/protect/t3code-cli-main
wait_active
as_user systemctl --user stop "$unit"
mkdir -p "$unit_dir/t3code.service.d"
printf '[Service]\nOOMScoreAdjust=-900\n' > "$unit_dir/t3code.service.d/$drop_in"
printf '[Service]\nNice=1\n' > "$unit_dir/t3code.service.d/50-admin.conf"
chown -R "$user:$user" "$unit_dir/t3code.service.d"
as_user t3 service protect --undo --yes > /proof/stale-native-undo.log 2>&1
[[ ! -e "$unit_dir/t3code.service.d/$drop_in" ]]
assert_file "$unit_dir/t3code.service.d/50-admin.conf" $'[Service]\nNice=1'
record stale-native-drop-in
mkdir -p "$unit_dir/$unit.d"
printf '[Service]\nNice=10\n' > "$unit_dir/$unit.d/$drop_in"
chown -R "$user:$user" "$unit_dir/$unit.d"
reject_without_changes conflicting-protection-file 'verify protection files:'
assert_file "$unit_dir/$unit.d/$drop_in" $'[Service]\nNice=10'
rm "$unit_dir/$unit.d/$drop_in"
printf '[Service]\nNice=11\n' > /proof/admin-override.conf
ln -s /proof/admin-override.conf "$unit_dir/$unit.d/$drop_in"
reject_without_changes linked-protection-file 'verify protection files:'
assert_file /proof/admin-override.conf $'[Service]\nNice=11'
rm "$unit_dir/$unit.d/$drop_in"
printf '[Service]\nExecStart=\nExecStart=/usr/bin/sleep infinity\n' > "$unit_dir/$unit.d/50-foreign.conf"
chown -R "$user:$user" "$unit_dir/$unit.d"
as_user systemctl --user daemon-reload
reject_without_changes foreign-command
rm "$unit_dir/$unit.d/50-foreign.conf"
as_user systemctl --user daemon-reload
as_user brew services stop test/protect/t3code-cli-main
rm -f "$unit_dir/$unit"
as_user systemctl --user daemon-reload
reject_without_changes missing-unit
if [[ -f /work/input/native.tar.gz ]]; then
  unit=t3code.service
  native_home="$home/native-t3-home"
  native_dir="$native_home/runtime/versions/0.1.9"
  as_user systemctl --user unmask "$unit"
  mkdir -p "$native_dir"
  tar -xzf /work/input/native.tar.gz --strip-components=1 -C "$native_dir"
  printf '0.1.9\n' > "$native_dir/.install-complete"
  printf '{"protocol":3,"activeVersion":"0.1.9"}\n' > "$native_home/runtime/service-state.json"
  cat > "$unit_dir/$unit" <<EOF
[Unit]
Description=Isolated native T3 launcher fixture
[Service]
ExecStart=$native_dir/t3 __service-launcher
Environment=T3CODE_HOME=$native_home
Environment=T3_BOOT_SERVICE_UNIT=$unit
Environment=T3CODE_TELEMETRY_ENABLED=false
Environment=LD_LIBRARY_PATH=$native_dir/lib
WorkingDirectory=$home
StandardOutput=append:$home/native-server.log
StandardError=append:$home/native-server.log
EOF
  chown -R "$user:$user" "$native_home" "$unit_dir"
  as_user systemctl --user daemon-reload
  as_user systemctl --user start "$unit"
  wait_active
  as_user python3 /work/runner/wait-http.py > /proof/native-http.log
  as_user python3 /work/runner/preview.py t3 service protect --base-dir "$native_home" > /proof/native-preview.log 2>&1
  grep -F 't3code.service.d/90-t3code-protect.conf' /proof/native-preview.log
  as_user t3 service protect --yes --base-dir "$native_home" > /proof/native-apply.log 2>&1
  grep -F 'When agents are idle, run `t3 service restart`' /proof/native-apply.log
  assert_file "$unit_dir/$unit.d/$drop_in" $'[Service]\nOOMScoreAdjust=-900'
  as_user systemctl --user restart "$unit"
  wait_active
  pid="$(as_user systemctl --user show "$unit" --property=MainPID --value)"
  [[ "$(cat "/proc/$pid/oom_score_adj")" == -900 ]]
  as_user t3 service status --base-dir "$native_home" > /proof/native-status.log 2>&1
  grep -F -- '-900' /proof/native-status.log
  as_user t3 service protect --undo --yes --base-dir "$native_home" > /proof/native-undo.log 2>&1
  [[ ! -e "$unit_dir/$unit.d/$drop_in" ]]
  as_user systemctl --user stop "$unit"
  as_user t3 service protect --undo --yes --base-dir "$native_home" > /proof/native-stopped-undo.log 2>&1
  cp "$home/native-server.log" /proof/native-server.log
  sha256sum /work/input/native.tar.gz > /proof/native-artifact.sha256
  record native-preview-apply-effective-status-and-undo
fi
python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path("/proof")
scenarios = [dict(zip(["scenario", "result"], row.split("\t"))) for row in (root / "scenarios.tsv").read_text().splitlines()]
report = {
    "upstreamSourceSha": os.environ["T3_PROTECT_SOURCE_SHA"],
    "artifactSha256": hashlib.sha256(Path("/work/input/candidate.tar.gz").read_bytes()).hexdigest(),
    "boundary": "Homebrew-installed CLI and real systemd inside a disposable Docker container",
    "scenarios": scenarios,
    "gaps": (["Native pinned runtime was not supplied; native runtime remains untested."] if not (root / "native-artifact.sha256").exists() else []) + ["Two competing verified active services remain untested in real systemd.", "Live Dakota acceptance was not authorized or run."],
}
if not json.loads((root / "memory-chain.json").read_text())["kernelMemoryControllerAvailable"]:
    report["gaps"].append("The Docker fixture does not expose descendant memory.low files; configured defaults were verified, kernel ancestor protection was not.")
(root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
PY
