const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)

export function isPdfAttachment(mime: string) {
  return mime === "application/pdf"
}

export function isMedia(mime: string) {
  return mime.startsWith("image/") || isPdfAttachment(mime)
}

export function isImageAttachment(mime: string) {
  const m = mime.toLowerCase()
  return m.startsWith("image/") && m !== "image/svg+xml" && m !== "image/vnd.fastbidsheet"
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
  // ISOBMFF box at offset 4: ftyp + brand. AVIF/HEIC use this container.
  if (startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (brand === "avif" || brand === "avis") return "image/avif"
    if (brand === "heic" || brand === "heix" || brand === "mif1" || brand === "msf1") return "image/heic"
  }
  // TIFF: II*\0 little-endian or MM\0* big-endian
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "image/tiff"
  }

  return fallback
}

// Image compression for attachments
//
// Vision models cap effective resolution (Anthropic ~1568 max edge — anything
// larger is downscaled server-side and pure waste in the prompt). Re-encoding
// to JPEG q90 (mozjpeg) also typically shrinks 1MB+ PNGs by 5–10× with no
// perceptible loss for vision tasks. Each attachment is replayed on every
// subsequent turn (see message-v2.ts buildToolMessages), so this multiplies
// across the session.
//
// Uses @jsquash/* WASM modules (mozjpeg + squoosh). WASM bundles cleanly with
// `bun build --compile` — sharp's native bindings don't, jimp is too slow.
// The .wasm files are imported as embedded assets and pre-compiled on first
// use. Falls through to the original bytes on decode failure or if the
// compressed result isn't actually smaller.

import * as Log from "@opencode-ai/core/util/log"
import decodePng, { init as initPngDec } from "@jsquash/png/decode"
import decodeJpeg, { init as initJpegDec } from "@jsquash/jpeg/decode"
import decodeWebp, { init as initWebpDec } from "@jsquash/webp/decode"
import decodeAvif, { init as initAvifDec } from "@jsquash/avif/decode"
import encodeJpeg, { init as initJpegEnc } from "@jsquash/jpeg/encode"
import resize, { initResize } from "@jsquash/resize"
import UTIF from "utif"
// @ts-expect-error — package ships wasm-bindgen .d.ts shadowing the file-import shape
import pngDecWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" }
import jpegDecWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm" with { type: "file" }
import jpegEncWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm" with { type: "file" }
// @ts-expect-error — package ships wasm-bindgen .d.ts shadowing the file-import shape
import resizeWasm from "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm" with { type: "file" }
import webpDecWasm from "@jsquash/webp/codec/dec/webp_dec.wasm" with { type: "file" }
import avifDecWasm from "@jsquash/avif/codec/dec/avif_dec.wasm" with { type: "file" }

const log = Log.create({ service: "media.compress" })

const COMPRESS_SKIP_BELOW_BYTES = 256 * 1024
const COMPRESS_DEFAULT_MAX_EDGE = 1568
const COMPRESS_DEFAULT_QUALITY = 90

async function compileWasm(filePath: unknown) {
  // wasm imports with { type: "file" } resolve to a string path at runtime,
  // even when the module's own .d.ts declares wasm-bindgen exports.
  const bytes = await Bun.file(filePath as string).arrayBuffer()
  return WebAssembly.compile(bytes)
}

let initPromise: Promise<void> | undefined
function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      const [pngM, jpegDecM, jpegEncM, resizeM, webpDecM, avifDecM] = await Promise.all([
        compileWasm(pngDecWasm),
        compileWasm(jpegDecWasm),
        compileWasm(jpegEncWasm),
        compileWasm(resizeWasm),
        compileWasm(webpDecWasm),
        compileWasm(avifDecWasm),
      ])
      await Promise.all([
        initPngDec(pngM),
        initJpegDec(jpegDecM),
        initJpegEnc(jpegEncM),
        initResize(resizeM),
        initWebpDec(webpDecM),
        initAvifDec(avifDecM),
      ])
    })().catch((err) => {
      // Reset so a later call can retry, but log once.
      initPromise = undefined
      log.warn("jsquash init failed", { error: String(err) })
      throw err
    })
  }
  return initPromise
}

function decodeTiff(bytes: Uint8Array): ImageData | null {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const ifds = UTIF.decode(buf)
  if (!ifds.length) return null
  const ifd = ifds[0]
  UTIF.decodeImage(buf, ifd)
  const rgba = UTIF.toRGBA8(ifd)
  // Synthesize an ImageData-shaped object. jsquash only reads width/height/data
  // and never touches `colorSpace`, but TS demands a full ImageData.
  return {
    width: ifd.width,
    height: ifd.height,
    data: new Uint8ClampedArray(rgba.buffer),
    colorSpace: "srgb",
  } as ImageData
}

async function decodeForMime(bytes: Uint8Array, mime: string) {
  // jsquash decoders typed to ArrayBuffer; slice the underlying buffer to the
  // exact view range so we don't accidentally hand them a larger backing store.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const m = mime.toLowerCase()
  if (m === "image/png") return decodePng(buf)
  if (m === "image/jpeg" || m === "image/jpg") return decodeJpeg(buf)
  if (m === "image/webp") return decodeWebp(buf)
  if (m === "image/avif") return decodeAvif(buf)
  if (m === "image/tiff" || m === "image/tif") return decodeTiff(bytes)
  // Fall back to magic-byte sniff — mime is sometimes "image/*", upper-case,
  // or wrong outright.
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return decodePng(buf)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpeg(buf)
  // TIFF: II*\0 (little-endian) or MM\0* (big-endian)
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return decodeTiff(bytes)
  }
  return null
}

async function runJsquash(bytes: Uint8Array, mime: string, maxEdge: number, quality: number) {
  await ensureInit()
  const decoded = await decodeForMime(bytes, mime)
  if (!decoded) return null

  const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height))
  const resized =
    scale < 1
      ? await resize(decoded, {
          width: Math.round(decoded.width * scale),
          height: Math.round(decoded.height * scale),
        })
      : decoded

  const out = await encodeJpeg(resized, { quality })
  return new Uint8Array(out)
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

  const maxEdge = opts.maxEdge ?? COMPRESS_DEFAULT_MAX_EDGE
  const quality = opts.quality ?? COMPRESS_DEFAULT_QUALITY
  const out = await runJsquash(bytes, mime, maxEdge, quality).catch((err) => {
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
