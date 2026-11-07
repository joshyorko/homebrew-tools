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

## Homebrew service attach acceptance

All four cases passed locally on 2026-11-07 against the actual AppImage built
with the service-attachment patch at `423bed7` and upstream source
`e455200077ce60806a01c8f28435b58860dcfc74`. The artifact SHA256 is
`a9ee7fb4399de0655343e5b18056a83e9dd7eeb5fb682ac6231b301a1a730b17`.
The build passed 100 focused source tests. First and repeat attachment connected
to the same service; the real API returned the seeded conversation history
using the original bearer credential after Desktop closed. The unknown-owner
case refused attachment, the package-mismatch case opened Connections without
minting a credential, and the manual choice opened `/settings/connections`.
These local runs do not establish hosted CI or source type-check success.
The paired acceptance CI job uploads reports and screenshots for 14 days in
its `t3-service-attach-<commit>` artifact, without databases or credentials.

The issue-175 recovery path is exercised against a source-built AppImage and a
fresh isolated T3 home. The fixture starts a real packaged T3 server inside a
container without external routing or DNS, supplies synthetic same-user systemd metadata, and
launches the packaged Desktop with its default local environment enabled. It
checks the verified-service recovery choice, the in-app pairing confirmation,
connection to the same environment ID, saved reconnection on a repeat launch,
and preservation of an existing project, idle thread, and a pre-existing bearer
credential that remains authenticated through the real service API. Synthetic
file markers, the ownership-lock inode, and a private byte-for-byte backup of
Desktop-only settings are checked as additional evidence. A second case
uses an unrecognized service command and verifies Desktop does not change its
settings or attach to that owner. The package-mismatch case refuses automatic
pairing before database access when the active formula keg and Desktop build
manifest do not identify the same immutable source package. Ownership is checked
again after window creation and immediately before credential delivery.

Build and export the candidate AppImage with the repository's Dagger module,
then run all isolated cases with fresh evidence directories:

```bash
git_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
dagger -m ./dagger/tap-pipeline call \
  --source=. --git-dir="$git_dir" \
  t-3-code-linux-candidate \
  --t-3-source-ref=<40-hex-upstream-commit> \
  --t-3-source-version=<paired-version> \
  export --path=/tmp/t-3-code-linux-candidate.AppImage
bash scripts/t3-homebrew-desktop-e2e/run.sh \
  /tmp/t-3-code-linux-candidate.AppImage /tmp/t3-service-attach service-attach
bash scripts/t3-homebrew-desktop-e2e/run.sh \
  /tmp/t-3-code-linux-candidate.AppImage /tmp/t3-unknown-owner unknown-owner
bash scripts/t3-homebrew-desktop-e2e/run.sh \
  /tmp/t-3-code-linux-candidate.AppImage /tmp/t3-package-mismatch package-mismatch
bash scripts/t3-homebrew-desktop-e2e/run.sh \
  /tmp/t-3-code-linux-candidate.AppImage /tmp/t3-manual-settings manual-settings
```

Each service fixture has an internal interface without a host gateway, external
routing or DNS, a private home and synthetic unlocked session keyring, a 4 GiB memory cap, a 512-task
cap with four-CPU affinity, and a 240-second deadline. It removes only its own container and image.
The `report.json`, screenshots and logs are generated evidence; they do not
prove behavior on a live Homebrew installation or systemd manager.
