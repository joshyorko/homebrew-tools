# Vulkan Dictation and Arc Reactor HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch Dakota dictation to the verified upstream Vulkan/Whisper `large-v3-turbo` path and add a lightweight GNOME Shell Arc Reactor HUD with staged rollback-safe installation.

**Architecture:** Dagger resolves and verifies the latest stable upstream Vulkan executable and packages it with the existing Homebrew tap. The local installer stages a verified Whisper model and candidate configuration, benchmarks GPU execution and resource limits, then atomically switches the user service or restores the prior Cohere installation. A user-scoped GNOME Shell extension observes Voxtype's state file and renders the Arc Reactor only during active states.

**Tech Stack:** Dagger TypeScript v5, Homebrew Formula Ruby, POSIX/Bash installer, Node test runner, Whisper GGML, Vulkan, GNOME Shell 50 JavaScript/St/Clutter extension APIs, systemd user service.

**Spec:** `docs/superpowers/specs/2026-08-30-vulkan-dictation-arc-hud-design.md`

## Global Constraints

- Keep dictation local, free, and private; do not add cloud transcription.
- Resolve the latest stable upstream Voxtype release at build time and verify release assets using `SHA256SUMS.txt`.
- Use the prebuilt `linux-x86_64-vulkan` executable; do not layer CUDA toolkit packages or compile a new GPU toolchain on Dakota.
- Use Whisper `large-v3-turbo`; keep the model warm only after staged resource and speed gates pass.
- Preserve and restore the current Cohere installation on any failed gate.
- Keep the global `Super+Alt+V` and Herdr `prefix+alt+v` triggers.
- Install the HUD per-user, use no idle polling loop, and stop all animations when idle.
- Do not push, publish, merge, or modify GitHub state.

### Task 1: Add verified Vulkan artifact selection

**Files:**
- Modify: `dagger/tap-pipeline/src/index.ts:1660-1775,1860-1895,3950-4070`
- Modify: `scripts/package-voxtype.mjs:35-90`
- Modify: `Formula/voxtype.rb:1-65`
- Test: `dagger/tap-pipeline/tests/dictation.test.ts`

**Interfaces:**
- Produce `buildVoxtypePrebuiltArtifact(tap, tagName, version, variant): Promise<VoxtypeBuild>` that returns the staged executable container, artifact path, release tag, commit, and asset name.
- Preserve the existing companion-binary packaging interface and formula wrappers.

- [ ] **Step 1: Write failing contract assertions**

  Add assertions that `dictationBundle` selects `linux-x86_64-vulkan`, verifies `SHA256SUMS.txt`, packages `large-v3-turbo`-compatible Whisper, and does not pass the `cohere` cargo feature for the local bundle.

- [ ] **Step 2: Run the focused test and confirm failure**

  Run `node --experimental-strip-types --test dagger/tap-pipeline/tests/dictation.test.ts`.
  Expected: the new Vulkan-selection assertions fail against the current cargo build path.

- [ ] **Step 3: Implement the prebuilt asset resolver**

  Fetch the latest stable release metadata already used by `dictationBundle`, fetch `SHA256SUMS.txt`, locate the exact line for `voxtype-${version}-linux-x86_64-vulkan`, download it through the existing retrying asset helper, verify its SHA-256 in the container, chmod it, and package it through `package-voxtype.mjs`. Keep the source tree only for default config, README, license, and completions.

- [ ] **Step 4: Keep formula packaging variant-neutral**

  Ensure the formula installs the packaged `libexec/voxtype` and companions without assuming whether the binary is cargo-built or upstream-prebuilt. Update caveats to describe the Vulkan variant and model setup without suggesting host package layering.

- [ ] **Step 5: Run focused tests and packaging syntax checks**

  Run `node --experimental-strip-types --test dagger/tap-pipeline/tests/dictation.test.ts`, `node --check scripts/package-voxtype.mjs`, and `git diff --check`.

- [ ] **Step 6: Commit the artifact change**

  Run `git add dagger/tap-pipeline/src/index.ts dagger/tap-pipeline/tests/dictation.test.ts scripts/package-voxtype.mjs Formula/voxtype.rb && git commit -m "Use verified Vulkan Voxtype artifact"`.

### Task 2: Implement staged Whisper model installation and rollback

**Files:**
- Modify: `scripts/install-dictation-local.sh:1-460`
- Test: `dagger/tap-pipeline/tests/dictation.test.ts`

**Interfaces:**
- Produce shell functions `resolve_whisper_model_metadata`, `download_whisper_model`, `stage_vulkan_candidate`, `accept_vulkan_candidate`, and `rollback_vulkan_candidate`.
- The installer must return nonzero before changing the active service if a staged gate fails.

- [ ] **Step 1: Write failing installer contract tests**

  Assert that the installer contains the Vulkan asset identity, Whisper model name, atomic `.part` download, model digest verification, `whisper.gpu_device`, flash-attention configuration, resource gates, and rollback paths.

- [ ] **Step 2: Run the focused test and confirm failure**

  Run `node --experimental-strip-types --test dagger/tap-pipeline/tests/dictation.test.ts`.
  Expected: the new installer assertions fail before implementation.

- [ ] **Step 3: Add model metadata and atomic download**

  Resolve the canonical Hugging Face `ggml-large-v3-turbo.bin` LFS metadata, download to `${model_path}.part`, verify the LFS SHA-256 and GGML magic, then move it into `~/.local/share/voxtype/models/large-v3-turbo/ggml-large-v3-turbo.bin`. Preserve the existing model and write provenance only after verification.

