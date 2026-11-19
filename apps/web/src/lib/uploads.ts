/**
 * What the platform accepts as an uploaded file (`UC-25.1-05`).
 *
 * The rule is here rather than on each screen because every upload reaches the same object
 * store and the same project, and a limit one screen enforces and another does not is not
 * a limit. A browser can be told anything, so the check is on the bytes that arrived.
 */

/** 25 MB: large enough for a scanned contract, small enough to keep out a video. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * The types an attachment may be.
 *
 * An allow-list, not a block-list: anything not named here is refused, so a type nobody
 * thought about is refused rather than accepted by default. Executables and archives are
 * absent deliberately — an attachment is something a person reads, and a platform that
 * stores and hands back programs is a distribution channel for them.
 */
export const ALLOWED_UPLOAD_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["text/markdown", "md"],
  ["text/html", "html"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

/**
 * The `Content-Disposition` a stored file is served with (RFC 6266).
 *
 * A header value is Latin-1, so a name with Arabic in it cannot go in `filename` as it is:
 * building the response threw, and every such download failed. `filename*` carries the real
 * name in UTF-8 (RFC 8187) and `filename` an ASCII stand-in for clients that ignore it. A
 * name without its type's extension gets one, so the saved file opens in the right program.
 */
export function contentDisposition(disposition: "inline" | "attachment", name: string, mimeType: string): string {
  const extension = ALLOWED_UPLOAD_TYPES.get(mimeType);
  const named = extension && !name.toLowerCase().endsWith(`.${extension}`) ? `${name}.${extension}` : name;
  // A quote or a line break would end the header early; a separator in a stored name is part
  // of the name, not a folder to save into.
  const safe = named.replace(/["\r\n]/g, "").replace(/[\\/]/g, "_");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  // `encodeURIComponent` leaves `'()*` alone, and RFC 8187 does not allow them unencoded.
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** A refusal in both console languages, which is what a screen and a service each need. */
export type UploadRefusal = { en: string; ar: string };

/** Why an upload was refused, or null when it is acceptable. */
export function uploadRefusal(input: { name: string; mimeType: string; size: number }): UploadRefusal | null {
  if (input.size <= 0) return { en: "That file is empty.", ar: "هذا الملف فارغ." };
  if (input.size > MAX_UPLOAD_BYTES) {
    const limit = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    return { en: `That file is over the ${limit} MB limit.`, ar: `هذا الملف يتجاوز حد ${limit} ميجابايت.` };
  }
  if (!ALLOWED_UPLOAD_TYPES.has(input.mimeType)) {
    return {
      en: `${input.mimeType || "That file type"} cannot be attached.`,
      ar: `${input.mimeType || "هذا النوع من الملفات"} لا يمكن إرفاقه.`,
    };
  }
  // A name is what a person clicks on later, and a path separator in one is a way to write
  // somewhere else in the store.
  if (/[\\/]/.test(input.name)) {
    return { en: "A file name may not contain a path.", ar: "لا يجوز أن يحتوي اسم الملف على مسار." };
  }
  return null;
}

/** The bytes of a `data:` URL, which is how a browser hands a file to a server action. */
export function bytesOfDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  // `[\s\S]` rather than the `s` flag, which the project's target does not carry.
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const [, mimeType, base64, payload] = match;
  const bytes = base64
    ? Uint8Array.from(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return { bytes, mimeType };
}

/**
 * What the first bytes of a file say it is, regardless of what it was declared as.
 *
 * A browser sends the type it guessed from the extension, so a renamed executable arrives
 * claiming to be a PDF. These are the signatures of the types the allow-list permits; a
 * file whose bytes match none of them is only as trustworthy as its name.
 */
const SIGNATURES: [type: string, magic: number[]][] = [
  ["application/pdf", [0x25, 0x50, 0x44, 0x46]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  // RIFF….WEBP — the four bytes at offset 8 are checked separately below.
  ["image/webp", [0x52, 0x49, 0x46, 0x46]],
  // The Office formats and every other zip container share this one.
  ["application/zip", [0x50, 0x4b, 0x03, 0x04]],
  ["application/x-msdownload", [0x4d, 0x5a]],
  ["application/x-executable", [0x7f, 0x45, 0x4c, 0x46]],
];

/** The media type the bytes themselves indicate, or null when they carry no signature. */
export function sniffType(bytes: Uint8Array): string | null {
  for (const [type, magic] of SIGNATURES) {
    if (magic.every((byte, index) => bytes[index] === byte)) return type;
  }
  return null;
}

/** The Office formats are zip containers, so a zip signature is expected for them. */
const ZIP_CONTAINERS = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/**
 * `UC-33.1-05`: why an uploaded file is quarantined rather than stored as usable.
 *
 * The scan the platform can actually perform is on the bytes: a file whose content is an
 * executable, or whose content contradicts the type it was uploaded as, is held rather than
 * served back. It is kept, not deleted, so an administrator can see what arrived.
 */
export function quarantineReason(declared: string, bytes: Uint8Array): UploadRefusal | null {
  const actual = sniffType(bytes);
  if (actual === "application/x-msdownload" || actual === "application/x-executable") {
    return { en: "The file contains an executable.", ar: "يحتوي الملف على برنامج تنفيذي." };
  }
  if (actual === null) return null;
  const expected = ZIP_CONTAINERS.has(declared) ? "application/zip" : declared;
  if (actual !== expected) {
    return {
      en: `The file was uploaded as ${declared} but its content is ${actual}.`,
      ar: `رُفع الملف على أنه ${declared} لكن محتواه ${actual}.`,
    };
  }
  return null;
}
