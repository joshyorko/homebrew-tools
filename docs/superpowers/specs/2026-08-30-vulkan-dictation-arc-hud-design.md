# Vulkan Dictation and Arc Reactor HUD Design

## Goal

Provide fast, accurate, free, private desktop dictation on Dakota with an unmistakable JARVIS-style recording indicator. Dictation must work in browsers, terminals, editors, and other GNOME applications through the existing global shortcut.

## Decisions

- Replace the locally compiled Cohere-focused Voxtype executable with upstream's checksum-verified `linux-x86_64-vulkan` release executable.
- Use Whisper `large-v3-turbo` as the primary model. Upstream identifies it as the best-accuracy GPU option, and it fits the RTX A1000's 4 GB VRAM envelope.
- Use the existing Eitype portal integration for focused-field insertion.
- Replace the incompatible Layer Shell HUD with a user-scoped GNOME Shell 50 extension using the selected Arc Reactor visual direction.
- Keep the existing `Super+Alt+V` global shortcut and Herdr-specific binding.

No CUDA toolkit, host package layering, cloud transcription, GitHub publication, or system-wide GNOME extension installation is introduced.

## Packaging and Provenance

The Dagger dictation bundle resolves the latest stable upstream Voxtype release, downloads the Vulkan executable and required companion assets, and verifies every asset against that release's `SHA256SUMS.txt`. The Homebrew formula packages the verified executable without rebuilding it.

The installer resolves the `large-v3-turbo` model from its canonical Hugging Face repository, obtains the immutable LFS SHA-256 metadata, downloads atomically to a `.part` file, verifies the digest, checks the GGML header, and only then moves it into the Voxtype model directory. The resolved release, model revision, asset names, and digests are recorded in the local provenance manifest.

## Staged Runtime Acceptance

The installer does not immediately replace the active service. It first stages the Vulkan executable and model in an isolated temporary configuration and runs a known English audio fixture through `voxtype transcribe` while observing the NVIDIA GPU.

The staged candidate must:

- initialize the NVIDIA Vulkan device without falling back to CPU;
- transcribe the fixture successfully and match its expected text within the fixture's accuracy threshold;
- finish faster than the fixture's audio duration;
- stay below 3.5 GB GPU memory and 4 GB resident system memory;
- exit without Vulkan, allocation, or illegal-instruction errors.

If any gate fails, installation stops and the current service, formula, configuration, model, and shortcut remain unchanged.

After staging passes, the installer backs up the current formula/configuration, installs the candidate, selects `engine = "whisper"` and `model = "large-v3-turbo"`, enables flash attention, disables context reuse that can cause repetitions, and restarts the user service. It then repeats startup, engine, model, service, and GPU checks. A failed post-install check restores the backup and restarts the previous service.

The model remains loaded while the service is running for low first-word latency. This is bounded by the acceptance limits above. The HUD and shortcut do no GPU work.

## Arc Reactor HUD

The HUD is a user-scoped GNOME Shell extension named `voxtype-arc-hud@homebrew-tools.local`. It is installed under the user's GNOME extension directory and enabled through `gnome-extensions`.

It adds a click-through overlay to GNOME Shell's UI group and monitors `/run/user/$UID/voxtype/state` with a `Gio.FileMonitor`. There is no idle polling loop.

States:

- `idle`: overlay hidden and animations stopped;
- `recording`: bottom-center cyan reactor visible, concentric rings rotating, red recording pip, and elapsed timer active;
- `transcribing`: reactor contracts into a brighter pulse with a `PROCESSING` label;
- error or unavailable service: brief amber/red fault indication, then hide.

The visual uses GNOME `St` and `Clutter` primitives only. Animations run only while visible, stop immediately on idle, accept no pointer or keyboard input, and avoid blur or full-screen effects. The extension contains no microphone or transcription logic and can be disabled without affecting Voxtype.

## Verification

Automated tests cover:

- latest-stable Vulkan asset selection and checksum enforcement;
- formula contents and installed executable identity;
- immutable model metadata, atomic download, and digest failure handling;
- staged benchmark failure preserving the current installation;
- generated GNOME extension metadata for Shell 50;
- state parser and the idle, recording, transcribing, and error transitions;
- installer preservation of both global and Herdr shortcuts;
- rollback after a simulated post-install service failure.

Live acceptance covers:

- service start and model preload;
- GPU use and resource ceilings;
- a timed transcription fixture;
- focused-field insertion in a browser and Herdr terminal;
- visible Arc Reactor transitions for recording and transcription;
- idle CPU use and extension disable/enable behavior.

## Rollback

The previous Homebrew artifact, Voxtype configuration, and model remain available until live acceptance succeeds. The installer records a single local rollback command in the state directory. The GNOME extension can be disabled independently, and failure to enable it does not take down dictation.
