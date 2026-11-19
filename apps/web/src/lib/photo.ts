/**
 * What may be put in `core.person.photo_ref`, and what may be read out of it.
 *
 * The column has two writers — My profile's upload, and the OIDC adapter copying the
 * identity provider's `picture` claim — and one reader that interpolates it into a CSS
 * `url(...)` on every avatar the console draws. A value carrying `)` or `;` would close
 * that function and add declarations to everybody else's screen, so both ends go through
 * here: the writers store nothing else, and the avatar renders nothing else.
 */

/** A profile photo uploaded on My profile: base64 PNG, JPEG or WebP and nothing else. */
export const PHOTO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

/** A photo the identity provider hosts. No quote, bracket, space or semicolon in sight. */
const PHOTO_HTTPS_URL = /^https:\/\/[^\s"'()\;<>]+$/;

/** Whether the value is an uploaded photo data URL or an HTTPS URL safe to put in a CSS `url(...)`. */
export function isSafePhotoRef(value: string): boolean {
  return PHOTO_DATA_URL.test(value) || PHOTO_HTTPS_URL.test(value);
}

/** The value, or `null` when it is not one the console is willing to render. */
export function safePhotoRef(value: string | null | undefined): string | null {
  return typeof value === "string" && isSafePhotoRef(value) ? value : null;
}
