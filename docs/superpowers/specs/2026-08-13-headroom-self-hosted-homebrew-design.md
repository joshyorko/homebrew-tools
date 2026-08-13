# Headroom Self-Hosted Homebrew Design

## Goal

Package the exact current `joshyorko/headroom:self-hosted` source as the `headroom-self-hosted` Homebrew formula and integrate it with the tap's standard CI, release-bundle, and auto-update workflows.

## Source and artifact contract

- Source repository: `https://github.com/joshyorko/headroom`
- Source ref: `self-hosted`
- Pinned commit: `ad7eea0d310c13278965a54488dbb6a9e3162d33`
- Source tree: `5ff8a07cfb70e8912dfcbd04d60282472e931199`
- Build image: Python 3.13 Bookworm
- Build profile: `headroom-ai[proxy]`

The Dagger builder creates the project wheel and every resolved dependency wheel in one retained wheelhouse. The release artifact contains that complete wheelhouse and internal build provenance. The release bundle adds final provenance containing the source repository, ref, exact commit, tree hash, artifact SHA256, build profile, and Python version.

## Homebrew and validation contract

The generated formula creates a Python 3.13 virtual environment and installs only from the retained wheelhouse with `--no-index` and `--find-links`. CI installs from a local artifact in an isolated Homebrew container, runs `brew test`, and directly checks `headroom --help` plus `headroom proxy --help`.

## Automation contract

`PACKAGE_REGISTRY`, changed-path detection, release metadata, and standard release-bundle generation own the package. A `headroom-daily` slot tracks the `self-hosted` branch head and is both scheduled daily and explicitly dispatchable. Publication remains a separate workflow action; this change does not publish a release.
