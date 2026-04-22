import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Database, sql } from "../storage"
import DESCRIPTION from "./session-search.txt"

const parameters = z.object({
  query: z.string().describe("Search terms for full-text search across past sessions"),
  role: z.enum(["user", "assistant"]).optional().describe("Filter by message role"),
  limit: z.number().min(1).max(50).default(10).optional().describe("Max results (default: 10)"),
})

type Metadata = {
  count: number
}

export const SessionSearchTool = Tool.define<typeof parameters, Metadata, never>(
  "session_search",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "session_search",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const limit = params.limit ?? 10
          const results = yield* Effect.sync(() =>
            Database.use((db) => {
              const roleFilter = params.role ? sql`AND role = ${params.role}` : sql``
              const stmt = db.all<{
                content: string
                session_id: string
                role: string
                time_created: number
                rank: number
              }>(
                sql`SELECT
                  snippet(session_fts, 0, '>>>', '<<<', '...', 40) as content,
                  session_id,
                  role,
                  time_created,
                  rank
                FROM session_fts
                WHERE session_fts MATCH ${params.query}
                  ${roleFilter}
                ORDER BY rank
                LIMIT ${limit}`,
              )
              return stmt
            }),
          )

          if (results.length === 0)
            return {
              title: "No results",
              output: `No past session content matching "${params.query}"`,
              metadata: { count: 0 },
            }

          const formatted = results
            .map((r) => {
              const date = new Date(r.time_created).toISOString().split("T")[0]
              return `[${date}] (${r.role}) ${r.content}`
            })
            .join("\n\n")

          return {
            title: `${results.length} results`,
            output: formatted,
            metadata: { count: results.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
