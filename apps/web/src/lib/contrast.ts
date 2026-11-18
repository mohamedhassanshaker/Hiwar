import { Rejected } from "./rejection";

/**
 * WCAG 2.2 contrast, written once so the Settings screen and the server action that saves a
 * brand colour apply the same rule.
 *
 * Specification 7.5.5 is that contrast is checked against WCAG 2.2 AA before a brand colour
 * is saved, and `UC-75.2-04` is that a failing colour blocks the save and offers an
 * accessible alternative. The check has to run on the server: the chosen colour is applied
 * to buttons, links, active navigation and the embedded widget, so a forced call that
 * bypassed the screen would put the whole console below AA (NFR-18, `COM-08`).
 */

/** WCAG 2.2 AA for normal text and user-interface components. */
export const AA_CONTRAST = 4.5;

/** The six-digit hex form the settings schema accepts, for example `#0677FF`. */
const HEX = /^#[0-9a-fA-F]{6}$/;

function channels(hex: string): number[] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

/** Relative luminance as WCAG 2.2 defines it. */
function luminance(hex: string): number {
  const linear = channels(hex)
    .map((value) => value / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/**
 * The contrast ratio of a colour against white, which is what a primary button shows: white
 * label on the brand colour. Rounded to two decimals, which is what the screen displays.
 */
export function contrastAgainstWhite(hex: string): number {
  return Math.round((1.05 / (luminance(hex) + 0.05)) * 100) / 100;
}

/** Whether a brand colour clears WCAG 2.2 AA against white. */
export function meetsAA(hex: string): boolean {
  return contrastAgainstWhite(hex) >= AA_CONTRAST;
}

/**
 * The nearest darker colour that clears AA, which `UC-75.2-04` offers as the suggestion.
 * Returns the colour unchanged when it already passes. Twenty steps of 10% reach black from
 * any starting colour, so the loop always terminates with a passing value.
 */
export function accessibleAlternative(hex: string): string {
  let colour = hex;
  for (let step = 0; step < 20 && !meetsAA(colour); step += 1) {
    colour = `#${channels(colour)
      .map((value) => Math.max(0, Math.round(value * 0.9)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return colour;
}

/** Raised when a brand colour fails the check, carrying the suggestion to show the user. */
export class ContrastError extends Rejected {
  readonly contrast: number;
  readonly suggestion: string;

  constructor(hex: string) {
    const contrast = contrastAgainstWhite(hex);
    const suggestion = accessibleAlternative(hex);
    super(
      `Contrast ${contrast}:1 against white is below WCAG 2.2 AA (${AA_CONTRAST}:1). Try ${suggestion}.`,
      `تباين ${contrast}:1 مع الأبيض دون معيار WCAG 2.2 AA (${AA_CONTRAST}:1). جرّب ${suggestion}.`,
    );
    this.name = "ContrastError";
    this.contrast = contrast;
    this.suggestion = suggestion;
  }
}

/**
 * Throws unless the colour is a six-digit hex that clears AA. The server calls this before
 * writing, so the rule holds whatever the caller is.
 *
 * @throws {ContrastError} when the colour is below WCAG 2.2 AA against white.
 * @throws {Error} when the colour is not a six-digit hex.
 */
export function assertAccessibleBrandColour(hex: string): void {
  if (!HEX.test(hex)) throw new Error("Use a six-digit hex colour.");
  if (!meetsAA(hex)) throw new ContrastError(hex);
}
