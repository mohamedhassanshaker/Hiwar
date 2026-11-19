import type { ZodError, ZodIssue } from "zod";

/**
 * Turns an input a schema refused into the `{ ok:false, message, messageAr }` a form shows.
 *
 * A server action that parses its input outside a `try` throws on a value the person typed,
 * and a thrown server error replaces the whole screen with "Something went wrong". An
 * out-of-range number or a too-long name is an ordinary refusal: it must come back as a value,
 * name the field and say the rule, in both console languages (specification section 9).
 */

/** What a field is called in English and in Arabic, keyed by the first segment of its path. */
export type FieldNames = Record<string, readonly [en: string, ar: string]>;

export type InputRefusal = { ok: false; message: string; messageAr: string };

const FALLBACK_FIELD = ["This value", "هذه القيمة"] as const;

/** One issue as the pair of sentences; a check that carries its own `params.ar` keeps its wording. */
function sentences(issue: ZodIssue, fields: FieldNames): readonly [string, string] {
  const customAr = (issue as { params?: { ar?: string } }).params?.ar;
  if (customAr) return [issue.message, customAr];

  const [en, ar] = fields[String(issue.path[0])] ?? FALLBACK_FIELD;
  if (issue.code === "too_small" || issue.code === "too_big") {
    const isMax = issue.code === "too_big";
    const limit = Number(isMax ? issue.maximum : issue.minimum);
    if (issue.origin === "string") {
      return isMax
        ? [`${en} must be at most ${limit} characters.`, `يجب ألا يزيد ${ar} عن ${limit} حرفًا.`]
        : [`${en} must be at least ${limit} characters.`, `يجب ألا يقل ${ar} عن ${limit} حرفًا.`];
    }
    if (issue.origin === "array") {
      return isMax
        ? [`${en} must have at most ${limit} entries.`, `يجب ألا يزيد عدد ${ar} عن ${limit}.`]
        : [`${en} must have at least ${limit} entries.`, `يجب ألا يقل عدد ${ar} عن ${limit}.`];
    }
    return isMax
      ? [`${en} must be at most ${limit}.`, `يجب ألا يزيد ${ar} عن ${limit}.`]
      : [`${en} must be at least ${limit}.`, `يجب ألا يقل ${ar} عن ${limit}.`];
  }
  if (issue.code === "invalid_format" && issue.format === "url") {
    return [`${en} must be a web address such as https://example.com.`, `يجب أن يكون ${ar} عنوان ويب مثل https://example.com.`];
  }
  if (issue.code === "invalid_type") {
    return String(issue.expected) === "int"
      ? [`${en} must be a whole number.`, `يجب أن يكون ${ar} عددًا صحيحًا.`]
      : [`${en} is required.`, `${ar} مطلوب.`];
  }
  return [`${en} is not valid.`, `${ar} غير صالح.`];
}

/**
 * The refusal for a failed parse: every issue's sentence, English and Arabic side by side.
 *
 * @param error the schema error from `safeParse`.
 * @param fields what the schema's top-level fields are called on screen.
 */
export function inputRefusal(error: ZodError, fields: FieldNames = {}): InputRefusal {
  const pairs = error.issues.map((issue) => sentences(issue, fields));
  return { ok: false, message: pairs.map(([en]) => en).join(" "), messageAr: pairs.map(([, ar]) => ar).join(" ") };
}
