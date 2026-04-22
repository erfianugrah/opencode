import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Memory } from "../memory"
import DESCRIPTION from "./memory.txt"

const parameters = z.object({
  action: z.enum(["save", "list", "delete", "update"]).describe("Action to perform"),
  content: z.string().optional().describe("Memory content (required for save/update)"),
  id: z.string().optional().describe("Memory ID (required for delete/update)"),
})

type Metadata = {
  action: string
  count?: number
}

export const MemoryTool = Tool.define<typeof parameters, Metadata, Memory.Service>(
  "memory",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "memory",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          switch (params.action) {
            case "list": {
              const items = yield* memory.list()
              if (items.length === 0)
                return {
                  title: "No memories",
                  output: "No memories stored yet.",
                  metadata: { action: "list", count: 0 },
                }
              const formatted = items
                .map((m) => `[${m.id}] ${m.content}`)
                .join("\n")
              return {
                title: `${items.length} memories`,
                output: formatted,
                metadata: { action: "list", count: items.length },
              }
            }

            case "save": {
              if (!params.content) return { title: "Error", output: "content is required for save", metadata: { action: "save" } }
              const saved = yield* memory.save(params.content)
              return {
                title: "Memory saved",
                output: `Saved: ${saved.content}`,
                metadata: { action: "save" },
              }
            }

            case "update": {
              if (!params.id || !params.content)
                return { title: "Error", output: "id and content are required for update", metadata: { action: "update" } }
              const updated = yield* memory.update(params.id, params.content)
              return {
                title: "Memory updated",
                output: `Updated: ${updated.content}`,
                metadata: { action: "update" },
              }
            }

            case "delete": {
              if (!params.id) return { title: "Error", output: "id is required for delete", metadata: { action: "delete" } }
              yield* memory.remove(params.id)
              return {
                title: "Memory deleted",
                output: "Deleted",
                metadata: { action: "delete" },
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
