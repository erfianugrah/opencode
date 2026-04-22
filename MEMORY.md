# Memory System Implementation Spec

Persistent memory across sessions, similar to Claude's memory feature.
Two tiers: always-injected memories (small, cheap) and on-demand session search (Phase 2).

## Architecture

```
Config.memory (boolean, default true)
  |
  +-- registry.ts: include MemoryTool in builtin if memory !== false
  |     +-- tools() filter: only when agent.mode === "primary"
  |
  +-- prompt.ts: inject memory block into system prompt
        +-- empty -> inject MEMORY_SEED_PROMPT (bootstrap from AGENTS.md)
        +-- non-empty -> inject formatted memories + MEMORY_MANAGEMENT instruction
        +-- over token budget -> truncate + hint "use memory tool to list all"
```

## Memory Lifecycle

```
User works in session
  |
  +-- Agent notices pattern/preference -> calls memory tool (save)
  +-- User explicitly says "remember X" -> agent calls memory tool (save)
  +-- Task completes -> agent reviews: anything worth remembering?
        +-- Calls memory tool (list) to check existing
        +-- Duplicate? skip or update existing
        +-- New? save it
```

## Phase 1: Persistent Memory

### 1. Schema: `packages/opencode/src/memory/memory.sql.ts`

Pattern: follows `session.sql.ts` / `share.sql.ts`

```ts
import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    content: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("memory_time_created_idx").on(table.time_created),
  ],
)
```

- Global scope (no project_id — sessions are local anyway)
- id: ulid for time-ordering
- content: the memory text (1-2 sentences each)
- Timestamps: time_created, time_updated from shared pattern

### 2. Service: `packages/opencode/src/memory/memory.ts`

Pattern: follows `session/todo.ts` (simplest CRUD service)

```ts
import { Effect, Layer, Context } from "effect"
import { Database, eq, desc } from "../storage"
import { MemoryTable } from "./memory.sql"
import { ulid } from "ulid"

export interface Info {
  id: string
  content: string
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly save: (content: string) => Effect.Effect<Info>
  readonly update: (id: string, content: string) => Effect.Effect<Info>
  readonly remove: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // list: returns all memories ordered by time_created desc
    // save: inserts with ulid() as id, returns the new row
    // update: sets content + time_updated, returns updated row
    // remove: deletes by id
    return Service.of({ list, save, update, remove })
  }),
)

export const defaultLayer = layer

export * as Memory from "./memory"
```

Key implementation details:
- `list()`: `Database.use(db => db.select().from(MemoryTable).orderBy(desc(MemoryTable.time_created)).all())`
- `save(content)`: `Database.use(db => db.insert(MemoryTable).values({ id: ulid(), content }).returning().get())`
- `update(id, content)`: `Database.use(db => db.update(MemoryTable).set({ content }).where(eq(MemoryTable.id, id)).returning().get())`
- `remove(id)`: `Database.use(db => db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run())`
- No Bus dependency needed (no events to publish for MVP)

### 3. Re-export: `packages/opencode/src/memory/index.ts`

```ts
export * as Memory from "./memory"
```

### 4. Tool: `packages/opencode/src/tool/memory.ts`

Pattern: follows `todo.ts` (single tool, complex params)

```ts
export const MemoryTool = Tool.define<typeof parameters, Metadata, Memory.Service>(
  "memory",
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    return {
      description: DESCRIPTION,  // from memory.txt
      parameters,
      execute: (params, ctx) => Effect.gen(function* () {
        // switch on params.action: "save" | "list" | "delete" | "update"
        // return { title, output, metadata }
      }),
    }
  }),
)
```

Parameters (zod):
```ts
const parameters = z.object({
  action: z.enum(["save", "list", "delete", "update"]).describe("Action to perform"),
  content: z.string().optional().describe("Memory content (required for save/update)"),
  id: z.string().optional().describe("Memory ID (required for delete/update)"),
})
```

Return format per action:
- `list`: output = formatted memory list with IDs, title = "N memories"
- `save`: output = saved memory content, title = "Memory saved"
- `update`: output = updated memory content, title = "Memory updated"
- `delete`: output = "Deleted", title = "Memory deleted"

### 5. Tool description: `packages/opencode/src/tool/memory.txt`

Concise description for the LLM:

```
Manage persistent memories that survive across sessions.

Use this tool to save user preferences, design principles, project conventions,
and recurring patterns so they are available in future sessions.

Actions:
- "save": Save a new memory. Requires content.
- "list": List all stored memories with their IDs.
- "update": Update an existing memory. Requires id and content.
- "delete": Delete an outdated memory. Requires id.

Guidelines:
- Before saving, list existing memories to check for duplicates
- Keep each memory concise: 1-2 sentences, actionable, specific
- If a memory already covers the same concept, update it instead of creating a new one
- Delete memories that are outdated or superseded
- Prefer 30 precise memories over 100 vague ones
```

### 6. Config flag: `packages/opencode/src/config/config.ts`

Add to `InfoSchema` near the `style` field (~line 131):

