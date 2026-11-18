/**
 * The key an attribute is stored under, from the label a designer typed (`UC-30.3-01`).
 *
 * A key is lower case, digits and underscores, starting with a letter, because it is what a
 * routing condition names (`amount_aed >= 5000`). The designer types a label such as
 * "Entity name"; asking them to also invent a key in a syntax they have not seen is what
 * made "Add attribute" fail. A label with no Latin letters (Arabic) falls back to
 * `attribute`, and a key already taken gets a number.
 */
export function attributeKeyFor(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "a_$1")
      .slice(0, 50) || "attribute";
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
}
