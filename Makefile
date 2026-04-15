# erfianugrah/opencode — fork build & sync workflow
# Tracks upstream anomalyco/opencode dev branch with local patches.

PLATFORM   := $(shell uname -s | tr A-Z a-z)-$(shell uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/')
DIST       := packages/opencode/dist/opencode-$(PLATFORM)/bin/opencode
INSTALL    := $(HOME)/.opencode/bin/opencode
BACKUP     := $(HOME)/.opencode/bin/opencode.bak
BUILD_SCRIPT := ./packages/opencode/script/build.ts

.PHONY: sync build install uninstall update clean help

## Fetch upstream dev, merge into local dev, push to fork
sync:
	@echo "Syncing upstream..."
	git fetch upstream
	git merge upstream/dev --no-edit
	git push origin dev
	@echo "✓ Synced with upstream"

## Install dependencies and build the binary
build:
	bun install
	$(BUILD_SCRIPT) --single
	@echo ""
	@echo "✓ Built: $(DIST)"
	@$(DIST) --version

## Back up current binary and install the new build
install: $(DIST)
	@if [ -f "$(INSTALL)" ]; then \
		cp "$(INSTALL)" "$(BACKUP)"; \
		echo "Backed up $(INSTALL) → $(BACKUP)"; \
	fi
	cp "$(DIST)" "$(INSTALL)"
	chmod +x "$(INSTALL)"
	@echo "✓ Installed: $$($(INSTALL) --version)"
	@echo ""
	@echo "Disable auto-update to keep this build:"
	@echo '  Set "autoupdate": false in ~/.config/opencode/opencode.json'

## Restore the backed-up binary
uninstall:
	@if [ -f "$(BACKUP)" ]; then \
		cp "$(BACKUP)" "$(INSTALL)"; \
		echo "✓ Restored: $$($(INSTALL) --version)"; \
	else \
		echo "No backup found at $(BACKUP)"; \
		echo "Re-enable autoupdate in opencode.json and restart to get the official release."; \
	fi

## Sync, build, and install in one shot
update: sync build install
	@echo ""
	@echo "✓ Updated to latest upstream + local patches"

## Remove build artifacts
clean:
	rm -rf packages/opencode/dist
	@echo "✓ Cleaned build artifacts"

## Show this help
help:
	@echo "erfianugrah/opencode — fork build & sync"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Quick start:"
	@echo "  make update       Sync upstream + build + install (do it all)"
	@echo ""
	@echo "Individual steps:"
	@echo "  make sync         Fetch upstream dev and merge"
	@echo "  make build        Install deps and compile binary"
	@echo "  make install      Back up current binary and install new build"
	@echo ""
	@echo "Maintenance:"
	@echo "  make uninstall    Restore backed-up official binary"
	@echo "  make clean        Remove build artifacts"
	@echo ""
	@echo "Platform: $(PLATFORM)"
	@echo "Binary:   $(DIST)"
	@echo "Install:  $(INSTALL)"
