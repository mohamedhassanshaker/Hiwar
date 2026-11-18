import { describe, expect, it } from "vitest";

import {
  ALLOWED_UPLOAD_TYPES,
  bytesOfDataUrl,
  contentDisposition,
  MAX_UPLOAD_BYTES,
  quarantineReason,
  sniffType,
  uploadRefusal,
} from "@/lib/uploads";

/**
 * `UC-25.1-05`: what the platform accepts as an attachment.
 *
 * The rule lives in one place because every upload reaches the same object store, and a
 * limit one screen enforces and another does not is not a limit.
 */

describe("what may be attached", () => {
  it("UC-25.1-05 refuses a file over the size limit", () => {
    const over = { name: "scan.pdf", mimeType: "application/pdf", size: MAX_UPLOAD_BYTES + 1 };
    expect(uploadRefusal(over)?.en).toMatch(/over the \d+ MB limit/);
    // Specification section 9: the refusal a person reads is in both languages.
    expect(uploadRefusal(over)?.ar).toMatch(/ميجابايت/);
    expect(uploadRefusal({ ...over, size: MAX_UPLOAD_BYTES })).toBeNull();
  });

  it("UC-25.1-05 refuses a type that is not named, rather than blocking a list of bad ones", () => {
    // An allow-list, so a type nobody thought about is refused instead of accepted.
    expect(uploadRefusal({ name: "setup.exe", mimeType: "application/x-msdownload", size: 10 })?.en).toMatch(
      /cannot be attached/,
    );
    expect(uploadRefusal({ name: "archive.zip", mimeType: "application/zip", size: 10 })?.en).toMatch(
      /cannot be attached/,
    );
    expect(uploadRefusal({ name: "claim.pdf", mimeType: "application/pdf", size: 10 })).toBeNull();
    expect(ALLOWED_UPLOAD_TYPES.has("application/zip")).toBe(false);
  });

  it("UC-25.1-05 refuses an empty file and a name carrying a path", () => {
    expect(uploadRefusal({ name: "claim.pdf", mimeType: "application/pdf", size: 0 })?.en).toMatch(/empty/);
    // A path separator in a name is a way to write somewhere else in the store.
    expect(uploadRefusal({ name: "../../etc/passwd", mimeType: "text/plain", size: 10 })?.en).toMatch(/path/);
    expect(uploadRefusal({ name: "a\\b.txt", mimeType: "text/plain", size: 10 })?.en).toMatch(/path/);
  });

  it("reads the bytes a browser hands over, and refuses what is not a data URL", () => {
    const encoded = Buffer.from("hello").toString("base64");
    const read = bytesOfDataUrl(`data:text/plain;base64,${encoded}`);
    expect(read?.mimeType).toBe("text/plain");
    expect(Buffer.from(read?.bytes ?? new Uint8Array()).toString()).toBe("hello");

    expect(bytesOfDataUrl("https://example.test/not-a-data-url")).toBeNull();
  });

  it("UC-33.1-05 holds a file whose content is not what it says it is", () => {
    // A browser sends the type it guessed from the extension, so a renamed executable
    // arrives claiming to be a PDF. The bytes are what decide.
    const executable = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]);
    expect(sniffType(executable)).toBe("application/x-msdownload");
    expect(quarantineReason("application/pdf", executable)?.en).toMatch(/executable/i);

    const elf = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]);
    expect(quarantineReason("application/pdf", elf)?.en).toMatch(/executable/i);

    // A real PDF uploaded as a PDF goes through.
    const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(quarantineReason("application/pdf", pdf)).toBeNull();

    // A PNG uploaded as a PDF is held: one of the two is wrong, and neither is trusted.
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    expect(quarantineReason("application/pdf", png)?.en).toMatch(/content is image\/png/);

    // An Office document is a zip container, which is the signature it is expected to have.
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    expect(
      quarantineReason("application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip),
    ).toBeNull();

    // Plain text carries no signature at all, so there is nothing to contradict.
    expect(quarantineReason("text/plain", new TextEncoder().encode("hello"))).toBeNull();
  });
});

describe("the name a download is saved under", () => {
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("UC-32.1-02 serves an Arabic name in a header a response accepts, with its extension", () => {
    const name = "Tahseel platform features list / قائمة مزايا منصة تحصيل";
    const header = contentDisposition("attachment", name, XLSX);
    // The header the route builds its response with; a non-Latin-1 value throws here.
    expect(() => new Response("x", { headers: { "content-disposition": header } })).not.toThrow();
    const encoded = /filename\*=UTF-8''(.+)$/.exec(header)?.[1] ?? "";
    expect(decodeURIComponent(encoded)).toBe("Tahseel platform features list _ قائمة مزايا منصة تحصيل.xlsx");
    expect(header).toMatch(/^attachment; filename="Tahseel platform features list _ [_ ]+\.xlsx"; /);
  });

  it("UC-32.1-02 keeps an extension the name already has, and leaves an unknown type's name alone", () => {
    expect(contentDisposition("inline", "Report.XLSX", XLSX)).toContain(`filename="Report.XLSX"`);
    expect(contentDisposition("inline", "notes", "application/octet-stream")).toContain(`filename="notes"`);
  });
});
