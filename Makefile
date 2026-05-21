.PHONY: codex-desktop-install codex-desktop-uninstall codex-desktop-zap install-codex-desktop uninstall-codex-desktop zap-codex-desktop

codex-desktop-install:
	scripts/install-codex-desktop-local.sh

codex-desktop-uninstall:
	scripts/uninstall-codex-desktop-local.sh

codex-desktop-zap:
	scripts/uninstall-codex-desktop-local.sh --zap

install-codex-desktop: codex-desktop-install

uninstall-codex-desktop: codex-desktop-uninstall

zap-codex-desktop: codex-desktop-zap
