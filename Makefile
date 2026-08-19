CODEX_DESKTOP_CONVERSION_REF_FILE ?= codex-desktop-conversion.ref
CODEX_DESKTOP_CONVERSION_COMMIT ?= $(shell ref="$$(sed -e 's/[[:space:]]*\#.*//' -e '/^[[:space:]]*$$/d' "$(CODEX_DESKTOP_CONVERSION_REF_FILE)" 2>/dev/null | head -n 1)"; printf '%s\n' "$${ref:-self-hosted}")
CODEX_DESKTOP_LINUX_FEATURES_LEAN := computer-use-linux node-repl-reaper read-aloud read-aloud-mcp chronicle-skysight record-and-replay
CODEX_DESKTOP_LINUX_FEATURES_FULL := agent-workspace api-key-model-visibility api-key-service-tier appshots authenticated-proxy automation-extensions chronicle-skysight computer-use-linux copilot-reasoning-effort directory-only-working-tree-watch frameless-titlebar global-dictation mcp-helper-reaper node-repl-reaper omarchy-theme persistent-status-panel pet-overlay project-group-last-updated-sort project-task-sort read-aloud read-aloud-mcp record-and-replay remote-control-ui remote-mobile-control shared-app-server-socket ui-tweaks
CODEX_DESKTOP_FEATURES_CONFIG ?= $(if $(XDG_CONFIG_HOME),$(XDG_CONFIG_HOME),$(HOME)/.config)/homebrew-tools/codex-desktop-features.json
CODEX_DESKTOP_SAVED_LINUX_FEATURES := $(shell if test -f "$(CODEX_DESKTOP_FEATURES_CONFIG)"; then python3 scripts/codex-desktop-feature-wizard.py --config "$(CODEX_DESKTOP_FEATURES_CONFIG)" --print-enabled 2>/dev/null; fi)
CODEX_DESKTOP_LINUX_FEATURES ?= $(if $(strip $(CODEX_DESKTOP_SAVED_LINUX_FEATURES)),$(CODEX_DESKTOP_SAVED_LINUX_FEATURES),$(CODEX_DESKTOP_LINUX_FEATURES_FULL))
CODEX_DESKTOP_OFFICIAL_BUNDLE_DIR ?= dist/codex-desktop-official
RECOVERY_OUTPUT ?= dist/homebrew-tools-recovery
RECOVERY_FILE_SERVER_URL ?= http://127.0.0.1:8000/homebrew-tools-recovery
DAGGER_GIT_DIR ?= $(shell git rev-parse --git-common-dir)
.PHONY: recovery-t3code-cli-main recovery-all fizzy-symphony-smoke chatgpt uninstall-chatgpt codex-desktop-setup codex-desktop-install codex-install install-codex-desktop test-codex-desktop-feature-wizard

recovery-t3code-cli-main:
	dagger -m ./dagger/tap-pipeline call --git-dir="$(DAGGER_GIT_DIR)" -o "$(RECOVERY_OUTPUT)" recovery-export --package-id=t3code-cli-main --file-server-base-url="$(RECOVERY_FILE_SERVER_URL)"

recovery-all:
	dagger -m ./dagger/tap-pipeline call --git-dir="$(DAGGER_GIT_DIR)" -o "$(RECOVERY_OUTPUT)" recovery-export --brewfile=./recovery/Brewfile --file-server-base-url="$(RECOVERY_FILE_SERVER_URL)"

fizzy-symphony-smoke:
	dagger -m ./dagger/fizzy-symphony-smoke call smoke-test --tap=.

chatgpt:
	scripts/install-chatgpt-local.sh

uninstall-chatgpt:
	scripts/uninstall-chatgpt.sh

codex-desktop-setup:
	CODEX_DESKTOP_LINUX_FEATURES_FULL="$(CODEX_DESKTOP_LINUX_FEATURES_FULL)" CODEX_DESKTOP_LINUX_FEATURES_LEAN="$(CODEX_DESKTOP_LINUX_FEATURES_LEAN)" CODEX_DESKTOP_BUNDLE_DIR="$(CODEX_DESKTOP_OFFICIAL_BUNDLE_DIR)" scripts/setup-codex-desktop-official.sh
	CODEX_DESKTOP_SKIP_SETUP=1 CODEX_DESKTOP_BUNDLE_DIR="$(CODEX_DESKTOP_OFFICIAL_BUNDLE_DIR)" scripts/install-codex-desktop-official.sh

codex-desktop-install:
	CODEX_DESKTOP_BUNDLE_DIR="$(CODEX_DESKTOP_OFFICIAL_BUNDLE_DIR)" scripts/install-codex-desktop-official.sh

codex-install install-codex-desktop: codex-desktop-install

test-codex-desktop-feature-wizard:
	python3 scripts/test-codex-desktop-feature-wizard.py
