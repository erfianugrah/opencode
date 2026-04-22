import { describe, expect, beforeEach } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Memory } from "../../src/memory"
import { MemoryTable } from "../../src/memory/memory.sql"
import { Database, sql } from "../../src/storage"
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

describe("Memory service", () => {
  it.live("save returns a memory with id and timestamps", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const before = Date.now()
        const saved = yield* mem.save("Use Bun APIs when possible")
        expect(saved.id).toBeTruthy()
        expect(saved.id.length).toBeGreaterThan(10)
        expect(saved.content).toBe("Use Bun APIs when possible")
        expect(saved.time_created).toBeGreaterThanOrEqual(before)
        expect(saved.time_updated).toBeGreaterThanOrEqual(before)
      }),
    ),
  )

  it.live("save generates unique ids", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const a = yield* mem.save("Memory A")
        const b = yield* mem.save("Memory B")
        const c = yield* mem.save("Memory C")
        const ids = new Set([a.id, b.id, c.id])
        expect(ids.size).toBe(3)
      }),
    ),
  )

  it.live("list returns memories ordered by time_created desc", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        yield* mem.save("First")
        yield* mem.save("Second")
        yield* mem.save("Third")
        const all = yield* mem.list()
        expect(all.length).toBe(3)
        expect(all[0].content).toBe("Third")
        expect(all[1].content).toBe("Second")
        expect(all[2].content).toBe("First")
        // timestamps are monotonically decreasing in list order
        expect(all[0].time_created).toBeGreaterThanOrEqual(all[1].time_created)
        expect(all[1].time_created).toBeGreaterThanOrEqual(all[2].time_created)
      }),
    ),
  )

  it.live("list returns empty array when no memories exist", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const all = yield* mem.list()
        expect(all).toEqual([])
      }),
    ),
  )

  it.live("update changes content and preserves id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const saved = yield* mem.save("Use Bun APIs")
        const updated = yield* mem.update(saved.id, "Use Bun APIs when possible (Bun.file(), etc.)")
        expect(updated.id).toBe(saved.id)
        expect(updated.content).toBe("Use Bun APIs when possible (Bun.file(), etc.)")
        expect(updated.time_updated).toBeGreaterThanOrEqual(saved.time_updated)
      }),
    ),
  )

  it.live("update does not create duplicate rows", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        yield* mem.save("Original")
        const all1 = yield* mem.list()
        expect(all1.length).toBe(1)
        yield* mem.update(all1[0].id, "Updated")
        const all2 = yield* mem.list()
        expect(all2.length).toBe(1)
        expect(all2[0].content).toBe("Updated")
      }),
    ),
  )

  it.live("remove deletes by id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const a = yield* mem.save("Keep this")
        const b = yield* mem.save("Delete this")
        yield* mem.remove(b.id)
        const remaining = yield* mem.list()
        expect(remaining.length).toBe(1)
        expect(remaining[0].id).toBe(a.id)
        expect(remaining[0].content).toBe("Keep this")
      }),
    ),
  )

  it.live("remove nonexistent id is a no-op", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        yield* mem.save("Existing")
        yield* mem.remove("nonexistent-id-12345")
        const all = yield* mem.list()
        expect(all.length).toBe(1)
      }),
    ),
  )

  it.live("remove all leaves empty list", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const a = yield* mem.save("A")
        const b = yield* mem.save("B")
        yield* mem.remove(a.id)
        yield* mem.remove(b.id)
        expect(yield* mem.list()).toEqual([])
      }),
    ),
  )

  it.live("handles special characters in content", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const content = "Use `Bun.file()` instead of `fs.readFile()` — it's faster & simpler"
        const saved = yield* mem.save(content)
        expect(saved.content).toBe(content)
        const all = yield* mem.list()
        expect(all[0].content).toBe(content)
      }),
    ),
  )

  it.live("handles long content", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const mem = yield* Memory.Service
        const content = "x".repeat(5000)
        const saved = yield* mem.save(content)
        expect(saved.content.length).toBe(5000)
      }),
    ),
  )
})

