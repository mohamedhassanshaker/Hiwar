import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The "working" dots must still show activity for a person whose system asks for reduced motion (Remote Desktop does). */
const css = readFileSync(fileURLToPath(new URL("../src/app/dash3.css", import.meta.url)), "utf8");

describe("the typing indicator under reduced motion", () => {
  it("should_pulse_the_dots_by_opacity_without_moving_them", () => {
    const reduced = /@media \(prefers-reduced-motion:reduce\)\{[^@]*?\.d3a-typing i\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(reduced).toContain("animation:d3a-fade");
    expect(reduced).toContain("transform:none");
    const fade = /@keyframes d3a-fade\{([^@]*?)\}\s*(?:@|\/\*|$)/.exec(css)?.[1] ?? "";
    expect(fade).toContain("opacity");
    expect(fade).not.toContain("transform");
  });
});
