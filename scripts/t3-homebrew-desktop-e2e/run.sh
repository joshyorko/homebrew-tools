#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 candidate.AppImage output-directory [success|failure|service-attach|unknown-owner|package-mismatch|manual-settings]" >&2
  exit 2
fi
artifact="$(realpath -- "$1")"
output="$(realpath -m -- "$2")"
scenario="${3:-success}"
[[ -f "$artifact" && "$scenario" =~ ^(success|failure|service-attach|unknown-owner|package-mismatch|manual-settings)$ ]] || exit 2
if [[ "$scenario" == "service-attach" || "$scenario" == "unknown-owner" || "$scenario" == "package-mismatch" || "$scenario" == "manual-settings" ]]; then
  e2e_script="service-attach-e2e.mjs"
else
  e2e_script="e2e.mjs"
fi
[[ ! -e "$output" ]] || { echo "Use a new output directory to keep acceptance evidence separate." >&2; exit 2; }
mkdir -p -- "$output"
runner_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
container="codex-t3-homebrew-ui-$$"
network="$container"
network_mode=none
image="codex-t3-homebrew-ui:test-$$"
owned_image=true
cleanup() {
  docker stop --timeout 3 "$container" >/dev/null 2>&1 || true
  docker rm "$container" >/dev/null 2>&1 || true
  if [[ "$network_mode" != none ]]; then docker network rm "$network" >/dev/null 2>&1 || true; fi
  if [[ "$owned_image" == true ]]; then docker image rm "$image" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
sha256sum "$artifact" > "$output/artifact.sha256"
if [[ -n "${T3_GUI_RUNNER_IMAGE:-}" ]]; then
  image="$T3_GUI_RUNNER_IMAGE"
  owned_image=false
  [[ "$(docker image inspect --format '{{.Config.User}}' "$image")" == testuser ]]
  docker image inspect --format '{{.Id}}' "$image" > "$output/image.log"
else
  docker build -t "$image" "$runner_dir" > "$output/image.log" 2>&1
fi
fixture_cpu_set="$(python3 -c 'import os; print(",".join(str(cpu) for cpu in sorted(os.sched_getaffinity(0))[:4]))')"
if [[ "$e2e_script" == service-attach-e2e.mjs ]]; then
  # Chromium reports loopback-only networking as offline and defers saved connections.
  # Give it a real interface without a host gateway, external routing, or DNS.
  docker network create --internal --opt com.docker.network.bridge.gateway_mode_ipv4=isolated "$network" > "$output/network.id"
  network_mode="$network"
fi
docker create --init --name "$container" --network "$network_mode" --dns=127.0.0.1 --cap-drop=ALL --security-opt no-new-privileges --pids-limit=512 --memory=4g --cpus=4 --cpuset-cpus="$fixture_cpu_set" --shm-size=512m -e "CASE=$scenario" -e "E2E_SCRIPT=$e2e_script" "$image" > "$output/container.id"
docker cp "$runner_dir/." "$container:/work/runner/"
docker cp "$artifact" "$container:/work/bundle/artifacts/candidate.AppImage"
status=0
timeout --kill-after=5s 240s docker start -a "$container" > "$output/run.log" 2>&1 || status=$?
for name in report.json resource-report.json confirmation.png result.png initial.png window-state.json renderer-state.json renderer-readiness.json owner-dialog.png owner-dialog-after-click.png error-screen.png pairing-result.txt pairing-failure.png pairing-confirmation.png connected.png repeat-run.png package-mismatch.png manual-settings.png failure.txt; do
  docker cp "$container:/tmp/t3-ui-test/$name" "$output/$name" >/dev/null 2>&1 || true
done
cat "$output/run.log"
[[ "$status" -eq 0 && -s "$output/report.json" ]]
