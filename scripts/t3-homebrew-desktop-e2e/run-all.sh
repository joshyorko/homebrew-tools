#!/usr/bin/env bash
set -euo pipefail

artifact="$(realpath -- "$1")"
output="$(realpath -m -- "$2")"
source_ref="$3"
[[ -f "$artifact" && "$source_ref" =~ ^[0-9a-f]{40}$ ]]
runner_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$output"
[[ ! -e "$output/acceptance.json" ]]
image="codex-t3-service-attach-evidence-$(cat /proc/sys/kernel/random/uuid)"
owned_image=false
cleanup() {
  if [[ "$owned_image" == true ]]; then docker image rm "$image" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

setup_status=0
docker build -t "$image" "$runner_dir" > "$output/runner-build.log" 2>&1 || setup_status=$?
if [[ "$setup_status" -eq 0 ]]; then
  owned_image=true
  export T3_GUI_RUNNER_IMAGE="$image"
  for scenario in service-attach unknown-owner package-mismatch manual-settings; do
    status=0
    bash "$runner_dir/run.sh" "$artifact" "$output/$scenario" "$scenario" > "$output/$scenario.log" 2>&1 || status=$?
    printf '%s\n' "$status" > "$output/$scenario.exit"
  done
fi

# Export evidence even after failure. Only acceptance.json's passed=true is a pass.
python3 - "$output" "$source_ref" "$setup_status" <<'PY'
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
source = sys.argv[2]
results = []
for scenario in ["service-attach", "unknown-owner", "package-mismatch", "manual-settings"]:
    receipt = root / f"{scenario}.exit"
    code = int(receipt.read_text()) if receipt.exists() else None
    report = root / scenario / "report.json"
    try:
        data = json.loads(report.read_text())
        matches = data.get("scenario") == scenario and data.get("sourceCommit") == source
    except (OSError, ValueError, AttributeError):
        matches = False
    results.append({"scenario": scenario, "exitCode": code, "sourceMatches": matches,
                    "passed": code == 0 and matches})
summary = {"upstream": source, "setupExitCode": int(sys.argv[3]), "scenarios": results,
           "passed": int(sys.argv[3]) == 0 and all(r["passed"] for r in results)}
(root / "acceptance.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
PY
