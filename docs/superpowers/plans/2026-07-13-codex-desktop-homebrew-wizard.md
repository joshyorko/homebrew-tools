# Codex Desktop Homebrew Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native Homebrew-first wizard that discovers Codex Desktop Linux features, remembers validated selections, and safely forwards an exact feature set into the existing local Homebrew installer.

**Architecture:** A Python module owns the manifest/config model and GTK4/libadwaita UI, while a small Bash adapter resolves the immutable conversion commit and orchestrates the existing installer. The Makefile exposes one guided target and keeps the existing install target non-interactive. Dagger accepts an explicit `none` sentinel so an empty user selection cannot silently become the full profile.

**Tech Stack:** Python 3.11+ standard library, PyGObject GTK4/libadwaita when available, Bash, GNU Make, Node test runner, Dagger TypeScript.

## Global Constraints

- Do not stop, uninstall, relaunch, or bypass the existing running-app guard.
- Use the exact conversion commit for both feature discovery and the Dagger build.
- Persist selections under `XDG_CONFIG_HOME`; do not require users to edit JSON.
- Preserve explicit `CODEX_DESKTOP_LINUX_FEATURES` overrides.
- Provide a terminal fallback when GTK4/libadwaita or a graphical session is unavailable.
- Keep the public build/install path local-only; do not publish converted app payloads.

---

### Task 1: Feature model and persistence

**Files:**
- Create: `scripts/codex-desktop-feature-wizard.py`
- Create: `scripts/test-codex-desktop-feature-wizard.py`

**Interfaces:**
- Produces: `Feature`, `discover_features(root)`, `load_selection(path, default_ids)`, `toggle_feature(features, selected, feature_id, enabled)`, `save_selection(path, selected)`, and `selection_argument(selected)`.
- Produces CLI: `--features-root`, `--config`, `--full-profile`, `--lean-profile`, `--result`, and `--print-enabled`.

- [ ] **Step 1: Write failing model tests**

Create temporary `feature.json` fixtures and assert discovery rejects duplicate IDs, missing READMEs, unknown requirements, and malformed config. Assert enabling a feature recursively enables `requires`, conflicts leave the selection unchanged with a message, disabling a requirement also disables its dependents, and an empty selection serializes as `none`.

```python
def test_enabling_feature_adds_requirements(self):
    features = self.features(
        Feature("read-aloud", "Read Aloud"),
        Feature("conversation-mode", "Conversation Mode", requires=("read-aloud",)),
    )
    selected, notice = toggle_feature(features, set(), "conversation-mode", True)
    self.assertEqual(selected, {"conversation-mode", "read-aloud"})
    self.assertIn("Read Aloud", notice)
```

- [ ] **Step 2: Run the model tests and verify RED**

Run: `python3 scripts/test-codex-desktop-feature-wizard.py`

Expected: failure because `scripts/codex-desktop-feature-wizard.py` does not exist.

- [ ] **Step 3: Implement the model and config CLI**

Use dataclasses and JSON only. Discover repository features from
`linux-features/<id>/feature.json`, validate each adjacent `README.md`, preserve
only known enabled IDs, write atomically through a sibling temporary file, and
return `none` from `selection_argument(set())`.

```python
@dataclass(frozen=True)
class Feature:
    id: str
    title: str
    description: str = ""
    requires: tuple[str, ...] = ()
    conflicts: tuple[str, ...] = ()
    category: str = "Other"

def selection_argument(selected: set[str]) -> str:
    return ",".join(sorted(selected)) if selected else "none"
```

- [ ] **Step 4: Run the model tests and verify GREEN**

Run: `python3 scripts/test-codex-desktop-feature-wizard.py`

Expected: all model tests pass.

- [ ] **Step 5: Commit the model**

```bash
git add scripts/codex-desktop-feature-wizard.py scripts/test-codex-desktop-feature-wizard.py
git commit -m "feat: add Codex Desktop feature selection model"
```

### Task 2: Native wizard and terminal fallback

**Files:**
- Modify: `scripts/codex-desktop-feature-wizard.py`
- Modify: `scripts/test-codex-desktop-feature-wizard.py`

**Interfaces:**
- Consumes: Task 1 model functions.
- Produces: result JSON `{"action":"save|install|cancel","features":[...]}`.

- [ ] **Step 1: Write failing action/result tests**

Test that `write_result(path, "save", selected)` and
`write_result(path, "install", selected)` serialize stable sorted IDs, while
cancel writes no config and reports `cancel`.

```python
def test_install_result_is_stable(self):
    write_result(self.result, "install", {"read-aloud", "pet-overlay"})
    self.assertEqual(json.loads(self.result.read_text()), {
        "action": "install",
        "features": ["pet-overlay", "read-aloud"],
    })
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `python3 scripts/test-codex-desktop-feature-wizard.py`

Expected: failure because `write_result` and the UI controller do not exist.

- [ ] **Step 3: Implement the GTK4/libadwaita flow**

Build one `Adw.ApplicationWindow` with a `Gtk.Stack` for feature selection and
review. Use `Adw.SwitchRow` for features, `Gtk.SearchEntry` for filtering,
profile buttons for Daily driver, Minimal, and Custom, an `Adw.ToastOverlay` for
dependency/conflict feedback, and explicit Save and Build & install actions.
Closing the window writes `cancel` only. If `gi`, GTK4, Adw, `DISPLAY`, and
`WAYLAND_DISPLAY` are unavailable, use a numbered terminal picker with the same
model and final action choices.

```python
def graphical_session_available() -> bool:
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))

def run_wizard(args) -> int:
    if graphical_session_available() and gtk_available():
        return run_gtk_wizard(args)
    return run_terminal_wizard(args)
