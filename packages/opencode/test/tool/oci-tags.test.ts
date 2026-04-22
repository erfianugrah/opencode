import { describe, expect, test } from "bun:test"
import { Log } from "../../src/util"

void Log.init({ print: false })

// Test the parse + token + tags chain via direct HTTP (no Effect needed)

function parse(image: string) {
  const clean = image.replace(/@.*$/, "").replace(/:([^/]*)$/, "")
  const first = clean.split("/")[0]
  if (!clean.includes("/")) return { registry: "registry-1.docker.io", repo: `library/${clean}` }
  if (first.includes(".") || first.includes(":")) return { registry: first, repo: clean.slice(first.length + 1) }
  return { registry: "registry-1.docker.io", repo: clean }
}

describe("oci-tags parse", () => {
  test("bare name → Docker Hub official", () => {
    const r = parse("nginx")
    expect(r.registry).toBe("registry-1.docker.io")
    expect(r.repo).toBe("library/nginx")
  })

  test("user/repo → Docker Hub", () => {
    const r = parse("vaultwarden/server")
    expect(r.registry).toBe("registry-1.docker.io")
    expect(r.repo).toBe("vaultwarden/server")
  })

  test("ghcr.io/org/repo", () => {
    const r = parse("ghcr.io/astral-sh/uv")
    expect(r.registry).toBe("ghcr.io")
    expect(r.repo).toBe("astral-sh/uv")
  })

  test("quay.io/org/repo", () => {
    const r = parse("quay.io/prometheus/prometheus")
    expect(r.registry).toBe("quay.io")
    expect(r.repo).toBe("prometheus/prometheus")
  })

  test("localhost:5000/myimage", () => {
    const r = parse("localhost:5000/myimage")
    expect(r.registry).toBe("localhost:5000")
    expect(r.repo).toBe("myimage")
  })

  test("strips tag", () => {
    const r = parse("nginx:latest")
    expect(r.registry).toBe("registry-1.docker.io")
    expect(r.repo).toBe("library/nginx")
  })

  test("strips digest", () => {
    const r = parse("nginx@sha256:abc123")
    expect(r.registry).toBe("registry-1.docker.io")
    expect(r.repo).toBe("library/nginx")
  })

  test("docker.io prefix", () => {
    const r = parse("docker.io/library/nginx")
    expect(r.registry).toBe("docker.io")
    expect(r.repo).toBe("library/nginx")
  })

  test("deeply nested repo", () => {
    const r = parse("ghcr.io/org/project/subpath")
    expect(r.registry).toBe("ghcr.io")
    expect(r.repo).toBe("org/project/subpath")
  })
})

describe("oci-tags live registry queries", () => {
  test(
    "Docker Hub — vaultwarden/server",
    async () => {
      const { registry, repo } = parse("vaultwarden/server")
      const norm = registry === "docker.io" ? "registry-1.docker.io" : registry

      // Get token
      const probe = await fetch(`https://${norm}/v2/${repo}/tags/list`)
      expect(probe.status).toBe(401)
      const challenge = probe.headers.get("www-authenticate") ?? ""
      const realm = challenge.match(/realm="([^"]+)"/)?.[1]
      const service = challenge.match(/service="([^"]+)"/)?.[1]
      expect(realm).toBeTruthy()

      const tokenResp = await fetch(`${realm}?service=${service}&scope=repository:${repo}:pull`)
      const json = (await tokenResp.json()) as { token?: string }
      expect(json.token).toBeTruthy()

      // Fetch tags
      const tagsResp = await fetch(`https://${norm}/v2/${repo}/tags/list`, {
        headers: { Authorization: `Bearer ${json.token}` },
      })
      expect(tagsResp.ok).toBe(true)
      const data = (await tagsResp.json()) as { tags: string[] }
      expect(data.tags.length).toBeGreaterThan(0)

      // Should include known version
      const semver = data.tags.filter((t) => /^\d+\.\d+/.test(t))
      expect(semver.length).toBeGreaterThan(0)
    },
    15000,
  )

  test(
    "ghcr.io — astral-sh/uv",
    async () => {
      const { registry, repo } = parse("ghcr.io/astral-sh/uv")

      const probe = await fetch(`https://${registry}/v2/${repo}/tags/list`)
      expect(probe.status).toBe(401)
      const challenge = probe.headers.get("www-authenticate") ?? ""
      const realm = challenge.match(/realm="([^"]+)"/)?.[1]
      const service = challenge.match(/service="([^"]+)"/)?.[1]

      const tokenResp = await fetch(`${realm}?service=${service}&scope=repository:${repo}:pull`)
      const json = (await tokenResp.json()) as { token?: string }
      expect(json.token).toBeTruthy()

      const tagsResp = await fetch(`https://${registry}/v2/${repo}/tags/list`, {
        headers: { Authorization: `Bearer ${json.token}` },
      })
      expect(tagsResp.ok).toBe(true)
      const data = (await tagsResp.json()) as { tags: string[] }
      expect(data.tags.length).toBeGreaterThan(0)
    },
    15000,
  )

  test(
    "quay.io — prometheus/prometheus (no auth needed)",
    async () => {
      const { registry, repo } = parse("quay.io/prometheus/prometheus")
      const resp = await fetch(`https://${registry}/v2/${repo}/tags/list`)
      expect(resp.ok).toBe(true)
      const data = (await resp.json()) as { tags: string[] }
      expect(data.tags.length).toBeGreaterThan(0)
    },
    15000,
  )

  test("version sort puts latest last", () => {
    const tags = ["1.2.0", "1.10.0", "1.3.0", "2.0.0", "1.1.0"]
    tags.sort((a, b) => {
      const pa = a.split(/[.\-]/)
      const pb = b.split(/[.\-]/)
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = parseInt(pa[i] ?? "0", 10)
        const nb = parseInt(pb[i] ?? "0", 10)
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb
        const cmp = (pa[i] ?? "").localeCompare(pb[i] ?? "")
        if (cmp !== 0) return cmp
      }
      return 0
    })
    expect(tags).toEqual(["1.1.0", "1.2.0", "1.3.0", "1.10.0", "2.0.0"])
  })

  test("semver filter", () => {
    const tags = ["latest", "1.35.7", "alpine", "v2.0.0", "1.35.7-alpine", "testing"]
    const semver = tags.filter((t) => /^v?\d+\.\d+/.test(t))
    expect(semver).toEqual(["1.35.7", "v2.0.0", "1.35.7-alpine"])
  })
})
