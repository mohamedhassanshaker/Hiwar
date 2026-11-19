import { describe, expect, it, vi } from "vitest";

/** `UC-53.2`: the label an updated skill's new version gets, never one the skill already has. */

vi.mock("@/lib/session", () => ({ requireOrganisationPermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/objects", () => ({ buckets: { skills: "skills" }, putObject: vi.fn() }));
vi.mock("@/features/skills/repository", () => ({}));

const { nextVersionLabel } = await import("@/features/skills/import-service");

describe("nextVersionLabel", () => {
  it("should_take_the_next_minor_of_a_semantic_version", () => {
    expect(nextVersionLabel("1.0.0", ["1.0.0"])).toBe("1.1.0");
    expect(nextVersionLabel("2.3.4", ["2.3.4"])).toBe("2.4.0");
  });

  it("should_count_on_from_a_v_numbered_label_as_authored_skills_have", () => {
    expect(nextVersionLabel("v1", ["v1"])).toBe("v2");
  });

  it("should_add_a_counter_to_any_other_label", () => {
    expect(nextVersionLabel("draft", ["draft"])).toBe("draft-2");
  });

  it("should_skip_a_label_the_skill_already_has", () => {
    expect(nextVersionLabel("1.0.0", ["1.0.0", "1.1.0", "1.2.0"])).toBe("1.3.0");
    expect(nextVersionLabel("v1", ["v1", "v2"])).toBe("v3");
  });
});
