# Homebrew Patch Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Homebrew desktop update behavior into owned patch files and retain shared upstream lifecycle, strict applicability, and real coverage.

**Architecture:** Keep patches as strict new-file hunks and minimize edited upstream files. Put Homebrew policy, identity, metadata, and transitions in owned updater modules; keep `DesktopUpdates.ts` as the integration boundary for shared admission, shutdown, recovery, and quit behavior. Keep owned tests and helpers separate from upstream modules and tests.

**Tech Stack:** TypeScript, Effect, Vitest, Node source-type checker, Dagger tap pipeline, Git patch application.

**Spec:** Astra-approved design and required corrections in the implementation request for failed upstream source `ab45ce71673398678004b92552e0e5bc91c10201`, tap HEAD `04c75a1506fac7fa51ba4970285b7acdff17bf5f`.

## Global Constraints

- Preserve the existing uncommitted desktop-update and service-attach patch refreshes; correct them in place.
- Keep upstream admission, active-check waiting, fresh-state reread, interruption handling, shutdown, and recovery orchestration in shared upstream lifecycle.
- Keep new behavior in owned files where specified; do not modify upstream `useUpdateEverything.ts`, `desktopUpdate.logic.ts`, `DesktopUpdates.test.ts`, or `updatesTestHarness.ts`.
- Preserve native updater paths, independent provider actions, service ownership hooks, protection revalidation, undo, and rollback behavior.
- Use strict new-file hunks; preflight both old and new paths and reject collisions.
- Do not run heavy local builds; use `bash scripts/dagger-devsy.sh` for Dagger and clean it only after the final remote job.

**Execution status:** Tasks 1–3 are implemented. Strict Desktop and CLI application passed at both requested source SHAs; focused script checks passed. Upstream package type/behavior checks and Dagger packaging remain blocked by remote workspace provisioning.

## Review Focus

- Service ownership recovery must run in production startup before authentication; test transient, persistent, canceled, unknown-owner, package-mismatch, disabled-local, changed-owner, and credential-order cases.
- Update contention, interruption, cancellation, wrong version, handoff failure, backend recovery, readiness, rollback failure, and inactive-service states must not fabricate progress or success.
- A Homebrew paired action must not stage remote server/provider updates; native combined flow and independent provider actions remain available.
- Sparse source application must reject collisions on owned new files and behavior drift while tolerating unrelated comments, tests, imports, and line shifts.
- Type checks must compare same-source baseline diagnostics and require zero diagnostics in extracted modules and contracts.

---

### Task 1: Repair service-attach startup recovery and owned tests

**Files:** `patches/t3-homebrew-service-attach.patch`; owned `DesktopApp.homebrew.test.ts`.

- [x] Export or otherwise test the actual startup phase that owns `HomebrewServiceAttachment.recover`.
- [x] Make recovery return an explicit boolean outcome and exercise production startup ordering without injecting a successful-start flag.
- [x] Retain `DesktopBackendPool.onStateDirOwned` and startup ownership hooks; cover the listed recovery and credential-order cases.

### Task 2: Extract desktop update behavior and preserve shared lifecycle

**Files:** `patches/t3-homebrew-desktop-update.patch`; add `HomebrewDesktopUpdates.ts`, `homebrewDesktopUpdate.logic.ts`, `useHomebrewUpdateResult.ts`, `DesktopUpdates.homebrew.test.ts`, `homebrewUpdatesTestHarness.ts`.

- [x] Move policy, detection/identity, check/prepare validation, metadata/result state, state transitions, and detached handoff into the owned updater module with narrow typed inputs/results.
- [x] Keep `DesktopUpdates.ts` integration hooks for shared admission, active-check wait, fresh state, interruption, shutdown, readiness, recovery, managed channels, previous result, and native poller exclusion.
- [x] Restore upstream combined-update hook and update logic; gate both UI entry and stale-dialog execution for Homebrew.
- [x] Keep paired Homebrew updates scoped to desktop only and use owned UI confirmation/result helpers.
- [x] Keep IPC state schema and runtime schema synchronized; retain artifact resource hooks.
- [x] Move update tests to owned files; restore upstream test/harness files unchanged. Move protection tests into `service.homebrew.test.ts` and preserve target revalidation and undo.

### Task 3: Harden patch application and verification wiring

**Files:** `scripts/check-t3-patches.mjs`, `scripts/check-t3-source-types.mjs`, `dagger/tap-pipeline/src/index.ts`; focused fixtures/tests.

- [x] Extend sparse preflight path discovery to old and new patch paths and reject collisions with owned new files.
- [x] Preserve `applySourcePatches` and variant ordering; prove strict ordered Desktop and CLI application at the failed source and freshly resolved candidate SHA.
- [x] Add fixtures for harmless imports/tests/comments/line shifts and unrelated combined-update edits; reject changed hook signatures and owned-file collisions.
- [x] Extend source-type checks to attachment, extracted updater, and web/contracts with same-source baseline comparison; require zero diagnostics in new modules and no increases elsewhere.
- [x] Make Dagger pipeline explicitly select required owned tests and fail if any required test file is absent.

### Task 4: Focused and remote verification

**Files:** no further source changes unless a focused check exposes a defect.

- [ ] Run focused existing source patch, source type, and owned behavior checks in the available compatible runtime.
- [ ] Run paired install/package Dagger flows only through `bash scripts/dagger-devsy.sh`; retrieve evidence and clean the Devsy workspace once after the final remote job.
- [ ] Record failed-source and candidate-source SHAs, exact commands/results, applicability separately from behavior/type/package acceptance, and any blocked gates.
