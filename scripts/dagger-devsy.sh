#!/usr/bin/env bash
set -euo pipefail

fail() { echo "dagger-devsy: $*" >&2; exit 1; }

if [[ "${1:-}" == --remote ]]; then
  shift
  run="$1"
  shift
  [[ "$run" == /builds/homebrew-tools/run.* ]] || fail "Invalid remote run directory"
  cd "$run"
  mapfile -d '' -t args < arguments
  set -- "${args[@]}"
  docker info >/dev/null
  exec 9>/builds/homebrew-tools/engine.lock
  echo "Waiting for the remote Dagger engine..." >&2
  flock 9
  git clone --bare --quiet repository.bundle source/.git
  git -C source config core.bare false
  git -C source remote set-url origin https://github.com/joshyorko/homebrew-tools.git
  git -C source update-ref --no-deref HEAD "$(cat head)"
  git -C source reset --mixed --quiet HEAD
  tar -xf source.tar -C source
  if [[ -f bundle.tar ]]; then
    mkdir input-bundle
    tar -xf bundle.tar -C input-bundle
  fi
  version="$(dagger version | awk '{print $2}')"
  [[ "$version" == v0.21.11 ]] || fail "Unexpected remote Dagger version: $version. Recreate the builder after updating its profile."
  engine="homebrew-tools-dagger-$version"
  cpu_set="$(python3 -c 'import os; print(",".join(map(str, sorted(os.sched_getaffinity(0))[:12])))')"
  if ! docker container inspect "$engine" >/dev/null 2>&1; then
    docker create --name "$engine" --privileged --cgroupns=private \
      --cpus=12 --cpuset-cpus="$cpu_set" --memory=24g --memory-swap=28g --pids-limit=4096 \
      --restart=unless-stopped --volume "$engine:/var/lib/dagger" \
      "registry.dagger.io/engine:$version" --debug >/dev/null
  fi
  limits="$(docker inspect "$engine" --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.PidsLimit}} {{.HostConfig.CgroupnsMode}} {{.HostConfig.CpusetCpus}}')"
  [[ "$limits" == "12000000000 25769803776 30064771072 4096 private $cpu_set" ]] || fail "Remote engine limits differ from the builder budget"
  docker start "$engine" >/dev/null
  effective="$(docker exec "$engine" cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max)"
  [[ "$effective" == $'25769803776\n4294967296\n1200000 100000\n4096' ]] || fail "Remote engine cgroup budget is not effective"
  cd source
  echo "Running Dagger on $(hostname), $run/source" >&2
  exec env "_EXPERIMENTAL_DAGGER_RUNNER_HOST=docker-container://$engine" dagger "$@"
