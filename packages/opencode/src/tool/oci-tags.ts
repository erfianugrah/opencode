import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./oci-tags.txt"

const Parameters = Schema.Struct({
  image: Schema.String.annotate({ description: "Container image reference (e.g. vaultwarden/server, ghcr.io/astral-sh/uv, nginx)" }),
  semver: Schema.optional(Schema.Boolean.annotate({ description: "Filter to semver-like tags only (default: false)" })),
  limit: Schema.optional(Schema.Number.annotate({ description: "Max tags to return (default: 10)" })),
})

type Metadata = {
  count: number
  registry: string
}

function parse(image: string) {
  const clean = image.replace(/@.*$/, "").replace(/:([^/]*)$/, "")
  const first = clean.split("/")[0]
  if (!clean.includes("/")) return { registry: "registry-1.docker.io", repo: `library/${clean}` }
  if (first.includes(".") || first.includes(":")) return { registry: first, repo: clean.slice(first.length + 1) }
  return { registry: "registry-1.docker.io", repo: clean }
}

async function token(registry: string, repo: string): Promise<string | undefined> {
  const url = `https://${registry}/v2/${repo}/tags/list`
  const probe = await fetch(url, { method: "GET", redirect: "follow" }).catch(() => null)
  if (!probe || probe.ok) return undefined

  const challenge = probe.headers.get("www-authenticate") ?? ""
  const realm = challenge.match(/realm="([^"]+)"/)?.[1]
  const service = challenge.match(/service="([^"]+)"/)?.[1]
  if (!realm) return undefined

  const resp = await fetch(`${realm}?service=${service ?? ""}&scope=repository:${repo}:pull`).catch(() => null)
  if (!resp?.ok) return undefined
  const json = (await resp.json()) as { token?: string; access_token?: string }
  return json.token ?? json.access_token
}

async function tags(registry: string, repo: string, auth: string | undefined): Promise<string[]> {
  const headers: Record<string, string> = auth ? { Authorization: `Bearer ${auth}` } : {}
  const result: string[] = []
  let url: string | null = `https://${registry}/v2/${repo}/tags/list`

  while (url) {
    const resp: Response = await fetch(url, { headers })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${registry}`)
    const json = (await resp.json()) as { tags?: string[] }
    if (json.tags) result.push(...json.tags)

    const link: string | null = resp.headers.get("link")
    const next: string | undefined = link?.match(/<([^>]+)>/)?.[1]
    if (next) {
      url = next.startsWith("http") ? next : `https://${registry}${next}`
    } else {
      url = null
    }
  }

  return result
}

export const OciTagsTool = Tool.define<typeof Parameters, Metadata, never>(
  "oci_tags",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "oci_tags",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const { registry, repo } = parse(params.image)
          const normalized = registry === "docker.io" ? "registry-1.docker.io" : registry
          const auth = yield* Effect.promise(() => token(normalized, repo))
          const all = yield* Effect.promise(() => tags(normalized, repo, auth))

          let filtered = all
          if (params.semver) filtered = filtered.filter((t) => /^v?\d+\.\d+/.test(t))

          filtered.sort((a, b) => {
            const pa = a.replace(/^v/, "").split(/[.\-]/)
            const pb = b.replace(/^v/, "").split(/[.\-]/)
            for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
              const na = parseInt(pa[i] ?? "0", 10)
              const nb = parseInt(pb[i] ?? "0", 10)
              if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb
              const cmp = (pa[i] ?? "").localeCompare(pb[i] ?? "")
              if (cmp !== 0) return cmp
            }
            return 0
          })

          const limit = Math.min(params.limit ?? 10, 100)
          const result = filtered.slice(-limit)

          if (result.length === 0)
            return {
              title: "No tags",
              output: `No tags found for ${params.image}`,
              metadata: { count: 0, registry: normalized },
            }

          return {
            title: `${result.length} tags`,
            output: result.join("\n"),
            metadata: { count: result.length, registry: normalized },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
