# Homebrew Tap for joshyorko tools

This tap contains Homebrew formulae for tools maintained by [@joshyorko](https://github.com/joshyorko).

## Quick Install

```bash
# One-liner (recommended)
brew install joshyorko/tools/rcc

# Or tap first, then use short name
brew tap joshyorko/tools
brew install rcc
```

## Available Formulae

### RCC (Repeatable Contained Code)

An automation runtime for creating isolated, reproducible environments. Fork of the original RCC with **Linux Homebrew (Linuxbrew) support**.

| Command | Description |
|---------|-------------|
| `brew install joshyorko/tools/rcc` | Install |
| `brew upgrade rcc` | Upgrade to latest |
| `brew uninstall rcc` | Uninstall |

#### Platform Support

| Platform | Status | Binary |
|----------|--------|--------|
| Linux x64 | ✅ Native | `rcc-linux64` |
| macOS Intel | ✅ Native | `rcc-darwin64` |
| macOS Apple Silicon | ✅ Rosetta 2 | `rcc-darwin64` |

#### Why This Fork?

The upstream RCC Homebrew package is a **Cask** (macOS-only binary distribution). This formula provides cross-platform support:

| Feature | Upstream Cask | This Formula |
|---------|--------------|---------------|
| Linux Support | ❌ No | ✅ Yes |
| macOS Intel | ✅ Yes | ✅ Yes |
| macOS ARM | ✅ Yes | ✅ Yes (Rosetta) |
| Type | Cask | Formula |

## For Brewfile Users

Add to your `Brewfile`:

```ruby
tap "joshyorko/tools"
brew "rcc"
```

Or with the full path:

```ruby
brew "joshyorko/tools/rcc"
```

## For Room of Requirement Users

This tap integrates seamlessly with the [Room of Requirement](https://github.com/joshyorko/room-of-requirement) DevContainer platform. Add to `.devcontainer/brew/automation.Brewfile`:

```ruby
tap "joshyorko/tools"
brew "rcc"
```

## Updating

```bash
brew update       # Fetch latest from all taps
brew upgrade rcc  # Upgrade RCC
```

## Contributing

Pull requests welcome! Please ensure:

1. SHA256 checksums are verified (extract from release artifacts)
2. Formulae work on both Linux and macOS
3. Tests pass: `brew test <formula>`

### Adding a New Version

1. Update `version` in the formula
2. Update SHA256 checksums for each platform
3. Test locally: `brew install --build-from-source ./Formula/rcc.rb`

## License

MIT
