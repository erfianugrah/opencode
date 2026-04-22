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

// Convert plain search terms to a forgiving FTS5 query.
// "gatekeeper DDD bounded context" -> "gatekeeper OR DDD OR bounded OR context"
// "llm-compose model swap" -> "llm OR compose OR model OR swap"
// Already-structured queries (with OR, AND, NOT, quotes, *) pass through unchanged.
function toFtsQuery(input: string) {
  if (/\b(OR|AND|NOT)\b|[*"]/.test(input)) return input
  return input
    .split(/[\s\-_./\\:]+/)
    .filter(Boolean)
    .join(" OR ")
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
          const query = toFtsQuery(params.query)
          const results = yield* Effect.sync(() =>
            Database.use((db) => {
              const roleFilter = params.role ? sql`AND role = ${params.role}` : sql``
              return db.all<{
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
                WHERE session_fts MATCH ${query}
                  ${roleFilter}
                ORDER BY rank
                LIMIT ${limit}`,
              )
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
