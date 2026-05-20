// superpowers.test.ts — unit + integration tests for the built-in
// methodology-injection service (replaces the obra/superpowers external plugin).
//
// Pure helpers test directly. The Effect-based maybeInject test points
// OPENCODE_SUPERPOWERS_BOOTSTRAP at a tmp SKILL.md so it doesn't need the
// real ~/.config/opencode/skills/superpowers directory.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import {
  Superpowers,
  alreadyInjected,
  buildBootstrap,
  decideInjection,
} from "../../src/session/superpowers"

const run = <A>(effect: Effect.Effect<A, any, Superpowers.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Superpowers.defaultLayer)))

describe("decideInjection", () => {
  test("returns 'intent' on build/implement/debug verbs", () => {
    expect(decideInjection("implement a retry function")).toBe("intent")
    expect(decideInjection("build the auth flow")).toBe("intent")
    expect(decideInjection("fix the bug in login")).toBe("intent")
    expect(decideInjection("debug this crash")).toBe("intent")
    expect(decideInjection("refactor the parser")).toBe("intent")
    expect(decideInjection("add a feature for X")).toBe("intent")
    expect(decideInjection("write unit tests for foo")).toBe("intent")
    expect(decideInjection("create a new component")).toBe("intent")
    expect(decideInjection("TDD this module")).toBe("intent")
  })

  test("returns 'skip' on Q&A / read-only prompts", () => {
    expect(decideInjection("how good is this repo?")).toBe("skip")
    expect(decideInjection("explain this code")).toBe("skip")
    expect(decideInjection("what does this function do")).toBe("skip")
    expect(decideInjection("show me the architecture")).toBe("skip")
    expect(decideInjection("write a summary of this paper")).toBe("skip")
    expect(decideInjection("add some salt to the recipe")).toBe("skip")
    expect(decideInjection("")).toBe("skip")
    expect(decideInjection("   \n  \t  ")).toBe("skip")
  })

  test("returns 'forced' when message contains <superpowers>", () => {
    expect(decideInjection("<superpowers> explain this")).toBe("forced")
    expect(decideInjection("just a chat <SUPERPOWERS>")).toBe("forced")
    expect(decideInjection("explain this <superpowers>")).toBe("forced")
  })

  test("forced beats intent", () => {
    expect(decideInjection("<superpowers> implement X")).toBe("forced")
  })

  test("unicode does not break intent regex", () => {
    expect(decideInjection("implement émigré café")).toBe("intent")
    expect(decideInjection("debug the 漢字 parser")).toBe("intent")
  })
})

describe("buildBootstrap", () => {
  const SAMPLE = `---
name: using-superpowers
description: bootstrap
---

You have superpowers.`

  test("strips YAML frontmatter", () => {
    const out = buildBootstrap(SAMPLE)
    expect(out).not.toContain("name: using-superpowers")
    expect(out).toContain("You have superpowers.")
  })

  test("wraps in methodology tags", () => {
    const out = buildBootstrap(SAMPLE)
    expect(out).toContain("<superpowers-methodology>")
    expect(out).toContain("</superpowers-methodology>")
  })

  test("includes idempotency marker", () => {
    expect(buildBootstrap(SAMPLE)).toContain("superpowers-methodology-injected")
  })

  test("appends opencode tool mapping", () => {
    const out = buildBootstrap(SAMPLE)
    expect(out).toContain("TodoWrite")
    expect(out).toContain("todowrite")
    expect(out).toContain("opencode subagent")
  })

  test("handles content with no frontmatter", () => {
    expect(buildBootstrap("plain body")).toContain("plain body")
  })
})

describe("alreadyInjected", () => {
  test("true when any text part contains marker", () => {
    expect(
      alreadyInjected([{ type: "text", text: "<!-- superpowers-methodology-injected -->\nfoo" }]),
    ).toBe(true)
  })

  test("false when no parts contain marker", () => {
    expect(alreadyInjected([{ type: "text", text: "hello" }])).toBe(false)
    expect(alreadyInjected([])).toBe(false)
  })

  test("ignores non-text parts", () => {
    expect(alreadyInjected([{ type: "image" }, { type: "text", text: "hi" }])).toBe(false)
  })
})

// ── integration: maybeInject Effect with mock bootstrap on disk ──────────────