```

- [ ] **Step 4: Run unit and syntax verification**

Run: `python3 scripts/test-codex-desktop-feature-wizard.py`

Run: `python3 -m py_compile scripts/codex-desktop-feature-wizard.py`

Expected: both commands exit 0 without opening a window.

- [ ] **Step 5: Commit the wizard UI**

```bash
git add scripts/codex-desktop-feature-wizard.py scripts/test-codex-desktop-feature-wizard.py
git commit -m "feat: add guided Codex Desktop setup window"
```

### Task 3: Homebrew adapter and Make targets

**Files:**
- Create: `scripts/setup-codex-desktop-local.sh`
- Create: `scripts/test-setup-codex-desktop-local.sh`
- Modify: `Makefile`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: wizard result JSON from Task 2.
- Produces: `make codex-desktop-setup` and `make test-codex-desktop-setup`.

- [ ] **Step 1: Write the failing adapter test**

Use fake `git`, wizard, and installer executables. Assert ref resolution produces
one immutable SHA, save exits without the installer, install passes both
`--conversion-commit <sha>` and `--linux-features <ids|none>`, and cancellation
starts no build.

```bash
assert_contains "$install_args" '--conversion-commit 0123456789abcdef0123456789abcdef01234567'
assert_contains "$install_args" '--linux-features none'
[ ! -e "$install_marker" ] || fail "cancel must not start installer"
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `bash scripts/test-setup-codex-desktop-local.sh`

Expected: failure because `scripts/setup-codex-desktop-local.sh` does not exist.

- [ ] **Step 3: Implement immutable checkout and action forwarding**

Resolve the configured branch/tag with `git ls-remote`, fetch that SHA into
`${XDG_CACHE_HOME:-$HOME/.cache}/homebrew-tools/codex-desktop-wizard/source`,
launch the wizard with the XDG config path, parse result JSON with Python, and
invoke the existing installer only for `action=install`.

```bash
case "$action" in
    save) echo "Feature selection saved." ;;
    install) "$repo_dir/scripts/install-codex-desktop-local.sh" \
        --conversion-commit "$resolved_commit" \
        --linux-features "$feature_argument" ;;
    cancel) echo "Setup cancelled; no build started." ;;
esac
```

- [ ] **Step 4: Wire Make defaults and documentation**

Add `codex-desktop-setup` and its test target. Read the saved config through the
Python `--print-enabled` CLI only when `CODEX_DESKTOP_LINUX_FEATURES` is not
explicitly set; fall back to the full profile when no saved config exists.
Document the guided flow before the raw install command.

- [ ] **Step 5: Run adapter and existing local tests**

Run: `bash scripts/test-setup-codex-desktop-local.sh`

Run: `make test-codex-desktop-local`

Expected: all tests pass; rebuild tests stay dry-run only.

- [ ] **Step 6: Commit the Homebrew adapter**

```bash
git add Makefile .gitignore README.md scripts/setup-codex-desktop-local.sh scripts/test-setup-codex-desktop-local.sh
git commit -m "feat: add Homebrew Codex Desktop setup wizard"
```

### Task 4: Explicit empty feature profile in Dagger

**Files:**
- Modify: `dagger/tap-pipeline/src/index.ts`
- Modify: `dagger/tap-pipeline/tests/codex-desktop.test.ts`

**Interfaces:**
- Consumes: `none` from Tasks 1-3.
- Produces: `parseLinuxFeatureList("none") === []`.

- [ ] **Step 1: Add the failing Dagger test**

Expose no new public API. Add a source-contract assertion and exercise the
local bundle feature parser through the existing test seam so `none` resolves
to zero enabled descriptors rather than the full default.

```typescript
assert.match(pipeline, /normalized === "none"/)
```

- [ ] **Step 2: Run the focused suite and verify RED**

Run: `npm test --prefix dagger/tap-pipeline`

Expected: the new `normalized === "none"` assertion fails.

- [ ] **Step 3: Implement the sentinel**

```typescript
if (normalized === "none") {
  return []
}
```

- [ ] **Step 4: Run full Homebrew validation**

Run: `npm test --prefix dagger/tap-pipeline`

Run: `bash -n scripts/setup-codex-desktop-local.sh scripts/install-codex-desktop-local.sh`

Run: `git diff --check`

Expected: 0 failures and clean syntax/diff checks.

- [ ] **Step 5: Commit the Dagger contract**

```bash
git add dagger/tap-pipeline/src/index.ts dagger/tap-pipeline/tests/codex-desktop.test.ts
git commit -m "fix: support an empty Codex Desktop feature profile"
```

### Task 5: Final review and publish

**Files:**
- Review all files changed since `origin/main`.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: pushed branch and merged Homebrew `main` only after validation.

- [ ] **Step 1: Run the complete focused matrix**

```bash
python3 scripts/test-codex-desktop-feature-wizard.py
bash scripts/test-setup-codex-desktop-local.sh
make test-codex-desktop-local
npm test --prefix dagger/tap-pipeline
python3 -m py_compile scripts/codex-desktop-feature-wizard.py
bash -n scripts/setup-codex-desktop-local.sh scripts/install-codex-desktop-local.sh
git diff --check origin/main..HEAD
```

Expected: all executable tests pass.

- [ ] **Step 2: Review scope and safety**

Confirm no command starts a real build during tests, no path stops/relaunches
Desktop, explicit environment overrides win, and the branch contains only the
design/plan and wizard work.

- [ ] **Step 3: Push the focused branch**

```bash
git push -u origin patchraptor/codex-desktop-homebrew-wizard
```

- [ ] **Step 4: Merge into Homebrew main after green validation**

Fast-forward or merge the focused branch into `main`, push `origin/main`, and
verify `main...origin/main` reports `0 0`.
