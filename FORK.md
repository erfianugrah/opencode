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

Disable auto-update so the official release doesn't overwrite your build:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false
}
```

## Baked-in local models

The `llama-server` provider with all 5 local models is baked directly into the
binary at `packages/opencode/src/provider/provider.ts`. No user config needed —
just build the fork and the models appear in `/models`.

The provider connects to `http://localhost:11434/v1` (the
[llm-compose](https://github.com/erfianugrah/llm-compose) model-switching proxy).
The proxy auto-swaps models when you select a different one.

| Model ID | Name | Vision | Thinking | llm-compose preset |
|---|---|---|---|---|
| `Qwen3.5-27B-Q4_K_M` | Qwen 3.5 27B Dense (local) | Yes | Yes | `qwen35` |
| `Qwen3.6-35B-A3B-UD-Q4_K_M` | Qwen3.6 35B MoE (local) | No | Yes | `qwen36-moe` |
| `gemma-4-31B-it-Q4_K_M` | Gemma 4 31B Dense (local) | Yes | Yes | `gemma4` |
| `qwen3-coder-30b-a3b-instruct-q4_k_m` | Qwen3 Coder 30B MoE (local) | No | No | `qwen3-coder` |
| `Qwen3-32B-Q4_K_M` | Qwen3 32B (local) | No | Yes | `qwen3` |

Model ID = GGUF filename without `.gguf`. System prompts are selected by model
ID substring matching in `packages/opencode/src/session/system.ts` — `gemma` and
`qwen` both route to the local model prompt (`gemma.txt`).

To add/remove models, edit the `llamaModels` array in `provider.ts` and rebuild.

## Channel database isolation

Building from the `dev` branch bakes `CHANNEL = "dev"` into the binary (via
`packages/script/src/index.ts:26-30` — it falls back to `git branch --show-current`
when no `OPENCODE_CHANNEL` env var is set at build time). At runtime, the channel
determines the database filename (`packages/opencode/src/storage/db.ts:31-35`):

| Channel                       | Database file       |
| ----------------------------- | ------------------- |
| `latest`, `beta`, `prod`      | `opencode.db`       |
| `dev` (this fork)             | `opencode-dev.db`   |
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

| Variable                      | Type    | Effect                                                           |
| ----------------------------- | ------- | ---------------------------------------------------------------- |
| `OPENCODE_DB`                 | string  | Override DB path (absolute, relative to data dir, or `:memory:`) |
| `OPENCODE_DISABLE_CHANNEL_DB` | boolean | Ignore channel, always use `opencode.db`                         |
| `OPENCODE_SKIP_MIGRATIONS`    | boolean | Replace all migration SQL with `select 1`                        |

## Fork features

### Output style toggle

Adds a `style` config option that controls output verbosity:

```jsonc
// opencode.json
{ "style": "terse" }    // default — minimal tokens, drops filler, fragments OK
{ "style": "socratic" } // learning mode — probing questions, explains reasoning
```

- Orthogonal to build/plan modes (all 4 combinations work)
- Toggle in-session via command palette: `/style` to toggle, or pick from the menu
- Config schema: `packages/opencode/src/config/config.ts` (field: `style`)
- Prompt constants: `TERSE_PROMPT` / `SOCRATIC_PROMPT` in `packages/opencode/src/session/prompt.ts`
- UI toggle: `packages/opencode/src/cli/cmd/tui/app.tsx` (command palette action)

### LaTeX sanitization

Local models (Gemma 4, Qwen) emit LaTeX notation (`$\rightarrow$`, `$\neq$`, etc.)
that doesn't render in terminal. The stream processor replaces these with Unicode
equivalents (→, ≠, ≤, ≥, etc.) at `text-end` and `reasoning-end` events.

- Code: `packages/opencode/src/session/processor.ts` (`sanitizeLatex` function)

### Gemma/Qwen model routing

Routes Gemma and Qwen models to a dedicated system prompt (`gemma.txt`) with
tool discipline rules and anti-loop guardrails for local model quirks.

- Code: `packages/opencode/src/session/system.ts`
- Prompt: `packages/opencode/src/session/prompt/gemma.txt`

### Local model fixes (`provider.ts`, `transform.ts`, `message-v2.ts`)

Several fixes for local models running via the llama-server provider:

- **Temperature capability**: set to `true` (was `false`, silently broke
  title generation and other background tasks)
- **`getSmallModel` bypass**: `priority = []` for llama-server — prevents
  catastrophic ~90s model swaps when generating titles on single-GPU setups.
  Always uses the currently loaded model for background tasks.
- **Gemma temperature**: added `gemma` match in `temperature()` returning
  `1.0` (was `undefined`, using unpredictable server defaults)
- **Reasoning suppression**: `smallOptions()` sends `reasoning_effort: "low"`
  for llama-server during title generation to avoid wasting time on `<think>`
  blocks for trivial tasks
- **Image stripping**: `toModelMessagesEffect()` strips image parts from
  conversation history when switching to a non-vision model — prevents
  `CallExpression` crash in `convertToModelMessages()`

Code:
- `packages/opencode/src/provider/provider.ts` (baked-in models, getSmallModel)
- `packages/opencode/src/provider/transform.ts` (temperature, smallOptions)
- `packages/opencode/src/session/message-v2.ts` (image stripping)

### Persistent memory

Memories survive across sessions. The agent auto-extracts user preferences,
design principles, and recurring patterns, deduplicating against existing
memories via LLM judgment. Injected into the system prompt on every message
(capped at ~2K tokens). On first session, seeds from AGENTS.md context.

```jsonc
// opencode.json — disable with:
{ "memory": false }
```

- Schema: `packages/opencode/src/memory/memory.sql.ts`
- Service: `packages/opencode/src/memory/memory.ts` (list, save, update, remove)
- Tool: `packages/opencode/src/tool/memory.ts` (save/list/delete/update actions)
- Config: `memory` boolean field (default: `true`)
- Gated to primary agent only (subagents/explore agents don't see the tool)
- Migration: `migration/20260422094718_memory/`
- Tests: `test/memory/memory.test.ts`

#### Session search

Full-text search over past session content using SQLite FTS5. The agent
uses this to find relevant context from previous work — past decisions,
implementations, patterns. Also used for memory seeding: on first run,
the agent searches past sessions for recurring preferences and saves them.

- Tool: `packages/opencode/src/tool/session-search.ts`
- FTS5 index: populated from existing sessions at migration time, kept
  current via SQLite trigger on new part inserts
- Migration: `migration/20260422120000_session_fts/`
- Queries: stemmed full-text search with snippet extraction and role filtering

### Container image version lookup

Built-in `oci_tags` tool queries OCI registries directly (Docker Hub, ghcr.io,
quay.io, any OCI-compliant registry) for container image tags. Agents use this
instead of web search — deterministic, no stale results, minimal tokens.
Available to all agents, not just primary.

- Tool: `packages/opencode/src/tool/oci-tags.ts`
- Tests: `test/tool/oci-tags.test.ts` (parse, live registry queries, sort, filter)
- CLI fallback: `script/oci-tags` (bash, requires jq)

## Branch strategy

- `dev` = upstream `dev` + fork modifications
- Fork changes: persistent memory + session search, style toggle, LaTeX sanitization, gemma/qwen routing, local model fixes, image stripping, oci-tags
- Upstream merges may need conflict resolution in `config.ts`, `prompt.ts`, `processor.ts`, `system.ts`, `provider.ts`, `transform.ts`, `message-v2.ts`, `registry.ts`