describe("Superpowers.maybeInject", () => {
  let tmpDir: string
  let bootstrapFile: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-superpowers-test-"))
    bootstrapFile = path.join(tmpDir, "SKILL.md")
    await fs.writeFile(
      bootstrapFile,
      `---
name: using-superpowers
description: bootstrap
---

You have access to superpowers methodology.`,
    )
    process.env.OPENCODE_SUPERPOWERS_BOOTSTRAP = bootstrapFile
  })

  afterAll(async () => {
    delete process.env.OPENCODE_SUPERPOWERS_BOOTSTRAP
    delete process.env.OPENCODE_SUPERPOWERS_OFF
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  function inInstance<A>(fn: (svc: Superpowers.Interface) => Effect.Effect<A>) {
    return Instance.provide({
      directory: tmpDir,
      fn: () => run(Superpowers.Service.use(fn)),
    })
  }

  test("injects on intent match", async () => {
    const messages = [
      {
        info: { role: "user", sessionID: `intent-${Date.now()}` },
        parts: [{ type: "text", text: "implement a retry function" }],
      },
    ]
    await inInstance((svc) => svc.maybeInject(messages))
    expect(messages[0].parts.length).toBe(2)
    expect((messages[0].parts[0] as { text: string }).text).toContain("superpowers-methodology")
    expect((messages[0].parts[1] as { text: string }).text).toBe("implement a retry function")
  })

  test("skips on Q&A", async () => {
    const messages = [
      {
        info: { role: "user", sessionID: `skip-${Date.now()}` },
        parts: [{ type: "text", text: "what is 2+2" }],
      },
    ]
    await inInstance((svc) => svc.maybeInject(messages))
    expect(messages[0].parts.length).toBe(1)
    expect((messages[0].parts[0] as { text: string }).text).toBe("what is 2+2")
  })

  test("forced injection via <superpowers>", async () => {
    const messages = [
      {
        info: { role: "user", sessionID: `forced-${Date.now()}` },
        parts: [{ type: "text", text: "<superpowers> tell me a joke" }],
      },
    ]
    await inInstance((svc) => svc.maybeInject(messages))
    expect(messages[0].parts.length).toBe(2)
    expect((messages[0].parts[0] as { text: string }).text).toContain("superpowers-methodology")
  })

  test("session-ID dedup: second call with same sessionID does not re-inject", async () => {
    const sessionID = `dedup-${Date.now()}`
    const mkMsgs = () => [
      {
        info: { role: "user", sessionID },
        parts: [{ type: "text", text: "implement feature Y" }],
      },
    ]
    await inInstance((svc) =>
      Effect.gen(function* () {
        const first = mkMsgs()
        yield* svc.maybeInject(first)
        expect(first[0].parts.length).toBe(2)

        // Simulate opencode reloading messages from DB — pristine array, same sessionID.
        const second = mkMsgs()
        yield* svc.maybeInject(second)
        expect(second[0].parts.length).toBe(1)
      }),
    )
  })

  test("kill switch: OPENCODE_SUPERPOWERS_OFF=1 is no-op", async () => {
    process.env.OPENCODE_SUPERPOWERS_OFF = "1"
    try {
      const messages = [
        {
          info: { role: "user", sessionID: `off-${Date.now()}` },
          parts: [{ type: "text", text: "implement X" }],
        },
      ]
      await inInstance((svc) => svc.maybeInject(messages))
      expect(messages[0].parts.length).toBe(1)
    } finally {
      delete process.env.OPENCODE_SUPERPOWERS_OFF
    }
  })

  test("empty messages array", async () => {
    const messages: Array<{ info: { role?: string }; parts: Array<{ type: string }> }> = []
    await inInstance((svc) => svc.maybeInject(messages))
    expect(messages.length).toBe(0)
  })

  test("user message with no parts", async () => {
    const messages = [{ info: { role: "user", sessionID: `noparts-${Date.now()}` }, parts: [] }]
    await inInstance((svc) => svc.maybeInject(messages))
    expect(messages[0].parts.length).toBe(0)
  })

  test("assistant message only — no user, skip silently", async () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "hello" }] },
    ]
    await inInstance((svc) => svc.maybeInject(messages))
    expect(messages[0].parts.length).toBe(1)
  })

  test("image-only user message — skip (no text to inject before)", async () => {
    const messages = [
      {
        info: { role: "user", sessionID: `image-${Date.now()}` },
        parts: [{ type: "image" }],
      },
    ]
    await inInstance((svc) => svc.maybeInject(messages))
    expect(messages[0].parts.length).toBe(1)
  })

  test("missing bootstrap file: graceful skip", async () => {
    const orig = process.env.OPENCODE_SUPERPOWERS_BOOTSTRAP
    process.env.OPENCODE_SUPERPOWERS_BOOTSTRAP = path.join(tmpDir, "does-not-exist.md")
    try {
      const messages = [
        {
          info: { role: "user", sessionID: `missing-${Date.now()}` },
          parts: [{ type: "text", text: "implement Z" }],
        },
      ]
      // Use a fresh instance so the bootstrap cache reflects the new path.
      await Instance.provide({
        directory: tmpDir,
        fn: () =>
          Effect.runPromise(
            Superpowers.Service.use((svc) => svc.maybeInject(messages)).pipe(
              Effect.provide(Superpowers.defaultLayer),
            ),
          ),
      })
      expect(messages[0].parts.length).toBe(1)
    } finally {
      if (orig) process.env.OPENCODE_SUPERPOWERS_BOOTSTRAP = orig
    }
  })
})
