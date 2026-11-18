import { describe, expect, it } from "vitest";

import { ingestionFinished } from "@/features/knowledge/ingestion-poll";

/**
 * `UC-56.2-04`: the Knowledge screen stops polling and records the outcome exactly when the
 * run is actually over — not before, and not never.
 *
 * A collection that stayed at "Ingesting" forever, with a workflow that had already finished,
 * was this condition checking only "idle" when the workflow's own terminal stage is "done".
 */
describe("ingestionFinished", () => {
  it("is true for the workflow's own terminal stage", () => {
    expect(ingestionFinished("done")).toBe(true);
  });

  it("is true once the run has aged out of Temporal", () => {
    expect(ingestionFinished("idle")).toBe(true);
  });

  it("is false while the run is still going", () => {
    expect(ingestionFinished("queued")).toBe(false);
    expect(ingestionFinished("parsing")).toBe(false);
    expect(ingestionFinished("indexing")).toBe(false);
    expect(ingestionFinished("extracting")).toBe(false);
  });

  it("is false for an unrecognised stage, rather than assuming the run is over", () => {
    expect(ingestionFinished("unknown")).toBe(false);
  });
});
