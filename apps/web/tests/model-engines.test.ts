import { describe, expect, it } from "vitest";

import { MODEL_ENGINES } from "@/db/schema/enums";
import { ENGINE_LABELS, ENGINE_VALUES } from "@/features/models/types";

describe("model engines", () => {
  it.each(MODEL_ENGINES)("D175 the stored engine %s reads as a name that is stored as it again", (stored) => {
    expect(ENGINE_VALUES[ENGINE_LABELS[stored]]).toBe(stored);
  });

  it("D175 a vLLM provider reads as vLLM, and a general OpenAI-compatible one not as OpenRouter", () => {
    expect(ENGINE_LABELS.VLlm).toBe("vLLM");
    expect(ENGINE_LABELS.OpenAiCompatible).toBe("OpenAI-compatible (other)");
  });
});
