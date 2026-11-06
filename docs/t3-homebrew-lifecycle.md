# T3 Code Homebrew lifecycle

The `t3code-cli-main` formula owns the Linux user service. Homebrew starts the
stable `opt_bin/t3` launcher with `serve`, `T3CODE_HOME=$HOME/.t3`, telemetry
disabled, and a non-interactive PATH that includes Homebrew, Codex, and OpenCode
locations. The `t3-code-linux` cask owns the Desktop AppImage. Both packages are
built from one pinned upstream commit by the paired T3 CI job.

## Migrate an existing user service

Run these commands as the T3 user, from this repository checkout. The first
command only inspects the two known legacy units; it does not start or stop
anything:

```bash
bash scripts/migrate-t3-homebrew-service.sh
```

Before applying, record which legacy unit was active and enabled so you can
restore that exact unit if you roll back:

```bash
systemctl --user is-active t3code-homebrew.service
systemctl --user is-enabled t3code-homebrew.service
systemctl --user is-active t3code.service
systemctl --user is-enabled t3code.service
```

If both legacy units are active, inspect them and choose one before migration;
do not restart both. Once the dry-run plan names only the intended legacy
services, apply it:

```bash
bash scripts/migrate-t3-homebrew-service.sh --apply
```

Migration and Desktop updates share the lock at
`${XDG_STATE_HOME:-$HOME/.local/state}/t3code/homebrew-update/update.lock`,
so neither can start or replace the service during the other operation. It
recognizes only `t3code-homebrew.service` and `t3code.service` in the current
user's systemd unit directories. Before stopping the active service, it saves
the exact unit as a same-filesystem hard link, with its original path/state, under
`XDG_STATE_HOME`/`~/.local/state/t3code-homebrew-service-migration/legacy`, then
atomically replaces the unit at its original path with a `/dev/null` mask. This
masks at the same, highest-priority path that contained the original unit, so
systemd cannot restart it during the handoff. It then checks for other T3 CLI
processes and listeners on port 3773, starts
`brew services start t3code-cli-main`, and verifies that systemd reports its
unit active. The original files are preserved in the migration state directory;
nothing under `~/.t3` is read, moved, or deleted. If systemd cannot determine a
unit's state, migration stops before changing services. Refusal messages do not
print raw `ExecStart` values.

If Homebrew activation fails and no other T3 server is found, the script stops
and unregisters any partially registered Homebrew unit, restores the original
legacy unit files, reloads systemd, and restarts the previously active unit. If
another T3 process, listener, or unverifiable state remains, it leaves the
legacy unit masked at its original path with the original file preserved in the
migration state directory. Identify the conflict before restoring a legacy
unit. Do not start the Homebrew service manually while a legacy T3 service is
active.

The script refuses to reconcile two active legacy units or an already active or
enabled Homebrew unit alongside a legacy unit. It also serializes concurrent
migrations, checks for a T3 CLI process on any port, and checks port 3773 after
stopping legacy services. If another listener remains, the legacy unit stays
masked at its original path, so it cannot start a second server. Identify and
stop that listener before restoring the saved unit.

Check the resulting service state with:

```bash
brew services info t3code-cli-main
systemctl --user is-active t3code-homebrew.service
systemctl --user is-active t3code.service
```

The Homebrew service should be running; both legacy units should be inactive
and masked. `systemctl` may report an inactive or unknown unit when a legacy
unit was not installed.

## Update from the T3 Desktop

The packaged Linux Desktop's update control uses the Homebrew provider. It
updates only this local CLI/Desktop pair; it does not update remote T3 servers
or provider packages. Its status and confirmation show both package identities
(`t3code-cli-main` and
`t3-code-linux`), their current and target versions, tap source, and the shared
12-character upstream source commit. The suffix in each paired version must
match that commit.

The flow has separate check, prepare, and install steps:

1. **Check** verifies that the running Desktop matches the installed cask, the
   installed CLI and Desktop versions match, and the tap offers a matching pair.
   It refreshes Homebrew metadata as the current user. No package is installed.
2. **Prepare** fetches both matching Homebrew artifacts and rechecks the target
   pair. Fetching does not install either package.
3. **Install** opens an explicit confirmation listing both version changes and
   the source commit. It warns that T3 Code and local servers will close. Only
   after confirmation does the Desktop hand off to a detached helper running as
   the same user.
