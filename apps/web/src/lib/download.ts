"use client";

/**
 * Handing a generated file to the browser.
 *
 * An export is built on the server — the rows are read with the caller's permissions and the
 * export is audited there — so what arrives here is text, not a URL. A blob and a temporary
 * anchor are the only way to save it without a round trip that would export twice.
 */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // The object URL holds the blob alive until it is revoked, and the click has already
  // taken a reference to it.
  URL.revokeObjectURL(url);
}
