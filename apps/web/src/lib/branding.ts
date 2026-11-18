import { BRANDING_ASSET_KINDS } from "@/db/schema/enums";
import { Rejected } from "./rejection";

/**
 * What may be stored as a branding asset, and the size each kind must be.
 *
 * Specification §7.5.5 fixes the sizes: a logo is at least 240×80, and the favicon is a
 * 64×64 PNG. `UC-75.2-02` rejects anything else "with the required size".
 *
 * The dimensions are read from the image's own bytes rather than taken from the upload.
 * A client-reported size is a claim, not a check: the browser form could be bypassed, and
 * a 1×1 image declared as 240×80 would be accepted and then drawn across every screen and
 * the embedded widget. Reading the header is the only version of this rule that holds
 * server-side (`COM-08`).
 *
 * Only PNG, JPEG and WebP are read, which are the formats the upload accepts. Each stores
 * its dimensions in a fixed place near the start, so no decoder is needed.
 */

/**
 * The kinds of asset Settings → Branding carries. Re-exported from the schema rather than
 * listed again: the column has a `CHECK` against that list, so a second copy here could
 * accept a kind the database then refuses.
 */
export { BRANDING_ASSET_KINDS as BRANDING_KINDS } from "@/db/schema/enums";
export type BrandingKind = (typeof BRANDING_ASSET_KINDS)[number];

/** What each kind must satisfy. A logo has a floor; the favicon has an exact size. */
export const BRANDING_RULES: Record<BrandingKind, { minWidth?: number; minHeight?: number; exact?: { width: number; height: number }; formats: string[] }> = {
  LogoLight: { minWidth: 240, minHeight: 80, formats: ["png", "svg+xml"] },
  LogoDark: { minWidth: 240, minHeight: 80, formats: ["png", "svg+xml"] },
  Favicon: { exact: { width: 64, height: 64 }, formats: ["png"] },
};

export type ImageSize = { width: number; height: number };

export class BrandingRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "BrandingRejected";
  }
}

/** The `data:` URL an upload arrives as, with its media subtype captured. */
const DATA_URL = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

/**
 * Whether a stored `contentRef` is an image a browser can actually draw from, rather than a
 * path into a store nothing here serves. Every reader of a branding asset uses this, not only
 * the upload's own write path: a row the write path never validated — a migration, a manual
 * edit, stale seed data — would otherwise reach an `<img src>` as un-renderable text.
 */
export function isRenderableImage(contentRef: string | null | undefined): contentRef is string {
  return !!contentRef && /^data:image\/[a-z0-9.+-]+;base64,/.test(contentRef);
}

function decode(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/**
 * The pixel size of a PNG, JPEG or WebP, or `null` when the bytes are not one of those or
 * are truncated before the header that carries it.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: an 8-byte signature, then the IHDR chunk, whose width and height are big-endian
  // 32-bit integers at offsets 16 and 20.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // WebP: "RIFF" .... "WEBP". Only the lossy (VP8 ) and lossless (VP8L) forms are read;
  // an extended (VP8X) file carries its size elsewhere and is treated as unreadable.
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const format = String.fromCharCode(...bytes.slice(12, 16));
    if (format === "VP8 ") {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (format === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  // JPEG: a chain of segments. The start-of-frame markers carry the size; every other
  // segment declares its own length, so the chain is walked rather than guessed at.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // SOF0…SOF15, excluding the four that are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }

  return null;
}

/**
 * Checks an uploaded branding asset against its kind's rule.
 *
 * @returns the image's size, so a caller can record what was accepted.
 * @throws {BrandingRejected} when the format, the bytes or the size is not acceptable. The
 * message names the requirement, which is what `UC-75.2-02` shows the person.
 */
export function assertBrandingAsset(kind: BrandingKind, dataUrl: string): ImageSize {
  const rule = BRANDING_RULES[kind];
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new BrandingRejected("Upload a PNG image.", "ارفع صورة PNG.");

  const [, format, base64] = match;
  if (!rule.formats.includes(format)) {
    const formats = rule.formats.map((f) => f.replace("+xml", "").toUpperCase());
    throw new BrandingRejected(
      `${kind} must be ${formats.join(" or ")}.`,
      `${kind} يجب أن يكون ${formats.join(" أو ")}.`,
    );
  }

  // An SVG has no pixel size to read, and none to check: it scales.
  if (format === "svg+xml") return { width: 0, height: 0 };

  const size = imageSize(decode(base64));
  if (!size) throw new BrandingRejected("That file could not be read as an image.", "تعذّرت قراءة هذا الملف كصورة.");

  if (rule.exact && (size.width !== rule.exact.width || size.height !== rule.exact.height)) {
    throw new BrandingRejected(
      `${kind} must be exactly ${rule.exact.width}×${rule.exact.height}; this one is ${size.width}×${size.height}.`,
      `${kind} يجب أن يكون ${rule.exact.width}×${rule.exact.height} بالضبط؛ وهذا ${size.width}×${size.height}.`,
    );
  }
  if (rule.minWidth && rule.minHeight && (size.width < rule.minWidth || size.height < rule.minHeight)) {
    throw new BrandingRejected(
      `${kind} must be at least ${rule.minWidth}×${rule.minHeight}; this one is ${size.width}×${size.height}.`,
      `${kind} يجب ألا يقل عن ${rule.minWidth}×${rule.minHeight}؛ وهذا ${size.width}×${size.height}.`,
    );
  }

  return size;
}
