# Faster tap CI without weaker acceptance

## What CI proves

The package registry remains the source of truth for change routing. Every selected
package has a visible reason and one of two modes:

| Change | Check |
| --- | --- |
| Documentation or known regression-test edits | Regression suites; no package rebuild |
| Cask or formula edits | Install the committed, checksum-verified artifact and exercise package checks |
| Builder or packaging helper edits | Full source build and checks for registered consumers |
| Dagger function, constant, registry entry, or artifact-plan edits | Full checks for consumers whose reachable TypeScript declarations changed |
| Comment/formatting-only JavaScript or TypeScript edits | Regression suites only, after equal parsed/printer output |
| Any `tap-ci.yml` edit | Regression suites and full PR-enabled source-build matrix |
| Shared package execution steps, dependencies, runtime configuration, or unproved inputs | Fail-safe full builds |
| Mixed artifact/build inputs for one package | Full build wins |
| Unknown production pipeline inputs | Conservatively run full builds |

Published-artifact checks must not replace a missing asset with a newer upstream
release, change its checksum to `:no_check`, disable a runtime assertion, or report
a download failure as success. An artifact check proves packaging and installation;
it does not claim that upstream source was rebuilt. Source builds and release
workflows retain their existing build and runtime gates.

The planner runs locally on the GitHub runner with Node and Git. It does not need
to start Dagger, pull a build image, or install APT packages to select a matrix.
PRs compare the native merge-base; pushes compare exact before/head commits.
Both sides of renames are considered, and invalid Git references fail the plan.
The path-only Dagger entrypoints remain conservative when source contents are
unavailable; the runner's `scripts/plan-tap-ci.mjs` applies change-aware routing.

The runner installs the existing pinned TypeScript compiler with lifecycle scripts
disabled, then compares reachable declarations in both Git trees. Package CI and
artifact-check roots follow local named imports, method calls, constants, types,
and shared helpers. Explicit `packageId` switches and equality guards are
specialized; other conditions remain conservative. Registry entries include
registered recipe dependents. Artifact plans are selected by package key.
Unknown paths, missing/deleted source modules, parse errors, unsupported local
imports or top-level side effects fall back to the full matrix. Runtime dependency
and module-config changes retain full coverage. Release workflows and their gates
are unchanged; changes confined to registered release orchestration and auto-update
slots run regression checks rather than rebuilding PR packages.

Examples verified against actual source diffs in `tests/impact.test.ts` and native
Git fixtures in `tests/planner.test.ts`:

- A Codex MemoryD `ciCheck` case edit selects Codex MemoryD, not Buzz or 15 other packages.
- An RCC registry URL edit selects RCC. Mixed recipe/build inputs keep build mode.
- A `t3BaseContainer` edit selects the T3 CLI and Desktop consumers.
- A shared Homebrew image edit selects all PR packages.
- A comment-only monolith edit selects no package jobs; every workflow edit selects the full matrix.
- An unknown added module or deleted dependency retains the fail-safe full matrix.

The regression suites still run on every PR. Every `tap-ci.yml` edit triggers
the full PR-enabled source-build matrix because the planner does not parse and
prove workflow semantics. This includes reporting-only and formatting changes;
keep workflow edits focused and account for the additional CI cost. Permission,
job gating, environment, tool setup, test execution, and planner output changes
therefore cannot be masked as regression-only changes.
The planner selects package jobs only; it does not validate GitHub token
permissions or guarantee that workflow conditions allow those jobs to execute.
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
