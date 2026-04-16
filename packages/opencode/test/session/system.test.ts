import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

describe("session.system provider routing", () => {
  test("routes claude models to anthropic prompt", () => {
    const [prompt] = SystemPrompt.provider({ api: { id: "claude-sonnet-4-20250514" } } as any)
    expect(prompt).toContain("OpenCode")
    expect(prompt).toContain("TodoWrite")
  })

  test("routes gpt-4 models to beast prompt", () => {
    const [prompt] = SystemPrompt.provider({ api: { id: "gpt-4o" } } as any)
    expect(prompt).toContain("webfetch")
    expect(prompt).toContain("NEVER auto-commit")
  })

  test("routes gemini models to gemini prompt", () => {
    const [prompt] = SystemPrompt.provider({ api: { id: "gemini-2.0-flash" } } as any)
    expect(prompt).toContain("ABSOLUTE paths")
  })

  test("routes unknown models to default prompt", () => {
    const [prompt] = SystemPrompt.provider({ api: { id: "unknown-xyz" } } as any)
    expect(prompt).toContain("NEVER commit")
  })
})

describe("compressed prompts preserve critical instructions", () => {
  test("anthropic prompt retains URL, TodoWrite, Task, system-reminder, code-ref rules", () => {
    const [prompt] = SystemPrompt.provider({ api: { id: "claude-sonnet-4" } } as any)
    expect(prompt).toContain("NEVER generate/guess URLs")
    expect(prompt).toContain("TodoWrite")
    expect(prompt).toContain("Task tool")
    expect(prompt).toContain("system-reminder")
    expect(prompt).toContain("file_path:line_number")
  })

  test("default prompt retains lint/typecheck, commit, and convention rules", () => {
    const [prompt] = SystemPrompt.provider({ api: { id: "unknown-model" } } as any)
    expect(prompt).toContain("lint")
    expect(prompt).toContain("NEVER commit")
    expect(prompt).toContain("NEVER assume library")
    expect(prompt).toContain("system-reminder")
  })

  test("beast prompt retains google search URL and .env instructions", () => {
    const [prompt] = SystemPrompt.provider({ api: { id: "gpt-4o" } } as any)
    expect(prompt).toContain("google.com/search")
    expect(prompt).toContain(".env")
  })

  test("gemini prompt retains safety, interactive command, and cancellation rules", () => {
    const [prompt] = SystemPrompt.provider({ api: { id: "gemini-2.0-flash" } } as any)
    expect(prompt).toContain("secrets")
    expect(prompt).toContain("interactive")
    expect(prompt).toContain("cancellation")
  })
})

describe("session.system", () => {
  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await load(tmp.path, (svc) => svc.get("build"))
          const runSkills = Effect.gen(function* () {
            const svc = yield* SystemPrompt.Service
            return yield* svc.skills(build!)
          }).pipe(Effect.provide(SystemPrompt.defaultLayer))

          const first = await Effect.runPromise(runSkills)
          const second = await Effect.runPromise(runSkills)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })
})
