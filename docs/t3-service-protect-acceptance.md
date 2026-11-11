# T3 service protection qualification

Issue: https://github.com/joshyorko/homebrew-tools/issues/185

Upstream source: `d2c25950b4d9183ea342d5d5fc14c326b9e0172a`.
The CLI-only patch is checked before application and tested before bundling.
Upstream changes to unit properties, runtime layout, or the formula's exact
launcher bytes must pass those checks again. Unknown layouts fail closed.

## Design

Protection resolves one verified native or Homebrew unit before confirmation
and verifies it again before mutation. Plan, status, and undo use that unit.
Native hot updates can retain an older installed launcher process while
repointing the unit to a newer installed runtime; both identities are checked.
Existing budgets, privileged confirmation, shared cleanup, and partial-failure
ordering remain upstream-owned.

Unit aliases were rejected because migration masks and lifecycle helpers depend
on the existing names. Formula post-install protection was rejected because it
would bypass the interactive preview, sudo, and undo contract.

## Source evidence

Before the workstation reboot, these checks ran against the patch:

- The Homebrew target regression failed on the original upstream protection
  plan, which selected the native drop-in instead.
- The native hot-update regression failed before its ownership correction.
- From `apps/server`, `pnpm exec vp test run --maxWorkers=1
  src/cloud/serviceProtection.test.ts src/cloud/serviceProtectionTarget.test.ts
  src/cli/service.test.ts` passed all 56 tests after correction.
- From `apps/server`, `pnpm exec effect-tsgo tsrs --noEmit --pretty false`
  exited 0. The compiler reported existing suggestions, with no errors.
- The web build and `pnpm --filter t3 run build:bundle` completed.
- The tap suite passed 207 tests with one skip. After reboot, the targeted
  `ci-regressions.test.ts` and `planner.test.ts` run passed all 59 tests.
- Independent Codex inspection accepted the final protection patch and found
  no additional proven production defect or actionable comment suppression.

The reboot erased the original `/tmp` logs and candidate archives. These are
historical source results, not installed package or live-host acceptance.

## Artifact and runtime gates

The first complete bounded Dagger build/install run passed, including formula
tests, the resource monitor handshake, and the compiled Connect command.
Its real systemd run then exposed an ownership-query defect: systemd omits an
empty `EnvironmentFiles` array even with `--all`. A direct D-Bus probe confirmed
an empty array, while a nonempty list appeared in both outputs. The CLI now
models that optional empty list correctly and still rejects nonempty file
lists or missing required ownership fields. The regression fixture reproduces
the omission. Qualification of that correction is in progress. The earlier
candidate receipts remain tied to their exact builds.

The property-format probes use a controlled `sleep` unit, not a T3 server.
They establish formatting only. Actual T3 ownership must pass the packaged
CLI and real-service scenarios separately. The source-only patch applies
after dependency installation so unchanged dependencies can remain cached;
a regression rejects manifest changes in that patch.

Native installed-runtime acceptance and two competing verified services remain
open. Live Dakota acceptance is not authorized and has not run. No formula
publication, merge, or release occurred.

The first bounded run exited 134 during workspace-wide test discovery.
The engine's process-limit counter increased while its OOM-kill counter stayed
at zero. The focused test command now runs from `apps/server` instead of
loading the other workspace test configurations. The resource budget stays
unchanged.

Package-scoped tests then failed to spawn Node with `EAGAIN`. The quota still
exposed CPUs `0-19` through affinity. The launcher now also pins two CPUs;
the kernel reports `0-1`, and a real Dagger child reports two available CPUs.
The dedicated engine was restarted under that affinity, retaining all memory
and process limits. No running T3 service was restarted by this task.

Run local Dagger commands through `bash scripts/dagger-limited.sh`. It creates
a private engine with 2 CPUs, 4 GiB RAM, 5 GiB RAM plus swap, and 512 processes,
then checks the configured and effective cgroup limits before any build.
Run heavy jobs sequentially. A failed run never increases its own limits. Any budget change must remain
explicit and leave room for the workstation and other processes.

After exporting a candidate bundle, run:

```sh
bash scripts/t3-service-protect-smoke/run.sh \
  <bundle>/artifacts/<candidate>.tar.gz \
  <bundle>/homebrew/t3code-cli-main.rb \
  <new-output-directory> \
  d2c25950b4d9183ea342d5d5fc14c326b9e0172a
```

An optional fifth argument supplies the upstream `v0.1.9` Linux x64 native
archive, verified against release asset SHA256
`0141025335da334759cecd8db3483e09772f3600ca03674698524e7d94291362`.
That fixture uses a fresh T3 home and the release's protocol-3 runtime layout;
it does not invoke the native installer or updater. The Homebrew-packaged CLI
then previews, applies, reads effective status, and undoes native protection.
The runner requires an actual HTTP server response for both owners.

The runner installs through Linuxbrew in a disposable, resource-limited
systemd container. Its report separates fixture proof from live acceptance.
It does not mount the host home, systemd directories, or cgroup filesystem.
Its image is built through the same bounded Dagger launcher.
Protection and undo never restart a server; the fixture's explicit restart
applies only to its own container service.

The web build subsequently exceeded the 3 GiB memory budget. Kernel records
showed two worker kills constrained to the dedicated engine cgroup, not a
host-wide OOM. The final explicit engine budget is 4 GiB RAM plus 1 GiB swap,
with two pinned CPUs and 512 processes. The runtime fixture remains capped at
3 GiB RAM plus 1 GiB swap. Heavy jobs run sequentially.
