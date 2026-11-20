import { describe, expect, it } from "vitest";

import { can, homeFor, type Role } from "@/server/authz";

describe("ORG-002 refused requests", () => {
  it("FR-006: each role's landing screen is one the role may open", () => {
    const expected: Record<Role, string> = {
      owner: "/conversations",
      admin: "/conversations",
      support_agent: "/conversations",
      builder: "/agents",
      analyst: "/analytics",
      billing: "/billing",
    };
    for (const [role, home] of Object.entries(expected) as [Role, string][]) expect(homeFor(role)).toBe(home);
    expect(can("builder", "conversations")).toBe(false);
  });
});
