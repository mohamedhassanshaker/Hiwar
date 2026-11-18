/** Small display helpers shared across features. Nothing here touches the database. */

/** A byte count as the console shows it on a file row. */
export function humanSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
