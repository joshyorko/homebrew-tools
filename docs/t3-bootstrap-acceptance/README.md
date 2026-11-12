# T3 bootstrap ownership regression

The replay source is upstream `26e769d6c4fd955429595828ac572efeca006168`.
The context-only tap baseline is `8d2ce99189aec7c01f00b8b33ea3348b85dec476`.

The regression calls the actual `DesktopApp.bootstrap` Effect with a real exclusive
SQLite ownership lock and the Effect test clock. Electron and the external owner
probe are test doubles; settings use the real in-memory settings layer. Exporting
the existing bootstrap Effect is the only test seam added to the baseline.

- [Baseline replay](bootstrap-red.log): two failures, three passes. Successful
  recovery and cancellation reach the generic error dialog instead of recovery.
- [Repaired replay](bootstrap-green.log): all five cases pass, including the
  ownership grace, successful attachment without local backend startup, refusal,
  cancellation, transient release, and the disabled-local-environment bypass.
- [Affected suites](affected-tests-final.log): eight suites, 78 tests pass.

These lightweight runs use Vite+ 1.4.0, Effect 4.1.2, Node 26, one test worker,
and two CPU affinity slots. Dependencies were installed with scripts disabled.
The candidate build explicitly selects `DesktopApp.homebrew.test.ts` before
packaging. A standalone TypeScript check reports no errors in the changed files,
but reports diagnostics elsewhere with the temporary test setup. It is not the
candidate type-check gate and does not establish a project type-check pass.

The resumed Harvester replay completed at the original failed upstream SHA:

- Desktop candidate `f5fa0cc` passed 111 selected tests, the mandatory type-regression
  gate, AppImage build, Homebrew audit/install, and verified export.
- [The successful type report](remote-typecheck-passed.json) has no new attachment
  diagnostics and zero server/shared diagnostics. It retains 35 measured inherited
  updater diagnostics; this is not a globally clean type check. The earlier
  [failed report](remote-typecheck-first-failed.json) is retained separately.
- [All four packaged GUI cases](remote-gui-passed.json) passed under harness
  `287d314`, including real connection/reconnection and preservation assertions.
  [The renderer-readiness experiment](renderer-premise.md) distinguishes the
  actual application renderer from a transient unloaded Electron window.
- CLI candidate `287d314` passed packaging, Homebrew install and `brew test`.
  Its verified artifact uses the same upstream SHA and version as Desktop.

[The acceptance summary](remote-acceptance-summary.json) records full tap/upstream
SHAs, checksums, storage admission, and persistent control-client evidence paths.
[The execution ledger](remote-execution.json) records run/engine/VM identity and
the separate [final cleanup result](remote-cleanup.json): workspace, machine and
VM are Stopped, with the original VM/PVC identities and disk/cache preserved.
The summary was captured before cleanup. Historical `/tmp` paths are provenance
only; retrieve full artifacts, logs and screenshots from the persistent control
host directory recorded in those receipts. Its size is 420,661,295 apparent bytes.
Three owned failed VM snapshots remain intentionally retained for forensics;
their exact paths and sizes are listed in the cleanup receipt.
The interrupted workstation build and failed attempts are not passing evidence.

The [prior hosted job](https://github.com/joshyorko/homebrew-tools/actions/runs/43209702514/job/131154639591)
at the context-only tap head built and installed both packages from upstream
`9771c5fd2df6568c7a4ac8a2263ed1e58535f9b5`, but the first packaged attachment
scenario failed while waiting for the recovery dialog. Its uploaded failure is
retained in [context-only-hosted-failure.txt](context-only-hosted-failure.txt).
This is not acceptance of the functional repair or of the original failed SHA.

The acceptance-only CI workflow can also replay the exact failed source:

```sh
gh workflow run tap-ci.yml --repo joshyorko/homebrew-tools --ref patchraptor/fix-homebrew-actions-job -f t3_source_ref=26e769d6c4fd955429595828ac572efeca006168
```

The paired job records the tap head, checked-out commit, and immutable upstream SHA
in its uploaded evidence. It retains the existing candidate type checks, package
installation checks, and four packaged GUI scenarios. The dispatch does not publish
packages or change the auto-update source channel.

The separate compatibility preflight runs without dependency installation. It
shares production patch ordering, checks independent Desktop and CLI trees, and
fails the auto-update resolve job before its package matrix starts. It also runs
before paired PR CLI acceptance. The final patch bytes pass both variants at
[the original source](final-original-source-preflight.log) and
[the newer 476fc9be source](final-newer-source-preflight.log), while
[merged-main base patches fail there](base-newer-source-rejection.log).
It saves wasted builds; it does not detect semantic changes such as the bootstrap
bypass. Publication, source channels and cadence are unchanged.
