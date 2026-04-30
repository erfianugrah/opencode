import { describe, expect, test } from "bun:test"
import path from "path"
import { compressImage, isImageAttachment, sniffAttachmentMime } from "../../src/util/media"

const FIXTURES_DIR = path.join(import.meta.dir, "../tool/fixtures")
const hasMagick = Boolean(Bun.which("magick") ?? Bun.which("convert"))
const skipIfNoMagick = hasMagick ? test : test.skip

describe("compressImage", () => {
  test("passes small images through untouched", async () => {
    const tiny = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const out = await compressImage(tiny, "image/png")
    expect(out.bytes).toBe(tiny)
    expect(out.mime).toBe("image/png")
  })

  test("respects min_bytes threshold", async () => {
    const bytes = new Uint8Array(300 * 1024)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const out = await compressImage(bytes, "image/png", { minBytes: 1024 * 1024 })
    expect(out.bytes).toBe(bytes)
  })

  test("returns input untouched when disabled", async () => {
    const file = Bun.file(path.join(FIXTURES_DIR, "large-image.png"))
    const bytes = new Uint8Array(await file.arrayBuffer())
    const out = await compressImage(bytes, "image/png", { enabled: false })
    expect(out.bytes).toBe(bytes)
    expect(out.mime).toBe("image/png")
  })

  test("skips non-image mimes", async () => {
    const bytes = new Uint8Array(500 * 1024)
    const out = await compressImage(bytes, "application/pdf")
    expect(out.bytes).toBe(bytes)
    expect(out.mime).toBe("application/pdf")
  })

  skipIfNoMagick("shrinks the large fixture and re-encodes to JPEG", async () => {
    const file = Bun.file(path.join(FIXTURES_DIR, "large-image.png"))
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1024 * 1024)

    const out = await compressImage(bytes, "image/png")
    expect(out.mime).toBe("image/jpeg")
    expect(out.bytes.byteLength).toBeLessThan(bytes.byteLength / 2)
    expect(sniffAttachmentMime(out.bytes, "")).toBe("image/jpeg")
    expect(isImageAttachment(out.mime)).toBe(true)
  })

  skipIfNoMagick("respects custom maxEdge", async () => {
    const file = Bun.file(path.join(FIXTURES_DIR, "large-image.png"))
    const bytes = new Uint8Array(await file.arrayBuffer())
    const wide = await compressImage(bytes, "image/png", { maxEdge: 1568 })
    const narrow = await compressImage(bytes, "image/png", { maxEdge: 512 })
    expect(narrow.bytes.byteLength).toBeLessThan(wide.bytes.byteLength)
  })
})
