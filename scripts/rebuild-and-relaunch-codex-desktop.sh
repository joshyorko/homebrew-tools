#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/rebuild-and-relaunch-codex-desktop.sh [options]

Update this Homebrew tools checkout, close Codex Desktop, rebuild/install the
local Codex Desktop cask, then launch Codex Desktop again.

Options:
  --dry-run              Print the plan without closing, pulling, building, or launching.
  --repo-dir PATH        Homebrew tools checkout. Defaults to this script's repo.
  --make-target TARGET   Make target to run. Defaults to codex-desktop-install.
  --skip-pull            Do not git fetch/pull before building.
  --allow-dirty          Allow a dirty checkout before git pull/build.
  --no-launch            Build/install but do not relaunch Codex Desktop.
  --follow-logs          After relaunch, run codex-desktop logs --follow.
  --wait-seconds N       Seconds to wait before SIGKILL after SIGTERM. Default: 25.
  -h, --help             Show this help.
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
make_target="codex-desktop-install"
dry_run=0
skip_pull=0
allow_dirty=0
launch_after=1
follow_logs=0
wait_seconds=25

quote_command() {
    local arg
    printf '%q' "$1"
    shift || true
    for arg in "$@"; do
        printf ' %q' "$arg"
    done
    printf '\n'
}

log() {
    printf '%s\n' "$*"
}

run() {
    printf '+ '
    quote_command "$@"
    if [ "$dry_run" -eq 0 ]; then
        "$@"
    fi
}

die() {
    echo "ERROR: $*" >&2
    exit 1
}

is_live_pid() {
    local pid="$1"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

read_pid_file() {
    local path="$1"
    local pid=""
    [ -f "$path" ] || return 0
    pid="$(sed -n 's/^[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$path" 2>/dev/null | head -n 1 || true)"
    if [ -n "$pid" ] && is_live_pid "$pid"; then
        printf '%s\n' "$pid"
    fi
}

discover_codex_desktop_pids() {
    local state_root="${XDG_STATE_HOME:-$HOME/.local/state}"
    local pid_file
    for pid_file in \
        "$state_root/codex-desktop/app.pid" \
        "$state_root/codex-desktop/webview.pid"
    do
        read_pid_file "$pid_file"
    done

    pgrep -u "$(id -u)" -f '/Caskroom/codex-desktop/.*/share/codex-desktop/app/electron|/share/codex-desktop/app/electron' 2>/dev/null || true
}

unique_live_pids() {
    local pid
    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        is_live_pid "$pid" || continue
        printf '%s\n' "$pid"
    done | awk '!seen[$0]++'
}

wait_for_exit() {
    local pid="$1"
    local waited=0
    while is_live_pid "$pid"; do
        [ "$waited" -lt "$wait_seconds" ] || return 1
        sleep 1
        waited=$((waited + 1))
    done
    return 0
}

stop_codex_desktop() {
    log "== stop Codex Desktop =="

    local pids
    pids="$(discover_codex_desktop_pids | unique_live_pids)"
    if [ -z "$pids" ]; then
        log "No live Codex Desktop process found."
        return 0
    fi

    if [ "$dry_run" -eq 1 ]; then
        log "DRY RUN: would send SIGTERM to Codex Desktop PIDs:"
        printf '%s\n' "$pids" | sed 's/^/  /'
        return 0
    fi

    local pid
    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        kill "$pid" 2>/dev/null || true
    done <<<"$pids"

    local stubborn=()
    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        if ! wait_for_exit "$pid"; then
            stubborn+=("$pid")
        fi
    done <<<"$pids"

    if [ "${#stubborn[@]}" -gt 0 ]; then
        log "Codex Desktop did not exit after ${wait_seconds}s; sending SIGKILL."
        kill -9 "${stubborn[@]}" 2>/dev/null || true
    fi
}

check_repo() {
    [ -d "$repo_dir" ] || die "repo dir does not exist: $repo_dir"
    [ -f "$repo_dir/Makefile" ] || die "Makefile not found in repo dir: $repo_dir"

    if [ "$dry_run" -eq 1 ]; then
        log "DRY RUN: would verify required commands: git, make, codex-desktop"
    else
        command -v git >/dev/null 2>&1 || die "git is required"
        command -v make >/dev/null 2>&1 || die "make is required"
        if [ "$launch_after" -eq 1 ] || [ "$follow_logs" -eq 1 ]; then
            command -v codex-desktop >/dev/null 2>&1 || die "codex-desktop is required"
        fi
    fi

    if [ "$allow_dirty" -eq 0 ]; then
        if [ "$dry_run" -eq 1 ]; then
            log "DRY RUN: would require a clean git checkout before pull/build"
        elif [ -n "$(git -C "$repo_dir" status --porcelain)" ]; then
            die "checkout is dirty; commit/stash first or rerun with --allow-dirty"
        fi
    fi
}

update_checkout() {
    if [ "$skip_pull" -eq 1 ]; then
        log "== skip git update =="
        return 0
    fi

    log "== update Homebrew tools checkout =="
    run git -C "$repo_dir" fetch --prune
    run git -C "$repo_dir" pull --ff-only
}

build_and_install() {
    log "== build and install Codex Desktop =="
    run make -C "$repo_dir" "$make_target"
}

launch_codex_desktop() {
    if [ "$launch_after" -eq 0 ]; then
        log "== launch skipped =="
        return 0
    fi

    log "== launch Codex Desktop =="
    if [ "$dry_run" -eq 1 ]; then
        log "DRY RUN: codex-desktop desktop"
        return 0
    fi

    local launch_log="${XDG_CACHE_HOME:-$HOME/.cache}/codex-desktop/rebuild-relaunch.log"
    mkdir -p "$(dirname "$launch_log")"
    nohup codex-desktop desktop >>"$launch_log" 2>&1 &
    local launch_pid=$!
    disown "$launch_pid" 2>/dev/null || true
    log "Launched Codex Desktop as PID $launch_pid"
    log "Relaunch log: $launch_log"
}

tail_logs() {
    if [ "$follow_logs" -eq 0 ]; then
        log "Live logs: codex-desktop logs --follow"
        return 0
    fi

    log "== follow Codex Desktop logs =="
    run codex-desktop logs --follow
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --dry-run)
            dry_run=1
            shift
            ;;
        --repo-dir)
            repo_dir="${2:-}"
            [ -n "$repo_dir" ] || die "--repo-dir requires a path"
            shift 2
            ;;
        --make-target)
            make_target="${2:-}"
            [ -n "$make_target" ] || die "--make-target requires a target"
            shift 2
            ;;
        --skip-pull)
            skip_pull=1
            shift
            ;;
        --allow-dirty)
            allow_dirty=1
            shift
            ;;
        --no-launch)
            launch_after=0
            shift
            ;;
        --follow-logs)
            follow_logs=1
            shift
            ;;
        --wait-seconds)
            wait_seconds="${2:-}"
            [[ "$wait_seconds" =~ ^[0-9]+$ ]] || die "--wait-seconds requires a non-negative integer"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "unknown option: $1"
            ;;
    esac
done

repo_dir="$(cd "$repo_dir" && pwd)"

if [ "$dry_run" -eq 1 ]; then
    log "DRY RUN: no processes will be closed, no git state will change, no build will run."
fi

check_repo
update_checkout
stop_codex_desktop
build_and_install
launch_codex_desktop
tail_logs
