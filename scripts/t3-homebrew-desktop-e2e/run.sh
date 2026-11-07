#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 candidate.AppImage output-directory [success|failure|service-attach|unknown-owner]" >&2
  exit 2
fi
artifact="$(realpath -- "$1")"
output="$(realpath -m -- "$2")"
scenario="${3:-success}"
[[ -f "$artifact" && "$scenario" =~ ^(success|failure|service-attach|unknown-owner)$ ]] || exit 2
if [[ "$scenario" == "service-attach" || "$scenario" == "unknown-owner" ]]; then
  e2e_script="service-attach-e2e.mjs"
else
  e2e_script="e2e.mjs"
fi
[[ ! -e "$output" ]] || { echo "Use a new output directory to keep acceptance evidence separate." >&2; exit 2; }
mkdir -p -- "$output"
runner_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
container="codex-t3-homebrew-ui-$$"
image="codex-t3-homebrew-ui:test-$$"
cleanup() {
  docker stop --timeout 3 "$container" >/dev/null 2>&1 || true
  docker rm "$container" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sha256sum "$artifact" > "$output/artifact.sha256"
docker build -t "$image" "$runner_dir" > "$output/image.log" 2>&1
docker create --name "$container" --network none --cap-drop=ALL --security-opt no-new-privileges --pids-limit=256 --memory=4g --cpus=4 --shm-size=512m -e "CASE=$scenario" -e "E2E_SCRIPT=$e2e_script" "$image" > "$output/container.id"
docker cp "$runner_dir/." "$container:/work/runner/"
docker cp "$artifact" "$container:/work/bundle/artifacts/candidate.AppImage"
status=0
timeout --kill-after=5s 240s docker start -a "$container" > "$output/run.log" 2>&1 || status=$?
for name in report.json confirmation.png result.png initial.png pairing-confirmation.png connected.png repeat-run.png failure.txt; do
  docker cp "$container:/tmp/t3-ui-test/$name" "$output/$name" >/dev/null 2>&1 || true
done
cat "$output/run.log"
[[ "$status" -eq 0 && -s "$output/report.json" ]]
