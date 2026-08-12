# Homebrew Tap for joshyorko tools

This tap contains Homebrew casks and formulae for tools maintained by [@joshyorko](https://github.com/joshyorko).

## Dagger Platform

When GitHub releases are unavailable, build a local recovery export without installing any packages first:

```bash
make recovery-t3code-cli-main  # one small, usable export
make recovery-all              # every standard tap release selected by recovery/Brewfile
```

Both commands write `dist/homebrew-tools-recovery`. Override `RECOVERY_OUTPUT` or
`RECOVERY_FILE_SERVER_URL` on the `make` command when the directory will be served elsewhere.
The all-package Brewfile is checked against the package registry, so unsupported or unknown entries fail before builds start.

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

The recovery export reuses those package release bundles and provides this stable transport contract:

```text
Brewfile
manifest.json
tap/Formula/*.rb
tap/Casks/*.rb
packages/<package-id>/artifacts/*
packages/<package-id>/release.json
packages/<package-id>/ci.log
```

`manifest.json` is schema version 1 and records the package versions plus the SHA256, relative path, and local
HTTP URL of every artifact. Formulae and casks under `tap/` use the same artifact URLs. The directory is the
intended future input to Josh's All the Things `--brew` option and may be copied into Hauler or another transport;
the recovery export itself does not publish to GitHub, build OCI images, inspect Homebrew caches, or require a
package to be installed. Serve the directory at `RECOVERY_FILE_SERVER_URL` when installing from the local tap.

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
| `brew install --cask joshyorko/tools/chatgpt` | Install ChatGPT Desktop from OpenAI's official Linux package |
| `brew install --HEAD joshyorko/tools/codex-desktop-linux-builder` | Install Codex Desktop local builder tooling only |
| `brew install joshyorko/tools/t3code-cli-main` | Install T3 Code CLI from `main` |
| `brew install joshyorko/tools/antigravity-cli` | Install Google Antigravity CLI for Linux x64; executable is `agy` |
| `brew install joshyorko/tools/camp` | Install the latest verified Camp Linux release |
| `brew install joshyorko/tools/devsy` | Install the stable Devsy CLI for Linux x64 or arm64 |
| `brew install --cask joshyorko/tools/devsy-desktop` | Install Devsy Desktop for Linux x64 |
| `brew install --cask joshyorko/tools/buzz-linux` | Install the portable Buzz Desktop build for Linux x64 |
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

T3 Code desktop packaged for Linux Homebrew as a separate cask. The tap builds
the Linux AppImage from upstream `pingdotgg/t3code` `main` with Dagger, uploads
that immutable artifact to this tap's releases, then renders the cask around it.
The cask launches its extracted `AppRun` directly, so it does not require FUSE at runtime.
The Linux-specific token avoids colliding with the official `homebrew/cask`
`t3-code` package.

> [!NOTE]
> Use the full tap path to make the distinction explicit:
> ```bash
> brew install --cask joshyorko/tools/t3-code-linux
> ```

```bash
brew install --cask joshyorko/tools/t3-code-linux
t3-code-linux
```

Build and smoke-test the desktop cask path:

```bash
dagger -m ./dagger/tap-pipeline call ci-check --package-id=t3-code-linux
dagger -m ./dagger/tap-pipeline call -o /tmp/release-bundle release-bundle --package-id=t3-code-linux
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

### Antigravity CLI

Google Antigravity CLI packaged from the upstream Linux x64 binary artifact.
The upstream installer downloads a manifest, verifies SHA512, copies the binary
as `agy`, and then runs first-run shell setup. This formula keeps the Homebrew
install path explicit: it pins the verified tarball and installs only the `agy`
launcher.

> [!NOTE]
> This is closed-source binary packaging, not a source build.
> ```bash
> brew install joshyorko/tools/antigravity-cli
> agy --help
> ```

Run `agy install` after installation if you want Antigravity's own shell setup.

### Devsy CLI and Desktop

Devsy is packaged as two required, co-installable Homebrew identities from the same
pinned stable upstream release:

- `devsy` is the CLI formula. Homebrew deterministically selects the verified raw
  Linux amd64 or arm64 binary for the current CPU and exposes `devsy`.
- `devsy-desktop` is the first-class Linux x86_64 AppImage cask. It exposes only
  `devsy-desktop`, a desktop entry, an icon, and the `devsy://` protocol handler.
  It is intentionally unsupported on arm64 and fails there instead of substituting
  Flatpak, RPM, or another package manager.

```bash
brew install joshyorko/tools/devsy
devsy --version

brew install --cask joshyorko/tools/devsy-desktop
devsy-desktop
```

The pinned AppImage contains its own byte-identical amd64 CLI at
`resources/bin/devsy` for internal Desktop use. The cask deliberately does not link
that embedded binary into Homebrew's `bin`, so it does not replace or shadow the
formula-owned `devsy` command. Both packages are MPL-2.0 upstream artifacts.

On Bluefin and Fedora bootc systems, the Homebrew AppImage cask and upstream Flatpak
bundle are parallel first-class Desktop choices. Homebrew provides tap-controlled
updates and direct host-tool access; Flatpak provides its own isolated lifecycle and
upstream host-reexec wrapper. The operator's command always selects the channel; this
tap never ranks one as the default, never auto-detects Bluefin, and never invokes or
owns Flatpak. RPM is appropriate when deliberately baked into a custom bootc image,
not for ad hoc host layering.

To explicitly select the upstream-owned Flatpak channel, choose an exact stable tag
from the [Devsy releases](https://github.com/devsy-org/devsy/releases), then download
and verify that release's GitHub-published digest before installing it:

```bash
DEVSY_TAG=vX.Y.Z
curl -fL -o Devsy.flatpak \
  "https://github.com/devsy-org/devsy/releases/download/${DEVSY_TAG}/Devsy.flatpak"
curl -fsSL "https://api.github.com/repos/devsy-org/devsy/releases/tags/${DEVSY_TAG}" \
  | jq -r '.assets[] | select(.name == "Devsy.flatpak") | .digest + "  Devsy.flatpak"' \
  | sed 's/^sha256://' \
  | sha256sum -c -
flatpak install --user ./Devsy.flatpak
```

The AppImage bundles `libnotify.so.4`, `libXss.so.1`, `libXtst.so.6`,
`libappindicator.so.1`, and its StatusNotifier implementation. The Homebrew cask
extracts the verified AppImage during installation and launches its bundled `AppRun`
directly, so it does not require FUSE at runtime. GTK3, NSS, AT-SPI, and `xdg-utils`
remain host runtime requirements. Bluefin runtime validation
confirmed a Wayland window, active StatusNotifier tray item and menu, protocol launch,
sandboxed Electron renderer, formula/cask coexistence, and a clean exit. The embedded
AppIndicator support means this package must not inherit DevPod's separate
AppIndicator runtime formula.

The `devsy-daily` updater alone resolves GitHub's time-dependent `latest`
non-prerelease release. Each published formula and cask is then pinned to an exact
version, tag commit, asset name, and SHA-256, mirrored through an immutable tap release,
and updated independently.

```bash
dagger -m ./dagger/tap-pipeline call ci-check --package-id=devsy
dagger -m ./dagger/tap-pipeline call ci-check --package-id=devsy-desktop
```

### Buzz Desktop for Linux

`buzz-linux` is built from a pinned Buzz source commit in a container, published
as a tap-owned AppImage, and installed with desktop, icon, and `buzz://` protocol
integration:

```bash
brew install --cask joshyorko/tools/buzz-linux
buzz
```

The build defaults to the upstream Linux fix commit recorded in
`dagger/buzz-linux-smoke/src/index.ts`. The workflow accepts an exact source
repository and 40-character commit so the same pipeline can build a maintained
fork without changing the package design. It never compiles on the Homebrew
user's host.

This is one x86_64 glibc artifact, not a separate build per distribution. Its
Ubuntu 22.04 build floor keeps it usable across current Ubuntu, Fedora, and Arch
families, including immutable or atomic hosts where Homebrew lives in the user
filesystem. The launcher discovers the host GStreamer plugin and scanner paths
at runtime and gives Buzz a private registry, avoiding AppImage assumptions
about distro-specific library layouts. The artifact intentionally uses host
graphics, WebKitGTK, GStreamer, and font libraries. It does not currently
support arm64 or musl-only systems, and a container smoke test cannot replace a
real compositor/GPU launch test.

To validate or publish it, run the `Buzz Linux` workflow. A publish run first
builds from source and installs the resulting artifact through Linuxbrew, then
creates the release and records its exact SHA-256 in the cask.

```bash
dagger -m ./dagger/buzz-linux-smoke call smoke-test --tap=.
```

### ChatGPT Desktop (Official Linux Package)

The `chatgpt` cask downloads the official architecture-specific OpenAI Linux
RPM. It verifies the pinned release (`26.803.81509`), package architecture, and
SHA-256 before extracting the complete `/usr/lib/chatgpt` payload locally. The
payload is not patched, rebuilt, vendored, or published by this tap.

Only the Homebrew integration is added: `bin/chatgpt` and a desktop entry under
the user's local application and icon directories. RPM maintainer scripts are
never run, so no system repository or service configuration is installed.

```bash
brew install --cask joshyorko/tools/chatgpt
chatgpt
```

The cask owns only the launcher and desktop integration files. Removing or upgrading it
does not delete ChatGPT or Codex user data. The Linux preview's Wayland
Computer Use, Remote, Global Dictation, and Record & Replay behavior still
needs validation on the target Bluefin desktop.

### Legacy Codex Desktop (Linux DMG Conversion Runtime)

The official Linux package above is the preferred ChatGPT Desktop stream. The
older Codex Desktop conversion remains available as separate local-only
builder tooling for conversion-specific experiments; it is not used by the
`chatgpt` cask and does not publish converted app payloads. The builder
downloads the official
`https://persistent.oaistatic.com/codex-app-prod/ChatGPT.dmg`, converts that DMG on
this machine, patches the extracted app for Linux Electron, rebuilds native
modules, stages bundled resources, renders a temporary local cask, and installs
that cask through Homebrew.

The rendered cask no longer pulls in a Homebrew `codex` cask. During install it
runs the official OpenAI installer for the Codex CLI from
`https://github.com/openai/codex/releases`:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

The preflight step skips this when a `codex` executable is already on `PATH`
(or in `~/.local/bin`), and you can force it off with
`CODEX_DESKTOP_SKIP_CLI_INSTALL=1` if you manage the Codex CLI yourself.

```bash
brew install --HEAD joshyorko/tools/codex-desktop-linux-builder
codex-desktop-linux-builder
codex-desktop --help
codex-desktop desktop
codex-desktop doctor
codex-desktop web --inspect
```

From a repo checkout, the same builder is available directly:

```bash
scripts/install-codex-desktop-local.sh
make codex-desktop-setup
make codex-desktop-install
make codex-install
make codex-desktop-uninstall
make codex-desktop-zap
make codex-desktop-rebuild-dry-run
make codex-desktop-rebuild-relaunch
make codex-desktop-rebuild-foreground
```

For normal interactive use, start with `make codex-desktop-setup`. It opens a
native GTK/libadwaita window on supported Linux desktops with Daily driver,
Minimal, and Custom profiles; searchable feature switches; dependency and
conflict guidance; and a final choice to save or build and install. The saved
selection lives under `${XDG_CONFIG_HOME:-~/.config}/homebrew-tools/` and is
used automatically by later `make codex-desktop-install` runs. A concise
terminal picker is used when no graphical session is available.

The graphical wizard depends on the device's native Python GObject bindings for
GTK 4 and libadwaita. These bindings and the saved feature selection are host
state, so syncing this checkout does not copy them to another device. Verify the
selected interpreter with:

```bash
python3 -c 'import gi; gi.require_version("Gtk", "4.0"); gi.require_version("Adw", "1"); from gi.repository import Adw, Gtk'
```

`make codex-desktop-setup` recreates `.venv-codex-desktop-setup` with access to
the system Python packages, verifies the native bindings, and runs the wizard
with that interpreter. Use
`CODEX_DESKTOP_SETUP_BASE_PYTHON=/path/to/python3 make codex-desktop-setup-env`
when another system Python owns the bindings. There is no `requirements.txt`:
the wizard's Python code uses only the standard library, while GTK,
libadwaita, and PyGObject remain native per-device dependencies that a PyPI
lockfile cannot supply reproducibly.
The saved selection remains local under the XDG config path above; set
`CODEX_DESKTOP_FEATURES_CONFIG` to an intentional synced path only when the
same selection should be shared across devices. Do not sync build caches,
reports, or installed application state.

The review screen also chooses the DMG source. **Tested pinned DMG** is the
default for repeatable feature work. **Newest upstream DMG** is a one-off build
that downloads the current OpenAI artifact and runs the selected feature set
through the shared upstream acceptance gate. Before the wizard opens, a bounded
HEAD request identifies whether the current upstream artifact matches the tested
pin and displays its size, Last-Modified value, and ETag without downloading the
DMG. It does not rewrite the checked-in pin. Rejected or inconclusive candidates
never reach Homebrew installation.
After a latest-DMG attempt, the wizard displays the verdict and the local
evidence path under
`${XDG_STATE_HOME:-~/.local/state}/homebrew-tools/codex-desktop/reports/`.
That directory contains the acceptance decision and any exported patch and
rebuild reports.

`make codex-desktop-install` and `make codex-install` use the checked-in
`codex-desktop-conversion.ref` by default, so local rebuilds follow the current
test branch without pasting a commit SHA. Override with
`CODEX_DESKTOP_CONVERSION_COMMIT=<ref-or-sha>` when needed.

The local Codex Desktop builder also uses the checked-in
`codex-desktop-dmg.ref` by default. When you do not pass `--codex-dmg` or
`CODEX_DESKTOP_CODEX_DMG`, the installer downloads that pinned upstream DMG
into `~/.cache/codex-desktop-dmg/<sha256>/Codex.dmg`, verifies its SHA256 and
content length, and then passes that local file into Dagger so rebuilds stay
reproducible even if the upstream `Codex.dmg` URL later changes in place.

Refresh the upstream DMG pin only after you have rechecked the current upstream
artifact and metadata, then update `codex-desktop-dmg.ref` in the repo:


```bash
curl -fsSLo /tmp/Codex.dmg https://persistent.oaistatic.com/codex-app-prod/ChatGPT.dmg
sha256sum /tmp/Codex.dmg
wc -c /tmp/Codex.dmg
curl -fsSIL https://persistent.oaistatic.com/codex-app-prod/ChatGPT.dmg
```


Override the pinned default with a local DMG whenever you need a one-off test:


```bash
scripts/install-codex-desktop-local.sh --codex-dmg /path/to/Codex.dmg
CODEX_DESKTOP_CODEX_DMG=/path/to/Codex.dmg make codex-desktop-install
```


The local Codex Desktop builder writes a Linux feature config during conversion.
Before the guided wizard has saved a selection, the default test set enables
every shipped Codex Desktop Linux feature except the template feature and
Thorium browser support. Afterward, `make codex-desktop-install` reuses the
wizard selection automatically.

Use the smaller troubleshooting profile explicitly when you need a lower-surface
Desktop build:

```bash
CODEX_DESKTOP_LINUX_FEATURES=lean make codex-desktop-install
```

Override with a one-off feature list such as
`CODEX_DESKTOP_LINUX_FEATURES="record-and-replay"` or pass
`scripts/install-codex-desktop-local.sh --linux-feature record-and-replay`.
The direct install path refuses to install over live Codex Desktop
bundle-backed processes by default so old Caskroom-backed app or CLI/MCP
helpers are not left running after a reinstall. From an external terminal, set
`CODEX_DESKTOP_STOP_RUNNING=1` or pass `--stop-running` to stop them first. Use
`CODEX_DESKTOP_ALLOW_RUNNING_INSTALL=1` only for deliberate diagnostics.

`make codex-desktop-rebuild-relaunch` is the local daily-driver loop designed to
be safe when launched from inside Codex Desktop: it starts a detached worker,
returns a PID and log path, then that worker fast-forwards this checkout, stops
Codex Desktop, rebuilds and reinstalls the local cask, and launches Codex
Desktop again. Use `make codex-desktop-rebuild-dry-run` first to print the
detached worker command without closing the app or starting a build. Use
`make codex-desktop-rebuild-foreground` only from an external terminal when you
want the rebuild to stay attached to that terminal.

`codex-desktop-uninstall` removes the local-only Homebrew cask, Caskroom payload,
desktop entry, app-grid icons, and temporary `codex-local/codex-desktop-local-*`
taps. `codex-desktop-zap` also removes Codex Desktop app-local
`~/.config/codex-desktop`, `~/.cache/codex-desktop`, and
`~/.local/state/codex-desktop`. Both preserve `~/.codex`.

The Dagger function is `codex-desktop-local-bundle`. It is for local export only,
not release publishing:

```bash
dagger -m ./dagger/tap-pipeline call codex-desktop-renderer-report --codex-dmg=/path/to/Codex.dmg
dagger -m ./dagger/tap-pipeline call -o /tmp/codex-bundle codex-desktop-local-bundle
```

That local bundle keeps the standard tap shape:
- `artifacts/` contains the tarball Homebrew installs
- `homebrew/` contains the rendered local cask with a `file://` URL and checksum
- `release.json` records the DMG hash, conversion commit, Electron version, managed Node runtime,
  and final artifact hash

Manual GNOME/Bluefin validation checklist:
- run `codex-desktop doctor` to inspect Codex CLI, browser, and Linux Computer Use readiness
- confirm the cask installed `~/.local/share/applications/codex-desktop.desktop` and app-grid icon files
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
brew "devsy"
cask "devsy-desktop"
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
