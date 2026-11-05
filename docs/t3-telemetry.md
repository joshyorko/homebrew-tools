# T3 Homebrew telemetry policy

Audited 2026-11-05 against the source used by both published packages that morning:
[`67eebaca23f8f7bc46e8817434087fc9c5acf8e3`](https://github.com/pingdotgg/t3code/tree/67eebaca23f8f7bc46e8817434087fc9c5acf8e3),
version `main.20261105042236.67eebaca23f8`.

## Source evidence

- [`AnalyticsService.ts` lines 67–79](https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/server/src/telemetry/AnalyticsService.ts#L67): `T3CODE_TELEMETRY_ENABLED` defaults to true. The default host is `https://ingest.t3.codes`; `T3CODE_POSTHOG_HOST` can override it.
- [Lines 120–145](https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/server/src/telemetry/AnalyticsService.ts#L120): the runtime flag and managed policy gate analytics. [Lines 199–234](https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/server/src/telemetry/AnalyticsService.ts#L199) gate delivery to `/batch/`; the payload includes hashed identity, install ID, OS/architecture, application version, channel and server mode. Recording is also gated at line 314.
- [`ProviderUsageAnalytics.ts` lines 345–360](https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/server/src/telemetry/ProviderUsageAnalytics.ts#L345): input/output, cached, reasoning and child usage counts are included when available. This supports token reporting, not a claim that every user/turn has complete counts.
- [Upstream telemetry documentation](https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/docs/user/telemetry.md): describes hashed account/device linkage, provider/model/effort, permission mode, outcomes and durations; says the endpoint retains events and forwards them to PostHog. It excludes prompts, responses, file contents, authentication tokens, conversation IDs and raw provider output. These are source/documentation observations, not a capture of production traffic or an audit of the remote ingest service.
- [`otelEnvironment.ts` lines 321–332](https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/packages/shared/src/otelEnvironment.ts#L321): the same false value disables relay tracing. Upstream documents relay traces going to Axiom.
- [`DesktopShellEnvironment.ts` lines 464–485](https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/desktop/src/shell/DesktopShellEnvironment.ts#L464): shell discovery only fills this variable if missing; inherited `false` survives discovery. [`DesktopBackendConfiguration.ts` line 89](https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/desktop/src/backend/DesktopBackendConfiguration.ts#L89) includes it in backend forwarding.

## Packaging boundary

Both Homebrew launchers unconditionally export `T3CODE_TELEMETRY_ENABLED=false`
before exec. The desktop menu targets the cask launcher. No user profile or settings
file is changed. Release rendering preserves the launcher bodies; a CI build variable
alone would not persist into an installed app. Existing installations must be
reinstalled and running processes restarted to pick up this launcher change.

The raw upstream-derived tarball/AppImage is not patched. Direct execution of its
embedded binaries bypasses the Homebrew policy. Separately hosted remote servers,
mobile applications, AI-provider telemetry and user-configured OTLP exporters are
not covered. Future upstream changes to the flag or environment propagation require
rechecking these source boundaries; the tests do not prove arbitrary future upstream
versions cannot introduce another reporting path.

## Verification

`t3-telemetry.test.ts` executes the actual launcher heredocs with substituted
Homebrew paths and probe executables. It verifies the child receives `false` with
an absent, true or false parent value, and preserves argument boundaries. This is
an executable inheritance test, not a live network-silence test. Dagger package CI
and artifact install checks also require the export in each installed launcher,
in addition to existing CLI help/formula and desktop integration checks. The formula
also preloads an environment assertion into the real installed Node CLI during
`brew test`, starting with telemetry enabled in the parent process.

The paired T3 PR acceptance job builds both packages from one resolved immutable
upstream source. PR CI does not publish releases. `Tap Manual` actions `release`
and `force-release`, and `Tap Auto Update`, do publish; rerunning an older workflow
run would reuse old tap source and would not apply this correction.
