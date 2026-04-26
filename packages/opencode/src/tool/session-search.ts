import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Database, sql } from "../storage"
import DESCRIPTION from "./session-search.txt"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search terms for full-text search across past sessions" }),
  role: Schema.optional(Schema.Literals(["user", "assistant"]).annotate({ description: "Filter by message role" })),
  limit: Schema.optional(Schema.Number.annotate({ description: "Max results (default: 10, max: 50)" })),
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

export const SessionSearchTool = Tool.define<typeof Parameters, Metadata, never>(
  "session_search",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "session_search",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const limit = Math.min(params.limit ?? 10, 50)
          const query = toFtsQuery(params.query)
          const results = yield* Effect.sync(() =>
            Database.use((db) => {
              const roleFilter = params.role
                ? sql`AND json_extract(m.data, '$.role') = ${params.role}`
                : sql``
              return db.all<{
                content: string
                session_id: string
                role: string
                time_created: number
                rank: number
              }>(
                sql`SELECT
                  snippet(session_fts, 0, '>>>', '<<<', '...', 40) as content,
                  f.session_id,
                  COALESCE(json_extract(m.data, '$.role'), '') as role,
                  f.time_created,
                  f.rank
                FROM session_fts f
                LEFT JOIN part p ON p.id = f.part_id
                LEFT JOIN message m ON m.id = p.message_id
                WHERE session_fts MATCH ${query}
                  ${roleFilter}
                ORDER BY f.rank
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
