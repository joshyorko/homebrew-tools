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

The script recognizes only `t3code-homebrew.service` and `t3code.service` in the
current user's systemd unit directories. It stops active units, disables units
that were enabled, then runs `brew services start t3code-cli-main`. It leaves
the legacy unit files in place and does not read, move, or delete anything under
`~/.t3`. If Homebrew cannot start, the script attempts to restore the prior
active and enabled states. It also verifies that systemd reports the Homebrew
unit active before it completes. Do not start the Homebrew service manually
while a legacy T3 service is still active.

The script refuses to reconcile two active legacy units or an already-active
Homebrew unit competing with a legacy unit. It also checks port 3773 after
stopping legacy services. If another listener remains, it leaves the legacy
units stopped and disabled so it cannot start a second server; identify and stop
that listener before manually restoring the one service you intend to keep.

Check the resulting service state with:

```bash
brew services info t3code-cli-main
systemctl --user is-active t3code-homebrew.service
systemctl --user is-active t3code.service
```

The Homebrew service should be running; both legacy units should be inactive.
`systemctl` may report an inactive or unknown unit when a legacy unit was not
installed.

## Upgrade the CLI and Desktop together

Run as the T3 user. These commands upgrade the already-installed packages; they
do not install a missing package:

```bash
tap_repo="$(brew --repo joshyorko/tools)"
rollback_dir="$HOME/.local/state/t3code-homebrew-rollback/$(date +%Y%m%d%H%M%S)"
mkdir -p "$rollback_dir"
chmod 700 "$rollback_dir"
cp "$tap_repo/Formula/t3code-cli-main.rb" "$rollback_dir/"
cp "$tap_repo/Casks/t3-code-linux.rb" "$rollback_dir/"
printf 'Saved rollback definitions in %s\n' "$rollback_dir"

brew update
brew upgrade joshyorko/tools/t3code-cli-main
brew upgrade --cask joshyorko/tools/t3-code-linux

cli_version="$(brew list --versions t3code-cli-main | awk '{print $2}')"
desktop_version="$(brew list --cask --versions t3-code-linux | awk '{print $2}')"
printf 'CLI: %s\nDesktop: %s\n' "$cli_version" "$desktop_version"
test -n "$cli_version" && test "$cli_version" = "$desktop_version"
```

The shared version has the upstream source commit's 12-character prefix after
the final dot (for example, both current packages are
`main.20261106111159.6577c6b61851`, from commit
`6577c6b6185167c0e502fa01f9e8e8f2dee6ff25`). Paired CI resolves one full commit
and passes it to both package acceptance jobs. If the versions do not match,
stop here and do not restart the service; inspect the tap formula, cask, and CI
source SHA first.

Restart only the Homebrew-owned server, and only after the compatibility check
above succeeds. Restarting interrupts active T3 work:

```bash
brew services restart t3code-cli-main
```

For service status, use `brew services info t3code-cli-main`. Do not use
`t3 service restart`; that command is owned by upstream T3 and is outside this
Homebrew lifecycle.

## Roll back

If a paired upgrade fails, use the saved `rollback_dir` from the upgrade step;
do not delete or reset `~/.t3`. Stop the Homebrew service first so only one
server can own the T3 data and port:

```bash
brew services stop t3code-cli-main
brew reinstall "$rollback_dir/t3code-cli-main.rb"
brew reinstall --cask "$rollback_dir/t3-code-linux.rb"

cli_version="$(brew list --versions t3code-cli-main | awk '{print $2}')"
desktop_version="$(brew list --cask --versions t3-code-linux | awk '{print $2}')"
test -n "$cli_version" && test "$cli_version" = "$desktop_version"
```

If the restored formula still declares the Homebrew service, start it after
the parity check:

```bash
brew services start t3code-cli-main
```

If you are also rolling back to a tap revision from before Homebrew service
support, restore only the legacy unit that was active before migration, and
re-enable it only if it was previously enabled. For example, if
`t3code-homebrew.service` was the sole active, enabled unit:

```bash
systemctl --user enable t3code-homebrew.service
systemctl --user start t3code-homebrew.service
```

If both legacy units were active before migration, leave them stopped until you
identify the single unit to restore. The migration keeps their unit files for
this recovery. Never run `brew services start` while the restored legacy server
is active.

## Update ownership and limitations

Use Homebrew for both packages and the service lifecycle. Do not run upstream
`t3 update` or `t3 service install`: the pinned upstream CLI downloads its own
release archives, and its service installer writes a separate `t3code.service`
that targets the upstream-managed `~/.t3/runtime` launcher. Either can bypass
the formula or create a competing server. The Desktop's “Update everything”
action is not a Homebrew operation and may replace the tap-built app with an
upstream release if an updater feed is configured.

The cask does not configure an updater feed. Upstream therefore shows its
existing “Automatic updates are not available because no update feed is
configured” state; this is accurate, but cannot name Homebrew as the update
owner. The message comes from the pinned upstream [Desktop updater check](https://github.com/pingdotgg/t3code/blob/6577c6b6185167c0e502fa01f9e8e8f2dee6ff25/apps/desktop/src/updates/DesktopUpdates.ts#L342-L347).
Homebrew does not add a fake Electron feed, and the Desktop update button does
not invoke `brew upgrade`.

Upstream supports `limits.updates.mode=off` in the administrator-managed Linux
policy at `/etc/t3code/policy.json` ([pinned source](https://github.com/pingdotgg/t3code/blob/6577c6b6185167c0e502fa01f9e8e8f2dee6ff25/packages/shared/src/managedPolicyFile.ts#L35-L46)).
The updater displays an organization-managed message when that policy turns
updates off ([pinned policy handling](https://github.com/pingdotgg/t3code/blob/6577c6b6185167c0e502fa01f9e8e8f2dee6ff25/apps/desktop/src/updates/DesktopUpdatePolicy.ts#L39-L47)).
The policy is system-wide, not scoped to this cask, and also affects CLI update
behavior ([pinned CLI policy check](https://github.com/pingdotgg/t3code/blob/6577c6b6185167c0e502fa01f9e8e8f2dee6ff25/apps/server/src/cli/update.ts#L367-L376)).
Homebrew does not create or modify it: an existing administrator policy must
not be overwritten or silently merged. If policy-managed Desktop updates are
required, coordinate the complete policy with the system administrator. The
current app cannot provide a truthful Homebrew-specific update message without
application changes or policy management reserved to an administrator.
