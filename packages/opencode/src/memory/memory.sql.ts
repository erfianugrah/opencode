import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    content: text().notNull(),
    ...Timestamps,
  },
  (table) => [index("memory_time_created_idx").on(table.time_created)],
)
