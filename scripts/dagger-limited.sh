#!/usr/bin/env bash
set -euo pipefail

version="$(dagger version | awk '{print $2}')"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Cannot determine the installed Dagger version" >&2; exit 1; }
engine="dagger-engine-limited-$version"
if ! docker container inspect "$engine" >/dev/null 2>&1; then
  docker create --name "$engine" --privileged --cgroupns=private \
    --cpus=2 --memory=3g --memory-swap=4g --pids-limit=512 \
    --restart=unless-stopped --volume "$engine:/var/lib/dagger" \
    "registry.dagger.io/engine:$version" --debug >/dev/null
fi
docker update --cpus=2 --memory=3g --memory-swap=4g --pids-limit=512 "$engine" >/dev/null
limits="$(docker inspect "$engine" --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.PidsLimit}} {{.HostConfig.CgroupnsMode}}')"
[[ "$limits" == "2000000000 3221225472 4294967296 512 private" ]] || { echo "Dagger resource limits were not applied" >&2; exit 1; }
docker start "$engine" >/dev/null
effective="$(docker exec "$engine" cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max)"
[[ "$effective" == $'3221225472\n1073741824\n200000 100000\n512' ]] || { echo "Dagger cgroup limits do not match the configured budget" >&2; exit 1; }
exec env "_EXPERIMENTAL_DAGGER_RUNNER_HOST=docker-container://$engine" dagger "$@"