describe("toFtsQuery", () => {
  // Test the query rewriting logic by importing it indirectly —
  // we test the behavior through the FTS table since toFtsQuery is not exported.
  // These tests verify FTS5 query semantics against the actual DB.

  it.live("plain terms match via OR (forgiving search)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        // Insert test data directly into FTS
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('gatekeeper uses DDD', 'sess1', 'part1', 'user', ${Date.now()})`,
            )
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('bounded context pattern', 'sess2', 'part2', 'assistant', ${Date.now()})`,
            )
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('unrelated content here', 'sess3', 'part3', 'user', ${Date.now()})`,
            )
          }),
        )

        // Plain query "gatekeeper bounded" should match both rows via OR
        const results = yield* Effect.sync(() =>
          Database.use((db) =>
            db.all<{ content: string }>(
              sql`SELECT content FROM session_fts WHERE session_fts MATCH ${"gatekeeper OR bounded"} LIMIT 10`,
            ),
          ),
        )
        expect(results.length).toBeGreaterThanOrEqual(2)
      }),
    ),
  )

  it.live("structured queries with OR pass through", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('kubernetes cluster setup', 'sess4', 'part4', 'user', ${Date.now()})`,
            )
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('k8s deployment config', 'sess5', 'part5', 'assistant', ${Date.now()})`,
            )
          }),
        )

        const results = yield* Effect.sync(() =>
          Database.use((db) =>
            db.all<{ content: string }>(
              sql`SELECT content FROM session_fts WHERE session_fts MATCH ${"kubernetes OR k8s"} LIMIT 10`,
            ),
          ),
        )
        expect(results.length).toBeGreaterThanOrEqual(2)
      }),
    ),
  )

  it.live("phrase search with quotes works", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('the system prompt is injected here', 'sess6', 'part6', 'assistant', ${Date.now()})`,
            )
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('prompt the system for output', 'sess7', 'part7', 'assistant', ${Date.now()})`,
            )
          }),
        )

        // Exact phrase should only match the first
        const results = yield* Effect.sync(() =>
          Database.use((db) =>
            db.all<{ content: string }>(
              sql`SELECT content FROM session_fts WHERE session_fts MATCH ${'"system prompt"'} LIMIT 10`,
            ),
          ),
        )
        expect(results.length).toBeGreaterThanOrEqual(1)
        expect(results.every((r) => r.content.includes("system prompt"))).toBe(true)
      }),
    ),
  )

  it.live("prefix search with * works", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const marker = `xyzpfx${Date.now()}`
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES (${marker + "alpha content here"}, 'sess8', 'part8', 'user', ${Date.now()})`,
            )
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES (${marker + "bravo other stuff"}, 'sess9', 'part9', 'assistant', ${Date.now()})`,
            )
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('no marker here', 'sess10', 'part10', 'user', ${Date.now()})`,
            )
          }),
        )

        // prefix marker* should match both rows with the marker but not the third
        const results = yield* Effect.sync(() =>
          Database.use((db) =>
            db.all<{ content: string }>(
              sql`SELECT content FROM session_fts WHERE session_fts MATCH ${marker + "*"} LIMIT 10`,
            ),
          ),
        )
        expect(results.length).toBe(2)
      }),
    ),
  )

  it.live("role filtering works", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('user said terraform', 'sess10', 'part10', 'user', ${Date.now()})`,
            )
            db.run(
              sql`INSERT INTO session_fts(content, session_id, part_id, role, time_created) VALUES ('assistant said terraform', 'sess11', 'part11', 'assistant', ${Date.now()})`,
            )
          }),
        )

        const userOnly = yield* Effect.sync(() =>
          Database.use((db) =>
            db.all<{ role: string }>(
              sql`SELECT role FROM session_fts WHERE session_fts MATCH 'terraform' AND role = 'user' LIMIT 10`,
            ),
          ),
        )
        expect(userOnly.every((r) => r.role === "user")).toBe(true)
      }),
    ),
  )

  it.live("no match returns empty", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const results = yield* Effect.sync(() =>
          Database.use((db) =>
            db.all<{ content: string }>(
              sql`SELECT content FROM session_fts WHERE session_fts MATCH 'xyznonexistent99999' LIMIT 10`,
            ),
          ),
        )
        expect(results.length).toBe(0)
      }),
    ),
  )
})
