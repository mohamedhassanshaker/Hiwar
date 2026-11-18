import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuideBody } from "@/features/governance/components/guide-body";

/**
 * `UC-79.1-03`: a reader follows a link in a guide and that screen opens.
 *
 * The renderer understands one construct, `[label](/route)`, and accepts in-app paths only.
 * `gov.doc_page` is editable content, so a body is untrusted input at the rendering
 * boundary: a guide must not be able to become a link off the console.
 */
const render = (text: string) => renderToStaticMarkup(<GuideBody text={text} />);

describe("UC-79.1-03 links in a guide", () => {
  it("turns an in-app path into a link to that screen", () => {
    const html = render("Decisions wait in your [Inbox](/inbox).");
    expect(html).toContain('href="/inbox"');
    expect(html).toContain(">Inbox</a>");
  });

  it("links several screens in one body and keeps the text around them", () => {
    const html = render("See [Agents](/agents) and [Budgets](/budgets) for limits.");
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/budgets"');
    expect(html).toContain("for limits.");
  });

  it("leaves a body with no link untouched", () => {
    expect(render("Every money value is an estimate.")).toContain("Every money value is an estimate.");
  });
});

describe("a guide cannot send a reader off the console", () => {
  // Each of these is a target that is not a path on this console. None may become a link.
  const refused = [
    "[Click](http://evil.example/steal)",
    "[Click](https://evil.example)",
    "[Click](//evil.example)",
    "[Click](javascript:alert(1))",
    "[Click](mailto:someone@example.com)",
    "[Click](data:text/html,<script>alert(1)</script>)",
  ];

  for (const body of refused) {
    it(`refuses to link ${body}`, () => {
      const html = render(body);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("href=");
    });
  }

  it("escapes markup written into a body rather than rendering it", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
