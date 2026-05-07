# Repository Guidelines

## Project Structure & Module Organization
This repository is a Homebrew tap. Put casks in `Casks/*.rb` and formulae in `Formula/*.rb`. Packaging helpers live in `scripts/*.mjs`. End-to-end smoke tests live in `dagger/vscode-insiders-linux-smoke` and `dagger/t3code-cli-main-smoke`, each with its own `src/index.ts`, `package.json`, and Dagger module metadata. CI automation is defined in `.github/workflows/*.yml`. Start with [README.md](/var/home/kdlocpanda/second_brain/Areas/devcontainers/homebrew-tools/README.md) for package intent and install examples.

## Build, Test, and Development Commands
Use Homebrew locally for fast validation:

```bash
brew install --cask ./Casks/rcc.rb
brew install --cask ./Casks/vscode-insiders-linux.rb
brew install ./Formula/t3code-cli-main.rb
brew audit --cask ./Casks/vscode-insiders-linux.rb
brew test ./Formula/t3code-cli-main.rb
```

Use the Dagger smoke tests for real packaging verification:

```bash
dagger -m ./dagger/vscode-insiders-linux-smoke call smoke-test --tap=.
dagger -m ./dagger/t3code-cli-main-smoke call smoke-test --tap=.
```

Use the Node packaging scripts only when iterating on artifacts directly:

```bash
node scripts/package-vscode-insiders-linux.mjs --source-rpm /tmp/source.rpm --output /tmp/pkg.tar.gz
node scripts/package-t3code-cli-main.mjs --upstream-dir /tmp/t3code --version main.test --output /tmp/pkg.tar.gz
```

## Coding Style & Naming Conventions
Match the existing style: 2-space indentation in Ruby, JavaScript, and TypeScript; ESM modules; double quotes; and no semicolons in JS/TS. Keep Homebrew tokens Linux-specific where needed, such as `devpod-linux` and `vscode-insiders-linux`, to avoid upstream collisions. Prefer small helper methods and explicit guard checks for packaging scripts.

## Testing Guidelines
Every version bump or packaging change should include a local `brew install` or `brew test`, plus the relevant Dagger smoke test for artifact-based packages. Keep smoke coverage focused on the real install path: package artifact, install through Linuxbrew, verify binaries, and check desktop integration files when applicable.

## Commit & Pull Request Guidelines
Follow the existing history: short imperative subjects like `Update devpod-linux cask to v0.17.0` or `Package VS Code Insiders from the Linux RPM (#12)`. PRs should explain what changed, link the upstream release or source commit, and note any updated SHA256 values. Include command output for `dagger ... smoke-test` or `brew audit` in the PR description. Add screenshots only when launcher, icon, or protocol-handler behavior changes.

## Security & Release Hygiene
Never merge checksum changes without verifying the downloaded artifact. Prefer immutable release URLs, keep `livecheck` skip reasons accurate, and avoid introducing unpinned network downloads into formula or cask install steps.
