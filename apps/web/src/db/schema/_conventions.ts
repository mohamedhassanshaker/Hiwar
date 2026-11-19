import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
  type PgColumnBuilderBase,
} from "drizzle-orm/pg-core";

import { PRINCIPAL_TYPES } from "./enums";

/**
 * The conventions of `Tahseel_AWP_Data_Model.md` section 1 and the PostgreSQL mapping of
 * section 1.1, written once. Every table in `core`, `work`, `ai`, `gov` and `audit` builds
 * its columns from here, so an identifier, a bilingual name, a money amount or an audit
 * column looks the same everywhere.
 */

/** Section 1.1: `uuid` primary key, UUIDv7 from PostgreSQL 18's own generator. */
export const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/** A foreign key column that is written the same way everywhere it appears. */
export const ref = (name: string) => uuid(name);

/** Section 1.1: estimated money is `numeric(18,4)` in AED. */
export const money = (name: string) => numeric(name, { precision: 18, scale: 4, mode: "number" });

/** Section 1.1: UTC everywhere. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Section 1: `CreatedAt`, `CreatedBy`, `UpdatedAt`, `UpdatedBy`, `Version` on every mutable entity. */
export const audited = {
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  version: integer("version").notNull().default(1),
} satisfies Record<string, PgColumnBuilderBase>;

/** Section 1: user-named records carry `NameEn` and `NameAr`. */
export const bilingualName = {
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
} satisfies Record<string, PgColumnBuilderBase>;

/** The same pair for records the UI calls a title rather than a name. */
export const bilingualTitle = {
  titleEn: text("title_en").notNull(),
  titleAr: text("title_ar").notNull(),
} satisfies Record<string, PgColumnBuilderBase>;

/** Section 1.1: enumerations are `text` with a `CHECK`, never a native enum type. */
export const enumCheck = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql.raw(`${quote(column.name)} in (${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ")})`));

/** The same check for a column that may be null. */
export const optionalEnumCheck = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(
    name,
    sql.raw(`${quote(column.name)} is null or ${quote(column.name)} in (${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ")})`),
  );

/** A nullable column holding one of `PRINCIPAL_TYPES`. */
export const principalTypeCheck = (name: string, column: AnyPgColumn) => optionalEnumCheck(name, column, PRINCIPAL_TYPES);

/**
 * A table `CHECK` written as raw SQL. PostgreSQL rejects schema-qualified column names
 * inside a table constraint, and Drizzle's `sql` template qualifies every column it
 * interpolates, so a constraint over more than one column is written with bare names.
 */
export const rowCheck = (name: string, expression: string) => check(name, sql.raw(expression));

/** Section 1.1: `…Json` and `…Config` columns are objects, never arrays or scalars. */
export const jsonObjectCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql.raw(`${quote(column.name)} is null or jsonb_typeof(${quote(column.name)}) = 'object'`));

/**
 * Section 1.1: the normalised search key. `public.awp_normalise` is the immutable Arabic
 * and Latin normaliser created by `infra/postgres/01-extensions.sql`; it folds alef, yaa
 * and taa-marbuta forms, strips diacritics and lowercases, so a search matches whichever
 * letter form the writer used.
 */
export const searchKey = (name: string, ...sources: string[]) =>
  text(name).generatedAlwaysAs(
    (): SQL => sql.raw(`public.awp_normalise(${sources.map((s) => `coalesce(${quote(s)}, '')`).join(" || ' ' || ")})`),
  );

/** A `pg_trgm` GIN index over a normalised search key, for contains and fuzzy matching. */
export const trigramIndex = (name: string, column: AnyPgColumn) =>
  index(name).using("gin", sql`${column} gin_trgm_ops`);

/** A `jsonb_path_ops` GIN index over a dynamic-attribute column. */
export const jsonbIndex = (name: string, column: AnyPgColumn) =>
  index(name).using("gin", sql`${column} jsonb_path_ops`);

/** A GIN index over a `text[]` value list. */
export const arrayIndex = (name: string, column: AnyPgColumn) => index(name).using("gin", column);

/** Section 1: records that can be deactivated carry `IsActive`. */
export const isActive = () => boolean("is_active").notNull().default(true);

function quote(identifier: string): string {
  return `"${identifier}"`;
}
