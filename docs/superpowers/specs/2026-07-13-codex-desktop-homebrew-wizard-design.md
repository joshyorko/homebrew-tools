# Codex Desktop Homebrew Wizard Design

## Outcome

`make codex-desktop-setup` opens a polished Homebrew-first feature wizard. It
discovers the exact Linux features available in the configured
`codex-desktop-linux` conversion, remembers the user's choices, explains
dependencies and conflicts, and offers either **Save** or **Build & install**.
Users never edit JSON or construct `CODEX_DESKTOP_LINUX_FEATURES` manually.

## Experience

The primary experience is a native GTK4/libadwaita window on Bluefin:

1. **Choose a profile.** Daily driver is the default and matches the checked-in
   Homebrew full profile. Minimal and Custom are also available.
2. **Choose features.** A searchable list uses human-readable titles and
   descriptions from each `feature.json`. Toggles are grouped into practical
   families. Enabling a feature automatically selects its requirements;
   conflicts are explained before the selection changes.
3. **Review.** The wizard shows the immutable conversion commit, enabled feature
   count, changes from the saved selection, and whether the next action will
   only save or will start the existing Homebrew build/install path.

The selection is stored as the existing `linux-features/features.json` shape in
the user's XDG config directory. The wizard owns the file; users do not.
Headless systems fall back to a concise terminal picker with the same model and
validation rather than the older native-package setup flow.

## Architecture

- `scripts/codex-desktop-feature-wizard.py` owns manifest discovery, selection
  state, dependency/conflict validation, persistence, and the GTK UI. Its data
  model is importable and testable without a display.
- `scripts/setup-codex-desktop-local.sh` resolves
  `codex-desktop-conversion.ref` to an immutable commit, prepares a cached
  checkout under `XDG_CACHE_HOME`, launches the wizard, and forwards the result
  to the existing installer.
- `make codex-desktop-setup` is the single user entrypoint. Existing
  `make codex-desktop-install` remains non-interactive and consumes the saved
  selection unless an explicit environment override is supplied.
- `CODEX_DESKTOP_CONVERSION_CHECKOUT` allows local-feature development. The
  default cached checkout is pinned to the same commit sent to Dagger, so the
  displayed manifests cannot drift from the conversion being built.

An empty selection is represented internally as `none`; Dagger must map it to
an empty feature list instead of falling back to the full profile.

## Safety and recovery

The wizard never stops, uninstalls, relaunches, or bypasses the running-app
guard. **Build & install** calls the existing installer, which retains its live
process refusal. Closing or cancelling the wizard starts no build and preserves
the last saved selection. Ref-resolution, cache, manifest, and config failures
are shown before any Dagger work begins.

## Validation

- Headless Python tests cover profiles, search data, requirements, conflicts,
  saved selection, empty selection, and malformed manifests.
- Shell tests use fake git, wizard, and installer commands to prove immutable
  ref pinning, save-only behavior, install forwarding, cancellation, and no
  accidental build.
- Dagger tests prove `none` maps to an empty list and explicit overrides win.
- GTK syntax/import checks and the existing Homebrew Codex Desktop suites run
  before merge.
