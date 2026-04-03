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
| `brew install joshyorko/tools/t3code-cli-main` | Install T3 Code CLI from `main` |
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

### Fizzy Board

Agent coordination for this migration runs on the `work-ai-board` Fizzy board:

- board id: `03fs668i2uvjcv6y1tkbz0b06`
- parent card: `Dagger-first tap platform migration`
- execution cards move through `Shaping`, `Ready for Agents`, `In Flight`, `Needs Input`, `Synthesize & Verify`, and `Ready to Ship`

Execution agents are expected to use the `Fizzy:fizzy` skill for card lookup, comments, status moves, and blockers.

## License

MIT
