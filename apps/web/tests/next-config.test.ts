import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

/**
 * TC-FIL-061: a file of exactly 25 MB is accepted. It reaches the server action as a base64 data
 * URL, and `proxy.ts` makes Next.js buffer every request body up to `proxyClientMaxBodySize`
 * (10 MB by default) and truncate the rest, so a 12 MB file failed with a 500. Both limits have to
 * hold the largest upload, base64 inflation included.
 */
const MIB = 1024 * 1024;
const BASE64_OF_LARGEST_UPLOAD = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3);

/** Megabytes in a `"34mb"` size limit. */
const megabytes = (limit: unknown): number => Number(/^(\d+)mb$/i.exec(String(limit))?.[1]) * MIB;

describe("next.config body limits", () => {
  it("lets a server action take the largest upload as a data URL", () => {
    expect(megabytes(nextConfig.experimental?.serverActions?.bodySizeLimit)).toBeGreaterThan(BASE64_OF_LARGEST_UPLOAD);
  });

  it("makes the proxy buffer a request body as large as the largest upload", () => {
    expect(megabytes(nextConfig.experimental?.proxyClientMaxBodySize)).toBeGreaterThan(BASE64_OF_LARGEST_UPLOAD);
  });
});
