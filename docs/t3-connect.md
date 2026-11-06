# T3 Connect public configuration policy

Audited 2026-11-06 against the pinned upstream source
[`6577c6b6185167c0e502fa01f9e8e8f2dee6ff25`](https://github.com/pingdotgg/t3code/tree/6577c6b6185167c0e502fa01f9e8e8f2dee6ff25),
the source both published packages were built from (`main.20261106111159.6577c6b61851`).

## What ships

Both Homebrew T3 build paths supply the same public T3 Connect identifiers. Paired
CI selects one immutable upstream commit for both packages. The audit above uses
the currently referenced source; corrected artifacts have not yet been built or published:

- `t3code-cli-main` (the `t3` CLI formula)
- `t3-code-linux` (the Desktop AppImage cask)

The four values come from the pinned upstream `.env.example` /
[T3 Connect setup](https://github.com/pingdotgg/t3code/blob/6577c6b6185167c0e502fa01f9e8e8f2dee6ff25/docs/operations/connect-setup.md)
and are the production public identifiers baked into official release builds:

```dotenv
T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsudDMuY29kZXMk
T3CODE_CLERK_JWT_TEMPLATE=t3-relay
T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=hzxSgY2cH10sDU2r
T3CODE_RELAY_URL=https://relay.t3.codes
```

These are client-visible identifiers. No Clerk secret key, relay credential, OAuth token,
signed macOS passkey setting, OTLP token, or developer `.env` is added, and optional OTLP
configuration stays disabled.

## Why it was missing

Upstream disables T3 Connect in a fresh clone. `scripts/lib/public-config.ts`
(`loadRepoEnv`) reads the repository-root `.env`/`.env.local` with the process environment
taking precedence, and the web, desktop, and bundled-server Vite/tsdown configs turn those
inputs into build-time defines (`__T3CODE_BUILD_RELAY_URL__`, `VITE_*`) before compilation.
The Dagger build stages downloaded the pinned commit, deleted `.git`, and built without ever
supplying those inputs. Upstream's `hasCloudPublicConfig` gate in
`apps/server/src/cloud/publicConfig.ts` disables Connect without them. The issue reports
the unavailable command in the CLI. Desktop uses the same unconfigured source-build
path, but its prior compiled feature state has not been independently verified;
QR LAN pairing does not prove cloud Connect availability.

## How it is supplied

`dagger/tap-pipeline/src/install-checks.ts` is the single audited source. It validates the
allowlist, and both `buildT3Artifact` and `buildT3CodeArtifact` apply it with
`withT3PublicConnectConfig(...)` to the build container **before** `pnpm install` and any
compilation. Because upstream prefers the process environment, the same four values reach the
standalone CLI bundle, the Desktop frontend, and the Desktop's embedded server from one place.

### Fail-closed guarantees

- `validateT3PublicConnectConfig` throws on a missing, empty, untrimmed, malformed,
  duplicated, or unexpected setting (bad publishable-key shape, non-HTTPS relay origin,
  relay URL with a path/query/fragment).
- `t3PublicConnectDriftGuardCommand` runs in the build container after checkout and before
  install. It fails the build when the pinned `.env.example` no longer documents an audited
  value, or when the pinned upstream source no longer consumes the public configuration
  (`loadRepoEnv`/`baseEnv = process.env` precedence plus the server, web, and desktop build
  markers).
- The runtime acceptance checks below fail when a future package silently strips the
  configuration from a built artifact.

## Acceptance surfaces

- `ci-check --package-id=t3code-cli-main` installs the just-built formula, then runs
  `t3 connect --help` with the four variables unset, an isolated `HOME`, and a bounded
  timeout. It asserts the real `t3 connect` command is present and the placeholder is not,
  without signing in or starting a service.
- `ci-check --package-id=t3-code-linux` installs the just-built cask and inspects the
  extracted `squashfs-root/resources/app.asar`, asserting the bundled web client is present
  and every audited public value occurs somewhere in the archive. This archive-wide
  check does not independently prove that both the frontend and server consume each value.
- The published-artifact plans in `install-checks.ts` carry the same checks so a released
  artifact is validated after publication.
- `tests/t3-public-config.test.ts` executes the drift guard, gate, and AppImage-shell checks
  against fixtures; it fails if the guard stops rejecting drift or the checks stop requiring
  the compiled values.

These checks target build feature availability. Only fixture tests have run locally;
the candidate builds, real Homebrew installation checks, and frontend/server parity
acceptance remain pending. They do not prove external reachability, authenticated cloud
use, Android/Desktop-close durability, or thread integrity.

Local verification for this change: all five public-config tests passed. The full pipeline
suite reported 156 passed, eight failed, and one skipped. Failures reported a missing Ruby
command and host shell-profile errors in the Buzz and Devsy checks. Tests ran sequentially
in a systemd cgroup capped at 64 tasks, 768 MiB, one CPU, and 30 seconds. A separate
12-task, three-second probe verified process-limit enforcement and whole-cgroup cleanup.
No fixture or test-cgroup processes remained afterward.

## Runtime and service behavior

- The Homebrew `t3` launcher runs the bundled entry with Homebrew `node@24` and
  unconditionally exports `T3CODE_TELEMETRY_ENABLED=false`; the cask launcher does the same
  and runs the extracted `AppRun` with `--no-sandbox`. Package names and service behavior are
  unchanged.
- Build defaults are intended to travel with the bundle into service startup. The service
  runtime selection and propagation of the telemetry policy still need verification at
  the selected upstream commit. Launcher tests do not prove managed-service behavior.
- `~/.t3/service.env` is an operator override layer parsed by the service launcher. Because
  upstream reads `process.env` ahead of the embedded build defaults, a value such as
  `T3CODE_RELAY_URL` or `T3CODE_HOST` in `service.env` overrides the packaged default for
  that machine. Do not add these variables unless deliberately overriding; this tap never
  reads or rewrites a user's real T3 home.

## Scope and rollback

- This is a build feature-parity change. The separately investigated hostname-resolution
  failure (`prod-*.t3coderelay.com` NXDOMAIN on Dakota's resolver) remains unresolved;
  a packaging fix is not supported as its remedy and DNS changes are out of scope.
- Rollback is a revert to the previous tap commit and its immutable release assets
  (`t3code-cli-main-main.20261106111159.6577c6b61851.tar.gz`,
  `T3-Code-main.20261106111159.6577c6b61851-x86_64.AppImage`); no republish is part of this
  change.
