# Devsy FUSE-Free Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch the Homebrew Devsy Desktop cask from its extracted AppImage payload without requiring FUSE 2.

**Architecture:** Keep the verified upstream AppImage as the cask artifact and extract it during preflight as today. Generate a wrapper that validates and executes `squashfs-root/AppRun`, and enforce that contract in the Dagger smoke test and package documentation.

**Tech Stack:** Homebrew Cask Ruby DSL, Bash wrapper, TypeScript Dagger pipeline, Node test runner, Markdown

## Global Constraints

- Do not install host packages or invoke Flatpak, RPM, DEB, or another package manager.
- Do not auto-detect Dakota, Bluefin, or any other host image.
- Do not add Electron `--no-sandbox` flags.
- Keep the formula-owned `devsy` CLI and cask-owned `devsy-desktop` launcher distinct.
- Preserve the immutable upstream AppImage and its verified SHA-256 as the downloaded artifact.

---

### Task 1: Enforce and implement the extracted AppRun launcher

**Files:**
- Modify: `dagger/tap-pipeline/tests/contract.test.ts`
- Modify: `Casks/devsy-desktop.rb`
- Modify: `dagger/tap-pipeline/src/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: Homebrew cask `staged_path` and the extracted `squashfs-root/AppRun` file.
- Produces: The `devsy-desktop` executable wrapper, which forwards all arguments to `AppRun`.

- [ ] **Step 1: Add a failing static packaging contract**

Add these assertions beside the existing Devsy cask assertions in `contract.test.ts`:

```ts
assert.match(cask, /app_run = "#\{staged_path\}\/squashfs-root\/AppRun"/)
assert.match(cask, /exec "#\{app_run\}" "\$@"/)
assert.doesNotMatch(cask, /exec "#\{appimage\}" "\$@"/)
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
npm --prefix dagger/tap-pipeline test -- --test-name-pattern='Devsy packages pin stable release assets and keep CLI and Desktop identities separate'
```

Expected: FAIL because the cask wrapper still executes `#{appimage}` and does not define `app_run`.

- [ ] **Step 3: Implement the minimal FUSE-free wrapper**

In the cask preflight, define and validate the extracted entry point after extraction:

```ruby
app_run = "#{staged_path}/squashfs-root/AppRun"
raise "No executable AppRun found in extracted Devsy AppImage" unless File.executable?(app_run)
```

Change only the wrapper's final command:

```bash
exec "#{app_run}" "$@"
```

- [ ] **Step 4: Strengthen the artifact smoke assertions**

Replace the smoke assertion that only checks for an executable AppImage with assertions that inspect the installed wrapper and extracted entry point:

```ts
"grep -q 'squashfs-root/AppRun' \"$(brew --prefix)/bin/devsy-desktop\"",
"! grep -q 'exec .*\\.AppImage' \"$(brew --prefix)/bin/devsy-desktop\"",
"test -n \"$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -path '*/squashfs-root/AppRun' -type f -perm -111 -print -quit)\"",
```

Retain the existing `--no-sandbox`, CLI coexistence, desktop entry, icon, protocol, embedded CLI checksum, and AppIndicator assertions.

- [ ] **Step 5: Document the runtime behavior**

Replace the README sentence that lists FUSE as a host runtime requirement with:

```markdown
The Homebrew cask extracts the verified AppImage during installation and launches
its bundled `AppRun` directly, so it does not require FUSE at runtime. GTK3, NSS,
AT-SPI, and `xdg-utils` remain host runtime requirements.
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm --prefix dagger/tap-pipeline test -- --test-name-pattern='Devsy packages pin stable release assets and keep CLI and Desktop identities separate'
```

Expected: PASS.

Run:

```bash
npm --prefix dagger/tap-pipeline test
```

Expected: all tap-pipeline tests PASS.

- [ ] **Step 7: Run formatting and diff checks**

Run:

```bash
git diff --check
```

Expected: no output and exit status 0.

- [ ] **Step 8: Run the artifact smoke test when Dagger is available**

Run:

```bash
dagger -m ./dagger/tap-pipeline call ci-check --package-id=devsy-desktop
```

Expected: PASS, including formula/cask coexistence and executable extracted `AppRun` assertions. If Dagger or its engine is unavailable, report that limitation without weakening the focused test coverage.

- [ ] **Step 9: Commit the implementation**

```bash
git add Casks/devsy-desktop.rb README.md dagger/tap-pipeline/src/index.ts dagger/tap-pipeline/tests/contract.test.ts
git commit -m "Launch Devsy Desktop without FUSE"
```
