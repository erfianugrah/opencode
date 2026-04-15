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

## Channel database isolation

Building from the `dev` branch bakes `CHANNEL = "dev"` into the binary (via
`packages/script/src/index.ts:26-30` — it falls back to `git branch --show-current`
when no `OPENCODE_CHANNEL` env var is set at build time). At runtime, the channel
determines the database filename (`packages/opencode/src/storage/db.ts:31-35`):

| Channel | Database file |
|---------|---------------|
| `latest`, `beta`, `prod` | `opencode.db` |
| `dev` (this fork) | `opencode-dev.db` |
| `local` (unbundled `bun run`) | `opencode-local.db` |

Both databases live in `~/.local/share/opencode/`. Sessions created with the
official release (`opencode.db`) are invisible to the dev build (`opencode-dev.db`)
and vice versa. If you see `Session not found` errors after switching builds,
this is why.

### Using the main database with dev builds

Set one of these environment variables at **runtime**:

```bash
# Force the main opencode.db regardless of channel
OPENCODE_DISABLE_CHANNEL_DB=1 opencode

# Or point to a specific database file
OPENCODE_DB=opencode.db opencode
```

Alternatively, set the channel at **build time** so it matches the official release:

```bash
OPENCODE_CHANNEL=latest make build
```

Add the runtime var to your shell profile if you always want the dev build to
share the main database:

```bash
# ~/.zshrc or ~/.bashrc
export OPENCODE_DISABLE_CHANNEL_DB=1
```

### Database env vars (undocumented upstream)

These are defined in `packages/opencode/src/flag/flag.ts:82-84` but not listed
in the official CLI docs (`packages/web/src/content/docs/cli.mdx`):

| Variable | Type | Effect |
|----------|------|--------|
| `OPENCODE_DB` | string | Override DB path (absolute, relative to data dir, or `:memory:`) |
| `OPENCODE_DISABLE_CHANNEL_DB` | boolean | Ignore channel, always use `opencode.db` |
| `OPENCODE_SKIP_MIGRATIONS` | boolean | Replace all migration SQL with `select 1` |

## Branch strategy

- `dev` = upstream `dev` + our additive files (FORK.md, Makefile, workflow)
- Upstream merges cleanly because our changes are new files only
- No source code patches — we just build from upstream dev which has the fixes
