// superpowers — conditional methodology bootstrap injection.
//
// Built-in equivalent of the obra/superpowers external plugin. When the first
// user message of a session matches a build/debug intent regex (or contains
// the <superpowers> force token), injects the using-superpowers/SKILL.md
// content as a synthetic text part prefixed to that message.
//
// Token economy: skill descriptions are already in the system prompt via
// SystemPrompt.skills(). The full methodology bootstrap (~1.5k tokens) is
// pulled in only when intent matches — Q&A sessions stay clean.
//
// Controls:
//   OPENCODE_SUPERPOWERS_OFF=1       kill switch (no-op)
//   OPENCODE_SUPERPOWERS_BOOTSTRAP   override SKILL.md path
//   <superpowers> in user message    force inject regardless of intent

import os from "os"
import path from "path"
import { Effect, Layer, Context } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstanceState } from "@/effect"
import { Log } from "../util"

const log = Log.create({ service: "superpowers" })

const MARKER = "<!-- superpowers-methodology-injected -->"

// Verbs that signal "we're about to build / debug / refactor".
// Tuned to avoid false positives on "write a summary", "add a comment", etc.
const INTENT_REGEX =
  /\b(implement|build|create|design|architect|refactor|rewrite|restructure|debug|trace|investigate|TDD|red-green-refactor|fix\s+(?:a\s+|the\s+)?(?:bug|issue|error|crash|test)|add\s+(?:a\s+|the\s+)?(?:feature|function|test|component|endpoint|method|hook|module)|write\s+(?:a\s+|the\s+)?(?:tests?|specs?|unit\s+tests?|integration\s+tests?))\b/i

const FORCE_TOKEN_REGEX = /<superpowers>/i

const TOOL_MAPPING = `Tool mapping for opencode:
- TodoWrite       → todowrite
- Task subagents  → opencode subagent (@mention)
- Skill tool      → opencode native skill tool
- File ops        → opencode native tools (read, write, edit, bash)`

function bootstrapPath(): string {
  const env = process.env.OPENCODE_SUPERPOWERS_BOOTSTRAP
  if (env) return env
  const configDir = Flag.OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config/opencode")
  return path.join(configDir, "skills/superpowers/using-superpowers/SKILL.md")
}

/** Classify the first user message text. Pure function — exported for tests. */
export function decideInjection(text: string): "intent" | "forced" | "skip" {
  if (FORCE_TOKEN_REGEX.test(text)) return "forced"
  if (INTENT_REGEX.test(text)) return "intent"
  return "skip"
}

/** Build the bootstrap payload from raw SKILL.md content. Pure — exported for tests. */
export function buildBootstrap(skillContent: string): string {
  const body = skillContent.replace(/^---\n[\s\S]*?\n---\n/, "")
  return [
    MARKER,
    "<superpowers-methodology>",
    "The using-superpowers skill is loaded inline below — do not re-load it via the skill tool.",
    "",
    body.trim(),
    "",
    TOOL_MAPPING,
    "</superpowers-methodology>",
  ].join("\n")
}

/** True iff any text part already contains the injection marker. */
export function alreadyInjected(parts: { type: string; text?: string }[]): boolean {
  return parts.some((p) => p.type === "text" && (p.text ?? "").includes(MARKER))
}

// Minimal shape of the message array that this service mutates. Mirrors the
// experimental.chat.messages.transform hook's `output.messages` type without
// pulling in the full MessageV2 type tree.
type MutableMessage = {
  info: { role?: string; sessionID?: string }
  parts: Array<{ type: string; text?: string; [k: string]: unknown }>
}

export interface Interface {
  /**
   * Inject the methodology bootstrap into the first user message of `messages`
   * if intent matches and the bootstrap is available. Mutates `messages` in
   * place. No-op when SUPERPOWERS_OFF is set or the bootstrap file is missing.
   */
  readonly maybeInject: (messages: MutableMessage[]) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Superpowers") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    // Per-instance state: cached bootstrap content + injected-session set.
    // ScopedCache handles disposal when the project instance is torn down.
    const state = yield* InstanceState.make(
      Effect.fn("Superpowers.state")(function* () {
        return {
          bootstrap: undefined as string | null | undefined,
          injectedSessions: new Set<string>(),
        }
      }),
    )

    const loadBootstrap = Effect.fnUntraced(function* () {
      const s = yield* InstanceState.get(state)
      if (s.bootstrap !== undefined) return s.bootstrap
      const p = bootstrapPath()
      if (!(yield* fs.exists(p).pipe(Effect.orElseSucceed(() => false)))) {
        s.bootstrap = null
        log.debug("bootstrap missing", { path: p })
        return null
      }
      const content = yield* fs.readFileString(p).pipe(Effect.catch(() => Effect.succeed("")))
      s.bootstrap = content ? buildBootstrap(content) : null
      return s.bootstrap
    })

    const maybeInject = Effect.fn("Superpowers.maybeInject")(function* (messages: MutableMessage[]) {
      if (process.env.OPENCODE_SUPERPOWERS_OFF === "1") return
      if (!messages?.length) return

      const firstUser = messages.find((m) => m.info.role === "user")
      if (!firstUser?.parts?.length) return

      const sessionID = firstUser.info.sessionID
      const s = yield* InstanceState.get(state)

      // Session-ID guard: opencode reloads messages from DB each agent step,
      // dropping any prior mutation. Tracking session IDs in-memory survives
      // those reloads and prevents per-step re-injection cost.
      if (sessionID && s.injectedSessions.has(sessionID)) return

      // Within-call guard: if a plugin or earlier transform already injected,
      // record + skip.
      if (alreadyInjected(firstUser.parts)) {
        if (sessionID) s.injectedSessions.add(sessionID)
        return
      }

      const firstText = (firstUser.parts.find((p) => p.type === "text")?.text) ?? ""
      const decision = decideInjection(firstText)
      if (decision === "skip") {
        // Cache the "skip" decision too — otherwise we re-evaluate every step.
        if (sessionID) s.injectedSessions.add(sessionID)
        return
      }

      const bootstrap = yield* loadBootstrap()
      if (!bootstrap) return

      const ref = firstUser.parts[0]
      firstUser.parts.unshift({ ...ref, type: "text", text: bootstrap })
      if (sessionID) s.injectedSessions.add(sessionID)
      log.info("injected", { bytes: bootstrap.length, decision, session: sessionID ?? "?" })
    })

    return Service.of({ maybeInject })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Superpowers from "./superpowers"
