# Fork: erfianugrah/opencode

Personal fork of [anomalyco/opencode](https://github.com/anomalyco/opencode) for
running dev builds with upstream fixes not yet in stable releases.

## Why this fork

OpenCode 1.4.6 has a bug where `@ai-sdk/openai-compatible` custom providers
silently strip image attachments even when `modalities: { input: ["text", "image"] }`
is set in the model config ([#20802](https://github.com/anomalyco/opencode/issues/20802),
[#8875](https://github.com/anomalyco/opencode/issues/8875)). The fix exists in
the `dev` branch but hasn't been released yet.

This fork tracks upstream `dev` and builds a local binary with the fix.

## Prerequisites

- [Bun](https://bun.sh/) 1.3+

```bash
curl -fsSL https://bun.sh/install | bash
```

## Setup

```bash
git clone git@github.com:erfianugrah/opencode.git ~/opencode
cd ~/opencode
git remote add upstream https://github.com/anomalyco/opencode.git
bun install
```

## Usage

### Do everything in one shot

```bash
cd ~/opencode
make update    # sync upstream + build + install
```

Quit OpenCode first — the binary can't be overwritten while running.

### Individual steps

```bash
make sync      # fetch upstream dev and merge
make build     # install deps and compile binary
make install   # back up current binary, install new build
```

### Restore official release

```bash
make uninstall   # restore backed-up binary
```

Or set `"autoupdate": true` in `opencode.json` and restart.

### All targets

```
make update       Sync upstream + build + install (do it all)
make sync         Fetch upstream dev and merge
make build        Install deps and compile binary
make install      Back up current binary and install new build
make uninstall    Restore backed-up official binary
make clean        Remove build artifacts
```

## Automated upstream sync

A GitHub Action (`.github/workflows/fork-sync.yml`) syncs upstream `dev` daily
at 06:00 UTC. If there's a merge conflict, it skips and you resolve manually.

You can also trigger it manually from the Actions tab.

## OpenCode config

Disable auto-update so the official release doesn't overwrite your build.
The `modalities` config is required for vision support with custom providers:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "provider": {
    "llama-server": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama.cpp (local)",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": {
        "gemma-4-31B-it-Q4_K_M": {
          "name": "Gemma 4 31B Dense (local)",
          "attachment": true,
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          }
        }
      }
    }
  }
}
```

## Branch strategy

- `dev` = upstream `dev` + our additive files (FORK.md, Makefile, workflow)
- Upstream merges cleanly because our changes are new files only
- No source code patches — we just build from upstream dev which has the fixes
