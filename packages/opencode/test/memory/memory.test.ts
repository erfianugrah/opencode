import { describe, expect, beforeEach } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Memory } from "../../src/memory"
import { MemoryTable } from "../../src/memory/memory.sql"
import { Database } from "../../src/storage"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Log } from "../../src/util"

void Log.init({ print: false })

const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const layer = Memory.defaultLayer.pipe(Layer.provideMerge(infra))

const it = testEffect(layer)

// Memory is global (not instance-scoped), clear between tests
beforeEach(() => {
  try {
    Database.use((db) => db.delete(MemoryTable).run())
  } catch {
    // table may not exist yet on first run
  }
})

describe("Memory", () => {
  it.live("save and list memories", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service

        const saved = yield* mem.save("Prefer functional array methods over for loops")
        expect(saved.content).toBe("Prefer functional array methods over for loops")
        expect(saved.id).toBeTruthy()
        expect(saved.time_created).toBeGreaterThan(0)

        const saved2 = yield* mem.save("No mocks in tests")
        expect(saved2.id).not.toBe(saved.id)

        const all = yield* mem.list()
        expect(all.length).toBe(2)
        // list returns desc by time_created, so most recent first
        expect(all[0].content).toBe("No mocks in tests")
        expect(all[1].content).toBe("Prefer functional array methods over for loops")
      }),
    ),
  )

  it.live("update a memory", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service

        const saved = yield* mem.save("Use Bun APIs")
        const updated = yield* mem.update(saved.id, "Use Bun APIs when possible (Bun.file(), etc.)")
        expect(updated.content).toBe("Use Bun APIs when possible (Bun.file(), etc.)")
        expect(updated.id).toBe(saved.id)

        const all = yield* mem.list()
        expect(all.length).toBe(1)
        expect(all[0].content).toBe("Use Bun APIs when possible (Bun.file(), etc.)")
      }),
    ),
  )

  it.live("delete a memory", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service

        const a = yield* mem.save("Memory A")
        yield* mem.save("Memory B")
        expect((yield* mem.list()).length).toBe(2)

        yield* mem.remove(a.id)
        const remaining = yield* mem.list()
        expect(remaining.length).toBe(1)
        expect(remaining[0].content).toBe("Memory B")
      }),
    ),
  )

  it.live("empty list returns empty array", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const all = yield* mem.list()
        expect(all).toEqual([])
      }),
    ),
  )
})
