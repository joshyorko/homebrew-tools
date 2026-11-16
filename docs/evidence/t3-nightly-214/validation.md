# T3 nightly release-note validation

Implementation commits: `a3c09137cca2732a53f62298fdf0a39c368a5b3d`, `981cc01f07e19b9cd1316aab7190809ddfdbf148`, `5bce21f84f1cf19228476e0708b19e4620b655d5`, and `51ae476c627fc7f9078ada99ba3a2283e15854e4` (final code).

The replay uses official upstream tag `v0.1.10-nightly.20261116.4774`, peeled to source commit `16695c812fffe75e85f8cc3084d2c561aa3ca93f`. Its downstream package identity is `0.1.10-nightly.20261116.4774.homebrew.1.16695c812fff`. This is an actual upstream nightly, not a relabeled main snapshot. The live default resolver separately verified the newer `.4787` nightly (`b5554ac8114f2ce7ce8b5973690ccb8cbb248efd`) and matching npm nightly availability.

Josh explicitly authorized local container builds for this task after the existing remote builder was absent. No Harvester workspace was provisioned. Builds use local Dagger; GUI proof uses the repository's disposable Docker runner. No installed workstation package, user service, release, or merge was changed.

## Completed checks

- Lightweight tap, helper, patch, promotion and UI-runner suite: 245 passed, zero failed, one existing optional Devsy artifact test skipped. Repeated on the final code snapshot committed as `51ae476`.
- All maintained CLI/Desktop patches apply in production order to pristine trees at the chosen upstream SHA.
- Desktop source acceptance: 83 tests passed. Type checks for Desktop, web, contracts, server and shared: zero baseline or patched diagnostics.
- CLI source acceptance: 81 tests passed. Final Linuxbrew CLI smoke passed audit/install, `brew test`, resource-monitor handshake, telemetry launcher check, Connect command availability, and exact `t3 v0.1.10-nightly.20261116.4774` runtime assertion. The first new version assertion expected a bare version; corrected to upstream's actual output format.
- Homebrew's actual version comparison places the previous main snapshot below the new nightly package identity; the existing formula version scheme is retained.
- Independent review found a producer/consumer byte-budget mismatch and the old embedded updater's migration limit. Collection now bounds the complete serialized UTF-8 provenance payload; migration is documented in the lifecycle guide.

## Commands

The local test executable is the existing Node 24 installation; the default host Node could not load its shared library. Test dependencies are confined to this worktree.

```sh
export PATH=/home/linuxbrew/.linuxbrew/Cellar/node@24/24.22.3_1/bin:$PATH
node --experimental-strip-types --test dagger/tap-pipeline/tests/*.test.ts scripts/apply-release-bundle.test.mjs scripts/t3-source-patches.test.mjs scripts/check-t3-source-types.test.mjs scripts/t3-homebrew-desktop-e2e/*.test.mjs
node scripts/check-t3-patches.mjs --source-ref 16695c812fffe75e85f8cc3084d2c561aa3ca93f --package-ids '["t3code-cli-main","t3-code-linux"]' --repository /tmp/t3-214-upstream
```

Local Dagger commands supply `--git-dir=/tmp/t3-214-tap.git`, an isolated Git metadata mirror because this worktree's `.git` is a file. The existing GitHub credential is supplied as a Dagger secret through `--github-token=env:GH_TOKEN`; no plaintext credential is recorded.

```sh
dagger -m ./dagger/tap-pipeline --git-dir=/tmp/t3-214-tap.git call ci-check --package-id=t3code-cli-main --github-token=env:GH_TOKEN --t-3-source-ref=16695c812fffe75e85f8cc3084d2c561aa3ca93f --t-3-source-version=0.1.10-nightly.20261116.4774.homebrew.1.16695c812fff
dagger -m ./dagger/tap-pipeline --git-dir=/tmp/t3-214-tap.git call ci-check --package-id=t3-code-linux --github-token=env:GH_TOKEN --t-3-source-ref=16695c812fffe75e85f8cc3084d2c561aa3ca93f --t-3-source-version=0.1.10-nightly.20261116.4774.homebrew.1.16695c812fff
bash scripts/t3-homebrew-desktop-e2e/run.sh /tmp/t3-214-desktop-fixed.AppImage /tmp/t3-214-notes-ui-final nightly-notes
```

## Packaged update UI

The corrected candidate built from the `981cc01` source snapshot has SHA256 `459cdfacaaa85afb34791b1243388be102973fc4475aa2ab4cfe7e9090d02bf2`. The final code commit `5bce21f` changes only schedule/formula descriptions relative to that snapshot. The runner subsequently adds one onboarding click to reach the sidebar on a fresh fixture.

The real packaged Electron app passed the notes-only runner with the actual helper and synthetic Homebrew/systemd state. Its extracted test copy claims the retained `.4749` installed baseline; its actual runtime remains `.4774`. The report explicitly records that synthetic identity. This proves a skipped-nightly view without upgrading the workstation or claiming an old installed binary was migrated.

- [Available screenshot](nightly-notes-available.png): visually inspected; two upstream highlights, footer, exact publication ages, and both release groups are visible.
- [Downloaded screenshot](nightly-notes-downloaded.png): visually inspected; the same notes remain after preparation.
- [Machine-readable result](report.json): the stats click invokes Electron's external opener with the canonical upstream `.4774` release URL. The opener is intercepted, so no host browser launches and no external page load is claimed. The helper command log remains unchanged by the click; no install is invoked anywhere in this scenario.

The counts are read from packaged upstream notes, not hardcoded targets. The first candidate omitted the provenance resource; the real GUI test caught it. Commit `981cc01` includes that resource and verifies the installed payload. A subsequent runner failure exposed the fresh-install welcome screen, resolved by clicking its normal **Start without an agent** control.

## Final validation and limits

Final CLI and Desktop Linuxbrew smokes passed. Desktop validates its installed helper, build identity, upstream provenance, launchers, desktop/icon integration, telemetry setting and public Connect payload.

The existing upstream DesktopUpdates policy/retry, releaseNotes, updateMachine and githubUpdateFeed suites passed: 78 tests across four files, with both maintained Desktop patches applied. The reproducible container recipe is `upstream-update-tests.Dockerfile`. Its source context is the exact nightly checkout with `t3-homebrew-desktop-update.patch` applied; the final build stage applies the service-attach patch through its named context.

```sh
docker build --build-context tap="$PWD/patches" --output=type=cacheonly -f docs/evidence/t3-nightly-214/upstream-update-tests.Dockerfile /tmp/t3-214-upstream
```

Cache-only output avoids exporting/unpacking an unnecessary dependency image. The earlier image export completed slowly; the final full-patch test run succeeded in the build stage. Only this task's test containers and image are removed; shared Docker/Dagger caches are preserved.

The added browser-specific Vitest fixture was not run separately. The actual packaged Electron screenshot/click scenario passed, as did all source type checks. No live main-to-nightly migration or workstation upgrade was run.

The old main-snapshot updater cannot recognize nightly versions. The first transition requires the updated tap helper, as documented in `docs/t3-homebrew-lifecycle.md`. No live migration was attempted.
