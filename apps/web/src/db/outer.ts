import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";

/**
 * A column written as `"schema"."table"."column"`, for a correlated subquery.
 *
 * Interpolating a column into a `sql` template renders whatever qualification the builder
 * decided the surrounding query needed, which for a single-table select is the bare column
 * name. Inside a subquery that name resolves against the subquery's own tables first, so
 * `(select count(*) from core.person p where p.org_unit_id = ${orgUnit.id})` compares
 * `person.org_unit_id` with `person.id` and counts nothing — silently, because it is a
 * valid query. Every reference to the outer query's row goes through this.
 */
export function outer(column: PgColumn): SQL {
  const { name, schema } = getTableConfig(column.table as PgTable);
  return schema
    ? sql`${sql.identifier(schema)}.${sql.identifier(name)}.${sql.identifier(column.name)}`
    : sql`${sql.identifier(name)}.${sql.identifier(column.name)}`;
}
