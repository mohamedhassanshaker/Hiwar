import { describe, expect, it } from "vitest";

import { connectionHealth } from "@/features/models/types";

const probe = (model: string, ok: boolean, untestable?: true) => ({ model, ok, detail: "", ms: 0, ...(untestable ? { untestable } : {}) });

describe("connection health", () => {
  it("D196 a model the console cannot test says nothing about the connection", () => {
    expect(connectionHealth(true, [probe("video-1", false, true)])).toBe("NotChecked");
    expect(connectionHealth(true, [probe("chat-1", true), probe("video-1", false, true)])).toBe("Healthy");
    expect(connectionHealth(true, [probe("chat-1", false), probe("video-1", false, true)])).toBe("Failed");
  });

  it("D196 a switched-off connection reads off, and one never tested reads Not checked", () => {
    expect(connectionHealth(false, [probe("chat-1", true)])).toBe("Disabled");
    expect(connectionHealth(true, null)).toBe("NotChecked");
  });
});
