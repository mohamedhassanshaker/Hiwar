import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  schemaFilter: ["public", "kb", "ai", "gov", "audit", "core"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://hiwar:hiwar@localhost:5433/hiwar" },
  strict: true,
});
