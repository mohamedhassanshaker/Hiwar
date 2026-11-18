import { z } from "zod";
import { describe, expect, it } from "vitest";

import "@/lib/zod-config";

/** A strict CSP blocks zod's `new Function` probe and Firefox logs it on every page; jitless skips the probe. */
describe("zod configuration", () => {
  it("should_run_without_the_just_in_time_compiler_so_a_strict_csp_sees_no_eval", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("should_still_validate_with_the_interpreted_path", () => {
    const schema = z.object({ name: z.string().min(2) });
    expect(schema.safeParse({ name: "ok" }).success).toBe(true);
    expect(schema.safeParse({ name: "x" }).success).toBe(false);
  });
});
