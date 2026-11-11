#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 4 || ! "$4" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 candidate.tar.gz formula.rb new-output-directory upstream-source-sha" >&2
  exit 2
fi
artifact="$(realpath -- "$1")"
formula="$(realpath -- "$2")"
output="$(realpath -m -- "$3")"
source_sha="$4"
[[ -f "$artifact" && -f "$formula" && ! -e "$output" ]]
mkdir -p -- "$output"
runner_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
container="codex-t3-protect-$$"
image="codex-t3-protect:test-$$"
owned_image=true
cleanup() {
  docker stop --timeout 5 "$container" >/dev/null 2>&1 || true
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [[ "$owned_image" == true ]]; then docker image rm "$image" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
sha256sum "$artifact" > "$output/artifact.sha256"
if [[ -n "${T3_PROTECT_RUNNER_IMAGE:-}" ]]; then
  image="$T3_PROTECT_RUNNER_IMAGE"
  owned_image=false
else
  timeout --kill-after=10s 600s docker build -t "$image" "$runner_dir" > "$output/image.log" 2>&1
fi
docker image inspect --format '{{.Id}}' "$image" > "$output/image.id"
docker create --name "$container" --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock --pids-limit=512 --memory=3g --memory-swap=4g --cpus=2 "$image" > "$output/container.id"
docker cp "$runner_dir/." "$container:/work/runner/"
docker cp "$artifact" "$container:/work/input/candidate.tar.gz"
docker cp "$formula" "$container:/work/input/t3code-cli-main.rb"
docker start "$container" > "$output/start.log"
status=0
timeout --kill-after=10s 600s docker exec -e "T3_PROTECT_SOURCE_SHA=$source_sha" "$container" bash /work/runner/session.sh > "$output/run.log" 2>&1 || status=$?
docker cp "$container:/proof/." "$output/" >/dev/null 2>&1 || true
docker logs "$container" > "$output/systemd.log" 2>&1
[[ "$status" == 0 && -s "$output/report.json" ]]