4. The helper waits for the Desktop and its AppImage children to exit, then
   checks and updates the package pair. It stops the Homebrew T3 service only
   when that service was active before the update, and restarts it only in that
   case. If it was inactive, it remains stopped.
5. After a successful pair install, the helper relaunches the Desktop. T3 reads
   the helper result, displays a success toast, and reconnects to the T3
   environment. It also relaunches after recoverable failures when the previous
   pair and service state have been restored, so the failure result can be
   shown in a toast. If recovery cannot be verified, the helper leaves the
   service stopped and does not relaunch the Desktop automatically; review the
   log before reopening it.

The helper validates the installed and candidate pair again at each stage, so a
stale check or tap change fails closed. It records its lock, log, and result
under `${XDG_STATE_HOME:-$HOME/.local/state}/t3code/homebrew-update/`; nothing
in `~/.t3` is used for update bookkeeping. For status outside the Desktop, run
`brew services info t3code-cli-main`.

## Recovery and rollback

If the CLI formula upgrade succeeds but the cask upgrade fails, Homebrew's cask
transaction restores the previously installed Desktop. The helper relinks the
retained previous formula keg, then verifies that the CLI and cask versions
match again. When that pair is verified, it restores the service only if it was
active before the update and reports the failure in the Desktop toast.

If the helper cannot verify recovery of the previous package pair, it leaves
the Homebrew service stopped and records a failure result. The Desktop remains
closed on this path. Review the helper log before reopening or starting a
service; do not start a legacy `t3code-homebrew` or `t3code` service alongside
Homebrew.

If both packages are installed at the matching target version but the service
cannot be restarted or verified, the pair remains installed. The helper reports
the service error rather than rolling back a valid pair. Review the log and
service status before retrying:

```bash
brew services info t3code-cli-main
systemctl --user status homebrew.mxcl.t3code-cli-main.service
```

If you are also rolling back to a tap revision from before Homebrew service
support, restore only the saved legacy unit that was active before migration.
For example, if `t3code-homebrew.service` was the sole active unit:

```bash
set -euo pipefail
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/t3code-homebrew-service-migration/legacy"
unit=t3code-homebrew.service
unit_path="$(cat "$state_dir/$unit.path")"
if [[ ! -L "$unit_path" || "$(readlink "$unit_path")" != /dev/null ]]; then
  echo "Refusing to overwrite a changed legacy unit at $unit_path." >&2
  exit 1
fi
restore_temp="${unit_path}.restore.$$"
ln -P -- "$state_dir/$unit" "$restore_temp"
mv -Tf -- "$restore_temp" "$unit_path"
systemctl --user daemon-reload
active="$(sed -n 's/^active=//p' "$state_dir/$unit.state")"
if [ "$active" = true ]; then systemctl --user start "$unit"; fi
```

If both legacy units were active before migration, leave them stopped until you
identify the single unit to restore. The original unit and its enabled/active
state are saved alongside the path. Never run `brew services start` while the
restored legacy server is active.

## Update ownership and policy limits

Do not run upstream `t3 update` or `t3 service install`. The CLI updater
downloads upstream release archives; its service installer creates a separate
`t3code.service` targeting the upstream-managed `~/.t3/runtime` launcher. The
Homebrew Desktop update button updates the tap's paired formula and cask; it
does not configure an Electron updater feed or use upstream release binaries.

The Homebrew provider defers to managed T3 update policy. In particular,
`limits.updates.mode: "off"` disables updates, and an administrator-managed
`limits.updates.feedUrl` is not replaced by the Homebrew source. On Linux this
policy is read from `/etc/t3code/policy.json` ([pinned source path](https://github.com/pingdotgg/t3code/blob/6577c6b6185167c0e502fa01f9e8e8f2dee6ff25/packages/shared/src/managedPolicyFile.ts#L35-L46)).
It is system-wide, not scoped to the Homebrew cask, and also affects CLI update
policy ([pinned CLI policy check](https://github.com/pingdotgg/t3code/blob/6577c6b6185167c0e502fa01f9e8e8f2dee6ff25/apps/server/src/cli/update.ts#L367-L376)).
Homebrew does not create, overwrite, or merge the admin policy. Coordinate
policy changes with the administrator; never replace an existing policy to
enable the Homebrew button.