```ts
memory: Schema.optional(Schema.Boolean).annotate({
  description: "Enable persistent memory across sessions (default: true)",
}),
```

### 7. Tool registration: `packages/opencode/src/tool/registry.ts`

Modifications:

a) Import MemoryTool (~line 1):
```ts
import { MemoryTool } from "./memory"
```

b) Yield MemoryTool (~line 115, alongside other tool yields):
```ts
const memorytool = yield* MemoryTool
```

c) Init MemoryTool (~line 197, in Effect.all block):
```ts
memory: Tool.init(memorytool),
```

d) Add to builtin array (~line 212, gated by config):
```ts
const cfg = yield* config.get()
// ... existing code ...
builtin: [
  // ... existing tools ...
  ...(cfg.memory !== false ? [tool.memory] : []),
]
```

e) Gate to primary agent in tools() filter (~line 270):
```ts
if (tool.id === MemoryTool.id) return input.agent.mode === "primary"
```

f) Add Memory.defaultLayer to defaultLayer (~line 319):
```ts
Layer.provide(Memory.defaultLayer),
```

Note: `questionEnabled` is checked inside `InstanceState.make` (runs once per instance),
so the `cfg.memory !== false` check should also be there. The `agent.mode === "primary"`
check goes in the per-call `tools()` filter since agent changes per request.

### 8. System prompt injection: `packages/opencode/src/session/prompt.ts`

Modifications:

a) Import Memory (~line 33):
```ts
import { Memory } from "../memory"
```

b) Yield Memory.Service (~line 126, near existing cfg yield):
```ts
const mem = yield* Memory.Service
```

c) After line 1502 (style injection), add memory injection:
```ts
if ((yield* cfg.get()).memory !== false) {
  const memories = yield* mem.list()
  if (memories.length === 0) {
    system.push(MEMORY_SEED_PROMPT)
  } else {
    const lines = memories.map(m => `- ${m.content}`)
    const block = lines.join("\n")
    // Rough token estimate: 1 token ~= 4 chars
    if (block.length > 8000) {
      const truncated = memories.slice(0, 30)
      const rest = memories.length - 30
      system.push([
        "# Memories (from past sessions)",
        ...truncated.map(m => `- ${m.content}`),
        `(${rest} more memories stored — use memory tool with action "list" to see all)`,
      ].join("\n"))
    } else {
      system.push("# Memories (from past sessions)\n" + block)
    }
    system.push(MEMORY_MANAGEMENT_PROMPT)
  }
}
```

d) Add Memory.defaultLayer to defaultLayer composition (~line 1713):
```ts
Layer.provide(Memory.defaultLayer),
```

e) Add prompt constants (near TERSE_PROMPT/SOCRATIC_PROMPT):

```ts
const MEMORY_SEED_PROMPT = `# Memory System
Your persistent memory is empty. This is your first session with memory enabled.
Review the user's AGENTS.md instructions and any preferences visible in this conversation.
Save key design principles, coding preferences, and patterns as memories using the memory tool.
This bootstraps your memory so future sessions start with context.`

const MEMORY_MANAGEMENT_PROMPT = `# Memory Management
You have persistent memory across sessions. After completing tasks:
1. Consider whether any user preferences or recurring patterns should be saved
2. Before saving, list existing memories to check for duplicates
3. If a concept is already covered, update it rather than creating a duplicate
4. Keep memories concise (1-2 sentences), actionable, and specific
5. Delete outdated or superseded memories
6. Consolidate related memories when the count gets high`
```

### 9. Migration

Generate with:
```bash
cd packages/opencode
bun run db generate --name memory
```

This creates `migration/XXXXXXXX_memory/migration.sql` + `snapshot.json`.

## Phase 2: Session Search (future)

FTS5 virtual table over message text parts. Separate tool `session_search`.
Not part of this implementation — tracked separately.

## Implementation Order

1. `src/memory/memory.sql.ts` — schema
2. `src/memory/memory.ts` — service
3. `src/memory/index.ts` — re-export
4. Generate migration
5. `src/tool/memory.txt` — tool description
6. `src/tool/memory.ts` — tool implementation
7. `src/config/config.ts` — add `memory` field
8. `src/tool/registry.ts` — register + gate
9. `src/session/prompt.ts` — inject memories + prompts
10. `bun typecheck` from packages/opencode
11. Test manually

## Files Changed Summary

| # | File | Action |
|---|------|--------|
| 1 | `src/memory/memory.sql.ts` | Create |
| 2 | `src/memory/memory.ts` | Create |
| 3 | `src/memory/index.ts` | Create |
| 4 | `migration/XXXX_memory/` | Generate |
| 5 | `src/tool/memory.txt` | Create |
| 6 | `src/tool/memory.ts` | Create |
| 7 | `src/config/config.ts` | Modify (add `memory` field) |
| 8 | `src/tool/registry.ts` | Modify (register + gate + layer) |
| 9 | `src/session/prompt.ts` | Modify (inject memories + prompts + service + layer) |
