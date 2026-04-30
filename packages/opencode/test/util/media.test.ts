import { describe, expect, test } from "bun:test"
import path from "path"
import { compressImage, isImageAttachment, sniffAttachmentMime } from "../../src/util/media"

const FIXTURES_DIR = path.join(import.meta.dir, "../tool/fixtures")

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

  test("accepts upper-case mime", async () => {
    const tiny = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(isImageAttachment("IMAGE/PNG")).toBe(true)
    expect(isImageAttachment("Image/Jpeg")).toBe(true)
    const out = await compressImage(tiny, "IMAGE/PNG")
    expect(out.mime).toBe("IMAGE/PNG")
  })

  test("shrinks the large fixture and re-encodes to JPEG", async () => {
    const file = Bun.file(path.join(FIXTURES_DIR, "large-image.png"))
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1024 * 1024)

    const out = await compressImage(bytes, "image/png")
    expect(out.mime).toBe("image/jpeg")
    expect(out.bytes.byteLength).toBeLessThan(bytes.byteLength / 2)
    expect(sniffAttachmentMime(out.bytes, "")).toBe("image/jpeg")
    expect(isImageAttachment(out.mime)).toBe(true)
  })

  test("respects custom maxEdge", async () => {
    const file = Bun.file(path.join(FIXTURES_DIR, "large-image.png"))
    const bytes = new Uint8Array(await file.arrayBuffer())
    const wide = await compressImage(bytes, "image/png", { maxEdge: 1568 })
    const narrow = await compressImage(bytes, "image/png", { maxEdge: 512 })
    expect(narrow.bytes.byteLength).toBeLessThan(wide.bytes.byteLength)
  })
})

describe("sniffAttachmentMime", () => {
  test("PNG", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffAttachmentMime(bytes, "")).toBe("image/png")
  })
  test("JPEG", () => {
    expect(sniffAttachmentMime(new Uint8Array([0xff, 0xd8, 0xff]), "")).toBe("image/jpeg")
  })
  test("WebP", () => {
    const b = new Uint8Array(16)
    b.set([0x52, 0x49, 0x46, 0x46], 0)
    b.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffAttachmentMime(b, "")).toBe("image/webp")
  })
  test("AVIF", () => {
    const b = new Uint8Array(16)
    b.set([0x00, 0x00, 0x00, 0x20], 0)
    b.set([0x66, 0x74, 0x79, 0x70], 4) // ftyp
    b.set([0x61, 0x76, 0x69, 0x66], 8) // avif brand
    expect(sniffAttachmentMime(b, "")).toBe("image/avif")
  })
  test("HEIC", () => {
    const b = new Uint8Array(16)
    b.set([0x00, 0x00, 0x00, 0x20], 0)
    b.set([0x66, 0x74, 0x79, 0x70], 4)
    b.set([0x68, 0x65, 0x69, 0x63], 8) // heic brand
    expect(sniffAttachmentMime(b, "")).toBe("image/heic")
  })
  test("TIFF little-endian", () => {
    expect(sniffAttachmentMime(new Uint8Array([0x49, 0x49, 0x2a, 0x00]), "")).toBe("image/tiff")
  })
  test("TIFF big-endian", () => {
    expect(sniffAttachmentMime(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]), "")).toBe("image/tiff")
  })
  test("falls back when unknown", () => {
    expect(sniffAttachmentMime(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), "fallback")).toBe("fallback")
  })
})