- [ ] **Step 4: Add isolated staging and safety gates**

  Copy the candidate executable/config into a temporary directory, run `voxtype transcribe` against a checked-in short English fixture, sample `nvidia-smi` memory/utilization, measure resident memory and elapsed time, and require NVIDIA Vulkan initialization, expected text, faster-than-real-time completion, GPU memory under 3584 MiB, and RSS under 4096 MiB.

- [ ] **Step 5: Add atomic acceptance and rollback**

  Back up the active formula/configuration, install the verified artifact, select `engine = "whisper"`, `whisper.model = "large-v3-turbo"`, `whisper.gpu_device = 0`, `whisper.flash_attn = true`, disable context reuse, restart the service, rerun health checks, and restore the backup on any failure. Keep the existing Homebrew PATH drop-in and both shortcuts.

- [ ] **Step 6: Run shell/test checks**

  Run `bash -n scripts/install-dictation-local.sh`, `node --experimental-strip-types --test dagger/tap-pipeline/tests/dictation.test.ts`, and `git diff --check`.

- [ ] **Step 7: Commit the installer change**

  Run `git add scripts/install-dictation-local.sh dagger/tap-pipeline/tests/dictation.test.ts && git commit -m "Stage Vulkan Whisper dictation safely"`.

### Task 3: Add the GNOME Arc Reactor HUD

**Files:**
- Create: `gnome-extension/voxtype-arc-hud@homebrew-tools.local/metadata.json`
- Create: `gnome-extension/voxtype-arc-hud@homebrew-tools.local/extension.js`
- Create: `gnome-extension/voxtype-arc-hud@homebrew-tools.local/stylesheet.css`
- Modify: `scripts/install-dictation-local.sh:390-460`
- Test: `dagger/tap-pipeline/tests/dictation.test.ts`

**Interfaces:**
- Extension entry points `enable()` and `disable()` manage a single `ArcReactor` overlay and `Gio.FileMonitor`.
- State transitions consume the exact strings `idle`, `recording`, `transcribing`, and error/unavailable.

- [ ] **Step 1: Write failing extension contract tests**

  Assert metadata declares GNOME Shell 50 compatibility, extension.js contains `enable`/`disable`, monitors `/voxtype/state`, creates a click-through overlay, and defines all four visual states.

- [ ] **Step 2: Run the focused test and confirm failure**

  Run `node --experimental-strip-types --test dagger/tap-pipeline/tests/dictation.test.ts`.
  Expected: extension-file assertions fail because the directory does not exist.

- [ ] **Step 3: Implement the state-driven overlay**

  Use `Main.layoutManager.uiGroup`, `St.Widget`, `St.Label`, `Clutter.ActorAlign`, and `Gio.File.monitor_file`. Hide the overlay for idle; show the cyan reactor and rotating ring for recording; show a short processing pulse for transcribing; show a brief amber/red error state. Set `reactive = false`, remove the monitor and stop transitions in `disable()`, and avoid timers while idle.

- [ ] **Step 4: Add the Arc Reactor stylesheet**

  Define compact bottom-center rings, cyan glow, red recording pip, elapsed/state labels, and reduced-motion fallback. Avoid blur-heavy or full-screen effects.

- [ ] **Step 5: Install and enable per-user**

  Copy the extension to `${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/voxtype-arc-hud@homebrew-tools.local`, run `gnome-extensions enable voxtype-arc-hud@homebrew-tools.local`, and continue successfully if the extension cannot enable; dictation remains independent.

- [ ] **Step 6: Run extension tests and syntax checks**

  Run `node --experimental-strip-types --test dagger/tap-pipeline/tests/dictation.test.ts`, `node --check gnome-extension/voxtype-arc-hud@homebrew-tools.local/extension.js`, `bash -n scripts/install-dictation-local.sh`, and `git diff --check`.

- [ ] **Step 7: Commit the HUD change**

  Run `git add gnome-extension scripts/install-dictation-local.sh dagger/tap-pipeline/tests/dictation.test.ts && git commit -m "Add GNOME Arc Reactor dictation HUD"`.

### Task 4: Build, install, and perform live acceptance

**Files:**
- Modify: `README.md` only if the final command or model identity needs updating.

- [ ] **Step 1: Run the complete automated suite**

  Run `node --experimental-strip-types --test dagger/tap-pipeline/tests/*.test.ts`, `bash -n scripts/install-dictation-local.sh`, and `git diff --check`.

- [ ] **Step 2: Build the local bundle through Dagger**

  Run `make dictation-install` only after the staged installer checks are present. Confirm the manifest contains the stable Voxtype tag, Vulkan asset, model revision/digest, and Eitype provenance.

- [ ] **Step 3: Verify post-install service and GPU state**

  Run:

  ```bash
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
  systemctl --user is-active voxtype.service
  voxtype config get engine
  voxtype config get whisper.model
  command -v eitype
  nvidia-smi --query-gpu=name,memory.used,memory.free,utilization.gpu --format=csv,noheader
  ```

- [ ] **Step 4: Verify live UX**

  Test `Super+Alt+V` in a browser field and Herdr terminal. Confirm Arc Reactor states for recording and transcription, correct insertion, no clipboard fallback, and no visible HUD while idle.

- [ ] **Step 5: Commit any documentation-only update and report gates**

  Report source, Dagger, install, service, GPU, model, injection, HUD, rollback, and publication gates separately. Do not push or publish.
