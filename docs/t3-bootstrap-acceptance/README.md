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
packaging. A standalone TypeScript pass reports no errors in the changed files,
but reports other upstream diagnostics and is not the candidate type-check gate.

Candidate type checks, Homebrew packaging/install acceptance, and all four packaged
attachment scenarios remain required. The interrupted local Dagger run is not a
pass. New Dagger runs and CI build launches are held at the operator's request.
The [prior hosted job](https://github.com/joshyorko/homebrew-tools/actions/runs/43209702514/job/131154639591)
at the context-only tap head built and installed both packages from upstream
`9771c5fd2df6568c7a4ac8a2263ed1e58535f9b5`, but the first packaged attachment
scenario failed while waiting for the recovery dialog. Its uploaded failure is
retained in [context-only-hosted-failure.txt](context-only-hosted-failure.txt).
This is not acceptance of the functional repair or of the original failed SHA.

After the operator releases the Dagger hold, push the existing PR branch and replay
the exact failed source with the acceptance-only dispatch:

```sh
gh workflow run tap-ci.yml --repo joshyorko/homebrew-tools --ref patchraptor/fix-homebrew-actions-job -f t3_source_ref=26e769d6c4fd955429595828ac572efeca006168
```

The paired job records the tap head, checked-out commit, and immutable upstream SHA
in its uploaded evidence. It retains the existing candidate type checks, package
installation checks, and four packaged GUI scenarios. The dispatch does not publish
packages or change the auto-update source channel.

The separate compatibility preflight runs without dependency installation. It
shares production patch ordering, checks independent Desktop and CLI trees, and
fails the resolve job before the package matrix starts. It saves wasted builds;
it does not detect semantic changes such as the bootstrap bypass.
