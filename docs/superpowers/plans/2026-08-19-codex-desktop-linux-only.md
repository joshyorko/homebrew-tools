# ChatGPT Community Linux Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete DMG lane and make ChatGPT Community setup select and build a verified pinned or latest OpenAI Linux package from one immutable ilysenko/PatchRaptor checkout while preserving the untouched official `chatgpt` stream.

**Architecture:** The setup wizard emits an official Linux package source choice. The shell adapter forwards that choice and the conversion ref to Dagger. Dagger resolves the conversion ref once, validates the selected feature profile against that tree, and uses either its verified pin metadata or signed APT resolution for the package.

**Tech Stack:** Bash, Python/GTK wizard, TypeScript Dagger module, Node test runner, Homebrew packaging, Debian package tooling.

**Spec:** `docs/superpowers/specs/2026-08-19-codex-desktop-linux-only-design.md`

## Global Constraints

- Support only the latest signed stable OpenAI Linux package on amd64 and arm64.
- Trust `InRelease` through the pinned repository key, then verify `Packages` and package SHA-256 values.
- Never execute upstream maintainer scripts.
- Keep the output identity `codex-desktop` under `/opt/codex-desktop`.
- Do not edit generated output or the user-selected dirty feature profile.

### Task 1: Lock the stale-generation regression

**Files:**
- Modify: `dagger/tap-pipeline/tests/codex-desktop.test.ts`
- Modify: `dagger/tap-pipeline/tests/contract.test.ts`

- [ ] **Step 1: Add assertions that the official setup forwards the conversion ref and package source.** Assert the setup command contains `--codex-desktop-conversion-commit` and `--codex-desktop-package-source`, and the Dagger source contains no hard-coded historical conversion SHA.
- [ ] **Step 2: Add an assertion that release-bundle passes its conversion argument into the official builder and rejects a missing feature in the resolved tree.**
- [ ] **Step 3: Run the focused tests and verify they fail against the current implementation.**

Run: `npm test -- --runInBand dagger/tap-pipeline/tests/codex-desktop.test.ts dagger/tap-pipeline/tests/contract.test.ts`

### Task 2: Wire immutable conversion and package-source selection

**Files:**
- Modify: `scripts/codex-desktop-feature-wizard.py`
- Modify: `scripts/setup-codex-desktop-official.sh`
- Modify: `dagger/tap-pipeline/src/index.ts`
- Modify: `dagger/tap-pipeline/src/library.ts`

- [ ] **Step 1: Add official Linux `pinned`/`latest` source state to the wizard result and review page.** Keep the legacy DMG labels and controls out of the official path.
- [ ] **Step 2: Pass the conversion ref and selected package source from setup to `release-bundle`.
- [ ] **Step 3: Change `releaseBundle` and the official builder to use the requested conversion ref, resolve it once, and read the feature/package metadata from that tree.
- [ ] **Step 4: Implement latest package resolution using the conversion checkout’s signed repository helper; retain pinned mode from `nix/upstream-linux-packages.json`.
- [ ] **Step 5: Add fail-closed feature validation before helper compilation and include source/commit provenance in `release.json`.
- [ ] **Step 6: Run `npm test -- --runInBand dagger/tap-pipeline/tests/codex-desktop.test.ts dagger/tap-pipeline/tests/contract.test.ts` and verify green.

### Task 3: Remove the DMG conversion lane

**Files:**
- Delete: `codex-desktop-dmg.ref`
- Delete: `Formula/codex-desktop-linux-builder.rb`
- Delete: `scripts/setup-codex-desktop-local.sh`
- Delete: `scripts/install-codex-desktop-local.sh`
- Delete: `scripts/package-codex-desktop-linux.mjs`
- Delete: `scripts/patch-codex-desktop-conversion.mjs`
- Delete: `scripts/test-setup-codex-desktop-local.sh`
- Delete: `scripts/test-install-codex-desktop-local.sh`
- Modify: `Makefile`, `dagger/tap-pipeline/src/index.ts`, `dagger/tap-pipeline/tests/codex-desktop.test.ts`, related docs

- [ ] **Step 1: Remove local-bundle/DAG APIs and all DMG-only constants and consumers after confirming no official path uses them.
- [ ] **Step 2: Remove legacy Make targets, formula references, and obsolete DMG documentation/tests.
- [ ] **Step 3: Run `rg -n 'Codex\\.dmg|codex-desktop-local|codex-desktop-dmg|dmgSource|CODEX_DESKTOP_DMG'` and ensure no deleted public name remains.

### Task 4: Verify and publish

- [ ] **Step 1: Run `bash -n scripts/setup-codex-desktop-official.sh` and the focused wizard/Dagger tests.
- [ ] **Step 2: Run the build-only `dagger -m ./dagger/tap-pipeline call ... release-bundle --package-id=codex-desktop-linux` path; verify retained bundle provenance and offline smoke before invoking host installation.
- [ ] **Step 3: Run `git diff --check` and inspect the complete diff while preserving `config/codex-desktop-linux-features.json`.
- [ ] **Step 4: Commit the source changes, push `homebrew-tools/main`, and verify the remote SHA.
- [ ] **Step 5: Only after the build-only gate is green, report whether the host install step is authorized and run it if explicitly requested.
