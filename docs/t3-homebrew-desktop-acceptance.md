# Packaged Desktop update acceptance

Both cases passed on 2026-11-06 using the actual unpublished source-built AppImage.
The production updater code was built from tap commit
`938ab4f96948950fc1c8a7cba471ef8584d0f27b`, upstream T3 commit
`b90e554e0a942605c4de2d4ff5d4654caf998e27`, package identity
`main.20261106210915.b90e554e0a94`, and Electron application version `0.1.7`.

Candidate AppImage SHA256:
`39c0051d8e6b0938e61bbcbf3aec64ca95ba5f2c11a4c82b441057c313846780`.

The runner used Playwright Core 1.60.0 and Xvfb in a disposable Node 26 Debian
container as an unprivileged user. The application container had no network,
no host Home mount, and no real credentials. It ran the shipped Electron UI,
preload/IPC, update provider and shell helper; Homebrew and systemd were fakes.

| Case | Observed result | Report |
| --- | --- | --- |
| Successful paired update | Real UI check, preparation, Cancel with no installation, Confirm, Desktop exit, ordered service stop/package actions/start, relaunch, success toast and local backend WebSocket reconnection | [success.json](t3-homebrew-desktop-acceptance/success.json) |
| Cask installation failure | Same UI/confirmation flow, failed cask action, prior formula keg relink, prior service state restored, relaunch, failure toast and local backend WebSocket reconnection | [failure.json](t3-homebrew-desktop-acceptance/failure.json) |

Both runs started with a fresh profile and no previous update-result file.
They verified the actual IPC schema, package/source versions in the update
control, no package replacement while the old Desktop was alive, and
preservation of an explicit nondefault `T3CODE_HOME` and a synthetic user-data
marker. No account login, T3 Connect or Tailscale operation was performed.

## Reproduce

Use a new output directory for each case:

```bash
bash scripts/t3-homebrew-desktop-e2e/run.sh /path/to/candidate.AppImage /tmp/t3-ui-success success
bash scripts/t3-homebrew-desktop-e2e/run.sh /path/to/candidate.AppImage /tmp/t3-ui-failure failure
```

The output includes the artifact checksum, JSON report, logs and screenshots.
The runner removes only its own container and image tag on exit.

## Boundaries

The fake upgrade changes the extracted candidate's build identity only after
Desktop exits. It does not download or replace real Homebrew artifacts. The
failed cask operation models Homebrew's transaction restoring the previous
cask; the real helper then performs its formula recovery commands against the
fakes. These GUI runs do not prove a real Homebrew upgrade/rollback or a real
user systemd manager. Separate isolated package CI audits and installs the
real formula/cask pair and verifies the shipped helper and manifest.

No live Dakota installation, service, `~/.t3`, credentials or routes were
changed. This PR does not publish a patched AppImage; it ships through a later
normal paired package build after integration.
