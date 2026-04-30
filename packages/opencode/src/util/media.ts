const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)

export function isPdfAttachment(mime: string) {
  return mime === "application/pdf"
}

export function isMedia(mime: string) {
  return mime.startsWith("image/") || isPdfAttachment(mime)
}

export function isImageAttachment(mime: string) {
  return mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
}

export function sniffAttachmentMime(bytes: Uint8Array, fallback: string) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp"
  }

  return fallback
}

// Image compression for attachments
//
// Vision models cap effective resolution (Anthropic ~1568 max edge — anything
// larger is downscaled server-side and pure waste in the prompt). Re-encoding
// to JPEG q90 also typically shrinks 1MB+ PNGs by 5–10× with no perceptible
// loss for vision tasks. Each attachment is replayed on every subsequent turn
// (see message-v2.ts buildToolMessages), so this multiplies across the session.
//
// Shells out to imagemagick (`magick` v7 or `convert` v6). Sharp would be
// nicer (faster, better mozjpeg encoder) but its native-binding loader breaks
// inside `bun build --compile`'s bunfs. Falls through to the original bytes
// if the tool isn't available, the input is already small, or the compressed
// result isn't actually smaller.

import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "media.compress" })

const COMPRESS_SKIP_BELOW_BYTES = 256 * 1024
const COMPRESS_DEFAULT_MAX_EDGE = 1568
const COMPRESS_DEFAULT_QUALITY = 90

let cachedTool: string | null | undefined

function findTool() {
  if (cachedTool !== undefined) return cachedTool
  cachedTool = Bun.which("magick") ?? Bun.which("convert") ?? null
  return cachedTool
}

async function runMagick(tool: string, bytes: Uint8Array, maxEdge: number, quality: number) {
  const proc = Bun.spawn(
    [tool, "-", "-auto-orient", "-resize", `${maxEdge}x${maxEdge}>`, "-strip", "-quality", String(quality), "jpg:-"],
    { stdin: "pipe", stdout: "pipe", stderr: "ignore" },
  )
  proc.stdin.write(bytes)
  await proc.stdin.end()
  const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
  const code = await proc.exited
  if (code !== 0 || out.byteLength === 0) return null
  return out
}

export async function compressImage(
  bytes: Uint8Array,
  mime: string,
  opts: { enabled?: boolean; maxEdge?: number; quality?: number; minBytes?: number } = {},
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (opts.enabled === false) return { bytes, mime }
  if (!isImageAttachment(mime)) return { bytes, mime }
  const minBytes = opts.minBytes ?? COMPRESS_SKIP_BELOW_BYTES
  if (bytes.byteLength < minBytes) return { bytes, mime }

  const tool = findTool()
  if (!tool) {
    log.debug("no imagemagick on PATH, passing through", { mime, bytes: bytes.byteLength })
    return { bytes, mime }
  }

  const maxEdge = opts.maxEdge ?? COMPRESS_DEFAULT_MAX_EDGE
  const quality = opts.quality ?? COMPRESS_DEFAULT_QUALITY
  const out = await runMagick(tool, bytes, maxEdge, quality).catch((err) => {
    log.warn("compress failed, passing through", { mime, bytes: bytes.byteLength, error: String(err) })
    return null
  })
  if (!out) return { bytes, mime }
  if (out.byteLength >= bytes.byteLength) {
    log.debug("compress not smaller, passing through", { mime, before: bytes.byteLength, after: out.byteLength })
    return { bytes, mime }
  }
  log.debug("compressed", {
    mime,
    before: bytes.byteLength,
    after: out.byteLength,
    ratio: Number((out.byteLength / bytes.byteLength).toFixed(3)),
  })
  return { bytes: out, mime: "image/jpeg" }
}

// Map a Config.Info.media block to compressImage options.
export function imageCompressOpts(media: { image_compress?: boolean; image_max_edge?: number; image_quality?: number; image_min_bytes?: number } | undefined) {
  return {
    enabled: media?.image_compress,
    maxEdge: media?.image_max_edge,
    quality: media?.image_quality,
    minBytes: media?.image_min_bytes,
  }
}
