/** WCAG contrast for brand colours (from AWP). */
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

/** The text colour to put on a brand colour: white when it clears AA, otherwise indigo ink. */
export function textOn(hex: string): string {
  return meetsAA(hex) ? "#ffffff" : "#1b1f4b";
}

/** Whether a value is a six-digit hex colour. */
export function isHex(value: string): boolean {
  return HEX.test(value);
}
