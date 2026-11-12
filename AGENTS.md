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

On the workstation, run every Dagger command through `bash scripts/dagger-devsy.sh`.
It provisions or resumes the `homebrew-tools-dagger` Devsy workspace using the
configured Harvester provider. The builder VM has 12 vCPUs, 32 GiB RAM, and a
200 GiB disk. Its private engine cgroup has 12 CPUs with matching affinity,
24 GiB RAM, 28 GiB total RAM plus swap, and 4096 processes.
The launcher uploads the current checkout, including uncommitted changes and
Git history, serializes builds, and copies one `-o` export back on success.
Use repository-relative input paths. Do not run raw Dagger, Docker builds, or
resource-heavy packaging scripts on the workstation, including after remote
failure. Devsy 1.27.0 MCP `workspace_exec` does not find this remote container.
Use `devsy workspace ssh homebrew-tools-dagger --command '<command>'` for diagnostics.
After the agent's final job, including failures, retrieve artifacts and needed
evidence, then run `bash scripts/dagger-devsy.sh --cleanup` and report the VM
state. Do not run cleanup after each call in a multi-command workflow. Cleanup
refuses active builds/startups, pending transfers, other workspace ownership on
the same VM, and unreadable/ambiguous usage. Registered peers conservatively
block shutdown even when stopped. Preserve other workspaces and report their
names when cleanup refuses. The command uses Devsy's native shared-machine stop
protection; never substitute direct machine stop, force deletion, cache/disk
removal, or local builds. Successful run data is removed after export retrieval;
failed run data stays for evidence. Never clear another run's active marker or
prune its snapshot. See README.md's Dagger Platform section for concurrency limits.
The old `scripts/dagger-limited.sh` entrypoint and Makefile recovery targets route
through this remote launcher. CI keeps its own runner configuration.

```bash
bash scripts/dagger-devsy.sh -m ./dagger/vscode-insiders-linux-smoke call smoke-test --tap=.
bash scripts/dagger-devsy.sh -m ./dagger/t3code-cli-main-smoke call smoke-test --tap=.
```

Use the relevant Dagger module to run Node packaging scripts remotely.
Direct artifact iteration requires a Node-equipped remote container:

```bash
node scripts/package-vscode-insiders-linux.mjs --source-archive /tmp/source.tar.gz --source-sha256 <verified-sha256> --output /tmp/pkg.tar.gz
node scripts/package-t3code-cli-main.mjs --upstream-dir /tmp/t3code --version main.test --output /tmp/pkg.tar.gz
```

## Coding Style & Naming Conventions
Match the existing style: 2-space indentation in Ruby, JavaScript, and TypeScript; ESM modules; double quotes; and no semicolons in JS/TS. Keep Homebrew tokens Linux-specific where needed, such as `devpod-linux` and `vscode-insiders-linux`, to avoid upstream collisions. Prefer small helper methods and explicit guard checks for packaging scripts.

## Testing Guidelines
Every version bump or packaging change should include a local `brew install` or `brew test`, plus the relevant Dagger smoke test for artifact-based packages. Keep smoke coverage focused on the real install path: package artifact, install through Linuxbrew, verify binaries, and check desktop integration files when applicable.

When an upstream Desktop artifact embeds a CLI that is also packaged as a formula, extract
the artifact and verify the embedded binary before choosing install identities. Keep the
formula-owned CLI and cask-owned launcher names distinct, do not link the embedded CLI from
the cask, and make the package CI install both artifacts together to prove their Homebrew
paths coexist.

For Devsy on Bluefin or Fedora bootc, keep channel selection explicit and deterministic:
Homebrew owns the CLI path, while the Homebrew AppImage cask and upstream Flatpak bundle are
parallel first-class Desktop choices with different package-manager lifecycles. Never rank
one Desktop channel as the Bluefin default, auto-detect the host to switch package managers,
or make a cask invoke or own Flatpak. Recommend RPM only when it is deliberately baked into
a custom bootc image, not for ad hoc host layering.
The Devsy AppImage embeds AppIndicator/StatusNotifier and libnotify support, so do not add
the DevPod AppIndicator runtime formula without new runtime evidence.

## Commit & Pull Request Guidelines
Follow the existing history: short imperative subjects like `Update devpod-linux cask to v0.17.0` or `Package VS Code Insiders from the Linux RPM (#12)`. PRs should explain what changed, link the upstream release or source commit, and note any updated SHA256 values. Include command output for `dagger ... smoke-test` or `brew audit` in the PR description. Add screenshots only when launcher, icon, or protocol-handler behavior changes.

## Security & Release Hygiene
Never merge checksum changes without verifying the downloaded artifact. Prefer immutable release URLs, keep `livecheck` skip reasons accurate, and avoid introducing unpinned network downloads into formula or cask install steps.
