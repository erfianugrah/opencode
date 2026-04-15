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

## Build and install

```bash
cd ~/opencode
./packages/opencode/script/build.ts --single
cp packages/opencode/dist/opencode-linux-x64/bin/opencode ~/.opencode/bin/opencode
```

The binary lands at `~/.opencode/bin/opencode`, replacing the auto-updated release.

> **Note:** OpenCode's auto-updater will overwrite your custom build on next
> start if `autoupdate` is enabled. To prevent this, set `"autoupdate": false`
> in `~/.config/opencode/opencode.json`.

## Sync with upstream

```bash
cd ~/opencode
git fetch upstream
git merge upstream/dev
git push origin dev
```

Then rebuild and install (see above).

## Restore the official release

```bash
# If you kept the backup:
cp ~/.opencode/bin/opencode.1.4.6.bak ~/.opencode/bin/opencode

# Or re-enable auto-update and restart:
# Set "autoupdate": true in opencode.json, then restart opencode.
```

## OpenCode config for local llama-server vision

The `modalities` config is required for image support with custom providers.
This is what makes clipboard image paste work with llama-server:

```json
{
  "$schema": "https://opencode.ai/config.json",
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

Without the dev build, `modalities` is parsed but not applied at runtime —
images get replaced with `ERROR: Cannot read "clipboard" (this model does not
support image input)`.
