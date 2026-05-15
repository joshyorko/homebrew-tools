# Homebrew Tap for joshyorko tools

This tap contains Homebrew casks and formulae for tools maintained by [@joshyorko](https://github.com/joshyorko).

## Dagger Platform

This tap is migrating to a Dagger-first platform. The orchestration entrypoint is `dagger/tap-pipeline/`, which owns:

- the package registry
- named auto-update slots and changed-package detection
- package-level `ciCheck(packageId)`
- package-level `releaseBundle(packageId)`

GitHub Actions is intentionally thin and generic:

- `.github/workflows/tap-ci.yml`
- `.github/workflows/tap-auto-update.yml`
- `.github/workflows/tap-manual.yml`

Local platform commands:

```bash
dagger -m ./dagger/tap-pipeline call list-packages
dagger -m ./dagger/tap-pipeline call list-auto-update-slots
dagger -m ./dagger/tap-pipeline call packages-for-auto-update-slot --slot-id=desktop-6h
dagger -m ./dagger/tap-pipeline call detect-changed-packages --base-ref=origin/main --head-ref=HEAD
dagger -m ./dagger/tap-pipeline call ci-check --package-id=t3code-cli-main
dagger -m ./dagger/tap-pipeline call -o /tmp/release-bundle release-bundle --package-id=vscode-insiders-linux
```

GitHub Actions owns the schedule. Dagger resolves package ids for a named auto-update slot and then handles
the package-specific build, smoke test, release bundle export, and rendered Homebrew output.

The exported release bundle always has the same shape:

```text
artifacts/<asset_name>
homebrew/<rendered_file>
release.json
ci.log
```

## Quick Install

```bash
# One-liner (recommended)
brew install --cask joshyorko/tools/rcc

# Or tap first, then use short name
brew tap joshyorko/tools
brew install --cask rcc
```

## Available Packages

### RCC (Repeatable Contained Code)

An automation runtime for creating isolated, reproducible environments. Fork of the original RCC with **Linux Homebrew (Linuxbrew) support**.

> [!NOTE]
> Since this cask shares a name with the upstream `robocorp/tools/rcc` cask, always use the **full path** to avoid conflicts:
> ```bash
> brew install --cask joshyorko/tools/rcc
> brew uninstall --cask joshyorko/tools/rcc
> ```

| Command | Description |
|---------|-------------|
| `brew install --cask joshyorko/tools/rcc` | Install RCC |
| `brew install --cask joshyorko/tools/devpod-linux` | Install DevPod (Linux) |
| `brew install --cask joshyorko/tools/t3-code-linux` | Install T3 Code (Linux) |
| `brew install --cask joshyorko/tools/vscode-insiders-linux` | Install VS Code Insiders (Linux) |
| `brew install joshyorko/tools/codex-desktop` | Install Codex Desktop Linux runtime |
| `brew install joshyorko/tools/t3code-cli-main` | Install T3 Code CLI from `main` |
| `brew install joshyorko/tools/fizzy-cli-master` | Install Fizzy CLI from upstream `master` |
| `brew install joshyorko/tools/fizzy-symphony` | Install Fizzy Symphony from `main` |
| `brew install joshyorko/tools/eitype` | Install Eitype |
| `brew install joshyorko/tools/voxtype` | Install Voxtype |
| `brew upgrade --cask joshyorko/tools/rcc` | Upgrade to latest |
| `brew uninstall --cask joshyorko/tools/rcc` | Uninstall |

#### Platform Support

| Platform | Status | Binary |
|----------|--------|--------|
| Linux x64 | ✅ Native | `rcc-linux64` |
| macOS Intel | ✅ Native | `rcc-darwin64` |
| macOS Apple Silicon | ✅ Rosetta 2 | `rcc-darwin64` |

#### Why This Fork?

The upstream RCC Homebrew package is macOS-only. This cask provides cross-platform support including Linux:

| Feature | Upstream Cask | This Cask |
|---------|--------------|-----------|
| Linux Support | ❌ No | ✅ Yes |
| macOS Intel | ✅ Yes | ✅ Yes |
| macOS ARM | ✅ Yes | ✅ Yes (Rosetta) |

### DevPod (Linux Cask)

DevPod - Open Source Dev-Environments-As-Code. Contains both the Desktop UI and CLI.
This cask follows the Bluefin/uBlue Linux tap convention of using a Linux-specific token (`devpod-linux`).
See [skevetter/devpod](https://github.com/skevetter/devpod) for release details.

> [!NOTE]
> This cask uses the upstream `.deb` asset so both the desktop app and `devpod` CLI are installed together.

```bash
brew install --cask joshyorko/tools/devpod-linux
devpod version
devpod-desktop

# Provider setup
devpod provider add docker
devpod provider add kubernetes
devpod provider add gcloud -o PROJECT=<gcp-project-id>   # Google Cloud
devpod provider add aws -o AWS_REGION=us-east-1
devpod provider add ssh -o HOST=<host-or-ip>

# Some providers currently require explicit source
devpod provider add loft-sh/devpod-provider-azure
devpod provider add loft-sh/devpod-provider-digitalocean
devpod provider add loft-sh/devpod-provider-terraform
devpod provider add loft-sh/devpod-provider-civo
devpod provider add loft-sh/devpod-provider-ecs
devpod provider add loft-sh/devpod-provider-dockerless

devpod provider list-available
```

### T3 Code (Linux Cask)

T3 Code packaged for Linux Homebrew as a separate cask around the upstream AppImage.
This intentionally uses a Linux-specific token so it does not collide with the official
`homebrew/cask` `t3-code` package.

> [!NOTE]
> Use the full tap path to make the distinction explicit:
> ```bash
> brew install --cask joshyorko/tools/t3-code-linux
> ```

```bash
brew install --cask joshyorko/tools/t3-code-linux
t3-code-linux
```

### T3 Code CLI (Main Formula)

T3 Code CLI packaged from the latest upstream `main` commit for Linux/devcontainer use.
The formula downloads an immutable prebuilt tarball emitted by the tap's generic Dagger release bundle,
including runtime dependencies, and runs it with Homebrew's `node@24`.

> [!NOTE]
> Use the full tap path to make it explicit that this tracks `main`, not upstream npm releases:
> ```bash
> brew install joshyorko/tools/t3code-cli-main
> ```

```bash
brew install joshyorko/tools/t3code-cli-main
t3 --help
```

The tap also includes a reusable Dagger smoke test for this packaging path:

```bash
dagger -m ./dagger/t3code-cli-main-smoke call smoke-test --tap=.
```

That smoke test is the real end-to-end path:
- build upstream `t3code` CLI from source
- package the tarball the formula consumes
- install the formula through Linuxbrew in-container
- run `brew test` and `t3 --help`

### Codex Desktop (Linux DMG Conversion Runtime)

Codex Desktop Linux support follows the same core idea as
[`ilysenko/codex-desktop-linux`](https://github.com/ilysenko/codex-desktop-linux): poll the official
`https://persistent.oaistatic.com/codex-app-prod/Codex.dmg`, convert that DMG, patch the extracted
app for Linux Electron, rebuild native modules, stage bundled resources, and package the resulting
`codex-app/` as a Homebrew artifact through the tap's Dagger pipeline.

```bash
brew install joshyorko/tools/codex-desktop
codex-desktop --help
codex-desktop desktop
codex-desktop doctor
codex-desktop install-desktop-entry
codex-desktop web --inspect
```

The Dagger package id is `codex-desktop-linux`, pinned to the field-research commit
`43c8bd1b5d4ab2eb4be8eb474528d6050c51db9a` from
`ilysenko/codex-desktop-linux`. The tap auto-update workflow checks the official DMG every two
hours. Use the standard release-bundle target for the upstream DMG path, or the Codex-specific target
when testing a local DMG:

```bash
dagger -m ./dagger/tap-pipeline call codex-desktop-renderer-report --codex-dmg=/path/to/Codex.dmg
dagger -m ./dagger/tap-pipeline call -o /tmp/codex-bundle release-bundle --package-id=codex-desktop-linux
dagger -m ./dagger/tap-pipeline call -o /tmp/codex-bundle codex-desktop-release-bundle --codex-dmg=/path/to/Codex.dmg
```

That release bundle keeps the standard tap shape:
- `artifacts/` contains the tarball Homebrew installs
- `homebrew/` contains the rendered formula with the artifact URL and checksum
- `release.json` records the DMG hash, conversion commit, Electron version, managed Node runtime,
  and final artifact hash
- `ci.log` records the Homebrew fixture smoke test

Manual GNOME/Bluefin validation checklist:
- run `codex-desktop doctor` and install any missing Codex CLI/browser prerequisites
- run `codex-desktop install-desktop-entry`
- confirm `~/.local/share/applications/codex-desktop.desktop` exists and appears in the app grid
- run `codex-desktop desktop` and confirm the converted Electron app launches
- keep browser/app-server experiments loopback-only and use `codex-desktop web --inspect` for the
  current renderer research report

### Fizzy CLI (Master Formula)

Fizzy CLI packaged from a pinned upstream `master` commit for Linux/Homebrew use.
The tap publishes an immutable Linux tarball to this repository's releases and the formula installs
that artifact directly instead of waiting on upstream Fizzy release cadence.

> [!NOTE]
> Use the full tap path to make it explicit that this tracks upstream `master` snapshots:
> ```bash
> brew install joshyorko/tools/fizzy-cli-master
> ```

```bash
brew install joshyorko/tools/fizzy-cli-master
fizzy --version
fizzy doctor
```

Binary/linking strategy:
- the formula name stays unique as `fizzy-cli-master`
- the installed executable stays `fizzy` so existing wrappers and agent tooling keep working
- the formula declares a conflict with any upstream `fizzy` formula so Linuxbrew handles the shared executable name explicitly

Update flow:
- the `fizzy-daily` auto-update slot tracks upstream `basecamp/fizzy-cli` `master` and publishes a new immutable release asset when HEAD changes
- if we want to freeze to our own snapshot instead, pin `upstream.ref` for `fizzy-cli-master` in `dagger/tap-pipeline/src/library.ts` to a commit SHA and run the Tap Manual `release` workflow for that package id

Follow-up for `joshyorko/agent-skills`:
- switch the Fizzy install wrapper/docs from upstream release downloads to `brew install joshyorko/tools/fizzy-cli-master`
- keep invoking the CLI as `fizzy` after install

The tap also includes a reusable Dagger smoke test for this packaging path:

```bash
dagger -m ./dagger/fizzy-cli-master-smoke call smoke-test --tap=.
```

That smoke test exercises the real delivery path:
- build Fizzy from upstream `master`
- package the tarball the formula consumes
- install the formula through Linuxbrew in-container
- run `brew test` and `fizzy --version`

### Fizzy Popper (Self-Hosted Formula)

Fizzy Popper packaged for Linux Homebrew from Josh Yorko's `joshyorko/fizzy-popper`
`self-hosted` branch. This keeps the self-hosted/Codex fixes on a distinct tap path until
they are ready to merge upstream.

> [!NOTE]
> Use the full tap path to make the fork/branch source explicit:
> ```bash
> brew install joshyorko/tools/fizzy-popper-self-hosted
> ```

```bash
brew install joshyorko/tools/fizzy-popper-self-hosted
fizzy-popper --help
fizzy-popper status
```

Update flow:
- the `fizzy-daily` auto-update slot now also tracks `joshyorko/fizzy-popper@self-hosted`
- to publish or refresh the immutable release asset on demand, run the Tap Manual `release`
  workflow with `package_id=fizzy-popper-self-hosted`
- if you want to freeze to a specific fork snapshot, pin `upstream.ref` for
  `fizzy-popper-self-hosted` in `dagger/tap-pipeline/src/library.ts` to a commit SHA and run
  that same manual release workflow

The tap also includes a reusable Dagger smoke test for this packaging path:

```bash
dagger -m ./dagger/fizzy-popper-self-hosted-smoke call smoke-test --tap=.
```

That smoke test exercises the real delivery path:
- build `joshyorko/fizzy-popper@self-hosted` inside the tap pipeline
- run the upstream package gates (`npm test`, `npm run typecheck`, `npm run build`, `npm pack`)
- wrap the locally built package into a Homebrew-ready tarball with vendored runtime dependencies
- install the formula through Linuxbrew in-container
- run `brew test` and `fizzy-popper --help`

### Fizzy Symphony (Main Formula)

Fizzy Symphony packaged for Linux Homebrew from `joshyorko/fizzy-symphony` `main`.
The tap builds the Node package from source with Dagger, vendors runtime dependencies into
an immutable tarball, and installs the CLI as `fizzy-symphony`.

> [!NOTE]
> Use the full tap path to make the source snapshot explicit:
> ```bash
> brew install joshyorko/tools/fizzy-symphony
> ```

```bash
brew install joshyorko/tools/fizzy-symphony
fizzy-symphony
fizzy-symphony status
```

Update flow:
- the `fizzy-daily` auto-update slot tracks `joshyorko/fizzy-symphony@main`
- to publish or refresh the immutable release asset on demand, run the Tap Manual `release`
  workflow with `package_id=fizzy-symphony`
- if you want to freeze to a specific snapshot, pin `upstream.ref` for
  `fizzy-symphony` in `dagger/tap-pipeline/src/library.ts` to a commit SHA and run
  that same manual release workflow

The tap also includes a reusable Dagger smoke test for this packaging path:

```bash
dagger -m ./dagger/fizzy-symphony-smoke call smoke-test --tap=.
```

That smoke test exercises the real delivery path:
- build `joshyorko/fizzy-symphony@main` inside the tap pipeline
- run the upstream package gates (`npm test`, optional `npm run build`, `npm pack`)
- wrap the locally built package into a Homebrew-ready tarball with vendored runtime dependencies
- install the formula through Linuxbrew in-container
- run `brew test` and `fizzy-symphony`

### Voxtype (Formula)

Voxtype packaged for Linux Homebrew as a pinned release artifact built from upstream source.
The tap's generic Dagger platform compiles Voxtype from the latest upstream GitHub release tag,
packages a Homebrew-friendly tarball, smoke-tests installation through Linuxbrew, uploads
that tarball to this repository's releases, and updates the formula to point at the new asset.

> [!NOTE]
> Use the full tap path to make it explicit that this package is delivered from this tap's
> Linux-focused build pipeline:
> ```bash
> brew install joshyorko/tools/voxtype
> ```

```bash
brew install joshyorko/tools/voxtype
voxtype --version
voxtype setup --download
voxtype setup systemd
```

The tap also includes a reusable Dagger smoke test for this packaging path:

```bash
dagger -m ./dagger/voxtype-smoke call smoke-test --tap=.
```

That smoke test exercises the real delivery path:
- build upstream `voxtype` from the tagged release source
- package the tarball the formula consumes
- install the formula through Linuxbrew in-container
- run `brew test` and `voxtype --version`

### Eitype (Formula)

Eitype is the GNOME/KDE Wayland typing backend companion for Voxtype. It provides the
host-side typing bridge that Voxtype can call when clipboard-only fallback is not enough.
The launcher checks for a usable `libxkbcommon` runtime when you run it:
- it prefers the host system copy when available
- it can use Homebrew's copy if you later choose `brew install libxkbcommon`
- it exits with a clear error if neither runtime exists

> [!NOTE]
> Use the full tap path to make it explicit that this package is delivered from this tap:
> ```bash
> brew install joshyorko/tools/eitype
> ```

```bash
brew install joshyorko/tools/eitype
eitype --version
```

Like Voxtype, Eitype is intended to run on the host OS. This formula avoids pulling
Homebrew's larger desktop/X11 dependency tree by default, which keeps the install
lighter on GNOME/KDE/Bluefin-style systems where the host runtime is already present.

If your host does not already provide `libxkbcommon.so.0`, opt into the smallest
extra Homebrew layer only when you need it:

```bash
brew install libxkbcommon
eitype --version
```

### VS Code Insiders (Linux Cask)

VS Code Insiders packaged for Linux Homebrew from Microsoft's official Linux RPM.
The generic Dagger release path checks the upstream Insiders RPM when the matching auto-update slot runs, repackages
its payload into a Homebrew-friendly archive, smoke-tests installation through Linuxbrew with Dagger,
uploads the artifact to this repository's releases, and updates the cask to point at that pinned asset.
The installed desktop integration intentionally preserves the canonical upstream Linux identities such as
`code-insiders.desktop`, `code-insiders-url-handler.desktop`, `code-insiders-workspace.xml`, and
the `vscode-insiders` icon theme name.

> [!NOTE]
> Use the full tap path to make the Linux-specific token explicit:
> ```bash
> brew install --cask joshyorko/tools/vscode-insiders-linux
> ```

```bash
brew install --cask joshyorko/tools/vscode-insiders-linux
code-insiders --version
```

The tap also includes a reusable Dagger smoke test for this packaging path:

```bash
dagger -m ./dagger/vscode-insiders-linux-smoke call smoke-test --tap=.
```

That smoke test exercises the real delivery path:
- resolve the latest upstream VS Code Insiders Linux RPM
- repackage the RPM payload into the archive the cask consumes
- install the cask through Linuxbrew in-container
- run `code-insiders --version` and verify canonical desktop integration artifacts
- verify MIME registration for `vscode-insiders://` and `application/x-code-insiders-workspace`

## For Brewfile Users

Add to your `Brewfile`:

```ruby
tap "joshyorko/tools"
cask "rcc"
```

Or with the full path:

```ruby
cask "joshyorko/tools/rcc"
```

## For Room of Requirement Users

This tap integrates seamlessly with the [Room of Requirement](https://github.com/joshyorko/room-of-requirement) DevContainer platform. Add to `.devcontainer/brew/automation.Brewfile`:

```ruby
tap "joshyorko/tools"
cask "rcc"
```

## Updating

```bash
brew update              # Fetch latest from all taps
brew upgrade --cask rcc  # Upgrade RCC
```

## Contributing

Pull requests welcome! Please ensure:

1. SHA256 checksums are verified (extract from release artifacts)
2. Casks work on both Linux and macOS
3. Tests pass: `brew audit --cask <cask>`

### Adding a Package

1. Add a registry entry in `dagger/tap-pipeline/src/library.ts`
2. Add or extend the package-specific Dagger logic in `dagger/tap-pipeline/src/index.ts`
3. Wire the package into one or more named auto-update slots in `dagger/tap-pipeline/src/library.ts` if it should auto-update
4. Keep release metadata, rendered Homebrew output, and CI validation inside Dagger
5. Add or tighten local Homebrew validation for the package family
6. Do not add a new package-specific workflow file

### Local Release and CI

```bash
npm test --prefix dagger/tap-pipeline
dagger -m ./dagger/tap-pipeline call ci-check --package-id=t3code-cli-main
dagger -m ./dagger/tap-pipeline call -o /tmp/release-bundle release-bundle --package-id=t3code-cli-main
node scripts/apply-release-bundle.mjs --bundle /tmp/release-bundle --repo .
```

The tap-pipeline test suite covers:
- slot resolution and package coverage for auto-update
- changed-package routing for PR CI
- release metadata contract shape across every registered package kind

## License

MIT
