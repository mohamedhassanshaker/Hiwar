import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// The deployment's allowed origins, as the database would give them.
vi.mock("@/features/engage/conversation-view", () => ({
  allowedOriginsOf: async (code: string) =>
    code === "shj3" ? ["https://host.example.test", "http://localhost:8080"] : code === "files" ? ["null"] : [],
}));

import { proxy } from "@/proxy";

const frameAncestors = async (path: string) =>
  (await proxy(new NextRequest(`http://localhost:3000${path}`))).headers
    .get("content-security-policy")
    ?.split("; ")
    .find((directive) => directive.startsWith("frame-ancestors"));

describe("the console's content security policy", () => {
  it("D178 lets the console's own preview frame a stored file, and nobody else", async () => {
    expect(await frameAncestors("/api/files?name=a.txt&kind=file")).toBe("frame-ancestors 'self'");
  });

  it("D178 never lets a console page be framed", async () => {
    expect(await frameAncestors("/dashboard")).toBe("frame-ancestors 'none'");
    expect(await frameAncestors("/api/filesystem")).toBe("frame-ancestors 'none'");
  });

  it("D231 lets only a deployment's allowed origins, and the console's preview, frame its widget", async () => {
    expect(await frameAncestors("/embed/v1/frame/shj3")).toBe("frame-ancestors 'self' https://host.example.test http://localhost:8080");
    expect(await frameAncestors("/embed/v1/frame/unknown")).toBe("frame-ancestors 'self'");
  });

  it("D220 admits every page when the deployment lists null, as a page opened as a file needs", async () => {
    // `*` matches network schemes only, so a page opened as a file is named by its scheme (D278).
    expect(await frameAncestors("/embed/v1/frame/files")).toBe("frame-ancestors * file:");
  });
});
