#!/usr/bin/env bash
set -euo pipefail
if [[ ($# != 4 && $# != 5) || ! "$4" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 candidate.tar.gz formula.rb new-output-directory upstream-source-sha [native-t3-0.1.9-linux-x64.tar.gz]" >&2
  exit 2
fi
artifact="$(realpath -- "$1")"
formula="$(realpath -- "$2")"
output="$(realpath -m -- "$3")"
source_sha="$4"
native_artifact="${5:-}"
if [[ -n "$native_artifact" ]]; then
  native_artifact="$(realpath -- "$native_artifact")"
  [[ "$(sha256sum "$native_artifact" | cut -d ' ' -f1)" == 0141025335da334759cecd8db3483e09772f3600ca03674698524e7d94291362 ]]
fi
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
  rm -f -- "$output/runner-image.tar"
}
trap cleanup EXIT
sha256sum "$artifact" > "$output/artifact.sha256"
if [[ -n "${T3_PROTECT_RUNNER_IMAGE:-}" ]]; then
  image="$T3_PROTECT_RUNNER_IMAGE"
  owned_image=false
else
  timeout --kill-after=10s 600s bash "$runner_dir/../dagger-limited.sh" core host directory \
    --path "$runner_dir" docker-build export --path "$output/runner-image.tar" > "$output/image.log" 2>&1
  docker load --input "$output/runner-image.tar" > "$output/image-load.log"
  loaded_image="$(sed -n 's/^Loaded image ID: \(sha256:[0-9a-f]\{64\}\)$/\1/p' "$output/image-load.log")"
  [[ "$loaded_image" =~ ^sha256:[0-9a-f]{64}$ ]]
  docker tag "$loaded_image" "$image"
  rm "$output/runner-image.tar"
fi
docker image inspect --format '{{.Id}}' "$image" > "$output/image.id"
cpu_set="$(python3 -c 'import os; print(",".join(map(str, sorted(os.sched_getaffinity(0))[:2])))')"
docker create --name "$container" --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock --pids-limit=512 --memory=3g --memory-swap=4g --cpus=2 --cpuset-cpus="$cpu_set" "$image" > "$output/container.id"
docker cp "$runner_dir/." "$container:/work/runner/"
docker cp "$artifact" "$container:/work/input/candidate.tar.gz"
docker cp "$formula" "$container:/work/input/t3code-cli-main.rb"
if [[ -n "$native_artifact" ]]; then docker cp "$native_artifact" "$container:/work/input/native.tar.gz"; fi
docker start "$container" > "$output/start.log"
status=0
timeout --kill-after=10s 600s docker exec -e "T3_PROTECT_SOURCE_SHA=$source_sha" "$container" bash /work/runner/session.sh > "$output/run.log" 2>&1 || status=$?
docker cp "$container:/proof/." "$output/" >/dev/null 2>&1 || true
docker logs "$container" > "$output/systemd.log" 2>&1
[[ "$status" == 0 && -s "$output/report.json" ]]
