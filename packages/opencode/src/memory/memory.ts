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
    const list = Effect.fn("Memory.list")(function* () {
      return yield* Effect.sync(() =>
        Database.use((db) => db.select().from(MemoryTable).orderBy(desc(MemoryTable.time_created)).all()),
      )
    })

    const save = Effect.fn("Memory.save")(function* (content: string) {
      const id = ulid()
      const now = Date.now()
      return yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(MemoryTable)
            .values({ id, content, time_created: now, time_updated: now })
            .returning()
            .get(),
        ),
      )
    })

    const update = Effect.fn("Memory.update")(function* (id: string, content: string) {
      return yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(MemoryTable)
            .set({ content, time_updated: Date.now() })
            .where(eq(MemoryTable.id, id))
            .returning()
            .get(),
        ),
      )
    })

    const remove = Effect.fn("Memory.remove")(function* (id: string) {
      yield* Effect.sync(() =>
        Database.use((db) => db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run()),
      )
    })

    return Service.of({ list, save, update, remove })
  }),
)

export const defaultLayer = layer

export * as Memory from "./memory"
