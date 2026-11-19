/**
 * How a file of a skill package is shown, from its extension: as text, as an image, or by its
 * size with a download. Pure, so the screen and the route that serves the bytes agree.
 */

const TEXT = new Set([
  "md", "markdown", "txt", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "yaml", "yml", "toml",
  "csv", "tsv", "sh", "bash", "ps1", "bat", "rb", "html", "htm", "css", "xml", "svg", "sql", "ini", "cfg",
  "j2", "jinja", "env", "log",
]);

/** Raster images only: an SVG is shown as text, because served inline it could run script. */
const IMAGES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);

export type FileKind = "text" | "image" | "other";

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileKind(path: string): FileKind {
  const extension = extensionOf(path);
  if (IMAGES.has(extension)) return "image";
  return TEXT.has(extension) ? "text" : "other";
}

/** The type a file is served with: never one the browser would run as a page. */
export function contentTypeOf(path: string): string {
  const image = IMAGES.get(extensionOf(path));
  if (image) return image;
  return fileKind(path) === "text" ? "text/plain; charset=utf-8" : "application/octet-stream";
}
