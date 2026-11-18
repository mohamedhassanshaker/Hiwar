import { describe, expect, it } from "vitest";

import { BrandingRejected, assertBrandingAsset, imageSize } from "@/lib/branding";

/**
 * `UC-75.2-02`: a logo below 240×80, or a favicon that is not a 64×64 PNG, is rejected with
 * the required size.
 *
 * The size is read from the image's own bytes. A client-reported size is a claim, not a
 * check — the form can be bypassed — and the brand assets are drawn on every screen and in
 * the embedded widget, so this has to hold server-side (`COM-08`).
 */

/** A valid PNG header of a given size. Nothing decodes it; only the IHDR is ever read. */
function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** A JPEG whose SOF0 segment declares a given size, reached by walking the segment chain. */
function jpeg(width: number, height: number): string {
  const comment = Buffer.alloc(20);
  comment.writeUInt16BE(0xfffe, 0); // a COM segment the walker must step over
  comment.writeUInt16BE(18, 2);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8]), comment, sof]);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

describe("reading an image's size from its bytes", () => {
  it("reads a PNG header", () => {
    expect(imageSize(Buffer.from(png(240, 80).split(",")[1], "base64"))).toEqual({ width: 240, height: 80 });
  });

  it("reads a JPEG by walking its segments, not by guessing an offset", () => {
    expect(imageSize(Buffer.from(jpeg(300, 100).split(",")[1], "base64"))).toEqual({ width: 300, height: 100 });
  });

  it("returns nothing for bytes that are not an image it reads", () => {
    expect(imageSize(Buffer.from("not an image at all, really not"))).toBeNull();
  });
});

describe("UC-75.2-02 a logo", () => {
  it("is accepted at the minimum size and above", () => {
    expect(assertBrandingAsset("LogoLight", png(240, 80))).toEqual({ width: 240, height: 80 });
    expect(assertBrandingAsset("LogoDark", png(960, 320))).toEqual({ width: 960, height: 320 });
  });

  it("is refused below the minimum, and the message names the requirement", () => {
    expect(() => assertBrandingAsset("LogoLight", png(239, 80))).toThrow(BrandingRejected);
    try {
      assertBrandingAsset("LogoLight", png(100, 40));
    } catch (error) {
      expect((error as Error).message).toContain("240×80");
      expect((error as Error).message).toContain("100×40");
    }
  });

  it("accepts an SVG, which has no pixel size to fall short of", () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
    expect(() => assertBrandingAsset("LogoLight", svg)).not.toThrow();
  });
});

describe("UC-75.2-02 the favicon", () => {
  it("is accepted at exactly 64×64", () => {
    expect(assertBrandingAsset("Favicon", png(64, 64))).toEqual({ width: 64, height: 64 });
  });

  it("is refused at any other size, including larger", () => {
    expect(() => assertBrandingAsset("Favicon", png(32, 32))).toThrow(BrandingRejected);
    expect(() => assertBrandingAsset("Favicon", png(128, 128))).toThrow(BrandingRejected);
    expect(() => assertBrandingAsset("Favicon", png(64, 63))).toThrow(BrandingRejected);
  });

  it("is refused when it is not a PNG", () => {
    expect(() => assertBrandingAsset("Favicon", jpeg(64, 64))).toThrow(/PNG/);
  });
});

describe("what is not an image at all", () => {
  it("is refused rather than stored", () => {
    for (const value of ["", "https://example.com/logo.png", "data:text/html;base64,PHNjcmlwdD4=", "data:image/png;base64,!!!"]) {
      expect(() => assertBrandingAsset("LogoLight", value), `${value} must be refused`).toThrow(BrandingRejected);
    }
  });

  it("is refused when the bytes are truncated before the header that carries the size", () => {
    const truncated = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`;
    expect(() => assertBrandingAsset("LogoLight", truncated)).toThrow(/could not be read/i);
  });
});
