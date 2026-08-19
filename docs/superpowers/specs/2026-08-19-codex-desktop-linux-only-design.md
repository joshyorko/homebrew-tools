# ChatGPT Community Linux Packaging Design

## Goal

Keep two explicit Linux streams: the untouched official OpenAI `chatgpt` package and the unofficial ilysenko/PatchRaptor `codex-desktop` package branded ChatGPT Community. The community setup chooses a pinned verified package or the latest package resolved through signed APT metadata.

## Design

The setup wizard exposes `pinned` and `latest` package sources only for the official Linux flow. The selected source is written to the wizard result and passed through the setup adapter into Dagger.

The conversion ref is resolved once to an immutable commit. Dagger uses that same checkout for feature discovery, package metadata, helper builds, and packaging. Pinned mode reads the verified package pin from that checkout. Latest mode resolves `InRelease`, validates the configured repository key and package indexes, then downloads and verifies the selected package before extraction.

The previous DMG conversion lane is removed: its refs, scripts, builder formula, local-bundle entrypoints, Make targets, tests, and obsolete documentation are deleted. No legacy fallback remains.

## Acceptance

- A feature profile cannot be applied to a conversion checkout that lacks one of its feature IDs.
- A release bundle records the selected conversion commit, package source, package version, package path, and package SHA-256.
- Pinned and latest package choices use the same immutable conversion checkout.
- The official build-only bundle and offline install smoke pass before any host installation.
