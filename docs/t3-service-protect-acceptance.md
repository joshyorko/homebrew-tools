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

The Dagger build/install run was interrupted before completion. The real
systemd runner has not yet completed. Native installed-runtime acceptance and
two competing verified services remain open. Live Dakota acceptance is not
authorized and has not run. No formula publication, merge, or release occurred.

Run local Dagger commands through `bash scripts/dagger-limited.sh`. It creates
a private engine with 2 CPUs, 3 GiB RAM, 4 GiB RAM plus swap, and 512 processes,
then checks the configured and effective cgroup limits before any build.
Run heavy jobs sequentially. A budget failure must fail the build, not prompt
an automatic increase in its limits.

After exporting a candidate bundle, run:

```sh
bash scripts/t3-service-protect-smoke/run.sh \
  <bundle>/artifacts/<candidate>.tar.gz \
  <bundle>/homebrew/t3code-cli-main.rb \
  <new-output-directory> \
  d2c25950b4d9183ea342d5d5fc14c326b9e0172a
```

The runner installs through Linuxbrew in a disposable, resource-limited
systemd container. Its report separates fixture proof from live acceptance.
It does not mount the host home, systemd directories, or cgroup filesystem.
Protection and undo never restart a server; the fixture's explicit restart
applies only to its own container service.
