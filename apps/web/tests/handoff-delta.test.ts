import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const handoffDir = fileURLToPath(new URL("../../../docs/02-product-requirements", import.meta.url));

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const globalsCss = readFileSync(join(srcDir, "app", "globals.css"), "utf8");
const sources = sourceFiles(srcDir).map((path) => ({ path, text: readFileSync(path, "utf8") }));

/** CHANGELOG section 15: the responsive rules the handoff added to the style block. */
const RESPONSIVE_RULES = [
  ".awp-hamb,.awp-scrim,.awp-show-xs{display:none!important}",
  ".nav-open .awp-scrim{display:block!important}",
  ".awp-tbl{min-width:100%}",
  ":has(> .awp-tbl){overflow-x:auto}",
  "@media (max-width:480px)",
  "@media (min-width:761px) and (max-width:900px)",
  "@media (max-width:760px)",
];

/** CHANGELOG section 16: terms the handoff replaced. None may survive in the console. */
const SUPERSEDED_TERMS = [
  "منصة العمل الوكيلي",
  "مؤسسة تحصيل",
  "المالك",
  "غرف النقاش",
  "غرفة النقاش",
  "غرفة نقاش",
  "عناصر العمل",
  "عنصر العمل",
  "عنصر عمل",
  "العناصر الفرعية",
  "عنصر فرعي",
  "البريد الوارد",
  "المؤسسة",
  "الأشخاص والوكلاء",
  "غرفة عمليات",
  "الموصلات",
  "الميزانيات والتكاليف التقديرية",
  "سجل التدقيق",
  "التوثيق",
];

describe("handoff delta", () => {
  it("carries the style block of the handoff AWP Console.html verbatim", () => {
    const html = readFileSync(join(handoffDir, "prototype", "AWP Console.html"), "utf8");
    const style = /<style>\r?\n([\s\S]*?)\r?\n<\/style>/.exec(html);
    expect(style).not.toBeNull();
    const expected = style![1].replace(/\r\n/g, "\n");
    expect(globalsCss.replace(/\r\n/g, "\n").trimEnd()).toBe(expected.trimEnd());
  });

  it.each(RESPONSIVE_RULES)("globals.css has the responsive rule %s", (rule) => {
    expect(globalsCss).toContain(rule);
  });

  it.each(SUPERSEDED_TERMS)("no source file uses the superseded term %s", (term) => {
    const offenders = sources.filter((file) => file.text.includes(term)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("writes every auto-fit and auto-fill grid template in the minmax(min(Npx,100%),1fr) form", () => {
    const old = /repeat\(auto-fi(?:t|ll),minmax\((?!min\()/;
    const offenders = sources.filter((file) => old.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("has at least one auto-fit grid in the new form, so the rule above is not vacuous", () => {
    const used = sources.filter((file) => /repeat\(auto-fi(?:t|ll),minmax\(min\(/.test(file.text));
    expect(used.length).toBeGreaterThan(0);
  });
});
