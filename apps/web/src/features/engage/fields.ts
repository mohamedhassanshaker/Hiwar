/**
 * The typed fields a storyline asks for (widget specification section 6.3, D231).
 *
 * Pure, so the server checks a value with the same rules the widget shows as hints. The
 * widget's checks only help the visitor; the server's are the ones that decide.
 */

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "amount",
  "phone",
  "email",
  "date",
  "time",
  "datetime",
  "select",
  "multiselect",
  "lookup",
  "file",
  "otp",
  "consent",
  "location",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldSpec = {
  type: FieldType;
  /** What the field is called when the widget echoes it back ("Got it: account 1.234"). */
  labelEn?: string;
  labelAr?: string;
  placeholder?: string;
  /** A regular expression the whole value must match. */
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  /** For numbers and amounts, or the earliest and latest ISO date. */
  min?: number | string;
  max?: number | string;
  step?: number;
  minItems?: number;
  maxItems?: number;
  /** For a file: accepted media types or extensions, and limits. */
  accept?: string[];
  maxSizeMb?: number;
  maxFiles?: number;
  help?: string;
  /** Shown as dots once entered, in the transcript and the echo. */
  mask?: boolean;
  /** Free text is still allowed beside the control (Guided steps). */
  allowFreeText?: boolean;
  /** An example of a valid value, for the error message and "Show me an example". */
  example?: string;
};

export type FieldCheck = { ok: true; value: string } | { ok: false; en: string; ar: string };

const refuse = (en: string, ar: string): FieldCheck => ({ ok: false, en, ar });

const withExample = (spec: FieldSpec, en: string, ar: string): FieldCheck =>
  spec.example ? refuse(`${en} For example: ${spec.example}`, `${ar} مثال: ${spec.example}`) : refuse(en, ar);

/** E.164, or a UAE number written locally, which is read as +971. */
function phoneOf(text: string): string | null {
  const digits = text.replace(/[\s()-]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  if (/^00[1-9]\d{6,14}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^0?5\d{8}$/.test(digits)) return `+971${digits.replace(/^0/, "")}`;
  return null;
}

/** An ISO date, time or date-time, as the picker sends it. */
function isoOf(type: "date" | "time" | "datetime", text: string): string | null {
  const value = text.trim();
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
  if (type === "time") return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
  return !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value : null;
}

/**
 * Whether a value is one the field accepts, and the value as it is stored.
 *
 * `choices` are the step's options, for select and multiselect: a value must be one of them.
 */
export function checkField(spec: FieldSpec, raw: string, choices: { value: string; en: string; ar: string }[] = []): FieldCheck {
  const text = raw.trim();
  if (text === "") return refuse("This is needed to continue.", "هذا مطلوب للمتابعة.");

  switch (spec.type) {
    case "number":
    case "amount": {
      const value = Number(text.replace(/,/g, "").replace(/^(aed|د\.إ)\s*/i, ""));
      if (!Number.isFinite(value)) return withExample(spec, "Enter a number.", "أدخل رقماً.");
      if (typeof spec.min === "number" && value < spec.min) return refuse(`The smallest allowed is ${spec.min}.`, `أقل قيمة مسموحة ${spec.min}.`);
      if (typeof spec.max === "number" && value > spec.max) return refuse(`The largest allowed is ${spec.max}.`, `أكبر قيمة مسموحة ${spec.max}.`);
      return { ok: true, value: String(value) };
    }
    case "phone": {
      const value = phoneOf(text);
      return value ? { ok: true, value } : withExample(spec, "Enter a mobile number, for example +971 50 123 4567.", "أدخل رقم هاتف متحرك، مثل ‎+971 50 123 4567.");
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? { ok: true, value: text } : refuse("Enter an email address, for example name@example.com.", "أدخل بريداً إلكترونياً، مثل name@example.com.");
    case "date":
    case "time":
    case "datetime": {
      const value = isoOf(spec.type, text);
      if (!value) return withExample(spec, "Choose a valid date or time.", "اختر تاريخاً أو وقتاً صحيحاً.");
      if (typeof spec.min === "string" && value < spec.min) return refuse(`Choose ${spec.min} or later.`, `اختر ${spec.min} أو بعده.`);
      if (typeof spec.max === "string" && value > spec.max) return refuse(`Choose ${spec.max} or earlier.`, `اختر ${spec.max} أو قبله.`);
      return { ok: true, value };
    }
    case "select": {
      const hit = choices.find((choice) => [choice.value, choice.en, choice.ar].some((label) => label.toLowerCase() === text.toLowerCase()));
      return hit ? { ok: true, value: hit.value } : refuse("Choose one of the options.", "اختر أحد الخيارات.");
    }
    case "multiselect": {
      const picked = text.split(/\s*[,،]\s*/).filter(Boolean);
      const values = picked.map((one) => choices.find((choice) => [choice.value, choice.en, choice.ar].some((label) => label.toLowerCase() === one.toLowerCase()))?.value);
      if (values.some((value) => !value)) return refuse("Choose from the options.", "اختر من الخيارات.");
      if (spec.minItems && values.length < spec.minItems) return refuse(`Choose at least ${spec.minItems}.`, `اختر ${spec.minItems} على الأقل.`);
      if (spec.maxItems && values.length > spec.maxItems) return refuse(`Choose at most ${spec.maxItems}.`, `اختر ${spec.maxItems} كحد أقصى.`);
      return { ok: true, value: values.join(",") };
    }
    case "consent":
      return /^(agree|i agree|yes|أوافق|نعم)$/i.test(text) ? { ok: true, value: "agreed" } : refuse("Agree to continue, or cancel.", "وافق للمتابعة أو ألغِ.");
    case "otp":
      return /^\d{6}$/.test(text) ? { ok: true, value: text } : refuse("Enter the 6-digit code.", "أدخل الرمز المكوّن من 6 أرقام.");
    case "file":
      // The upload endpoint returns an id; the step stores it.
      return /^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/i.test(text) ? { ok: true, value: text } : refuse("Upload a file to continue.", "ارفع ملفاً للمتابعة.");
    default: {
      if (spec.minLength && text.length < spec.minLength) return withExample(spec, `Enter at least ${spec.minLength} characters.`, `أدخل ${spec.minLength} أحرف على الأقل.`);
      if (spec.maxLength && text.length > spec.maxLength) return refuse(`Keep it to ${spec.maxLength} characters.`, `لا تتجاوز ${spec.maxLength} حرفاً.`);
      if (spec.pattern && !new RegExp(spec.pattern).test(text)) return withExample(spec, "That does not look right.", "يبدو أن القيمة غير صحيحة.");
      return { ok: true, value: text };
    }
  }
}

/** A stored value as the transcript and the echo show it: dots when the field masks it. */
export function shown(spec: FieldSpec | undefined, value: string): string {
  if (!spec?.mask) return value;
  return value.length <= 2 ? "••" : `${"•".repeat(Math.max(2, value.length - 2))}${value.slice(-2)}`;
}

/**
 * The values in a free-text message that later fields recognise by their pattern, so a
 * Guided step can take several at once ("home internet, account 1.23456789").
 */
export function extractByPattern(text: string, fields: { slot: string; spec: FieldSpec }[]): Record<string, string> {
  const found: Record<string, string> = {};
  for (const { slot, spec } of fields) {
    if (!spec.pattern) continue;
    const loose = new RegExp(spec.pattern.replace(/^\^/, "").replace(/\$$/, ""));
    const match = loose.exec(text);
    if (!match) continue;
    const checked = checkField(spec, match[0]);
    if (checked.ok) found[slot] = checked.value;
  }
  return found;
}