fi

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${DAGGER_DEVSY_WORKSPACE:-homebrew-tools-dagger}"
[[ "$workspace" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "Workspace name must contain lowercase letters, digits, and hyphens"

if [[ "${1:-}" == --help ]]; then
  cat <<'EOF'
Usage: bash scripts/dagger-devsy.sh [DAGGER_ARGUMENTS...]
       bash scripts/dagger-devsy.sh --setup
       bash scripts/dagger-devsy.sh --status

Provision or resume a Harvester Devsy builder and run Dagger remotely.
Commands run from the repository root. Use repository-relative input paths.
Tracked files and non-ignored untracked files, plus Git history, are uploaded.
One -o/--output export is copied back to the requested local path on success.
The VM, container, and Dagger cache remain available for subsequent builds.
No local Docker or Dagger engine is started, including on remote failure.

DAGGER_DEVSY_WORKSPACE selects a separate builder workspace.
Use devsy workspace ssh homebrew-tools-dagger --command '<command>' for diagnostics.
EOF
  exit 0
fi

for tool in devsy ssh git tar python3 flock realpath; do
  command -v "$tool" >/dev/null || fail "$tool is required on the client"
done
cd "$root"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/homebrew-tools/$workspace"
mkdir -p "$cache/.devcontainer"
exec 8>"$cache/provision.lock"
flock 8
cp "$root/.devcontainer/dagger/"{Dockerfile,devcontainer.json} "$cache/.devcontainer/"
if [[ "${1:-}" == --status ]]; then
  exec devsy workspace describe "$workspace"
fi
up() {
  python3 - "$@" <<'PY'
import json
import signal
import subprocess
import sys

def expired(*_):
    raise TimeoutError("Devsy provisioning exceeded 20 minutes")

signal.signal(signal.SIGALRM, expired)
signal.alarm(1200)
process = subprocess.Popen(
    ["devsy", "--no-status", "--result-format", "json", "workspace", "up", *sys.argv[1:]],
    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, text=True,
)
success = False
try:
    for line in process.stdout:
        print(line, end="", file=sys.stderr, flush=True)
        event = json.loads(line)
        if event.get("kind") == "result":
            success = event.get("outcome") == "success"
            break
finally:
    signal.alarm(0)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        # SSH_TUNNEL_MODE can keep Devsy open after its terminal result.
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
sys.exit(0 if success else 1)
PY
}
existing="$(devsy --result-format json workspace list)"
provider="$(python3 -c '
import json, sys
data = json.load(sys.stdin)
for ws in data:
    if ws.get("id", ws.get("name")) == sys.argv[1]:
        provider = ws.get("provider", {})
        print(provider.get("name", "") if isinstance(provider, dict) else provider)
        break
' "$workspace" <<<"$existing")"
if [[ -n "$provider" ]]; then
  [[ "$provider" == harvester ]] || fail "Existing workspace $workspace belongs to $provider, not Harvester"
  up "$workspace" --ide none --ide-launch skip --ssh-tunnel=false
else
  echo "Provisioning $workspace on Harvester with 12 vCPUs, 32 GiB RAM, and 200 GiB disk..." >&2
  up "$cache" --id "$workspace" --provider harvester \
    --ide none --ide-launch skip --ssh-configure --ssh-tunnel=false \
    --provider-option HARVESTER_CPU=12 --provider-option HARVESTER_MEMORY=32Gi \
    --provider-option HARVESTER_DISK=200Gi >&2
fi
flock -u 8
exec 8>&-

ssh_args=(-T -o BatchMode=yes -o ForwardAgent=no -o ConnectTimeout=30
  -o HostName=devsy -o Port=22
  -o "ProxyCommand=devsy workspace ssh $workspace --stdio --start-services=false --agent-forwarding=false --ssh-gpg-forwarding=false"
  "$workspace.devsy")
remote() {
  # Commands use validated run paths. Arbitrary Dagger arguments travel in a file.
  # shellcheck disable=SC2029
  ssh "${ssh_args[@]}" "$1"
}
if [[ "${1:-}" == --setup ]]; then
  remote 'dagger version && docker info --format "Remote Docker host {{.Name}}, CPUs {{.NCPU}}, RAM {{.MemTotal}} bytes"'
  exit 0
fi
[[ "$#" -gt 0 ]] || set -- functions
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
args=()
output=""
bundle=""
git_dir="$(realpath -m -- "$(git rev-parse --git-common-dir)")"
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --bundle|--bundle=*)
      [[ -z "$bundle" ]] || fail "Supply only one --bundle directory"
      if [[ "$1" == --bundle ]]; then
        [[ "$#" -ge 2 ]] || fail "--bundle requires a directory"
        bundle="$2"
        shift 2
      else
        bundle="${1#*=}"
        shift
      fi
      [[ -n "$bundle" && -d "$bundle" ]] || fail "--bundle requires a local directory"
      args+=(--bundle=../input-bundle)
      ;;
    -m|--mod)
      [[ "$#" -ge 2 ]] || fail "$1 requires a module path"
      module="$2"
      [[ "$module" != "$root/"* ]] || module="./${module#"$root/"}"
      args+=("$1" "$module")
      shift 2
      ;;
    -o|--output)
      [[ "$#" -ge 2 && -n "$2" && -z "$output" ]] || fail "Supply exactly one nonempty export path"
      output="$2"
      args+=("$1" ../output/payload)
      shift 2
      ;;
    --output=*|-o=*)
      [[ -z "$output" && -n "${1#*=}" ]] || fail "Supply exactly one nonempty export path"
      output="${1#*=}"
      args+=(--output=../output/payload)
      shift
      ;;
    --git-dir)
      [[ "$#" -ge 2 && ( "$2" == .git || "$(realpath -m -- "$2")" == "$git_dir" ) ]] || fail "--git-dir must refer to this checkout's Git directory"
      args+=(--git-dir=.git)
      shift 2
      ;;
    --git-dir=*)
      [[ "${1#*=}" == .git || "$(realpath -m -- "${1#*=}")" == "$git_dir" ]] || fail "--git-dir must refer to this checkout's Git directory"
      args+=(--git-dir=.git)
      shift
      ;;
    *) args+=("$1"); shift ;;
  esac
done
if [[ -n "$output" ]]; then
  [[ ! -L "$output" ]] || fail "Export destination must not be a symlink"
  output="$(realpath -m -- "$output")"
  [[ "$output" != "$root" && "$output" != / && ! -L "$output" ]] || fail "Unsafe export destination"
fi

echo "Snapshotting the current checkout, including uncommitted changes..." >&2
git bundle create "$tmp/repository.bundle" --all HEAD
git rev-parse HEAD >"$tmp/head"
git ls-files --cached --others --exclude-standard -z | python3 -c '
import os, sys
paths = dict.fromkeys(sys.stdin.buffer.read().split(b"\0"))
for path in paths:
    if path and os.path.lexists(path):
        sys.stdout.buffer.write(path + b"\0")
' >"$tmp/files"
tar --null --verbatim-files-from --no-recursion -T "$tmp/files" -cf "$tmp/source.tar"
cp "$root/scripts/dagger-devsy.sh" "$tmp/driver.sh"
printf '%s\0' "${args[@]}" >"$tmp/arguments"
upload_files=(repository.bundle head source.tar driver.sh arguments)
if [[ -n "$bundle" ]]; then
  tar -C "$bundle" -cf "$tmp/bundle.tar" .
  upload_files+=(bundle.tar)
fi
run="$(remote 'mkdir -p /builds/homebrew-tools && mktemp -d /builds/homebrew-tools/run.XXXXXXXX')"
[[ "$run" =~ ^/builds/homebrew-tools/run\.[a-zA-Z0-9]+$ ]] || fail "Unexpected remote run directory"
printf 'Remote run retained at %s:%s\n' "$workspace" "$run" >&2
tar -C "$tmp" -cf - "${upload_files[@]}" | remote "tar -xf - -C $run"
remote "bash $run/driver.sh --remote $run"
if [[ -n "$output" ]]; then
  mkdir -p "$tmp/export" "$(dirname -- "$output")"
  remote "tar -C $run/output -cf - payload" | tar -xf - -C "$tmp/export"
  if [[ -d "$tmp/export/payload" && ! -L "$tmp/export/payload" ]]; then
    mkdir -p "$output"
    cp -a "$tmp/export/payload/." "$output/"
  else
    [[ ! -d "$output" ]] || fail "Cannot overwrite a directory with a file export"
    mv -f -- "$tmp/export/payload" "$output"
  fi
  printf 'Export copied to %s\n' "$output" >&2
fi
