# Homebrew Tap for joshyorko tools

This tap contains Homebrew casks and formulae for tools maintained by [@joshyorko](https://github.com/joshyorko).

## Quick Install

```bash
# One-liner (recommended)
brew install --cask joshyorko/tools/rcc

# Or tap first, then use short name
brew tap joshyorko/tools
brew install --cask rcc
```

## Available Casks

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
| `brew install joshyorko/tools/t3-code-linux` | Install T3 Code (Linux) |
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

### T3 Code (Linux Formula)

T3 Code packaged for Linux Homebrew as a separate formula around the upstream AppImage.
This intentionally uses a Linux-specific token so it does not collide with the official
`homebrew/cask` `t3-code` package.

> [!NOTE]
> Use the full tap path to make the distinction explicit:
> ```bash
> brew install joshyorko/tools/t3-code-linux
> ```

```bash
brew install joshyorko/tools/t3-code-linux
t3-code-linux
```

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

### Adding a New Version

1. Update `version` in the cask
2. Update SHA256 checksums for each platform
3. Test locally: `brew install --cask ./Casks/rcc.rb`

## License

MIT
