CODEX_DESKTOP_CONVERSION_REF_FILE ?= codex-desktop-conversion.ref
CODEX_DESKTOP_CONVERSION_COMMIT ?= $(shell ref="$$(sed -e 's/[[:space:]]*\#.*//' -e '/^[[:space:]]*$$/d' "$(CODEX_DESKTOP_CONVERSION_REF_FILE)" 2>/dev/null | head -n 1)"; printf '%s\n' "$${ref:-self-hosted}")
CODEX_DESKTOP_INSTALL_ARGS = --conversion-commit "$(CODEX_DESKTOP_CONVERSION_COMMIT)"

ifneq ($(strip $(CODEX_DESKTOP_CODEX_DMG)),)
CODEX_DESKTOP_INSTALL_ARGS += --codex-dmg "$(CODEX_DESKTOP_CODEX_DMG)"
endif

ifneq ($(strip $(CODEX_DESKTOP_BUNDLE_DIR)),)
CODEX_DESKTOP_INSTALL_ARGS += --bundle-dir "$(CODEX_DESKTOP_BUNDLE_DIR)"
endif

ifneq ($(strip $(CODEX_DESKTOP_SKIP_INSTALL)),)
CODEX_DESKTOP_INSTALL_ARGS += --skip-install
endif

CODEX_DESKTOP_INSTALL_ARGS += $(CODEX_DESKTOP_INSTALL_EXTRA_ARGS)

.PHONY: codex-desktop-install codex-install codex-desktop-uninstall codex-desktop-zap codex-desktop-rebuild-relaunch codex-desktop-rebuild-foreground codex-desktop-rebuild-dry-run test-codex-desktop-rebuild install-codex-desktop uninstall-codex-desktop zap-codex-desktop

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
