# erfianugrah/opencode — fork build & sync workflow
# Tracks upstream anomalyco/opencode dev branch with local patches.

PLATFORM   := $(shell uname -s | tr A-Z a-z)-$(shell uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/')
DIST       := packages/opencode/dist/opencode-$(PLATFORM)/bin/opencode
INSTALL    := $(HOME)/.opencode/bin/opencode
BACKUP     := $(HOME)/.opencode/bin/opencode.bak
BUILD_SCRIPT := ./packages/opencode/script/build.ts

# Files where upstream changes most often conflict with fork patches.
# Keep this list in sync with FORK.md "Hot files" section.
HOT_FILES := \
  packages/opencode/src/config/config.ts \
  packages/opencode/src/session/prompt.ts \
  packages/opencode/src/session/processor.ts \
  packages/opencode/src/session/system.ts \
  packages/opencode/src/session/superpowers.ts \
  packages/opencode/src/provider/provider.ts \
  packages/opencode/src/provider/transform.ts \
  packages/opencode/src/session/message-v2.ts \
  packages/opencode/src/tool/registry.ts \
  package.json

.PHONY: sync sync-preview sync-tags sync-rollback build install uninstall update clean help

## Show upstream changes since last sync (read-only, no mutation)
sync-preview:
	@git fetch upstream --quiet
	@COMMITS=$$(git rev-list --count HEAD..upstream/dev); \
	  if [ "$$COMMITS" = "0" ]; then \
	    echo "✓ Already up to date with upstream/dev"; \
	    exit 0; \
	  fi; \
	  echo "Upstream/dev has $$COMMITS new commits since last merge."; \
	  echo ""; \
	  echo "Latest 20:"; \
	  git log --oneline HEAD..upstream/dev | head -20 | sed 's/^/  /'; \
	  if [ "$$COMMITS" -gt 20 ]; then echo "  ... ($$((COMMITS-20)) more)"; fi; \
	  echo ""; \
	  echo "Upstream commits touching HOT files (conflict risk):"; \
	  ANY_HOT=0; \
	  for f in $(HOT_FILES); do \
	    N=$$(git log --oneline HEAD..upstream/dev -- "$$f" 2>/dev/null | wc -l); \
	    if [ "$$N" -gt 0 ]; then \
	      printf "  %4d  %s\n" "$$N" "$$f"; \
	      ANY_HOT=1; \
	    fi; \
	  done; \
	  if [ "$$ANY_HOT" = "0" ]; then echo "  (none — clean merge likely)"; fi; \
	  echo ""; \
	  echo "Drill into a file: git log --oneline HEAD..upstream/dev -- <path>"; \
	  echo "Run merge:        make sync"

## Sync: tag rollback point, fetch, prompt, merge, typecheck, push
sync:
	@TAG="pre-sync-$$(date +%Y%m%d-%H%M%S)"; \
	  git fetch upstream --quiet; \
	  COMMITS=$$(git rev-list --count HEAD..upstream/dev); \
	  if [ "$$COMMITS" = "0" ]; then \
	    echo "✓ Already up to date"; \
	    exit 0; \
	  fi; \
	  echo "Tagging rollback point: $$TAG"; \
	  git tag "$$TAG"; \
	  echo ""; \
	  echo "Upstream has $$COMMITS new commits. Hot files affected:"; \
	  HOT=""; \
	  for f in $(HOT_FILES); do \
	    N=$$(git log --oneline HEAD..upstream/dev -- "$$f" 2>/dev/null | wc -l); \
	    if [ "$$N" -gt 0 ]; then \
	      printf "  %4d  %s\n" "$$N" "$$f"; \
	      HOT="$$HOT $$f"; \
	    fi; \
	  done; \
	  if [ -z "$$HOT" ]; then echo "  (none — clean merge likely)"; fi; \
	  echo ""; \
	  if [ -z "$$SYNC_YES" ]; then \
	    printf "Continue with merge? [y/N] "; \
	    read -r yn < /dev/tty; \
	    if [ "$$yn" != "y" ] && [ "$$yn" != "Y" ]; then \
	      echo "✗ Aborted before merge. Rollback tag preserved: $$TAG"; \
	      exit 1; \
	    fi; \
	  fi; \
	  echo "Merging upstream/dev..."; \
	  if git merge upstream/dev --no-edit; then \
	    echo "✓ Merge succeeded. Running typecheck..."; \
	    if bun typecheck 2>&1 | tail -3; then \
	      echo "✓ Typecheck passed"; \
	    else \
	      echo ""; \
	      echo "✗ Typecheck output above. Inspect failures before pushing."; \
	      echo "  Rollback: git reset --hard $$TAG"; \
	      echo "  Or fix: edit + commit + manually push"; \
	      exit 1; \
	    fi; \
	    git push origin dev; \
	    echo "✓ Synced. Rollback tag preserved: $$TAG"; \
	    echo "  Cleanup later: git tag -d $$TAG"; \
	  else \
	    echo ""; \
	    echo "✗ Merge conflict. Files in conflict:"; \
	    git diff --name-only --diff-filter=U | sed 's/^/    /'; \
	    echo ""; \
	    echo "  Resolve: edit the files, then 'git add' + 'git commit'"; \
	    echo "  Push:    git push origin dev"; \
	    echo "  Abort:   git merge --abort && git reset --hard $$TAG"; \
	    exit 1; \
	  fi

## List recent pre-sync rollback tags
sync-tags:
	@TAGS=$$(git tag | grep '^pre-sync-' | sort -r); \
	  if [ -z "$$TAGS" ]; then \
	    echo "No pre-sync tags. None created yet."; \
	    exit 0; \
	  fi; \
	  echo "Recent pre-sync tags (newest first):"; \
	  echo "$$TAGS" | head -10 | while read t; do \
	    SHA=$$(git rev-parse --short "$$t"); \
	    SUBJ=$$(git log -1 --format='%s' "$$t"); \
	    printf "  %-30s %s %s\n" "$$t" "$$SHA" "$$SUBJ"; \
	  done

## Roll back to the most recent pre-sync tag (DESTRUCTIVE — uses --hard reset)
sync-rollback:
	@LAST=$$(git tag | grep '^pre-sync-' | sort -r | head -1); \
	  if [ -z "$$LAST" ]; then \
	    echo "✗ No pre-sync tag found"; \
	    exit 1; \
	  fi; \
	  echo "Will hard-reset to: $$LAST ($$(git rev-parse --short $$LAST))"; \
	  echo "Current HEAD:      $$(git rev-parse --short HEAD)"; \
	  printf "Continue? [y/N] "; \
	  read -r yn < /dev/tty; \
	  if [ "$$yn" != "y" ] && [ "$$yn" != "Y" ]; then echo "Aborted."; exit 1; fi; \
	  git reset --hard "$$LAST"; \
	  echo "✓ Reset to $$LAST"; \
	  echo "  To push the rollback to origin: git push --force-with-lease origin dev"

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
	@echo "  make update         Sync upstream + build + install (do it all)"
	@echo ""
	@echo "Sync workflow:"
	@echo "  make sync-preview   Show upstream changes (read-only, safe)"
	@echo "  make sync           Tag rollback + fetch + prompt + merge + typecheck + push"
	@echo "  make sync-tags      List recent pre-sync rollback tags"
	@echo "  make sync-rollback  Hard-reset to most recent pre-sync tag (destructive)"
	@echo ""
	@echo "Build:"
	@echo "  make build          Install deps and compile binary"
	@echo "  make install        Back up current binary and install new build"
	@echo "  make uninstall      Restore backed-up official binary"
	@echo "  make clean          Remove build artifacts"
	@echo ""
	@echo "Env overrides:"
	@echo "  SYNC_YES=1 make sync    Skip confirmation prompt (for scripted use)"
	@echo ""
	@echo "Platform: $(PLATFORM)"
	@echo "Binary:   $(DIST)"
	@echo "Install:  $(INSTALL)"
