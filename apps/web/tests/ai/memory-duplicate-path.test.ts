import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `UC-55.3-06`: a second memory at the same path is refused with a sentence the form can show.
 *
 * The driver wraps Postgres's unique-violation error, and the wrapper's own message is the
 * failed query with its parameters. The service used to look for the index name in that text,
 * missed it, and handed the query, with the person's id in it, to the toast.
 */

const repository = vi.hoisted(() => ({
  scopePathsVisibleTo: vi.fn(),
  createMemory: vi.fn(),
}));

vi.mock("@/features/memory/repository", () => repository);
vi.mock("@/features/memory/policy-service", () => ({
  PII_FILTER: "pii",
  readableScopes: vi.fn(),
  proposedBySelf: vi.fn(),
  assertReachable: vi.fn(),
}));
vi.mock("@/features/governance/service", () => ({ isFeatureEnabled: async () => false }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/session", () => ({
  can: vi.fn(),
  requirePermission: async () => ({ personId: "person-1", nameEn: "Mariam" }),
  visibleOrgUnitIds: async () => [],
}));

const { createMemory } = await import("@/features/memory/service");
const { MemoryRejected } = await import("@/features/memory/errors");

const input = {
  scopePath: "org",
  slug: "vendor-rules",
  titleEn: "Vendor rules",
  titleAr: "Vendor rules",
  content: "Check the list.",
  requiresReview: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  repository.scopePathsVisibleTo.mockResolvedValue(["org"]);
});

describe("creating a memory at a path that is taken", () => {
  it("says so in both languages when the driver wraps the unique violation", async () => {
    const wrapped = new Error('Failed query: insert into "ai"."memory" params: person-1', {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    repository.createMemory.mockRejectedValue(wrapped);

    const refusal = await createMemory(input).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(MemoryRejected);
    expect(refusal).toMatchObject({
      message: "There is already a memory at org/vendor-rules.",
      messageAr: expect.stringContaining("org/vendor-rules"),
    });
  });

  it("lets any other failure through unchanged", async () => {
    const failure = new Error("connection reset");
    repository.createMemory.mockRejectedValue(failure);

    await expect(createMemory(input)).rejects.toBe(failure);
  });
});
