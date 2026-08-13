# Headroom Self-Hosted Homebrew Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate an offline-installable Headroom self-hosted Homebrew release bundle from an exact source commit.

**Architecture:** Extend the existing tap package registry and Dagger adapter switch with one Headroom source builder, formula renderer, CI path, metadata path, and bundle path. Retain the complete wheelhouse in the artifact and emit final provenance beside it in the release bundle.

**Tech Stack:** Dagger TypeScript, Python 3.13, pip wheel, Homebrew formula Ruby, GitHub Actions.

## Global Constraints

- Work only on `patchraptor/headroom-homebrew-release` in the supplied persistent worktree.
- Pin commit `ad7eea0d310c13278965a54488dbb6a9e3162d33` and tree `5ff8a07cfb70e8912dfcbd04d60282472e931199`.
- Use Python 3.13 and `headroom-ai[proxy]`.
- Install through Homebrew with `--no-index` and `--find-links`.
- Do not publish a GitHub Release, deploy Headroom, or mutate `main`.

---

### Task 1: Registry and automation contract

**Files:**
- Modify: `dagger/tap-pipeline/src/types.ts`
- Modify: `dagger/tap-pipeline/src/library.ts`
- Modify: `dagger/tap-pipeline/auto-update-slots.json`
- Modify: `.github/workflows/tap-auto-update.yml`
- Modify: `dagger/tap-pipeline/tests/contract.test.ts`
- Modify: `dagger/tap-pipeline/tests/planner.test.ts`

- [ ] Add failing contract tests for the package identity, exact source pin, changed path, release capability, and daily/dispatch slot.
- [ ] Run focused Node tests and confirm they fail for missing Headroom registration.
- [ ] Add the minimal registry, type, changed-path, and workflow entries.
- [ ] Rerun focused Node tests and confirm they pass.

### Task 2: Source build, formula, and provenance

**Files:**
- Create: `Formula/headroom-self-hosted.rb`
- Modify: `dagger/tap-pipeline/src/index.ts`
- Modify: `dagger/tap-pipeline/tests/contract.test.ts`

- [ ] Add failing contract assertions for Python 3.13, proxy wheel build, complete wheelhouse retention, offline pip flags, source tree hash, artifact checksum provenance, and CLI checks.
- [ ] Run the focused contract test and confirm it fails.
- [ ] Implement the Headroom builder, formula renderer, CI check, release metadata, and release bundle with final provenance.
- [ ] Rerun focused tests and TypeScript checks.

### Task 3: Checkpoint publication

**Files:** all Headroom-scoped paths from Tasks 1-2 and these design/plan documents.

- [ ] Verify diff scope, static tests, formatting, and source pin.
- [ ] Commit the coherent implementation checkpoint.
- [ ] Push the specified branch and open a draft PR against `main` with `gh`.

### Task 4: End-to-end acceptance

**Files:** no source changes unless evidence exposes a Headroom packaging defect.

- [ ] Run one Dagger `release-bundle` lane for `headroom-self-hosted` and retain output under `/tmp`.
- [ ] Verify artifact checksum, complete wheelhouse, internal provenance, and bundle provenance.
- [ ] Run Dagger `ci-check` for the isolated offline Homebrew install and CLI tests.
- [ ] Update the draft PR with exact checks and any remaining risk; push a follow-up fix only if required.
