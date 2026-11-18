"use client";

import Link from "next/link";
import { Fragment } from "react";

/**
 * Renders a documentation body, turning `[label](/route)` into a link to that screen.
 *
 * `UC-79.1-03` is that a reader can follow a link in a guide to the screen it describes.
 * This is deliberately not a Markdown renderer: a guide body needs one construct, and a
 * full parser would be a dependency and a sink for whatever ends up in `gov.doc_page`.
 *
 * **In-app paths only.** A target must start with a single `/`. That rules out `http:`,
 * `javascript:`, protocol-relative `//host` and anything else that could take a reader off
 * the console or execute, so a guide cannot become a phishing surface whatever is written
 * into the table. Anything that does not match is left as the literal text it was, and
 * React escapes it.
 */

/** `[label](/path)` — the label stops at the first `]`, the target at the first `)`. */
const LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

/** A target that is a path on this console, not a URL somewhere else. */
function isInAppPath(target: string): boolean {
  return target.startsWith("/") && !target.startsWith("//");
}

/** A guide body as one paragraph, with each in-app `[label](/path)` drawn as a link. */
export function GuideBody({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK)) {
    const [whole, label, target] = match;
    const start = match.index ?? 0;
    if (start > cursor) parts.push(text.slice(cursor, start));

    if (isInAppPath(target)) {
      parts.push(
        <Link key={`${start}-${target}`} href={target} className="awp-link">
          {label}
        </Link>,
      );
    } else {
      // Not a path this console can serve: show what was written rather than linking it.
      parts.push(whole);
    }
    cursor = start + whole.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <p style={{ margin: 0, lineHeight: 1.7, maxWidth: 680 }}>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </p>
  );
}
