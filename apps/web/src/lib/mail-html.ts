import sanitizeHtml from "sanitize-html";

/**
 * D247: email bodies are HTML a settings writer edits in a rich text editor. The HTML is
 * sanitised when it is saved and again when it is sent, a value filled into it is escaped,
 * and every email also carries a plain-text copy derived from it.
 */

const ALLOWED: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "code", "pre", "hr"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["http", "https", "mailto"],
};

/** The HTML with everything an email body may not carry removed: scripts, styles, handlers. */
export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, ALLOWED);
}

/** The value with `&`, `<`, `>`, `"` and `'` escaped, for filling into an email's HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A body written as plain text before bodies were HTML: paragraphs at blank lines, breaks within. */
export function textToHtml(text: string): string {
  if (/<\/?(p|br|strong|b|em|i|u|s|a|ul|ol|li|h[1-3]|blockquote|code|pre|hr)\b[^>]*>/i.test(text)) return text;
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** `{{name}}` filled from `values`; an unknown placeholder is left empty. */
export function fill(template: string, values: Record<string, string>, escape: (value: string) => string = (value) => value): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_whole, name: string) => escape(values[name] ?? ""));
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** The plain-text copy of an HTML body: lines and list items kept, a link's address after its text. */
export function htmlToText(html: string): string {
  const marked = html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_whole, href: string, text: string) => (text.trim() && text.trim() !== href ? `${text} (${href})` : href))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|h[1-3]|blockquote|pre|li|ul|ol)>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n----\n");
  const stripped = sanitizeHtml(marked, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

/** One email from a template: the subject on one line, the HTML body sanitised, and its text copy. */
export function renderMail(template: { subject: string; body: string }, values: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = fill(template.subject, values).replace(/\s+/g, " ").trim();
  const html = sanitizeMailHtml(fill(textToHtml(template.body), values, escapeHtml));
  return { subject, html, text: htmlToText(html) };
}
