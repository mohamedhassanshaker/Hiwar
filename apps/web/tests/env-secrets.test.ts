import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { env, resetEnvCache } from "@/lib/env";

/**
 * `.env.example` publishes working values so a laptop runs out of the box. Each one is
 * therefore a known key: `APP_KEK` is 32 zero bytes, so every connector, channel and
 * provider credential it wraps is readable by anyone who can read the repository;
 * `RUN_TOKEN_SIGNING_KEY` forges an agent identity against the platform MCP server.
 *
 * The schema cannot catch a deployment that kept them — the example `APP_KEK` is a
 * well-formed 32-byte key — so production fails closed on them (NFR-10, NFR-13, and
 * integrity rule 8 of the data model).
 */
const EXAMPLE = {
  APP_KEK: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_SECRET: "dev-secret-change-me",
  RUN_TOKEN_SIGNING_KEY: "dev-run-token-key",
};

const REAL = {
  APP_KEK: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SECRET: "a-real-session-secret",
  RUN_TOKEN_SIGNING_KEY: "a-real-run-token-key",
};

let saved: NodeJS.ProcessEnv;

/**
 * `NODE_ENV` is typed read-only by the Next.js environment types, which is right for
 * application code and wrong for a case whose whole subject is what production does.
 */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  saved = { ...process.env };
  resetEnvCache();
  process.env.DATABASE_URL = "postgresql://unused/awp";
  delete process.env.NEXT_PHASE;
});

afterEach(() => {
  process.env = saved;
  resetEnvCache();
});

describe("published example secrets", () => {
  it("are refused in production, naming every one still in use", () => {
    setNodeEnv("production");
    Object.assign(process.env, EXAMPLE);

    expect(() => env()).toThrowError(/APP_KEK, AUTH_SECRET, RUN_TOKEN_SIGNING_KEY/);
  });

  it("are refused even when only one of them was left behind", () => {
    setNodeEnv("production");
    Object.assign(process.env, REAL, { APP_KEK: EXAMPLE.APP_KEK });

    expect(() => env()).toThrowError(/APP_KEK/);
  });

  it("do not block development, which is what they exist for", () => {
    setNodeEnv("development");
    Object.assign(process.env, EXAMPLE);

    expect(() => env()).not.toThrow();
  });

  it("do not fail the build, which runs with NODE_ENV=production on a developer's machine", () => {
    // `next build` prerenders route handlers and so reads the building machine's
    // environment. Refusing there would fail every local build and teach people to delete
    // the check; the guard is about serving, not compiling.
    setNodeEnv("production");
    process.env.NEXT_PHASE = "phase-production-build";
    Object.assign(process.env, EXAMPLE);

    expect(() => env()).not.toThrow();
  });

  it("let production start once the values are real", () => {
    setNodeEnv("production");
    Object.assign(process.env, REAL);

    expect(() => env()).not.toThrow();
    expect(env().APP_KEK).toBe(REAL.APP_KEK);
  });
});
