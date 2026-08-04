# Devsy FUSE-Free Launcher Design

## Objective

Make the Homebrew `devsy-desktop` cask run on Project Bluefin Dakota's
distroless image while preserving support for Fedora-based Bluefin images.

## Root Cause

The cask extracts the verified upstream AppImage during installation, but its
wrapper launches the original AppImage. The AppImage runtime dynamically loads
FUSE 2 before Devsy starts. Dakota intentionally lacks the conventional host
userspace that provides `libfuse.so.2`, so the launcher fails even though the
application payload has already been extracted.

## Design

Keep the immutable upstream AppImage as the downloaded and checksummed release
artifact. During cask preflight, continue extracting it with
`--appimage-extract`. Change the installed `devsy-desktop` wrapper to execute
the extracted `squashfs-root/AppRun` entry point directly.

The wrapper will verify that `AppRun` is executable and emit a targeted error
if the extracted payload is incomplete. It will forward all arguments without
adding Electron sandbox flags or detecting the host image.

This preserves the AppImage's bundled runtime libraries without invoking its
FUSE-dependent mount runtime. The cask will not install host packages, invoke
another package manager, select Flatpak, or build Devsy from source at install
time.

## Alternatives Rejected

- The upstream `.deb` declares conventional host runtime dependencies and is
  less suitable for Dakota's distroless userspace.
- Building from source during installation requires Node, Go, Python, native
  build tools, and network downloads without eliminating Electron's runtime
  dependencies.
- Installing FUSE 2 changes the host and contradicts the distroless packaging
  goal.
- A runtime fallback creates image-dependent behavior when the extracted
  payload can be used deterministically everywhere.

## Verification

Update the Devsy Desktop smoke contract to assert that:

- the installed wrapper executes `squashfs-root/AppRun`;
- the wrapper does not execute the `.AppImage` or add `--no-sandbox`;
- `AppRun` exists and is executable after cask installation;
- the CLI formula and Desktop cask remain co-installable;
- desktop entry, icon, and protocol-handler installation remain unchanged.

Update the README to state that the Homebrew launcher uses the extracted
AppImage payload and therefore does not require FUSE at runtime.
