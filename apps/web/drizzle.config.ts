import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  schemaFilter: ["core", "work", "ai", "gov", "audit"],
  strict: true,
  verbose: true,
});
