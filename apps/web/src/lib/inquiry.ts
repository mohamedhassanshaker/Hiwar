/**
 * D388: a report's filters travel in the address, so an inquiry can be shared, reloaded and turned
 * into its PDF unchanged. These read them out of a query string and write them back.
 */

export type QueryValues = Record<string, string | string[] | undefined>;

/** The named fields of a query string, each the first value given or "" when absent. */
export function formOf<const K extends string>(query: QueryValues, fields: readonly K[]): Record<K, string> {
  const form = {} as Record<K, string>;
  for (const field of fields) {
    const value = query[field];
    form[field] = ((Array.isArray(value) ? value[0] : value) ?? "").trim();
  }
  return form;
}

/** The query string of a form, leaving out the fields that are empty. */
export function queryOf(form: Record<string, string>): string {
  const query = new URLSearchParams();
  for (const [field, value] of Object.entries(form)) if (value) query.set(field, value);
  return query.toString();
}

/** The most rows a list report holds. */
export const INQUIRY_PDF_ROWS = 2000;
