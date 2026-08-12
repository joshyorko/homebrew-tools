CODEX_DESKTOP_CONVERSION_REF_FILE ?= codex-desktop-conversion.ref
CODEX_DESKTOP_CONVERSION_COMMIT ?= $(shell ref="$$(sed -e 's/[[:space:]]*\#.*//' -e '/^[[:space:]]*$$/d' "$(CODEX_DESKTOP_CONVERSION_REF_FILE)" 2>/dev/null | head -n 1)"; printf '%s\n' "$${ref:-self-hosted}")
CODEX_DESKTOP_LINUX_FEATURES_LEAN := node-repl-reaper open-target-discovery read-aloud read-aloud-mcp chronicle-skysight record-and-replay x11-ewmh-computer-use
CODEX_DESKTOP_LINUX_FEATURES_FULL := agent-workspace api-key-model-visibility api-key-service-tier appshots authenticated-proxy codex-wrapper-updater conversation-mode copilot-reasoning-effort frameless-titlebar global-dictation mcp-helper-reaper node-repl-reaper omarchy-theme open-target-discovery persistent-status-panel pet-overlay project-task-sort read-aloud read-aloud-mcp chronicle-skysight record-and-replay remote-control-ui remote-mobile-control ui-tweaks x11-ewmh-computer-use
CODEX_DESKTOP_FEATURES_CONFIG ?= $(if $(XDG_CONFIG_HOME),$(XDG_CONFIG_HOME),$(HOME)/.config)/homebrew-tools/codex-desktop-features.json
CODEX_DESKTOP_SETUP_VENV ?= $(CURDIR)/.venv-codex-desktop-setup
CODEX_DESKTOP_SAVED_LINUX_FEATURES := $(shell if test -f "$(CODEX_DESKTOP_FEATURES_CONFIG)"; then python3 scripts/codex-desktop-feature-wizard.py --config "$(CODEX_DESKTOP_FEATURES_CONFIG)" --print-enabled 2>/dev/null; fi)
CODEX_DESKTOP_LINUX_FEATURES ?= $(if $(strip $(CODEX_DESKTOP_SAVED_LINUX_FEATURES)),$(CODEX_DESKTOP_SAVED_LINUX_FEATURES),$(CODEX_DESKTOP_LINUX_FEATURES_FULL))
CODEX_DESKTOP_BUNDLE_DIR ?= dist/codex-desktop-local
CODEX_DESKTOP_BUNDLE_ARCHIVE ?= dist/codex-desktop-local.tar.gz
RECOVERY_OUTPUT ?= dist/homebrew-tools-recovery
RECOVERY_FILE_SERVER_URL ?= http://127.0.0.1:8000/homebrew-tools-recovery
DAGGER_GIT_DIR ?= $(shell git rev-parse --git-common-dir)
CODEX_DESKTOP_INSTALL_ARGS = --conversion-commit "$(CODEX_DESKTOP_CONVERSION_COMMIT)"
ifneq ($(strip $(CODEX_DESKTOP_CODEX_DMG)),)
CODEX_DESKTOP_INSTALL_ARGS += --codex-dmg "$(CODEX_DESKTOP_CODEX_DMG)"
endif

ifneq ($(strip $(CODEX_DESKTOP_BUNDLE_DIR)),)
CODEX_DESKTOP_INSTALL_ARGS += --bundle-dir "$(CODEX_DESKTOP_BUNDLE_DIR)"
endif

ifneq ($(strip $(CODEX_DESKTOP_LINUX_FEATURES)),)
CODEX_DESKTOP_INSTALL_ARGS += --linux-features "$(CODEX_DESKTOP_LINUX_FEATURES)"
endif

ifneq ($(strip $(CODEX_DESKTOP_SKIP_INSTALL)),)
CODEX_DESKTOP_INSTALL_ARGS += --skip-install
endif

CODEX_DESKTOP_INSTALL_ARGS += $(CODEX_DESKTOP_INSTALL_EXTRA_ARGS)

.PHONY: recovery-t3code-cli-main recovery-all fizzy-symphony-smoke chatgpt uninstall-chatgpt codex-desktop-build codex-desktop-build-archive codex-desktop-setup-env codex-desktop-setup codex-desktop-install codex-desktop-install-artifact codex-desktop-install-archive crabbox-pull-codex-desktop-archive codex-install codex-desktop-uninstall codex-desktop-zap codex-desktop-rebuild-relaunch codex-desktop-rebuild-foreground codex-desktop-rebuild-dry-run test-codex-desktop-setup test-codex-desktop-install test-codex-desktop-rebuild test-codex-desktop-local install-codex-desktop uninstall-codex-desktop zap-codex-desktop print-codex-desktop-linux-features-lean print-codex-desktop-linux-features-full

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

