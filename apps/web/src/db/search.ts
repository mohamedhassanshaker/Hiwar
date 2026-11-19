import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * `text` with `\`, `%` and `_` escaped, so a `like` pattern built from it matches it literally.
 * Backslash is PostgreSQL's default `like` escape character.
 */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/**
 * Whether `target` contains `term`, with `term` normalised by `public.awp_normalise` (NFR-21:
 * Arabic letter forms and diacritics fold) and matched literally. `target` is a `search_key`
 * column, already normalised, or an expression that normalises.
 */
export function containsTerm(target: AnyPgColumn | SQL, term: string): SQL {
  return sql`${target} like '%' || public.awp_normalise(${likeLiteral(term)}) || '%'`;
}
