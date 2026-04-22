- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- NEVER run compiled binaries, servers, or daemons directly on the dev machine unless you fully understand their startup hooks and side effects. Use `go test`, `bun test`, Docker, or dry-run flags instead. If unsure what a binary does at startup, read the main() function first.

## Container Image Versions

**Do NOT web-search for container image versions.** Use the `oci_tags` tool — it queries OCI registries directly (Docker Hub, ghcr.io, quay.io, any OCI-compliant registry).

```
oci_tags(image: "vaultwarden/server", semver: true, limit: 5)
oci_tags(image: "ghcr.io/astral-sh/uv", semver: true)
oci_tags(image: "nginx")
```

Alternatively, `./script/oci-tags` is available as a CLI script in this repo.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## Output Style

Configurable via `style` in `opencode.json`:

```jsonc
{ "style": "terse" }    // default — minimal tokens, drops filler, fragments OK
{ "style": "socratic" } // learning mode — probing questions, explains reasoning
```

- `terse` + `socratic` are orthogonal to `build` + `plan` modes (all 4 combinations work)
- Toggle in-session: `/style terse` or `/style socratic` (or `/style` to toggle)
- Style is injected into the system prompt at `packages/opencode/src/session/prompt.ts`
- Config schema at `packages/opencode/src/config/config.ts` (field: `style`)
- Prompt constants: `TERSE_PROMPT` and `SOCRATIC_PROMPT` in `prompt.ts`
