"""Final, conservative shutdown of the reusable Harvester builder."""

import json
import re
import select
import shlex
import subprocess
import sys


def refuse(message):
    raise RuntimeError(message)


def devsy(*args):
    result = subprocess.run(
        ["devsy", "--no-status", "--result-format", "json", *args],
        capture_output=True, text=True, timeout=120,
    )
    # Devsy can skip unreadable workspace records and emit only a warning.
    if result.returncode or result.stderr.strip():
        refuse(f"Cannot establish safe usage: {' '.join(args)}: {result.stderr.strip()}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def ownership(workspace):
    workspaces = devsy("workspace", "list")
    if not isinstance(workspaces, list):
        refuse("Unreadable workspace inventory")
    own = [ws for ws in workspaces if ws.get("id") == workspace]
    if len(own) != 1 or own[0].get("provider", {}).get("name") != "harvester":
        refuse("Builder ownership is missing or is not Harvester")
    machine = own[0].get("machine", {}).get("machineId")
    uid = own[0].get("uid")
    if not machine or not uid:
        refuse("Builder machine identity is unreadable")
    machines = devsy("machine", "list")
    matches = [m for m in machines if m.get("id") == machine]
    if len(matches) != 1 or matches[0].get("provider", {}).get("name") != "harvester":
        refuse("Machine ownership is ambiguous")
    for ws in workspaces:
        if ws.get("id") == workspace:
            continue
        provider = ws.get("provider", {}).get("name")
        other_machine = ws.get("machine", {}).get("machineId")
        if not provider or (provider == "harvester" and not other_machine):
            refuse(f"Unreadable machine ownership for workspace {ws.get('id')}")
        if other_machine == machine:
            # Native workspace stop also conservatively preserves registered
            # peers, even stopped ones. Never stop someone else's container.
            refuse(f"Shared machine {machine} belongs to other workspace {ws.get('id')}")
    tasks = devsy("workspace", "task", "list")
    if not isinstance(tasks, list):
        refuse("Unreadable startup task inventory")
    for task in tasks:
        if task.get("status") not in ("succeeded", "failed"):
            refuse(f"Unfinished Devsy startup: {task.get('workspaceId')} ({task.get('id')})")
    return machine, uid


# Hold both locks until Devsy finishes stopping the VM. Markers protect the
# upload/export intervals; lifecycle.lock protects running and queued drivers.
GUARD = r'''
set -euo pipefail
mkdir -p /builds/homebrew-tools
exec 7>/builds/homebrew-tools/lifecycle.lock
flock -n 7 || { echo 'Active or queued remote build' >&2; exit 1; }
exec 9>/builds/homebrew-tools/engine.lock
flock -n 9 || { echo 'Active remote Dagger engine job' >&2; exit 1; }
for marker in /builds/homebrew-tools/run.*/active; do
  [ ! -e "$marker" ] || { echo "Pending upload/export or interrupted owner: $marker" >&2; exit 1; }
done
docker ps --format '{{.Names}} {{.Label "dev.containers.id"}}' | python3 -c '
import re, sys
uid = sys.argv[1]
for line in sys.stdin:
    fields = line.split()
    if len(fields) == 2 and fields[1] == uid:
        continue
    if len(fields) == 1 and re.fullmatch(r"homebrew-tools-dagger-v[0-9]+\.[0-9]+\.[0-9]+", fields[0]):
        continue
    sys.exit("Other or unknown running VM container: " + line.strip())
' UID_PLACEHOLDER
echo ready
cat >/dev/null
'''


def main():
    workspace = sys.argv[1]
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", workspace):
        refuse("Invalid workspace")
    machine, uid = ownership(workspace)
    state = devsy("machine", "status", machine)
    if state.get("state") == "Stopped":
        print(f"Builder VM {machine} is already Stopped; disk/cache preserved")
        return
    if state.get("state") != "Running":
        refuse(f"Ambiguous machine state: {state.get('state')}")
    proxy = (
        f"ProxyCommand=devsy workspace ssh {workspace} --stdio --start-services=false "
        "--agent-forwarding=false --ssh-gpg-forwarding=false"
    )
    command = "bash -c " + shlex.quote(GUARD.replace("UID_PLACEHOLDER", shlex.quote(uid)))
    guard = subprocess.Popen(
        ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ForwardAgent=no", "-o", "ConnectTimeout=30",
         "-o", "HostName=devsy", "-o", "Port=22", "-o", proxy, f"{workspace}.devsy", command],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
    )
    try:
        if not select.select([guard.stdout], [], [], 45)[0] or guard.stdout.readline().strip() != "ready":
            refuse("Remote usage guard refused shutdown or was unreadable")
        if ownership(workspace) != (machine, uid) or guard.poll() is not None:
            refuse("Ownership changed while acquiring shutdown guard")
        # Workspace stop quiesces its startup tasks, takes its native lock, and
        # rechecks shared machine ownership. Direct machine stop lacks that check.
        devsy("workspace", "stop", workspace)
        state = devsy("machine", "status", machine)
        print(f"Builder VM {machine}: {state.get('state')}; disk/cache preserved")
        if state.get("state") != "Stopped":
            refuse("VM remains up; native shared-machine protection or a concurrent startup may apply")
    finally:
        guard.stdin.close()
        try:
            guard.wait(timeout=5)
        except subprocess.TimeoutExpired:
            guard.terminate()
            guard.wait(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError) as error:
        sys.exit(f"dagger-devsy cleanup: REFUSED: {error}")
