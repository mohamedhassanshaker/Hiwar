/** A connector tool's refusal reaches the run whole enough to correct the call (owner, 2026-11-03). */
import { describe, expect, it } from "vitest";
import { CONNECTOR_REFUSAL_CHARS, connectorRefusal } from "@/lib/connector-runtime";

describe("connectorRefusal", () => {
  const apiAnswer = JSON.stringify({
    success: false,
    statusCode: 400,
    request: "POST /AdminApi/api/v1/SecurityUser/addUser",
    body: { title: "One or more validation errors occurred.", errors: { $: ["The JSON value could not be converted."] } },
  });

  it("hands back the tool's own text, with the validation errors past the first 200 characters", () => {
    const said = connectorRefusal(JSON.stringify({ detail: apiAnswer }));

    expect(said).toBe(apiAnswer);
    expect(said).toContain("The JSON value could not be converted.");
  });

  it("keeps a text that is not the runtime's JSON as it is", () => {
    expect(connectorRefusal("Bad gateway")).toBe("Bad gateway");
  });

  it("bounds a very long answer", () => {
    expect(connectorRefusal(JSON.stringify({ detail: "x".repeat(10_000) }))).toHaveLength(CONNECTOR_REFUSAL_CHARS);
  });
});