print-codex-desktop-linux-features-lean:
	@printf '%s\n' "$(CODEX_DESKTOP_LINUX_FEATURES_LEAN)"

print-codex-desktop-linux-features-full:
	@printf '%s\n' "$(CODEX_DESKTOP_LINUX_FEATURES_FULL)"

codex-desktop-build:
	CODEX_DESKTOP_SKIP_INSTALL=1 scripts/install-codex-desktop-local.sh $(CODEX_DESKTOP_INSTALL_ARGS)

codex-desktop-build-archive: codex-desktop-build
	mkdir -p "$(dir $(CODEX_DESKTOP_BUNDLE_ARCHIVE))"
	tar -czf "$(CODEX_DESKTOP_BUNDLE_ARCHIVE)" -C "$(dir $(CODEX_DESKTOP_BUNDLE_DIR))" "$(notdir $(CODEX_DESKTOP_BUNDLE_DIR))"

codex-desktop-setup-env:
	CODEX_DESKTOP_SETUP_VENV="$(CODEX_DESKTOP_SETUP_VENV)" scripts/bootstrap-codex-desktop-setup-env.sh

codex-desktop-setup: codex-desktop-setup-env
	CODEX_DESKTOP_SETUP_PYTHON="$(CODEX_DESKTOP_SETUP_VENV)/bin/python3" CODEX_DESKTOP_FEATURES_CONFIG="$(CODEX_DESKTOP_FEATURES_CONFIG)" scripts/setup-codex-desktop-local.sh --full-profile "$(CODEX_DESKTOP_LINUX_FEATURES_FULL)" --lean-profile "$(CODEX_DESKTOP_LINUX_FEATURES_LEAN)"

codex-desktop-install:
	scripts/install-codex-desktop-local.sh $(CODEX_DESKTOP_INSTALL_ARGS)

codex-desktop-install-artifact:
	CODEX_DESKTOP_USE_EXISTING_BUNDLE=1 scripts/install-codex-desktop-local.sh $(CODEX_DESKTOP_INSTALL_ARGS)

codex-desktop-install-archive:
	test -f "$(CODEX_DESKTOP_BUNDLE_ARCHIVE)"
	rm -rf "$(CODEX_DESKTOP_BUNDLE_DIR)"
	mkdir -p "$(dir $(CODEX_DESKTOP_BUNDLE_DIR))"
	tar -xzf "$(CODEX_DESKTOP_BUNDLE_ARCHIVE)" -C "$(dir $(CODEX_DESKTOP_BUNDLE_DIR))"
	$(MAKE) codex-desktop-install-artifact

crabbox-pull-codex-desktop-archive:
	scripts/pull-crabbox-artifact.sh --id "$${CRABBOX_LEASE:-homebrew-tools}" --remote "$(CODEX_DESKTOP_BUNDLE_ARCHIVE)" --local "$(CODEX_DESKTOP_BUNDLE_ARCHIVE)"

codex-install: codex-desktop-install

codex-desktop-rebuild-relaunch:
	scripts/rebuild-and-relaunch-codex-desktop.sh --detach

codex-desktop-rebuild-foreground:
	scripts/rebuild-and-relaunch-codex-desktop.sh

codex-desktop-rebuild-dry-run:
	scripts/rebuild-and-relaunch-codex-desktop.sh --detach --dry-run

test-codex-desktop-install:
	scripts/test-install-codex-desktop-local.sh

test-codex-desktop-setup:
	python3 scripts/test-codex-desktop-feature-wizard.py
	scripts/test-bootstrap-codex-desktop-setup-env.sh
	scripts/test-setup-codex-desktop-local.sh

test-codex-desktop-rebuild:
	scripts/test-rebuild-and-relaunch-codex-desktop.sh

test-codex-desktop-local: test-codex-desktop-setup test-codex-desktop-install test-codex-desktop-rebuild

codex-desktop-uninstall:
	scripts/uninstall-codex-desktop-local.sh

codex-desktop-zap:
	scripts/uninstall-codex-desktop-local.sh --zap

install-codex-desktop: codex-desktop-install

uninstall-codex-desktop: codex-desktop-uninstall

zap-codex-desktop: codex-desktop-zap
