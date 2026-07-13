# Codex Desktop DMG Source Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe pinned-versus-latest DMG choice to the Homebrew wizard and preserve the existing acceptance evidence for every latest-DMG build.

**Architecture:** The wizard owns the visible source choice and result summary. The setup adapter forwards the choice to the existing installer. The installer keeps pinned behavior as the default, uses Dagger's upstream download path only for `latest`, copies the returned decision/reports to XDG state, and refuses installation unless the shared acceptance verdict permits promotion.

**Tech Stack:** Python 3, GTK4/libadwaita, Bash, Dagger TypeScript, Node test runner.

## Global Constraints

- Never rewrite `codex-desktop-dmg.ref` from the wizard.
- Never stop, rebuild, install, or relaunch Codex Desktop without the explicit Build & install action.
- Only `accepted` and `accepted_with_warnings` may reach Homebrew installation.
- Preserve evidence for `rejected` and `inconclusive` attempts.

---

### Task 1: Wizard source model and review UI

**Files:**
- Modify: `scripts/codex-desktop-feature-wizard.py`
- Test: `scripts/test-codex-desktop-feature-wizard.py`

**Interfaces:**
- Produces result JSON with `dmgSource: "pinned" | "latest"`.
- Consumes pinned SHA, size, Last-Modified, and ETag CLI values for display.

- [ ] Add failing tests proving pinned is the default, source values are validated, and result summaries expose verdict details.
- [ ] Run `python3 scripts/test-codex-desktop-feature-wizard.py` and confirm the new assertions fail.
- [ ] Add the two review-page source rows, terminal fallback prompt, result JSON field, and result-summary mode.
- [ ] Re-run the Python test suite and confirm it passes.

### Task 2: Setup adapter propagation and result display

**Files:**
- Modify: `scripts/setup-codex-desktop-local.sh`
- Test: `scripts/test-setup-codex-desktop-local.sh`

**Interfaces:**
- Consumes wizard `dmgSource`.
- Calls installer with `--dmg-source pinned|latest` and `--result-file PATH`.

- [ ] Add failing shell fixtures for pinned/default and latest forwarding plus post-build result display.
- [ ] Run `bash scripts/test-setup-codex-desktop-local.sh` and confirm the new fixture fails.
- [ ] Forward source metadata and show the persisted result after the installer returns.
- [ ] Re-run the adapter suite and confirm it passes.

### Task 3: Acceptance evidence and install gate

**Files:**
- Modify: `scripts/install-codex-desktop-local.sh`
- Modify: `dagger/tap-pipeline/src/index.ts`
- Test: `scripts/test-install-codex-desktop-local.sh`
- Test: `dagger/tap-pipeline/tests/codex-desktop.test.ts`

**Interfaces:**
- Installer accepts `--dmg-source pinned|latest` and `--result-file PATH`.
- Dagger bundle always returns `result.json` and available files under `reports/`.

- [ ] Add failing tests proving latest omits `--codex-dmg`, pinned still verifies its fingerprint, reports are copied, and rejected/inconclusive verdicts stop before Brew.
- [ ] Run the focused shell and Dagger tests and confirm the new assertions fail.
- [ ] Make the conversion attempt return evidence even when acceptance rejects the candidate, then gate artifact packaging and Brew installation on the decision verdict.
- [ ] Re-run the focused tests and confirm they pass.

### Task 4: Documentation and broad verification

**Files:**
- Modify: `README.md`

- [ ] Document the two source choices, persistent report location, and promotion verdicts.
- [ ] Run Python, shell, Dagger, syntax, and diff checks.
- [ ] Commit and publish the focused branch, then fast-forward Homebrew `main`.
