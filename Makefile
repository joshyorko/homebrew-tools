CODEX_DESKTOP_CONVERSION_REF_FILE ?= codex-desktop-conversion.ref
CODEX_DESKTOP_CONVERSION_COMMIT ?= $(shell ref="$$(sed -e 's/[[:space:]]*\#.*//' -e '/^[[:space:]]*$$/d' "$(CODEX_DESKTOP_CONVERSION_REF_FILE)" 2>/dev/null | head -n 1)"; printf '%s\n' "$${ref:-self-hosted}")
CODEX_DESKTOP_LINUX_FEATURES_LEAN := node-repl-reaper open-target-discovery read-aloud read-aloud-mcp record-and-replay x11-ewmh-computer-use
CODEX_DESKTOP_LINUX_FEATURES_FULL := agent-workspace api-key-service-tier appshots authenticated-proxy codex-wrapper-updater conversation-mode copilot-reasoning-effort node-repl-reaper open-target-discovery persistent-status-panel read-aloud read-aloud-mcp record-and-replay remote-control-ui remote-mobile-control ui-tweaks x11-ewmh-computer-use
CODEX_DESKTOP_LINUX_FEATURES ?= $(CODEX_DESKTOP_LINUX_FEATURES_FULL)
CODEX_DESKTOP_INSTALL_ARGS = --conversion-commit "$(CODEX_DESKTOP_CONVERSION_COMMIT)"
CODEX_RELEASE_INSTALL_ARGS =

ifneq ($(strip $(CODEX_RELEASE_SOURCE_REPO)),)
CODEX_RELEASE_INSTALL_ARGS += --source-repo "$(CODEX_RELEASE_SOURCE_REPO)"
endif

ifneq ($(strip $(CODEX_RELEASE_REF)),)
CODEX_RELEASE_INSTALL_ARGS += --ref "$(CODEX_RELEASE_REF)"
endif

ifneq ($(strip $(CODEX_RELEASE_SOURCE_DIR)),)
CODEX_RELEASE_INSTALL_ARGS += --source-dir "$(CODEX_RELEASE_SOURCE_DIR)"
endif

ifneq ($(strip $(CODEX_RELEASE_CACHE_DIR)),)
CODEX_RELEASE_INSTALL_ARGS += --cache-dir "$(CODEX_RELEASE_CACHE_DIR)"
endif

ifneq ($(strip $(CODEX_RELEASE_OUTPUT_DIR)),)
CODEX_RELEASE_INSTALL_ARGS += --output-dir "$(CODEX_RELEASE_OUTPUT_DIR)"
endif

ifneq ($(strip $(CODEX_RELEASE_ARTIFACT)),)
CODEX_RELEASE_INSTALL_ARGS += --artifact "$(CODEX_RELEASE_ARTIFACT)"
endif

ifneq ($(strip $(CODEX_RELEASE_BUNDLE_DIR)),)
CODEX_RELEASE_INSTALL_ARGS += --bundle-dir "$(CODEX_RELEASE_BUNDLE_DIR)"
endif

ifneq ($(strip $(CODEX_RELEASE_SKIP_INSTALL)),)
CODEX_RELEASE_INSTALL_ARGS += --skip-install
endif

CODEX_RELEASE_INSTALL_ARGS += $(CODEX_RELEASE_INSTALL_EXTRA_ARGS)

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

.PHONY: codex codex-build codex-release-local codex-desktop-install codex-install codex-desktop-uninstall codex-desktop-zap codex-desktop-rebuild-relaunch codex-desktop-rebuild-foreground codex-desktop-rebuild-dry-run test-codex-desktop-rebuild install-codex-desktop uninstall-codex-desktop zap-codex-desktop print-codex-desktop-linux-features-lean print-codex-desktop-linux-features-full

print-codex-desktop-linux-features-lean:
	@printf '%s\n' "$(CODEX_DESKTOP_LINUX_FEATURES_LEAN)"

print-codex-desktop-linux-features-full:
	@printf '%s\n' "$(CODEX_DESKTOP_LINUX_FEATURES_FULL)"

codex:
	scripts/install-codex-release-local.sh $(CODEX_RELEASE_INSTALL_ARGS) -- $(CODEX_RELEASE_BUILD_ARGS)

codex-build:
	CODEX_RELEASE_SKIP_INSTALL=1 scripts/install-codex-release-local.sh $(CODEX_RELEASE_INSTALL_ARGS) -- $(CODEX_RELEASE_BUILD_ARGS)

codex-release-local: codex-build

codex-desktop-install:
	scripts/install-codex-desktop-local.sh $(CODEX_DESKTOP_INSTALL_ARGS)

codex-install: codex-desktop-install

codex-desktop-rebuild-relaunch:
	scripts/rebuild-and-relaunch-codex-desktop.sh --detach

codex-desktop-rebuild-foreground:
	scripts/rebuild-and-relaunch-codex-desktop.sh

codex-desktop-rebuild-dry-run:
	scripts/rebuild-and-relaunch-codex-desktop.sh --detach --dry-run

test-codex-desktop-rebuild:
	scripts/test-rebuild-and-relaunch-codex-desktop.sh

codex-desktop-uninstall:
	scripts/uninstall-codex-desktop-local.sh

codex-desktop-zap:
	scripts/uninstall-codex-desktop-local.sh --zap

install-codex-desktop: codex-desktop-install

uninstall-codex-desktop: codex-desktop-uninstall

zap-codex-desktop: codex-desktop-zap
