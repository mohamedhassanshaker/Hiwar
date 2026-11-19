import { describe, expect, it } from "vitest";

import { modelToolName, platformToolName } from "@/features/connectors/tool-name";
import { PLATFORM_TOOLS } from "@/mcp/tools";

describe("D223 a connector tool's model name", () => {
  it("is one a provider accepts, and reads back as the platform's name", () => {
    const listed = modelToolName("custom-server/describe_tabular_table");
    expect(listed).toBe("custom-server__describe_tabular_table");
    expect(listed).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(platformToolName(listed)).toBe("custom-server/describe_tabular_table");
  });

  it("D363 carries a dot or a dash in the tool's name to the provider and back exactly", () => {
    // `erp/claims.read` was listed as `erp__claims.read`, which OpenRouter refused (400).
    const cases = {
      "erp/claims.read": "erp__claims-_read",
      "m365/calendar.create_event": "m365__calendar-_create_event",
      "custom-server/describe-table": "custom-server__describe--table",
      "custom-server/x-_y.z": "custom-server__x--_y-_z",
    };
    for (const [platform, model] of Object.entries(cases)) {
      expect(modelToolName(platform)).toBe(model);
      expect(model).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(platformToolName(model)).toBe(platform);
    }
  });

  it("leaves every catalogue tool's name as it is, both ways", () => {
    for (const { name } of PLATFORM_TOOLS) {
      expect(modelToolName(name)).toBe(name);
      expect(platformToolName(name)).toBe(name);
    }
  });
});

describe("D363 a connector tool's step label", () => {
  it("names the tool's action from the platform name, not the escaped one", async () => {
    const { actionTitle } = await import("@/features/assistant/components/assistant-activity");
    const t = (en: string) => en;
    expect(actionTitle({ name: "erp__claims-_read", args: {} }, t)).toBe("Read claims");
    expect(actionTitle({ name: "erp__vendors-_search", args: { query: "Al Futtaim" } }, t)).toBe("Search vendors · Al Futtaim");
  });
});
