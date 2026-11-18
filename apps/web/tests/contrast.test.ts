import { describe, expect, it } from "vitest";

import {
  AA_CONTRAST,
  ContrastError,
  accessibleAlternative,
  assertAccessibleBrandColour,
  contrastAgainstWhite,
  meetsAA,
} from "@/lib/contrast";

/**
 * Specification 7.5.5: a brand colour is checked against WCAG 2.2 AA before it is saved.
 * `UC-75.2-04` is that a failing colour blocks the save and a suggestion is offered, and
 * NFR-18 is that the console stays at AA — the colour reaches buttons, links, active
 * navigation and the embedded widget, so this is the check that keeps the whole console
 * above the line.
 */
describe("UC-75.2-03 contrast of a brand colour against white", () => {
  it("computes the WCAG 2.2 ratio", () => {
    // Black on white is the maximum ratio WCAG defines, and white on white the minimum.
    expect(contrastAgainstWhite("#000000")).toBe(21);
    expect(contrastAgainstWhite("#ffffff")).toBe(1);
  });

  it("reads a six-digit hex case-insensitively", () => {
    expect(contrastAgainstWhite("#0677FF")).toBe(contrastAgainstWhite("#0677ff"));
  });
});

describe("UC-75.2-04 a colour that fails the check", () => {
  // Pale yellow on white is the classic failure: legible to a designer, not to everyone.
  const failing = "#ffe066";

  it("is refused by the server, not only disabled on the screen", () => {
    expect(meetsAA(failing)).toBe(false);
    expect(() => assertAccessibleBrandColour(failing)).toThrow(ContrastError);
  });

  it("carries a suggestion that itself passes", () => {
    let thrown: unknown;
    try {
      assertAccessibleBrandColour(failing);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ContrastError);
    const suggestion = (thrown as ContrastError).suggestion;
    expect(meetsAA(suggestion)).toBe(true);
    expect(contrastAgainstWhite(suggestion)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("leaves a passing colour alone", () => {
    const passing = "#12034B";
    expect(meetsAA(passing)).toBe(true);
    expect(accessibleAlternative(passing)).toBe(passing);
    expect(() => assertAccessibleBrandColour(passing)).not.toThrow();
  });

  it("rejects anything that is not a six-digit hex", () => {
    for (const bad of ["#fff", "0677FF", "#gggggg", ""]) {
      expect(() => assertAccessibleBrandColour(bad)).toThrow();
    }
  });

  it("always terminates on a suggestion, however pale the colour", () => {
    // Darkening by 10% a bounded number of times must reach a passing colour from white,
    // which is the worst case.
    expect(meetsAA(accessibleAlternative("#ffffff"))).toBe(true);
  });
});
