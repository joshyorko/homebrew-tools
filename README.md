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
See [loft-sh/devpod](https://github.com/loft-sh/devpod) for more details.

> [!NOTE]
> This Cask uses the `tar.gz` distribution to support immutable distros (like Bluefin/uBlue) better than AppImages.

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
