import { describe, expect, it } from "vitest";

import { htmlToText, renderMail, sanitizeMailHtml, textToHtml } from "@/lib/mail-html";

/** D247: email bodies are rich HTML, and nothing in them or filled into them can run. */
describe("email HTML", () => {
  it("keeps formatting and links, and drops scripts, handlers and unsafe links", () => {
    const html = sanitizeMailHtml(
      '<p onclick="x()"><strong>Hi</strong> <a href="https://a.example/x" target="_blank">there</a></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><img src=x onerror=y>',
    );
    expect(html).toBe('<p><strong>Hi</strong> <a href="https://a.example/x">there</a></p><a>bad</a>');
  });

  it("escapes a value filled into the body, so a title cannot add markup", () => {
    const email = renderMail(
      { subject: "{{key}} {{title}}", body: '<p>{{title}}</p><p><a href="{{link}}">Open</a></p>' },
      { key: "REQ-1", title: '<img src=x onerror=alert(1)> & "more"', link: "https://awp.example/requests?open=REQ-1&x=1" },
    );
    expect(email.subject).toBe('REQ-1 <img src=x onerror=alert(1)> & "more"');
    expect(email.html).toBe('<p>&lt;img src=x onerror=alert(1)&gt; &amp; "more"</p><p><a href="https://awp.example/requests?open=REQ-1&amp;x=1">Open</a></p>');
    expect(email.text).toBe('<img src=x onerror=alert(1)> & "more"\nOpen (https://awp.example/requests?open=REQ-1&x=1)\n');
  });

  it("reads a body saved as plain text before bodies were HTML", () => {
    expect(textToHtml("{{title}}\n\n{{key}} is <done>.\nOpen it: {{link}}\n")).toBe("<p>{{title}}</p><p>{{key}} is &lt;done&gt;.<br>Open it: {{link}}</p>");
    expect(textToHtml("<p>already HTML</p>")).toBe("<p>already HTML</p>");
  });

  it("gives the plain-text copy its lines and list items", () => {
    expect(htmlToText("<h2>Title</h2><ul><li>one</li><li>two</li></ul><p>a<br>b</p>")).toBe("Title\n- one\n- two\n\na\nb\n");
  });
});
