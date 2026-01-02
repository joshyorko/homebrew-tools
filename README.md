# Homebrew Tap for joshyorko tools

This tap contains Homebrew formulae for tools maintained by [@joshyorko](https://github.com/joshyorko).

## Installation

```bash
brew tap joshyorko/tools
```

## Available Formulae

### RCC (Robocorp Control Center)

A fork of [Robocorp RCC](https://github.com/robocorp/rcc) with Linux Homebrew support.

```bash
# Install
brew install joshyorko/tools/rcc

# Upgrade
brew upgrade joshyorko/tools/rcc

# Uninstall
brew uninstall rcc
```

#### Why This Fork?

The upstream `robocorp/tools/rcc` is a **Cask** (macOS-only binary distribution). This formula:

| Feature | Upstream Cask | This Formula |
|---------|--------------|---------------|
| Linux Support | ❌ No | ✅ Yes |
| macOS Intel | ✅ Yes | ✅ Yes |
| macOS ARM | ✅ Yes | ✅ Yes |
| Type | Cask | Formula |

## For Room of Requirement Users

This tap integrates seamlessly with the [Room of Requirement](https://github.com/joshyorko/room-of-requirement) DevContainer platform. Add to your Brewfile:

```ruby
tap "joshyorko/tools"
brew "joshyorko/tools/rcc"
```

## Contributing

Pull requests welcome! Please ensure:

1. SHA256 checksums are verified
2. Formulae work on both Linux and macOS
3. Tests pass (`brew test <formula>`)

## License

MIT
