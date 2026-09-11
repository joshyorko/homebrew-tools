# Faster tap CI without weaker acceptance

## What CI proves

The package registry remains the source of truth for change routing. Every selected
package has a visible reason and one of two modes:

| Change | Check |
| --- | --- |
| Documentation or known regression-test edits | Regression suites; no package rebuild |
| Cask or formula edits | Install the committed, checksum-verified artifact and exercise package checks |
| Builder, packaging helper, or shared production pipeline edits | Full source build and package checks |
| Mixed artifact/build inputs for one package | Full build wins |
| Unknown production pipeline inputs | Conservatively run full builds |

Published-artifact checks must not replace a missing asset with a newer upstream
release, change its checksum to `:no_check`, disable a runtime assertion, or report
a download failure as success. An artifact check proves packaging and installation;
it does not claim that upstream source was rebuilt. Source builds and release
workflows retain their existing build and runtime gates.

The planner runs locally on the GitHub runner with Node and Git. It does not need
to start Dagger, pull a build image, or install APT packages to select a matrix.
Both sides of renames are considered, and invalid Git references fail the plan.
Runtime fixtures still schedule package checks. Unknown test-like paths are not
assumed to be safe to skip. Versioned cask leaves without a dedicated check fail
planning explicitly instead of checking the unversioned package.

## Scheduling

Tap CI uses GitHub's native concurrency control to cancel an older run of the same
pull request. Main-branch and publication workflows are not cancelled by a newer PR.
Package failures remain independent through `fail-fast: false`; an empty package
matrix still requires the regression job to pass.

## Caching

Use the official Dagger GitHub action and the existing `DAGGER_CLOUD_TOKEN` secret.
Do not wrap the Dagger engine filesystem in `actions/cache` or add a second cache
service merely because a build is slow. Do not restore untrusted PR build caches
into privileged publication jobs without an explicit trust boundary.

Dagger already caches execution layers and supports explicit cache volumes for
package downloads and compiler output. Those are different mechanisms. A Cloud
trace or a populated local cache does not by itself prove cache reuse across fresh
GitHub runners. The diagnostic job summary records local engine entry count and
disk usage without making that stronger claim.

Native inspection on the engine used by a build:

```sh
dagger -s query <<'GRAPHQL'
{ engine { localCache { entrySet { entryCount diskSpaceBytes } } } }
GRAPHQL
```

Cache volumes are scoped to their Dagger module by default. Reusing a volume name
in a different module does not share its contents; share a `CacheVolume` argument
explicitly when that is intended. Existing compiler caches are retained. Their
presence in source is not evidence of remote persistence.

To assess actual reuse, compare two runs of the same immutable source and build
inputs on separate GitHub runners in Dagger Cloud. Check the expensive build
vertices, dependency downloads, compiler output, execution durations and cache
hits. Record layer reuse and compiler-volume reuse separately. A second local
call on the same engine does not establish cross-runner persistence. Never prune
the engine cache as part of this measurement.

## Deferred optimizations

- Persistent or larger runners: evaluate only after measuring cache hits and
  compilation time. They have ongoing cost and maintenance implications.
- Compiler caching or changing Rust release profiles: retain current release
  semantics; do not disable optimization or checks merely to improve CI timing.
- GitHub-hosted compiler-cache export: evaluate supported Dagger cache behavior
  first, including cache size, eviction, concurrency and PR/release trust.
- Build receipts shared across PR and release workflows: require matching source,
  toolchain, lockfiles, packaging inputs and artifact digests before reusing a
  candidate as release evidence.

## Baseline and measurement

The completed [Tap CI run 34601090760](https://github.com/joshyorko/homebrew-tools/actions/runs/34601090760)
used roughly 128 combined job-minutes. Its Buzz job took 35 minutes, VS Code
21 minutes, DevPod 14 minutes, and Codex Desktop 11 minutes. These are total
job durations, including setup, downloads and checks, not compiler-only timings.

Compare the new packaging path on unchanged, committed package versions. Report
planning duration, selected package count, total job-minutes and slowest job
separately. A route-selection test is not a runtime speed measurement. Do not
claim a delivery-time improvement until a hosted artifact check completes.

## Official references

- [Dagger caching](https://docs.dagger.io/features/caching/)
- [Dagger native cache inspection](https://docs.dagger.io/configuration/cache)
- [Dagger 0.21.9 cache-volume scope](https://github.com/dagger/dagger/blob/v0.21.9/docs/current_docs/extending/modules/cache-volumes.mdx)
- [Dagger GitHub action](https://github.com/dagger/dagger-for-github)
- [GitHub concurrency controls](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
