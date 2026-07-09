#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/pull-crabbox-artifact.sh --id LEASE --remote PATH --local PATH [options]

Pull a file from a CrabBox lease through the provider SSH command. This is the
fallback for providers such as Daytona where `crabbox run --download` is not
supported.

Options:
  --id LEASE          CrabBox lease id or slug.
  --remote PATH      Remote artifact path, usually relative to the synced repo.
  --local PATH       Local destination path.
  --provider NAME    CrabBox provider. Default: daytona.
  --work-root PATH   Remote work root. Default: /home/daytona/crabbox.
  -h, --help         Show this help.
EOF
}

lease=""
remote_path=""
local_path=""
provider="${CRABBOX_PROVIDER:-daytona}"
work_root="${CRABBOX_WORK_ROOT:-/home/daytona/crabbox}"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --id)
            lease="${2:-}"
            [ -n "$lease" ] || { echo "--id requires a value" >&2; exit 64; }
            shift 2
            ;;
        --remote)
            remote_path="${2:-}"
            [ -n "$remote_path" ] || { echo "--remote requires a value" >&2; exit 64; }
            shift 2
            ;;
        --local)
            local_path="${2:-}"
            [ -n "$local_path" ] || { echo "--local requires a value" >&2; exit 64; }
            shift 2
            ;;
        --provider)
            provider="${2:-}"
            [ -n "$provider" ] || { echo "--provider requires a value" >&2; exit 64; }
            shift 2
            ;;
        --work-root)
            work_root="${2:-}"
            [ -n "$work_root" ] || { echo "--work-root requires a value" >&2; exit 64; }
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 64
            ;;
    esac
done

[ -n "$lease" ] || { echo "--id is required" >&2; exit 64; }
[ -n "$remote_path" ] || { echo "--remote is required" >&2; exit 64; }
[ -n "$local_path" ] || { echo "--local is required" >&2; exit 64; }

command -v crabbox >/dev/null 2>&1 || { echo "crabbox is required" >&2; exit 69; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 69; }

ssh_output="$(crabbox ssh --provider "$provider" --id "$lease" --show-secret 2>/dev/null)"
mapfile -t ssh_args < <(python3 - "$ssh_output" <<'PY'
import shlex
import sys

text = sys.argv[1]
for line in text.splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        args = shlex.split(line)
    except ValueError:
        continue
    if args and args[0] == "ssh":
        print("\n".join(args))
        break
else:
    print("could not parse crabbox ssh command", file=sys.stderr)
    sys.exit(1)
PY
)

[ "${#ssh_args[@]}" -gt 0 ] || { echo "crabbox ssh did not return an SSH command" >&2; exit 70; }

mkdir -p "$(dirname "$local_path")"
tmp_path="$(mktemp "${local_path}.tmp.XXXXXX")"
cleanup() {
    rm -f "$tmp_path"
}
trap cleanup EXIT

remote_script='
set -euo pipefail
remote_path="$1"
work_root="$2"

if [ -f "$remote_path" ]; then
    cat "$remote_path"
    exit 0
fi

if [ -f "$work_root/$remote_path" ]; then
    cat "$work_root/$remote_path"
    exit 0
fi

found="$(find "$work_root" -path "*/$remote_path" -type f -print -quit 2>/dev/null || true)"
if [ -n "$found" ] && [ -f "$found" ]; then
    cat "$found"
    exit 0
fi

echo "remote artifact not found: $remote_path under $work_root" >&2
exit 66
'

"${ssh_args[@]}" bash -s -- "$remote_path" "$work_root" >"$tmp_path" <<<"$remote_script"
mv "$tmp_path" "$local_path"
trap - EXIT

printf 'Pulled %s from CrabBox lease %s into %s\n' "$remote_path" "$lease" "$local_path"
